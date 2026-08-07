"""Stage -> run -> ALWAYS clean up a WP's blind test sets, with PROOF OF EXECUTION.

Worker 3 tooling for the Canvas V2 batches.

WP55 rewrite. The previous version had THREE independent no-op paths, each of
which made a never-executed blind set indistinguishable from a passing one:

  1. Filenames were copied verbatim. `test_foo_blind1.ts` matches no vitest
     discovery glob, so vitest printed "No test files found" and exited 0,
     which the runner reported as a pass. 46 files project-wide were affected.
  2. Staging depth was hardcoded to three levels below `<pkg>/src`. Depth is a
     PER-SET property derived from that set's own relative imports: WP1 needs 3,
     WP46 needs 2. A blanket shift would have broken every set that worked.
  3. The target package was hardcoded to `plugin/`. WP41 imports
     `../../mux-protocol` and belongs to `server/`.

The structural guarantee this module now provides:

    A set is reported PASS only if a STRUCTURED reporter artefact says a
    non-zero number of tests were collected and none failed.
    A process exit code of 0 is never by itself accepted as evidence.

Zero collected tests is a hard failure under the named reason ZERO_COLLECTION.

Usage:  python _run_blind.py <WP-number> [set1|set2|both] [--ts-only|--py-only]
        python _run_blind.py --selftest        (falsification harness, WP55 DoD)

Guarantees:
  - staging dirs are removed in a finally block, on success, failure and
    KeyboardInterrupt (a leftover staging dir leaks blind tests to the next
    coder sub-agent -- recorded as B1 process failure #3)
  - staged copies are byte-identical to the authored file (sha256-verified);
    only the NAME is normalised, and files under tests/blind_set*/ are never
    written to
  - counts come from vitest's JSON reporter / pytest's JUnit XML, never from
    parsing reporter prose
  - one machine-readable record per (WP, set) is written to _blind_records/
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------
# Make this runner encoding-safe on its own. A failing set prints unicode box
# characters; on a Windows cp1252 console the old runner died with
# UnicodeEncodeError *while reporting a failure*, which is the worst possible
# moment to lose the output.
# --------------------------------------------------------------------------
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - very old Python / redirected stream
        pass

ART = Path(__file__).resolve().parent
REPO = ART.parent.parent
RECORDS = ART / "_blind_records"
RAW = RECORDS / "_raw"

PACKAGES = ("plugin", "server")


def stage_roots() -> list[Path]:
    """Staging roots that must be absent after every run, for every package.

    Two shapes are needed because depth 1 cannot live under __tests__/v2blind/.
    """
    roots: list[Path] = []
    for pkg in PACKAGES:
        roots.append(REPO / pkg / "src" / "__tests__" / "v2blind")
        roots.append(REPO / pkg / "src" / "v2blind_d1")
    return roots


# --------------------------------------------------------------------------
# Module-specifier extraction
# --------------------------------------------------------------------------
SPEC_RE = re.compile(
    r"""(?:
        \bfrom\s*['"](?P<a>[^'"]+)['"]
      | \bimport\s+['"](?P<b>[^'"]+)['"]
      | \bimport\s*\(\s*['"](?P<c>[^'"]+)['"]
      | \brequire\s*\(\s*['"](?P<d>[^'"]+)['"]
      | \bvi\.(?:mock|doMock|unmock|importActual|importMock)\s*\(\s*['"](?P<e>[^'"]+)['"]
      | \bimportActual\s*(?:<[^>]*>)?\s*\(\s*['"](?P<f>[^'"]+)['"]
    )""",
    re.X,
)

#: Extension candidates tried when resolving a TS/JS specifier to a real file.
_EXT_CANDIDATES = ("", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts")
_INDEX_CANDIDATES = ("index.ts", "index.tsx", "index.js", "index.mjs")


def relative_specifiers(files: list[Path]) -> set[str]:
    """Every relative module specifier imported by this set of TS files."""
    specs: set[str] = set()
    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in SPEC_RE.finditer(text):
            spec = next((g for g in m.groups() if g), None)
            if spec and spec.startswith("."):
                specs.add(spec)
    return specs


def resolves(base_dir: Path, spec: str) -> bool:
    """Does `spec`, resolved from `base_dir`, name a file that exists?"""
    target = (base_dir / spec).resolve()
    cands: list[Path] = []
    # A '.js' specifier in a TS project refers to the '.ts' source.
    for suffix, replacement in ((".js", ".ts"), (".mjs", ".mts"), (".cjs", ".cts"),
                                (".jsx", ".tsx")):
        if str(target).endswith(suffix):
            cands.append(Path(str(target)[: -len(suffix)] + replacement))
    cands += [Path(str(target) + ext) for ext in _EXT_CANDIDATES]
    cands += [target / idx for idx in _INDEX_CANDIDATES]
    return any(c.is_file() for c in cands)


def stage_dir_for(pkg: str, depth: int, wp: str, which: str) -> Path:
    """Directory holding the staged files, `depth` levels below <pkg>/src.

    Depth is the number of directories between <pkg>/src and the staged file,
    which is exactly the number of '../' needed to climb back to <pkg>/src.

    The first component stays `__tests__` for depth >= 2 because WP5 imports
    `../../harness/canvas-double` and relies on `<pkg>/src/__tests__/harness/`
    actually existing -- i.e. a set can constrain the path COMPONENTS, not just
    the depth.
    """
    src = REPO / pkg / "src"
    if depth <= 1:
        return src / "v2blind_d1"
    if depth == 2:
        return src / "__tests__" / "v2blind"
    d = src / "__tests__" / "v2blind" / f"wp{wp}_{which}"
    for extra in range(depth - 3):
        d = d / f"n{extra + 4}"
    return d


@dataclass
class Placement:
    pkg: str
    depth: int
    stage: Path
    unresolved: list[str] = field(default_factory=list)


def derive_placement(
    wp: str, which: str, specs: set[str]
) -> tuple[Placement | None, list[Placement]]:
    """Find the (package, depth) where EVERY relative specifier resolves.

    This is a filesystem search, not a heuristic. A max-depth or min-depth rule
    would be wrong: WP5 mixes '../../../canvas/...' with '../../harness/...'
    and only one placement satisfies both simultaneously.
    """
    tried: list[Placement] = []
    winners: list[Placement] = []
    for pkg in PACKAGES:
        if not (REPO / pkg / "src").is_dir():
            continue
        for depth in (2, 3, 4, 1):
            stage = stage_dir_for(pkg, depth, wp, which)
            bad = [s for s in sorted(specs) if not resolves(stage, s)]
            p = Placement(pkg=pkg, depth=depth, stage=stage, unresolved=bad)
            tried.append(p)
            if not bad:
                winners.append(p)
    if not winners:
        return None, tried
    # Deterministic: declared package order, then the shallowest depth.
    winners.sort(key=lambda p: (PACKAGES.index(p.pkg), p.depth))
    return winners[0], tried


# --------------------------------------------------------------------------
# Filename normalisation (NAME ONLY -- content is never touched)
# --------------------------------------------------------------------------
#: Vitest 4 default discovery glob: **/*.{test,spec}.?(c|m)[jt]s?(x)
_DISCOVERABLE_TS = re.compile(r"\.(test|spec)\.[cm]?[jt]sx?$")
_TS_SUFFIX = re.compile(r"(\.[cm]?[jt]sx?)$")


def is_ts_test_source(name: str) -> bool:
    """A TS file that is meant to BE a test (as opposed to a local helper)."""
    return name.startswith("test_") or bool(_DISCOVERABLE_TS.search(name))


def normalise_ts_name(name: str) -> str | None:
    """Return the staged name, or None if the file cannot be made discoverable."""
    if _DISCOVERABLE_TS.search(name):
        return name
    m = _TS_SUFFIX.search(name)
    if not m:
        return None
    return name[: m.start()] + ".test" + m.group(1)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


# --------------------------------------------------------------------------
# Records
# --------------------------------------------------------------------------
@dataclass
class Record:
    wp: str
    set: str
    framework: str
    files_staged: int = 0
    tests_collected: int = 0
    tests_passed: int = 0
    tests_failed: int = 0
    exit_code: int | None = None
    verdict: str = "RUNNER_ERROR"
    reason: str = ""
    package: str = ""
    depth: int | None = None
    detail: str = ""

    def write(self) -> None:
        RECORDS.mkdir(parents=True, exist_ok=True)
        path = RECORDS / f"WP{self.wp}_{self.set}_{self.framework}.json"
        path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        with (RECORDS / "index.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(asdict(self)) + "\n")


def cleanup() -> None:
    for root in stage_roots():
        if root.exists():
            shutil.rmtree(root, ignore_errors=True)


def child_env() -> dict[str, str]:
    return {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}


# --------------------------------------------------------------------------
# TypeScript path
# --------------------------------------------------------------------------
def run_ts(wp: str, which: str, src_dir: Path, ts_files: list[Path]) -> Record:
    rec = Record(wp=wp, set=which, framework="vitest")
    tests = [f for f in ts_files if is_ts_test_source(f.name)]
    helpers = [f for f in ts_files if f not in tests]

    # AC2: a file that cannot be made discoverable is named individually and
    # fails the run -- never silently excluded from it.
    non_normalisable = [f.name for f in tests if normalise_ts_name(f.name) is None]
    if non_normalisable:
        rec.verdict = "NON_NORMALISABLE"
        rec.reason = "files cannot be made framework-discoverable: " + ", ".join(non_normalisable)
        return rec

    specs = relative_specifiers(ts_files)
    placement, tried = derive_placement(wp, which, specs)
    if placement is None:
        best = min(tried, key=lambda p: len(p.unresolved)) if tried else None
        rec.verdict = "IMPORT_UNRESOLVED"
        rec.reason = (
            "no (package, depth) placement resolves every relative import. "
            f"Best candidate {best.pkg}/depth{best.depth} left unresolved: "
            f"{', '.join(best.unresolved)}"
        ) if best else "no candidate placements"
        return rec

    rec.package, rec.depth = placement.pkg, placement.depth
    pkg_dir = REPO / placement.pkg
    stage = placement.stage

    try:
        cleanup()
        stage.mkdir(parents=True)
        staged: list[Path] = []
        for f in tests + helpers:
            new_name = normalise_ts_name(f.name) if f in tests else f.name
            dst = stage / new_name
            shutil.copy2(f, dst)
            # Name-only normalisation, enforced rather than promised.
            if sha256(f) != sha256(dst):
                rec.verdict = "RUNNER_ERROR"
                rec.reason = f"staged copy is not byte-identical to source: {f.name}"
                return rec
            staged.append(dst)
        rec.files_staged = len(staged)

        RAW.mkdir(parents=True, exist_ok=True)
        json_out = RAW / f"WP{wp}_{which}_vitest.json"
        if json_out.exists():
            json_out.unlink()

        rel = stage.relative_to(pkg_dir).as_posix() + "/"
        proc = subprocess.run(
            ["npx", "vitest", "run", rel, "--reporter=json",
             f"--outputFile={json_out}"],
            cwd=str(pkg_dir),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=True,
            timeout=900,
            env=child_env(),
        )
        rec.exit_code = proc.returncode
        out = (proc.stdout or "") + (proc.stderr or "")

        # AC1/AC5: the structured artefact is the evidence. Its absence is a
        # hard failure, NOT an absence of problems.
        if not json_out.is_file():
            rec.verdict = "NO_STRUCTURED_OUTPUT"
            rec.reason = (
                "vitest produced no JSON report; a pass cannot be evidenced. "
                f"exit={proc.returncode}"
            )
            rec.detail = tail(out, 40)
            return rec
        try:
            data = json.loads(json_out.read_text(encoding="utf-8", errors="replace"))
        except Exception as exc:
            rec.verdict = "NO_STRUCTURED_OUTPUT"
            rec.reason = f"vitest JSON report unparseable: {exc}"
            rec.detail = tail(out, 40)
            return rec

        rec.tests_collected = int(data.get("numTotalTests", 0) or 0)
        rec.tests_passed = int(data.get("numPassedTests", 0) or 0)
        rec.tests_failed = int(data.get("numFailedTests", 0) or 0)
        _finish(rec, out)
        return rec
    finally:
        cleanup()


# --------------------------------------------------------------------------
# Python path
# --------------------------------------------------------------------------
def run_py(wp: str, which: str, src_dir: Path, py_files: list[Path]) -> Record:
    """Python blind sets are run IN PLACE.

    60 of the Python blind files locate the repo via
    `Path(__file__).resolve().parents[5] / "tools"`, which is only correct at
    their authored path. Copying them anywhere else silently breaks that
    resolution. They are already named `test_*.py`, which IS pytest's discovery
    pattern, so no staging and no renaming is required -- the two reasons
    staging existed for TypeScript do not apply here.
    """
    rec = Record(wp=wp, set=which, framework="pytest")
    tests = [f for f in py_files if f.name.startswith("test_")]
    rec.files_staged = len(tests)
    if not tests:
        rec.verdict = "ZERO_COLLECTION"
        rec.reason = "no test_*.py files present in the set"
        return rec

    RAW.mkdir(parents=True, exist_ok=True)
    xml_out = RAW / f"WP{wp}_{which}_pytest.xml"
    if xml_out.exists():
        xml_out.unlink()

    # pytest MUST run from the repo root: from the workspace root, session
    # collection aborts on a dangling junction (Projects/_external/FinaleAbgabe,
    # absent E: drive) which looks like an import failure and is not.
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", str(src_dir), "-p", "no:cacheprovider",
         "-q", f"--junit-xml={xml_out}"],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=1800,
        env=child_env(),
    )
    rec.exit_code = proc.returncode
    out = (proc.stdout or "") + (proc.stderr or "")

    if not xml_out.is_file():
        rec.verdict = "NO_STRUCTURED_OUTPUT"
        rec.reason = (
            f"pytest produced no JUnit XML; a pass cannot be evidenced. "
            f"exit={proc.returncode}"
        )
        rec.detail = tail(out, 40)
        return rec
    try:
        root = ET.parse(xml_out).getroot()
        suite = root if root.tag == "testsuite" else root.find("testsuite")
        total = int(suite.get("tests", "0"))
        failed = int(suite.get("failures", "0"))
        errors = int(suite.get("errors", "0"))
        skipped = int(suite.get("skipped", "0"))
    except Exception as exc:
        rec.verdict = "NO_STRUCTURED_OUTPUT"
        rec.reason = f"pytest JUnit XML unparseable: {exc}"
        rec.detail = tail(out, 40)
        return rec

    rec.tests_collected = total
    rec.tests_failed = failed + errors
    rec.tests_passed = total - rec.tests_failed - skipped
    _finish(rec, out)
    return rec


# --------------------------------------------------------------------------
def _finish(rec: Record, out: str) -> None:
    """The single place a verdict of PASS can be assigned."""
    if rec.tests_collected <= 0:
        rec.verdict = "ZERO_COLLECTION"
        rec.reason = (
            "the run collected 0 tests. This is a hard failure: a set that was "
            "never executed must never be reported as passing, whatever the exit code."
        )
        rec.detail = tail(out, 40)
        return
    if rec.tests_failed > 0:
        rec.verdict = "FAIL"
        rec.reason = f"{rec.tests_failed} of {rec.tests_collected} tests failed"
        rec.detail = failures(out)
        return
    if rec.exit_code not in (0, None):
        rec.verdict = "FAIL"
        rec.reason = (
            f"no test failed but the process exited {rec.exit_code} "
            "(collection or teardown error)"
        )
        rec.detail = tail(out, 40)
        return
    rec.verdict = "PASS"
    rec.reason = f"{rec.tests_passed} of {rec.tests_collected} tests passed"


def tail(text: str, n: int = 30) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines[-n:])


def failures(text: str) -> str:
    """Extract the FAIL blocks so a red run is diagnosable without a re-run."""
    lines = text.splitlines()
    keep, grab = [], 0
    for ln in lines:
        low = ln.lower()
        if "fail" in low or "assertionerror" in low or "expected" in low:
            grab = 12
        if grab > 0:
            keep.append(ln)
            grab -= 1
    return "\n".join(keep[:160])


# --------------------------------------------------------------------------
def run_set(wp: str, which: str, only: str | None = None) -> list[Record]:
    src = ART / "tests" / f"blind_{which}" / f"WP{wp}"
    if not src.is_dir():
        rec = Record(wp=wp, set=which, framework="none", verdict="NO_SUCH_SET",
                     reason=f"no such set on disk: {src}")
        rec.write()
        return [rec]

    ts_files = sorted(f for f in src.glob("*.ts") if f.is_file())
    py_files = sorted(f for f in src.glob("*.py") if f.is_file())

    recs: list[Record] = []
    try:
        if ts_files and only != "py":
            recs.append(run_ts(wp, which, src, ts_files))
        if py_files and only != "ts":
            recs.append(run_py(wp, which, src, py_files))
        if not recs:
            recs.append(Record(wp=wp, set=which, framework="none",
                               verdict="ZERO_COLLECTION",
                               reason="the set directory contains no .ts and no .py files"))
    finally:
        cleanup()

    for r in recs:
        r.write()
    return recs


def report(recs: list[Record]) -> int:
    worst = 0
    for r in recs:
        bar = "=" * 74
        print(f"\n{bar}\n== WP{r.wp} blind_{r.set} [{r.framework}] -> {r.verdict}\n{bar}")
        print(f"   package/depth : {r.package or '-'} / {r.depth if r.depth is not None else '-'}")
        print(f"   files staged  : {r.files_staged}")
        print(f"   collected     : {r.tests_collected}")
        print(f"   passed/failed : {r.tests_passed} / {r.tests_failed}")
        print(f"   exit code     : {r.exit_code}")
        print(f"   reason        : {r.reason}")
        if r.detail:
            print(f"   ---- detail ----\n{r.detail}")
        if r.verdict != "PASS":
            worst = 1
    return worst


def selftest() -> int:
    """WP55 falsification harness.

    Points the repaired runner at a deliberately unmatchable set and asserts it
    FAILS LOUDLY rather than reporting a pass. This is the acceptance criterion
    that cannot be satisfied by inspection: it must be demonstrated.
    """
    print("=" * 74)
    print("WP55 FALSIFICATION: a set that executes nothing must not report PASS")
    print("=" * 74)

    ok = True

    # 1. A set that does not exist at all.
    recs = run_set("99999", "set1")
    print(f"\n[1] nonexistent set WP99999      -> {recs[0].verdict}: {recs[0].reason}")
    ok &= recs[0].verdict != "PASS"

    # 2. A synthetic set whose file is syntactically a test but is named so it
    #    matches no discovery glob, and whose import cannot resolve anywhere.
    #    Under the OLD runner this printed "No test files found" and exited 0
    #    -> reported as a pass.
    fake = ART / "tests" / "blind_set1" / "WP99998"
    fake.mkdir(parents=True, exist_ok=True)
    try:
        (fake / "test_unmatchable_blind1.ts").write_text(
            "import { describe, it, expect } from 'vitest';\n"
            "import { nope } from '../../this/module/does/not/exist';\n"
            "describe('unmatchable', () => { it('never runs', () => { expect(nope).toBe(1); }); });\n",
            encoding="utf-8",
        )
        recs = run_set("99998", "set1")
        r = recs[0]
        print(f"\n[2] unresolvable-import set      -> {r.verdict}: {r.reason}")
        ok &= r.verdict != "PASS"

        # 3. Same file, but with an import that DOES resolve, so it actually
        #    stages and runs -- proving the harness is not just failing
        #    everything indiscriminately. A runner that fails every set is as
        #    useless as one that passes every set.
        (fake / "test_unmatchable_blind1.ts").write_text(
            "import { describe, it, expect } from 'vitest';\n"
            "describe('control', () => { it('really runs', () => { expect(1).toBe(1); }); });\n",
            encoding="utf-8",
        )
        recs = run_set("99998", "set1")
        r = recs[0]
        print(f"\n[3] control set (should PASS >0) -> {r.verdict}: collected={r.tests_collected}")
        ok &= (r.verdict == "PASS" and r.tests_collected > 0)
    finally:
        shutil.rmtree(fake, ignore_errors=True)

    # 4. Staging must be gone.
    leftover = [str(p) for p in stage_roots() if p.exists()]
    print(f"\n[4] staging dirs after all runs  -> {leftover or 'all absent'}")
    ok &= not leftover

    print("\n" + "=" * 74)
    print("FALSIFICATION RESULT:",
          "PASS - a non-executed set cannot report green" if ok
          else "FAIL - the runner is still not trustworthy")
    print("=" * 74)
    return 0 if ok else 1


def main() -> int:
    argv = list(sys.argv[1:])
    if not argv:
        print(__doc__)
        return 2
    if argv[0] == "--selftest":
        try:
            return selftest()
        finally:
            cleanup()

    only = None
    if "--ts-only" in argv:
        only, argv = "ts", [a for a in argv if a != "--ts-only"]
    if "--py-only" in argv:
        only, argv = "py", [a for a in argv if a != "--py-only"]

    wp = argv[0].lstrip("wWpP")
    which = argv[1] if len(argv) > 1 else "both"
    sets = ["set1", "set2"] if which == "both" else [which]

    all_recs: list[Record] = []
    try:
        for s in sets:
            all_recs.extend(run_set(wp, s, only))
    finally:
        cleanup()

    worst = report(all_recs)

    leftover = [str(p) for p in stage_roots() if p.exists()]
    if leftover:
        print(f"\n!! STAGING NOT CLEANED: {leftover}")
        return 99
    print("\n[staging clean: no v2blind staging dirs present]")
    print(f"[records: {RECORDS}]")
    return worst


if __name__ == "__main__":
    sys.exit(main())
