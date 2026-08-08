"""S158 / S159 — WP116 Rule 11 falsifiability driver.

Mechanics copied verbatim from `wp112_break_table.py` (itself from
`wp115_break_table.py` / `wp109_break_table.py`): copy-aside, EXACT string
replacement, restore in a `finally`, sha256 equality, the `S133`-anchored
failure parser. Its own file for `S100`'s reason. Never `git checkout`, never
`git stash`.

A break that reddens NOTHING is reported as such, not silently dropped — and
two rows (`W7`, `W15`) are NEGATIVE CONTROLS that are SUPPOSED to redden
nothing.

THE RECURSION WORTH NAMING: package A's product IS an oracle, so the W-rows over
`e2e-control.ts` are asking "can the thing that exists to detect a failure
detect ITS OWN failure?". `W1` is the shipped defect verbatim — agreement scored
as convergence — and it must redden the acceptance row.
"""

import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "plugin"
E2E = PLUGIN / "src" / "testing" / "e2e-control.ts"
IDENT = PLUGIN / "src" / "files" / "rename-identity.ts"
CORE = PLUGIN / "src" / "files" / "manifest-removal-decision.ts"
MAIN = PLUGIN / "src" / "main.ts"

TESTS = [
    "src/__tests__/v2/wp116/test_s158_the_oracle_that_could_not_see_a_shared_loss.test.ts",
    "src/__tests__/v2/wp116/test_s159_hash_equality_is_not_file_identity.test.ts",
    # The neighbours these two packages could re-open.
    # WP49 owns the peer-to-peer oracle A3 promises not to narrow; WP72's tp4
    # and WP49's tp12 both police what `e2e-control.ts` may import; `utils.test`
    # and `manifest.test` pin the two production surfaces B edited; WP86 owns
    # the decision core B added a floor to; WP95 owns the hostile collision B4
    # must keep pinned; `regression.test` drives the manifest-change handler.
    "src/__tests__/wp49/test_tp6_doc_converged_file_diverged_visible.test.ts",
    "src/__tests__/wp49/test_tp7_honest_green_convergence_visible.test.ts",
    "src/__tests__/wp49/test_tp8_files_agree_doc_diverges_visible.test.ts",
    "src/__tests__/wp49/test_tp12_existing_protocol_no_new_dependency_visible.test.ts",
    "src/__tests__/wp72/test_tp4_no_production_branch_and_no_new_transport_visible.test.ts",
    "src/__tests__/utils.test.ts",
    "src/__tests__/manifest.test.ts",
    "src/__tests__/regression.test.ts",
    "src/__tests__/v2/wp86/test_tp01_vanished_key_sink_census.test.ts",
    "src/__tests__/v2/wp86/test_tp02_removal_decision_core.test.ts",
    "src/__tests__/v2/wp95/test_tp01_the_predicate_and_the_op_kind_census_visible.test.ts",
    "src/__tests__/v2/wp95/test_tp02_every_arm_refuses_and_the_local_writer_does_not_visible.test.ts",
    "src/__tests__/v2/wp95/test_tp03_the_refusal_is_observable_visible.test.ts",
]

# (id, acceptance criterion, description, [(file, old, new), ...])
BREAKS = [
    # ---------------------------------------------------------------- A ----
    (
        "W1",
        "A2 — THE DEFECT ITSELF",
        "the oracle stops consulting the expectation and scores agreement as convergence, "
        "which is S158 verbatim: the S119 run becomes a pass again",
        [(E2E,
          "  if (violations.length > 0) {",
          "  if (false && violations.length > 0) {")],
    ),
    (
        "W2",
        "A1/A2 — emptiness must be ASSERTED, never inferred",
        "the structural clause is always satisfied, so a lazy expectation lets a truncation "
        "through — the exact hole S119 fell into",
        [(E2E,
          "    satisfied: !observedEmpty || emptinessAsserted,",
          "    satisfied: true,")],
    ),
    (
        "W3",
        "A1 — the size floor must actually compare",
        "the atLeastBytes clause is satisfied unconditionally",
        [(E2E,
          "    const satisfied = file.size >= expected.atLeastBytes;",
          "    const satisfied = true;")],
    ),
    (
        "W4",
        "A1 / S155 — UNJUDGEABLE IS NEVER GREEN",
        "a question that could not be asked is recorded as a pass",
        [(E2E,
          "    verdict: CONVERGENCE_VERDICT.UNJUDGEABLE,\n    converged: false,",
          "    verdict: CONVERGENCE_VERDICT.UNJUDGEABLE,\n    converged: true,")],
    ),
    (
        "W5",
        "A1 — the reference point must state its provenance",
        "an expectation with no stated origin is accepted, so an expectation read back off a "
        "peer becomes indistinguishable from a recorded one",
        [(E2E,
          "  if (origin.length === 0) {",
          "  if (false && origin.length === 0) {")],
    ),
    (
        "W6",
        "A1 — an expectation that states nothing is not a reference point",
        "a clause-free expectation is accepted, which is the weak oracle wearing the new API",
        [(E2E,
          "  if (statedClauses.length === 0) {",
          "  if (false && statedClauses.length === 0) {")],
    ),
    (
        "W7",
        "NEGATIVE CONTROL (A)",
        "a clause DETAIL string nobody asserts is reworded; no decision, no clause, no branch "
        "and no counter is touched",
        [(E2E,
          '      detail: "the expectation states no exact digest",',
          '      detail: "no exact digest appears in this expectation",')],
    ),
    (
        "W8",
        "A3 — ARRIVAL must stay a real question",
        "peer agreement is hardcoded true, so DIVERGED can never be reported",
        [(E2E,
          "    .filter((p) => !sameFileObservation(reference.file, p.file))",
          "    .filter(() => false)")],
    ),
    # ---------------------------------------------------------------- B ----
    (
        "W9",
        "B1/B2 — THE DEFECT ITSELF",
        "the ambiguity test is removed, so the first candidate in array order wins again: "
        "hash equality read as file identity, exactly as shipped",
        [(IDENT,
          "    if (candidates.length === 1 && rivals.length === 0) {",
          "    if (candidates.length >= 1) {")],
    ),
    (
        "W10",
        "B2 — the tie-break must itself be unambiguous",
        "the basename rescue accepts a basename that is ALSO shared, which is the same coin "
        "flip one level down",
        [(IDENT,
          "    if (sameName.length === 1 && rivalsWithSameName.length === 0) {",
          "    if (sameName.length >= 1) {")],
    ),
    (
        "W11",
        "B2 — the pairing must be a bijection",
        "the double-claim guard is disabled. EXPECTED TO REDDEN NOTHING while the rules above "
        "hold, and reported as such: it is a belt on top of braces, not the load-bearing test",
        [(IDENT,
          "    if (claimed.has(newPath)) {",
          "    if (false && claimed.has(newPath)) {")],
    ),
    (
        "W12",
        "B2 — the core refuses a basis that is not an identity basis",
        "the decision core stops checking the stated basis",
        [(CORE,
          "  if (probe.identityBasis !== undefined && !IDENTITY_BASES.includes(asString(probe.identityBasis))) {",
          "  if (false && probe.identityBasis !== undefined && !IDENTITY_BASES.includes(asString(probe.identityBasis))) {")],
    ),
    (
        "W13",
        "B2 — the shipped call site must STATE the basis",
        "main.ts stops passing identityBasis, which is the 'optional floor somebody forgets' "
        "case the census row exists for",
        [(MAIN,
          "              identityBasis:\n                preferred === newPath",
          "              notTheIdentityBasis:\n                preferred === newPath")],
    ),
    (
        "W14",
        "S155 — the ledger counts EVERY branch",
        "the ambiguous refusal stops being recorded, so 'ran and refused' becomes byte-"
        "identical to 'never ran'",
        [(IDENT,
          "    ledger.push({\n      oldPath,\n      newPath: null,\n      outcome: RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT,",
          "    if (false) ledger.push({\n      oldPath,\n      newPath: null,\n      outcome: RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT,")],
    ),
    (
        "W15",
        "NEGATIVE CONTROL (B)",
        "the no-content-match reason is reworded. No row asserts this wording and no branch "
        "moves; the replacement is deliberately kept long, because tp01c asserts that every "
        "ledger row carries a reason of real length",
        [(IDENT,
          '          "no added key carries these bytes, so this disappearance is not the source half of " +\n          "any rename in this event",',
          '          "not one added key in this event carries these bytes, so this disappearance cannot " +\n          "be the source half of any rename here",')],
    ),
]

TARGETS = {E2E, IDENT, CORE, MAIN}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_summary(clean):
    m = re.search(r"Tests\s+(.+?)\n", clean)
    return m.group(1).strip() if m else "UNPARSED"


def run_tests():
    proc = subprocess.run(
        ["npx", "vitest", "run", "--reporter=verbose", *TESTS],
        cwd=PLUGIN, capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace",
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    # S133 — ANCHORED AT LINE START. An unanchored `[x×]` harvests prose.
    failed = sorted({
        m.group(1).strip()
        for m in re.finditer(r"^\s*[x×]\s+(.+?)(?:\s+\d+ms)?$", clean, re.M)
    })
    return failed, clean_summary(clean)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    baseline_sha = {p: sha256(p) for p in TARGETS}

    wanted = {a.upper() for a in sys.argv[1:]}
    selected = [b for b in BREAKS if not wanted or b[0].upper() in wanted]
    if wanted:
        missing = wanted - {b[0].upper() for b in BREAKS}
        if missing:
            print(f"  !! unknown break ids: {sorted(missing)}")
            return 2
        print(f"=== FILTERED RUN: {len(selected)} of {len(BREAKS)} rows "
              f"({', '.join(b[0] for b in selected)}) ===")
    else:
        print(f"=== FULL RUN: all {len(BREAKS)} rows ===")

    print("=== BASELINE (no break) ===")
    failed, summary = run_tests()
    print(f"  {summary}")
    if failed:
        print("  !! baseline is not green, aborting:", failed)
        return 1

    rows = []
    for bid, ac, desc, edits in selected:
        for p in TARGETS:
            shutil.copyfile(p, p.with_suffix(p.suffix + ".pre-v2-smoke"))
        applied = True
        for path, old, new in edits:
            text = path.read_text(encoding="utf-8")
            if old not in text:
                print(f"  !! {bid}: anchor not found in {path.name}")
                applied = False
                break
            path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="")
        try:
            if applied:
                failed, summary = run_tests()
            else:
                failed, summary = ["ANCHOR NOT FOUND"], "NOT RUN"
        finally:
            for p in TARGETS:
                shutil.copyfile(p.with_suffix(p.suffix + ".pre-v2-smoke"), p)
                p.with_suffix(p.suffix + ".pre-v2-smoke").unlink()
        restored = all(sha256(p) == baseline_sha[p] for p in TARGETS)

        rows.append((bid, ac, desc, failed, summary, restored))
        print(f"\n=== {bid} ({ac}) {desc}")
        print(f"  {summary}   restore byte-identical: {restored}")
        for f in failed:
            print(f"    RED: {f}")

    print("\n\n================ WP116 BREAK TABLE ================")
    for bid, ac, desc, failed, summary, restored in rows:
        print(f"\n{bid} [{ac}] {desc}")
        print(f"  result   : {summary}")
        print(f"  restored : {'byte-identical (sha256)' if restored else '!! MISMATCH !!'}")
        if failed:
            for f in failed:
                print(f"  RED      : {f}")
        else:
            print("  RED      : NOTHING — this break reddened no test")

    print("\n=== FINAL GREEN CHECK ===")
    failed, summary = run_tests()
    print(f"  {summary}  failures={failed}")
    leftovers = sorted(str(p) for p in PLUGIN.rglob("*.pre-v2-smoke"))
    print(f"=== COPY-ASIDE LEFTOVERS: {len(leftovers)} {leftovers} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
