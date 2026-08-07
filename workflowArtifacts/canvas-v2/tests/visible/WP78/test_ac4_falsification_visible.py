# WP78 / AC4 — "every criterion above is falsified separately and headless — no Obsidian, no
# npm build, no vault, no socket — and each named injection is shown to redden the assertion
# it targets."
#
# The three injections are named by the charter, not chosen here:
#
#   (i)   restore a default for `runner`        → AC1 and AC2(c) must go RED
#   (ii)  add a second `subprocess` reference
#         in a DIFFERENT module of the package  → AC2(a) must go RED and must NAME the
#                                                 module and line it found
#   (iii) rename `build_e2e_bundle` in the
#         parsed copy                           → the POSITIVE CONTROL must go RED
#
# (iii) is the one that distinguishes a real assertion from a lookup that always returns
# nothing, and it is demonstrated rather than asserted: under (iii) the naive absence check
# "no bare call site exists" still passes, on a tree where the function it is about does not
# exist. That is the vacuity, shown happening.
#
# Injections are TARGETED, never global: each is applied on its own with the rest of the tree
# unchanged, and each test records whether neighbouring criteria stayed green.
#
# The "before" harness is a BYTE COPY of the pre-repair package, taken from git's object
# store with git's own object id re-derived from each written file (`_prerepair.py`). It is
# PARSED, never imported: the pre-repair module is precisely the one in which starting a
# process takes no argument.
#
# DATA SAFETY: every mutated package lives under `tmp_path`. Nothing is imported from any
# mutated or pre-repair copy, nothing is executed, no build is run, no vault is read, no
# socket is opened, no Obsidian is launched.

from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path
from typing import Callable, Optional, Tuple

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))

import _prerepair  # noqa: E402
import _spawn_oracle as oracle  # noqa: E402

PACKAGE = _TOOLS / "obsidian_e2e"


# =================================================================================
# The criteria, as functions over a parsed package. The SAME functions run against the
# repaired tree, the pre-repair byte copy and every injected copy — "an identical harness"
# means one implementation, not three that resemble each other.
# =================================================================================


def positive_control(report: oracle.PackageReport, *, expect_opt_in: bool = True) -> None:
    functions = [oracle.BUILD_FN] + ([oracle.OPT_IN_RUNNER] if expect_opt_in else [])
    report.assert_found(functions=functions, min_spawn_nodes=2)


def criterion_ac1_no_default(report: oracle.PackageReport) -> None:
    param = report.parameter(oracle.BUILD_FN, "runner")
    assert param is not None, "no `runner` parameter"
    assert param.has_default is False, f"`runner` defaults to {param.default_source}"
    usage = report.body_usage(oracle.BUILD_FN, "runner")
    for shape in ("boolop", "ifexp", "compare", "rebound"):
        assert usage[shape] == [], f"substitution reintroduced as {shape}: {usage[shape]}"


def criterion_ac2a_spawn_attribution(report: oracle.PackageReport, runner_name: str) -> None:
    stray = [
        n
        for n in report.spawn_nodes
        if n.module != oracle.INSTALL_MODULE or n.function != runner_name
    ]
    assert stray == [], "spawn primitive(s) outside the opt-in runner: " + "; ".join(
        f"{n.module}:{n.line} in {n.function}() -> {n.spelling}" for n in stray
    )
    assert len(report.spawn_nodes) == 2, f"spawn node count moved to {len(report.spawn_nodes)}"


def criterion_ac2b_runner_defaults_nothing(
    report: oracle.PackageReport, runner_name: str
) -> None:
    defaults = report.param_defaults_naming(runner_name)
    subs = report.substitutions_naming(runner_name)
    assert defaults == (), f"{runner_name} is a parameter default at {defaults}"
    assert subs == (), f"{runner_name} is substituted at {subs}"


def criterion_ac2c_signature(report: oracle.PackageReport) -> None:
    param = report.parameter(oracle.BUILD_FN, "runner")
    assert param is not None, "no `runner` parameter in the parsed signature"
    assert param.kind == "keyword-only", param.kind
    assert param.has_default is False, f"default present: {param.default_source}"


def verdict(check: Callable[[], None]) -> Tuple[str, Optional[str]]:
    """Run a criterion and report GREEN/RED plus the message. Nothing is swallowed."""
    try:
        check()
    except AssertionError as exc:
        return "RED", str(exc)
    return "GREEN", None


# =================================================================================
# Injection machinery — targeted textual mutation of a COPY, then a re-parse.
# =================================================================================


def copy_package(dest: Path) -> Path:
    package = dest / "obsidian_e2e"
    package.mkdir(parents=True)
    for path in sorted(PACKAGE.glob("*.py")):
        shutil.copy2(path, package / path.name)
    return package


def mutate(package: Path, module: str, old: str, new: str, *, expect: int = 1) -> None:
    """Apply one targeted replacement and PROVE it applied.

    An injection that silently failed to apply is a green that means nothing — the same
    class this whole WP is about, one level up.
    """
    path = package / module
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    assert count == expect, (
        f"INJECTION DID NOT APPLY: {old!r} occurs {count} time(s) in {module}, expected "
        f"{expect}. A falsification that did not change the tree proves nothing."
    )
    path.write_text(source.replace(old, new), encoding="utf-8")


@pytest.fixture()
def repaired() -> oracle.PackageReport:
    return oracle.scan_package(PACKAGE)


# =================================================================================
# The baseline both directions are measured against
# =================================================================================


def test_the_repaired_tree_is_green_on_every_criterion(repaired: oracle.PackageReport) -> None:
    """Recorded first: every criterion passes on the tree as it stands.

    Without this, "the injection turned it red" is compatible with "it was red already".
    """
    positive_control(repaired)
    assert verdict(lambda: criterion_ac1_no_default(repaired)) == ("GREEN", None)
    assert verdict(
        lambda: criterion_ac2a_spawn_attribution(repaired, oracle.OPT_IN_RUNNER)
    ) == ("GREEN", None)
    assert verdict(
        lambda: criterion_ac2b_runner_defaults_nothing(repaired, oracle.OPT_IN_RUNNER)
    ) == ("GREEN", None)
    assert verdict(lambda: criterion_ac2c_signature(repaired)) == ("GREEN", None)


def test_the_before_harness_is_a_verified_byte_copy() -> None:
    """"Byte copy" is measured here, not asserted in the report.

    `_prerepair.materialise()` re-derives git's own object id from every file it writes; this
    test additionally confirms the copy is genuinely a DIFFERENT tree from the repaired one,
    because a "before" harness that silently became the "after" one would make every
    falsification below vacuous.
    """
    package = _prerepair.package_dir()
    shas = _prerepair.blob_shas()
    assert "install.py" in shas and len(shas) >= 11, shas

    for name, blob_sha in shas.items():
        raw = (package / name).read_bytes()
        header = f"blob {len(raw)}\0".encode("utf-8")
        assert hashlib.sha1(header + raw).hexdigest() == blob_sha, name

    before = (package / "install.py").read_bytes()
    after = (PACKAGE / "install.py").read_bytes()
    assert before != after, (
        "the pre-repair copy is byte-identical to the current install.py — the baseline "
        f"commit {_prerepair.BASELINE_COMMIT[:8]} has drifted onto the repaired code"
    )


# =================================================================================
# INJECTION (i) — restore a default for `runner`
# =================================================================================


def test_injection_i_the_pre_repair_byte_copy_reddens_ac1_and_ac2c() -> None:
    """(i) against the byte copy of the pre-repair module, under the identical harness."""
    report = oracle.scan_package(_prerepair.package_dir())

    # The control still passes on the pre-repair tree — it finds `build_e2e_bundle` and both
    # spawn nodes. The opt-in runner legitimately does not exist there yet, so it is not
    # required. This matters: the criteria below go red because the PROPERTY is absent, not
    # because the walk found nothing.
    positive_control(report, expect_opt_in=False)

    status, message = verdict(lambda: criterion_ac1_no_default(report))
    assert status == "RED", "AC1 passed against the pre-repair module"
    assert "defaults to None" in message, message

    status, message = verdict(lambda: criterion_ac2c_signature(report))
    assert status == "RED", "AC2(c) passed against the pre-repair module"
    assert "default present: None" in message, message

    # AC2(a) is red there too, for a different reason worth recording: the pre-repair
    # `import subprocess` sits at MODULE scope, so a spawn primitive is reachable without
    # entering any function at all.
    status, message = verdict(
        lambda: criterion_ac2a_spawn_attribution(report, oracle.SUPERSEDED_RUNNER)
    )
    assert status == "RED", "AC2(a) passed against the pre-repair module"
    assert "<module>" in message, message

    # AC2(b) is red: the spawning runner IS the substituted default there. That is the defect.
    status, message = verdict(
        lambda: criterion_ac2b_runner_defaults_nothing(report, oracle.SUPERSEDED_RUNNER)
    )
    assert status == "RED"
    assert "substituted" in message, message


def test_injection_i_targeted_reintroduction_reddens_ac1_and_ac2c(tmp_path: Path) -> None:
    """(i) again, as a TARGETED injection onto the repaired tree — one change, nothing else.

    The pre-repair copy differs from the repaired tree in several ways at once. This variant
    changes exactly the default and its substitution, so the reddening is attributable to
    them and to nothing else.
    """
    package = copy_package(tmp_path)
    mutate(
        package,
        "install.py",
        "def build_e2e_bundle(plugin_dir: PathLike, *, runner: Runner) -> BuildResult:",
        "def build_e2e_bundle(plugin_dir: PathLike, *, runner: Optional[Runner] = None"
        ") -> BuildResult:",
    )
    mutate(
        package,
        "install.py",
        "    reported = runner(command, str(cwd))",
        "    reported = (runner or spawning_subprocess_runner)(command, str(cwd))",
    )
    report = oracle.scan_package(package)
    positive_control(report)

    assert verdict(lambda: criterion_ac1_no_default(report))[0] == "RED"
    assert verdict(lambda: criterion_ac2c_signature(report))[0] == "RED"
    status, message = verdict(
        lambda: criterion_ac2b_runner_defaults_nothing(report, oracle.OPT_IN_RUNNER)
    )
    assert status == "RED", "AC2(b) missed a substitution naming the opt-in runner"
    assert "substituted" in message, message

    # NEIGHBOURING BEHAVIOUR: AC2(a) stays GREEN. The injection moved reachability, not the
    # spawn census — recorded because "a perturbation that changes nothing is a finding".
    assert verdict(
        lambda: criterion_ac2a_spawn_attribution(report, oracle.OPT_IN_RUNNER)
    ) == ("GREEN", None)


# =================================================================================
# INJECTION (ii) — a second `subprocess` reference in a different module
# =================================================================================


SECOND_SPAWN = (
    "\n\ndef _injected_second_spawn(argv):\n"
    "    import subprocess\n"
    "    return subprocess.run(argv, check=False).returncode\n"
)


def test_injection_ii_a_second_spawn_elsewhere_reddens_ac2a_and_names_it(
    tmp_path: Path,
) -> None:
    package = copy_package(tmp_path)
    victim = package / "scratch.py"
    before_lines = len(victim.read_text(encoding="utf-8").splitlines())
    victim.write_text(
        victim.read_text(encoding="utf-8") + SECOND_SPAWN, encoding="utf-8"
    )
    report = oracle.scan_package(package)
    positive_control(report)

    status, message = verdict(
        lambda: criterion_ac2a_spawn_attribution(report, oracle.OPT_IN_RUNNER)
    )
    assert status == "RED", "AC2(a) did not notice a second spawn in another module"
    # The criterion must NAME the module and the line — "it failed" is not evidence a reader
    # can act on, and a census that cannot point at the node it found is a boolean.
    assert "scratch.py" in message, message
    injected_lines = [n.line for n in report.spawn_nodes if n.module == "scratch.py"]
    assert injected_lines and all(line > before_lines for line in injected_lines)
    for line in injected_lines:
        assert f"scratch.py:{line}" in message, message
    assert "_injected_second_spawn" in message, message
    assert len(report.spawn_nodes) == 4, [str(n) for n in report.spawn_nodes]

    # NEIGHBOURING BEHAVIOUR: AC1, AC2(b) and AC2(c) stay GREEN. The injection is targeted.
    assert verdict(lambda: criterion_ac1_no_default(report)) == ("GREEN", None)
    assert verdict(lambda: criterion_ac2c_signature(report)) == ("GREEN", None)
    assert verdict(
        lambda: criterion_ac2b_runner_defaults_nothing(report, oracle.OPT_IN_RUNNER)
    ) == ("GREEN", None)


def test_injection_ii_variant_a_grep_defeating_second_spawn_is_also_caught(
    tmp_path: Path,
) -> None:
    """The same injection in a spelling a text search would miss.

    AC2 says a grep is not sufficient evidence for this criterion. This is that claim as a
    falsification rather than as prose.
    """
    package = copy_package(tmp_path)
    victim = package / "readiness.py"
    victim.write_text(
        victim.read_text(encoding="utf-8")
        + "\n\ndef _injected_indirect_spawn(argv):\n"
        "    import importlib\n"
        "    return importlib.import_module('subprocess').run(argv).returncode\n",
        encoding="utf-8",
    )
    report = oracle.scan_package(package)
    positive_control(report)
    status, message = verdict(
        lambda: criterion_ac2a_spawn_attribution(report, oracle.OPT_IN_RUNNER)
    )
    assert status == "RED"
    assert "readiness.py" in message and "import_module" in message, message


# =================================================================================
# INJECTION (iii) — rename the function; the POSITIVE CONTROL must go red
# =================================================================================


def test_injection_iii_a_rename_reddens_the_positive_control(tmp_path: Path) -> None:
    package = copy_package(tmp_path)
    mutate(
        package,
        "install.py",
        "def build_e2e_bundle(plugin_dir: PathLike, *, runner: Runner) -> BuildResult:",
        "def build_e2e_bundle_RENAMED(plugin_dir: PathLike, *, runner: Runner) -> BuildResult:",
    )
    report = oracle.scan_package(package)

    status, message = verdict(lambda: positive_control(report))
    assert status == "RED", (
        "THE POSITIVE CONTROL DID NOT NOTICE THAT `build_e2e_bundle` NO LONGER EXISTS. "
        "Every absence assertion licensed by it is worthless."
    )
    assert "POSITIVE CONTROL FAILED" in message and oracle.BUILD_FN in message, message


def test_injection_iii_shows_the_vacuity_it_exists_to_catch(tmp_path: Path) -> None:
    """The demonstration, not the assertion: under (iii) the naive absence check PASSES.

    `assert not bare_calls` over a tree where `build_e2e_bundle` was renamed finds no calls,
    so it finds no bare calls, so it goes green — on a tree that has no such function at all.
    That is the exact vacuity the charter names, reproduced here so the control's value is
    measured rather than argued.
    """
    package = copy_package(tmp_path)
    mutate(
        package,
        "install.py",
        "def build_e2e_bundle(plugin_dir: PathLike, *, runner: Runner) -> BuildResult:",
        "def build_e2e_bundle_RENAMED(plugin_dir: PathLike, *, runner: Runner) -> BuildResult:",
    )
    (package / "caller.py").write_text(
        "from . import install\n\n\ndef go(d):\n"
        "    return install.build_e2e_bundle_RENAMED(d)\n",
        encoding="utf-8",
    )

    sites = oracle.scan_call_sites(package, oracle.BUILD_FN)
    bare = [s for s in sites if not s.supplies_runner]
    assert bare == [], "the naive check is expected to pass here — that is the point"
    assert sites == (), "and it passes because it found NOTHING, not because nothing is bare"

    # A real bare call, under the renamed name, is sitting right there.
    renamed_sites = oracle.scan_call_sites(package, "build_e2e_bundle_RENAMED")
    assert len(renamed_sites) == 1
    assert renamed_sites[0].supplies_runner is False
    assert renamed_sites[0].inside_raises_typeerror is False

    # The control is what separates the two outcomes.
    report = oracle.scan_package(package)
    assert verdict(lambda: positive_control(report))[0] == "RED"


def test_injection_iii_variant_an_empty_parse_also_reddens_the_control(tmp_path: Path) -> None:
    """The other way the lookup returns nothing: the wrong directory.

    A stale `__pycache__`, a moved package or a typo'd path all produce the same empty walk,
    and the control must fail on it rather than license an absence assertion.
    """
    empty = tmp_path / "not_the_package"
    empty.mkdir()
    report = oracle.scan_package(empty)
    status, message = verdict(lambda: positive_control(report))
    assert status == "RED"
    assert "no module was parsed" in message, message

    assert report.spawn_nodes == ()
    assert oracle.scan_call_sites(empty, oracle.BUILD_FN) == ()
