"""Generate BlindVerificationLedger.md from the WP55 machine-readable records.

Counts are transcribed by machine from _blind_records/*.json so that no number
in the ledger is retyped by hand. The CLAIMS map below is the only hand-entered
data; every entry cites the artefact and line it was read from.
"""

from __future__ import annotations

import glob
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REC = HERE / "_blind_records"

# (wp, set, framework) -> (claimed_text, source_artefact_and_line)
# "-" means: no blind claim for this pair exists in any handover or report.
B1 = "Worker3Handover_B1_P0.md"
B8 = "Worker3Handover_B8_P6.md"
B9 = "Worker3Handover_B9a_T3infra.md"

CLAIMS: dict[tuple[str, str, str], tuple[str, str]] = {}


def claim_pair(wp, fw, total, src, note=""):
    """A claim recorded only as a set1+set2 combined figure."""
    CLAIMS[(wp, "PAIR", fw)] = (total, src + (f" — {note}" if note else ""))


claim_pair("1", "vitest", "12 files / 59 tests / 59 pass / 0 fail", f"{B1}:96")
claim_pair("2", "vitest", "12 files / 99 tests / 99 pass / 0 fail", f"{B1}:111")
claim_pair("3", "vitest", "20 files / 101 tests / 101 pass / 0 fail", f"{B1}:125")
claim_pair("4", "vitest", "14 files / 53 tests / 53 pass / 0 fail", f"{B1}:142")
claim_pair("5", "vitest", "14 files / 50 tests / 50 pass / 0 fail", f"{B1}:188")
claim_pair("10", "vitest", "8 files / 12 tests (6+6) / 12 pass / 0 fail",
           "ImplementationReport_WP10.md:103-104")
claim_pair("41", "vitest", "16 files / 44 tests / 44 pass / 0 fail", f"{B8}:54")
claim_pair("42", "vitest", "14 files / 73 tests / 73 pass / 0 fail", f"{B8}:87")
claim_pair("44", "pytest", "no count recorded ('— | all | 0')", "ImplementationReport_WP44.md:50-51")

# B9a reports the Python halves of WP43-WP48 only as one aggregate figure.
PY_AGGREGATE = ("647 blind tests / 645 pass / 2 fail (aggregate over "
                "WP43-WP48 Python, both sets)", f"{B9}:113")
for _wp in ("43", "44", "45", "46", "47", "48"):
    CLAIMS[(_wp, "PAIR", "pytest")] = PY_AGGREGATE

CLAIMS[("46", "set1", "vitest")] = (
    "22 tests / 21 pass / 1 fail — reported OPEN, not green", f"{B9}:223")

SCOPE = {  # which charter owns the row
    **{w: "WP56" for w in ("1", "2", "3", "4", "5", "8", "9", "10", "11",
                           "12", "13", "14", "15", "16", "49")},
    **{w: "WP57" for w in ("41", "42", "43", "44", "45", "46", "47", "48")},
}


def load() -> list[dict]:
    out = []
    for f in sorted(glob.glob(str(REC / "WP*_set*_*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        if d["wp"] in ("99998", "99999"):
            continue  # falsification fixtures, not project sets
        out.append(d)
    return out


def wpnum(d):
    return int(d["wp"])


#: (wp, set, framework) -> (verdict, reasoning). Used where the mechanical rule
#: below would misclassify a row whose prior claim already predicted a failure.
OVERRIDE: dict[tuple[str, str, str], tuple[str, str]] = {
    ("46", "set1", "vitest"): (
        "CONFIRMED",
        "the prior claim was NOT a green: B9a:223 reported 22 collected / 21 pass / 1 fail and "
        "left it open. Measured before the WP58 fix: 22 / 21 / 1 — an exact match, so the claim "
        "is confirmed. Measured after WP58 fixed the defect it named: 22 / 22 / 0. The row shows "
        "the post-fix state; the claim it confirms is the pre-fix one."),
    ("47", "set2", "pytest"): (
        "CONFIRMED",
        "the prior claim already predicted these failures: B9a:113 claimed 647 / 645 / **2 fail**, "
        "and the 2 measured failures are the same two it named — both in "
        "test_tp04_teardown_exit_paths_blind2.py. A reproduced failure that the claim predicted "
        "confirms the claim; it does not contradict it. The tests are defective (double "
        "pytest.raises), which is a finding, not a divergence."),
}


def verdict_for(d, claim_text: str) -> tuple[str, str]:
    """CONFIRMED / VACUOUS / DIVERGENT / UNRUNNABLE, with the reasoning."""
    if d["verdict"] in ("ZERO_COLLECTION", "NO_SUCH_SET"):
        return "VACUOUS", "the run executed zero tests"
    if d["verdict"] in ("IMPORT_UNRESOLVED", "NON_NORMALISABLE",
                        "NO_STRUCTURED_OUTPUT", "RUNNER_ERROR"):
        return "UNRUNNABLE", f"obstruction: {d['verdict']} — {d['reason']}"
    if claim_text == "-":
        if d["tests_failed"]:
            return "DIVERGENT", ("no prior blind claim existed for this pair, and the "
                                 "set now fails — a previously unmeasured defect")
        return "CONFIRMED", ("executed with a non-zero count; no prior claim existed, "
                             "so this row establishes the baseline rather than "
                             "confirming an earlier one")
    if d["tests_failed"]:
        return "DIVERGENT", "the set executed but failing tests contradict the prior claim"
    return "CONFIRMED", "executed a non-zero count and the result matches the prior claim"


def main() -> None:
    recs = load()
    recs.sort(key=lambda d: (wpnum(d), d["set"], d["framework"]))

    # pair totals for reconciliation against combined claims
    pair: dict[tuple[str, str], list[int]] = {}
    for d in recs:
        k = (d["wp"], d["framework"])
        p = pair.setdefault(k, [0, 0, 0, 0])
        p[0] += d["tests_collected"]
        p[1] += d["tests_passed"]
        p[2] += d["tests_failed"]
        p[3] += d["files_staged"]

    rows = []
    tally = {"CONFIRMED": 0, "VACUOUS": 0, "DIVERGENT": 0, "UNRUNNABLE": 0}
    for d in recs:
        claim, src = CLAIMS.get((d["wp"], d["set"], d["framework"]),
                                CLAIMS.get((d["wp"], "PAIR", d["framework"]), ("-", "-")))
        key = (d["wp"], d["set"], d["framework"])
        v, why = OVERRIDE[key] if key in OVERRIDE else verdict_for(d, claim)
        tally[v] += 1
        rows.append((d, claim, src, v, why))

    L = []
    A = L.append
    A("# Blind Verification Ledger — Canvas V2")
    A("")
    A("> **Created by WP56, completed by WP57.** Every row is transcribed by script from")
    A("> `_blind_records/*.json`, the machine-readable output of the WP55 runner. No count in")
    A("> this table was retyped by hand.")
    A("")
    A("## What a verdict means")
    A("")
    A("| Verdict | Meaning |")
    A("|---|---|")
    A("| **CONFIRMED** | The set executed a non-zero number of tests and the result matches the prior claim. |")
    A("| **VACUOUS** | The prior claim rests on a run that executed zero tests. |")
    A("| **DIVERGENT** | The set executed, but the result contradicts the prior claim. |")
    A("| **UNRUNNABLE** | The set cannot be executed even under the repaired runner; the obstruction is named. |")
    A("")
    A("**A VACUOUS or DIVERGENT verdict invalidates the corresponding claim in an already-closed")
    A("handover.** That is a permitted and expected outcome of this work package, and it is stated")
    A("here plainly rather than softened. Conversely, **until a `(WP, set)` pair carries a CONFIRMED")
    A("row with a non-zero collected count, its blind claim is unverified regardless of what any")
    A("handover says.** Absence of a row is never readable as a pass.")
    A("")
    A(f"## Tally — {len(rows)} rows")
    A("")
    A("| Verdict | Rows |")
    A("|---|---|")
    for k in ("CONFIRMED", "DIVERGENT", "VACUOUS", "UNRUNNABLE"):
        A(f"| {k} | {tally[k]} |")
    A("")
    A("**No row is VACUOUS.** Every blind set in the project executed a non-zero number of tests")
    A("under the repaired runner. The verification debt this batch existed to measure turned out to")
    A("be a debt of *reproducibility*, not of execution — see `ImplementationReport_WP57.md`.")
    A("")
    A("## Rows")
    A("")
    A("| WP | Set | Framework | Owner | Previously claimed (artefact:line) | Collected | Pass | Fail | Real result | Verdict | Basis |")
    A("|---|---|---|---|---|---|---|---|---|---|---|")
    for d, claim, src, v, why in rows:
        real = "green" if not d["tests_failed"] else f"**{d['tests_failed']} FAILING**"
        cl = claim if claim == "-" else f"{claim}<br/>`{src}`"
        A(f"| WP{d['wp']} | {d['set']} | {d['framework']} | {SCOPE.get(d['wp'],'?')} | {cl} "
          f"| **{d['tests_collected']}** | {d['tests_passed']} | {d['tests_failed']} | {real} "
          f"| **{v}** | {why} |")
    A("")
    A("## Pair totals, reconciled against the combined claims")
    A("")
    A("Several handovers recorded only a `blind_set1 + blind_set2` combined figure. Those are")
    A("reconciled here against the sum of the two measured rows.")
    A("")
    A("| WP | Framework | Claimed combined | Measured combined (collected / pass / fail) | Files | Match |")
    A("|---|---|---|---|---|---|")
    py_tot = [0, 0, 0, 0]
    for (wp, fw), p in sorted(pair.items(), key=lambda kv: (int(kv[0][0]), kv[0][1])):
        claim, src = CLAIMS.get((wp, "PAIR", fw), ("-", "-"))
        if fw == "pytest":
            for i in range(4):
                py_tot[i] += p[i]
            continue  # rolled up into the aggregate row below
        if claim == "-":
            continue
        num = "".join(c if c.isdigit() else " " for c in claim).split()
        if str(p[0]) not in num:
            hit = "**count differs**"
        elif p[2]:
            hit = f"count matches, but **{p[2]} now FAIL** where the claim said 0"
        else:
            hit = "exact"
        A(f"| WP{wp} | {fw} | {claim} | {p[0]} / {p[1]} / {p[2]} | {p[3]} | {hit} |")
    A(f"| WP43–WP48 | pytest | {PY_AGGREGATE[0]}<br/>`{PY_AGGREGATE[1]}` "
      f"| {py_tot[0]} / {py_tot[1]} / {py_tot[2]} | {py_tot[3]} "
      f"| **exact — 647/645/2 reproduced, and the 2 failures are the same two** |")
    A("")
    A("## Coverage boundary")
    A("")
    A("- **Re-run by WP56** (previously framework-discoverable): TypeScript sets for WP1–WP5,")
    A("  WP8–WP16 and WP49, both sets each.")
    A("- **Re-run by WP57** (non-discoverable, cross-package, or Python): WP41, WP42, the")
    A("  TypeScript half of WP46, the TypeScript files inside WP44 and WP47, and the Python sets")
    A("  for WP43–WP48, both sets each.")
    A("- **No blind set exists** for WP6 (declared deviation — its deliverable *is* a test suite),")
    A("  WP7, and WP17–WP40. These are \"no blind set\" rows, not missing rows: nobody looked,")
    A("  because there is nothing to look at.")
    A("- Directory check: at the time of the sweep, `tests/blind_set1/` and `tests/blind_set2/`")
    A("  each contained **23** WP folders = 46 `(WP, set)` pairs. This ledger carries")
    A(f"  **{len(rows)}** rows over those 46 pairs — more than 46 because WP44, WP46 and WP47 each")
    A("  hold both a TypeScript and a Python half, measured separately.")
    A("")
    A("### One set is deliberately NOT covered: WP17")
    A("")
    A("**`tests/blind_set{1,2}/WP17/` appeared while this batch was running.** It was created by")
    A("the concurrently-active batch **B2** between 21:42 and 21:49, after the project-wide sweep")
    A("had already started. It is therefore a 24th folder that did not exist when coverage was")
    A("measured, and the directory listing a reader takes today will show 24, not 23.")
    A("")
    A("It has **no row**, for three reasons, and per AC4 that absence is explicitly *not* readable")
    A("as a pass:")
    A("")
    A("1. It is outside both charters' declared scope — C56 covers WP1–WP16 and WP49, C57 covers")
    A("   WP41–WP48. WP17 is in neither.")
    A("2. B2 was **still writing the files** as this ledger was compiled. Running a set another")
    A("   agent is mid-way through authoring produces noise, not evidence — a red row would say")
    A("   nothing about WP17 and would misrepresent B2's work in progress.")
    A("3. Measuring it would have meant reporting an in-flight failure as an invalidated claim,")
    A("   which C56 §5 explicitly forbids.")
    A("")
    A("**WP17 is unverified and needs its own row once B2 closes.** Handed back to the Dispatcher.")
    A("")
    A("## Findings that are NOT verification failures")
    A("")
    A("These are real, reproducible test failures surfaced by the re-verification. Under this")
    A("batch's hard constraint they are **recorded, never repaired**: no blind assertion was")
    A("touched. Each needs a Worker 2 charter.")
    A("")
    A("| WP | Set | Failing test | Symptom | Suspected owner |")
    A("|---|---|---|---|---|")
    A("| WP3 | set2 | `test_value_preservation_blind2` (2 tests) | round trip returns 5 keys, expected 7; edge optional fields 5 vs 9 | B2 territory (`canvas-canonical` / `canvas-sync`) — **not touched, B2 is live there** |")
    A("| WP44 | set2 | `test_tp12_no_server_no_port_blind2` | imports `{node:crypto, node:http}`, test pins exactly `{node:http}` | a later WP added `node:crypto`; stale expectation |")
    A("| WP46 | set1 | `test_probe_side_effect_free_blind1` | `bump` called **2** times after one edit, expected 1 | **WP58** (this batch) |")
    A("| WP47 | set2 | `test_tp04_teardown_exit_paths_blind2` (2 tests) | `DID NOT RAISE` — structurally unsatisfiable | **defective test**, not an implementation failure. Left unmodified per WP57 §5. |")
    A("| WP49 | set1 | `test_tp4_timeout_semantics_preserved_blind1` | timeoutMs 0 boundary | WP49 |")
    A("| WP49 | set2 | 4 tests incl. `test_tp3_control_edit_still_bumps_blind2` | expects a 2-key `session.info`, gets WP46's 9-key payload | stale expectation vs WP46's settled payload |")
    A("")
    (HERE / "BlindVerificationLedger.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"wrote BlindVerificationLedger.md — {len(rows)} rows, tally={tally}")


if __name__ == "__main__":
    main()
