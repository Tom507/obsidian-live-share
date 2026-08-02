# Blind Verification Ledger — Canvas V2

> **Created by WP56, completed by WP57.** Every row is transcribed by script from
> `_blind_records/*.json`, the machine-readable output of the WP55 runner. No count in
> this table was retyped by hand.

## What a verdict means

| Verdict | Meaning |
|---|---|
| **CONFIRMED** | The set executed a non-zero number of tests and the result matches the prior claim. |
| **VACUOUS** | The prior claim rests on a run that executed zero tests. |
| **DIVERGENT** | The set executed, but the result contradicts the prior claim. |
| **UNRUNNABLE** | The set cannot be executed even under the repaired runner; the obstruction is named. |

<!-- Updated: B13 escalation ruling — a CONFIRMED row expired unnoticed; interim statement, expanded by WP65 AC3 2026-08-02 -->

> ### A row is a measurement, not a timeless fact
>
> **A CONFIRMED row is evidence for the tree it was measured against, and is never readable as a
> current pass.** A later AC can retire the shape a row pinned without touching the set at all.
>
> **Worked example — `WP3 set1`.** CONFIRMED **56/56/0** by WP56; re-measured **56/55/1** by B13
> with the set untouched. **WP56 was not wrong** — WP10 AC5 landed in between. And the instructive
> part: `toV2Edge` keeps an edge's flat keys *only when the endpoint register fails to build*, so
> before AC5 the assertion passed **because** a fully-connected side-less edge was being read as
> not-an-endpoint. **The row was green on account of the very defect AC5 was written to fix.**
> Read later as a standing fact, it would have been evidence that a fixed bug is still fixed.
>
> *(Both WP3 sets were amended under Worker 2's extended WP59 licence and re-measured green by
> B15 on 2026-08-02 — see their rows. That measurement is subject to this same rule: it is
> evidence for the tree it was taken against, not a guarantee about any later one.)*
>
> Until **WP65** lands `measured_at` / `tree_rev` on every record, no row here can say when or
> against what it was taken — `_blind_records/*.json` carries no such field, and file mtime is
> overwritten on every re-run. In the meantime: **absence of a row is never a pass, and an old row
> is not a pass either.** A batch landing an AC that retires a shape existing blind sets pin must
> name and re-measure those `(WP, set)` pairs, or record that it did not.

**A VACUOUS or DIVERGENT verdict invalidates the corresponding claim in an already-closed
handover.** That is a permitted and expected outcome of this work package, and it is stated
here plainly rather than softened. Conversely, **until a `(WP, set)` pair carries a CONFIRMED
row with a non-zero collected count, its blind claim is unverified regardless of what any
handover says.** Absence of a row is never readable as a pass.

## Tally — 58 rows

| Verdict | Rows |
|---|---|
| CONFIRMED | 58 |
| DIVERGENT | 0 |
| VACUOUS | 0 |
| UNRUNNABLE | 0 |

<!-- Updated: WP62 added the two WP17 rows (52 → 54, CONFIRMED 51 → 53). -->
<!-- Updated: B13 backfilled four rows (WP18 set1/set2, WP63 set1/set2), all CONFIRMED
     (54 → 58, CONFIRMED 53 → 57). B13 also re-measured WP3 and flipped **WP3 set1**
     from CONFIRMED to DIVERGENT (57 → 56 CONFIRMED, 1 → 2 DIVERGENT): a failure that
     did not exist at WP56's sweep is now reproducible there. WP3 set2 remains
     DIVERGENT — WP59 amended and greened the two assertions it was licensed to amend,
     and doing so UNMASKED a third, previously unreachable one. See the WP59 note. -->
<!-- Updated: B15 (WP59 re-entry) — Worker 2 extended WP59's licence to the two `edges.bare`
     pins, one per set. Both amended and both sets re-measured GREEN on 2026-08-02:
     set1 56/56/0, set2 45/45/0, counts read verbatim from `_blind_records/*.json`.
     Both WP3 rows flip DIVERGENT → CONFIRMED (56 → 58 CONFIRMED, 2 → 0 DIVERGENT).
     Row count unchanged at 58 — no row was added or removed, two verdicts changed. -->


**No row is VACUOUS.** Every blind set in the project executed a non-zero number of tests
under the repaired runner. The verification debt this batch existed to measure turned out to
be a debt of *reproducibility*, not of execution — see `ImplementationReport_WP57.md`.

## Rows

| WP | Set | Framework | Owner | Previously claimed (artefact:line) | Collected | Pass | Fail | Real result | Verdict | Basis |
|---|---|---|---|---|---|---|---|---|---|---|
| WP1 | set1 | vitest | WP56 | 12 files / 59 tests / 59 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:96` | **37** | 37 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP1 | set2 | vitest | WP56 | 12 files / 59 tests / 59 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:96` | **22** | 22 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP2 | set1 | vitest | WP56 | 12 files / 99 tests / 99 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:111` | **54** | 54 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP2 | set2 | vitest | WP56 | 12 files / 99 tests / 99 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:111` | **45** | 45 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP3 | set1 | vitest | WP56 → B13 → **B15** | 20 files / 101 tests / 101 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:125` | **56** | 56 | 0 | green | **CONFIRMED** | **Measured 2026-08-02 by B15 (WP59 re-entry), on the tree described below — not a standing fact.** History: CONFIRMED 56/56/0 by WP56; re-measured 56/55/1 by B13 with the set untouched, because WP10 AC5 landed in between and made a side-less `{fromNode}` a WHOLE endpoint register, so a bare edge reads `{from, id, to}`. Worker 2 then extended WP59's licence to this pin, ruling it a **stale expectation, not a defect** — `toV2Edge` keeps an edge's flat keys only when the register *fails* to build, so the earlier green was produced by the very defect AC5 fixes. B15 amended `test_file_shape_tabs_blind1.test.ts:79` to read through `decodeCanvasDataToFlat` and added two strictness pins (full flat key set; `decodeEndpointToFile` emits no `*Side`/`*End`). Re-measured **56 / 56 / 0**, verbatim from `_blind_records/WP3_set1_vitest.json`. Test count unmoved at 56. Falsified before being recorded: the `side = ""` perturbation turns the amended test red at the new pin directly and alone (55/56); production restored byte-clean, sha256 verified. |
| WP3 | set2 | vitest | WP56 → WP59 → **B15** | 20 files / 101 tests / 101 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:125` | **45** | 45 | 0 | green | **CONFIRMED** | **Measured 2026-08-02 by B15 (WP59 re-entry), on the tree described below — not a standing fact.** History: DIVERGENT 45/43/2; B13 re-measured first (the ruling was provisional on B2 closing), reproduced both named failures in exactly the recorded shape — 5 keys vs 7 at `:54`, 5 vs 9 at `:76` — and amended both under §7, which **unmasked** a third assertion that had never executed. Worker 2 extended the licence to it. B15 amended the `edges.bare` key-set pin (now at `:103` post-renumbering) to read the already-bound `flat` and added the `decodeEndpointToFile` no-`*Side` pin. Re-measured **45 / 45 / 0**, verbatim from `_blind_records/WP3_set2_vitest.json`. Test count unmoved at 45. Falsified before being recorded, and the falsification needed **two** perturbations: the charter's unconditional `side = ""` reddens the test at the earlier `:98` assertion, which *masks* this site — a narrower perturbation touching only side-less endpoints isolates it (red at exactly this pin, 44/45). Production restored byte-clean, sha256 verified. |
| WP4 | set1 | vitest | WP56 | 14 files / 53 tests / 53 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:142` | **25** | 25 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP4 | set2 | vitest | WP56 | 14 files / 53 tests / 53 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:142` | **28** | 28 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP5 | set1 | vitest | WP56 | 14 files / 50 tests / 50 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:188` | **26** | 26 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP5 | set2 | vitest | WP56 | 14 files / 50 tests / 50 pass / 0 fail<br/>`Worker3Handover_B1_P0.md:188` | **24** | 24 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP8 | set1 | vitest | WP56 | - | **5** | 5 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP8 | set2 | vitest | WP56 | - | **8** | 8 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP9 | set1 | vitest | WP56 | - | **6** | 6 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP9 | set2 | vitest | WP56 | - | **4** | 4 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP10 | set1 | vitest | WP56 | 8 files / 12 tests (6+6) / 12 pass / 0 fail<br/>`ImplementationReport_WP10.md:103-104` | **6** | 6 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP10 | set2 | vitest | WP56 | 8 files / 12 tests (6+6) / 12 pass / 0 fail<br/>`ImplementationReport_WP10.md:103-104` | **6** | 6 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP11 | set1 | vitest | WP56 | - | **3** | 3 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP11 | set2 | vitest | WP56 | - | **3** | 3 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP12 | set1 | vitest | WP56 | - | **16** | 16 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP12 | set2 | vitest | WP56 | - | **15** | 15 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP13 | set1 | vitest | WP56 | - | **15** | 15 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP13 | set2 | vitest | WP56 | - | **13** | 13 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP14 | set1 | vitest | WP56 | - | **32** | 32 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP14 | set2 | vitest | WP56 | - | **30** | 30 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP15 | set1 | vitest | WP56 | - | **11** | 11 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP15 | set2 | vitest | WP56 | - | **11** | 11 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP16 | set1 | vitest | WP56 | - | **13** | 13 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP16 | set2 | vitest | WP56 | - | **11** | 11 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP17 | set1 | vitest | **WP62** | 12 files / 13 tests / 13 pass / 0 fail<br/>`Worker3Handover_B2_P1cores.md:99` | **22** | 22 | 0 | green | **CONFIRMED** | the 12 authored files were re-run FIRST, on their own, and reproduced the prior claim exactly (13 collected / 13 pass / 0 fail). WP62 then added the three AC5 counterparts the original set predates, so the set now collects 22 and passes 22. Count moves UP; nothing was deleted or weakened. |
| WP17 | set2 | vitest | **WP62** | 12 files / 13 tests / 13 pass / 0 fail<br/>`Worker3Handover_B2_P1cores.md:99` | **110** | 110 | 0 | green | **CONFIRMED** | same baseline reproduction as set1 (13 collected / 13 pass / 0 fail on the 12 authored files). WP62's three AC5 counterparts are table-driven here — 10 typed keys × 2 junk values, and 24 insertion-order permutations per precedence scenario — so the set now collects 110 and passes 110. |
| WP41 | set1 | vitest | WP57 | 16 files / 44 tests / 44 pass / 0 fail<br/>`Worker3Handover_B8_P6.md:54` | **24** | 24 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP41 | set2 | vitest | WP57 | 16 files / 44 tests / 44 pass / 0 fail<br/>`Worker3Handover_B8_P6.md:54` | **20** | 20 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP42 | set1 | vitest | WP57 | 14 files / 73 tests / 73 pass / 0 fail<br/>`Worker3Handover_B8_P6.md:87` | **28** | 28 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP42 | set2 | vitest | WP57 | 14 files / 73 tests / 73 pass / 0 fail<br/>`Worker3Handover_B8_P6.md:87` | **45** | 45 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP43 | set1 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **10** | 10 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP43 | set2 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **12** | 12 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP44 | set1 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **66** | 66 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP44 | set1 | vitest | WP57 | - | **11** | 11 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP44 | set2 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **87** | 87 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP44 | set2 | vitest | WP57 → **WP60** | - | **25** | 25 | 0 | green | **CONFIRMED** | was DIVERGENT (25/24/1). The single failure was a stale import-surface pin (`{node:http}` vs the module's sanctioned `{node:crypto, node:http}`), amended under §7 by **WP60**; re-run 2026-08-01 collects 25 and passes 25 |
| WP45 | set1 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **50** | 50 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP45 | set2 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **49** | 49 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP46 | set1 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **41** | 41 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP46 | set1 | vitest | WP57 | 22 tests / 21 pass / 1 fail — reported OPEN, not green<br/>`Worker3Handover_B9a_T3infra.md:223` | **22** | 22 | 0 | green | **CONFIRMED** | the prior claim was NOT a green: B9a:223 reported 22 collected / 21 pass / 1 fail and left it open. Measured before the WP58 fix: 22 / 21 / 1 — an exact match, so the claim is confirmed. Measured after WP58 fixed the defect it named: 22 / 22 / 0. The row shows the post-fix state; the claim it confirms is the pre-fix one. |
| WP46 | set2 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **41** | 41 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP46 | set2 | vitest | WP57 | - | **19** | 19 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP47 | set1 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **92** | 92 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP47 | set1 | vitest | WP57 | - | **59** | 59 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP47 | set2 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **114** | 112 | 2 | **2 FAILING** | **CONFIRMED** | the prior claim already predicted these failures: B9a:113 claimed 647 / 645 / **2 fail**, and the 2 measured failures are the same two it named — both in test_tp04_teardown_exit_paths_blind2.py. A reproduced failure that the claim predicted confirms the claim; it does not contradict it. The tests are defective (double pytest.raises), which is a finding, not a divergence. |
| WP47 | set2 | vitest | WP57 | - | **60** | 60 | 0 | green | **CONFIRMED** | executed with a non-zero count; no prior claim existed, so this row establishes the baseline rather than confirming an earlier one |
| WP48 | set1 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **43** | 43 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP48 | set2 | pytest | WP57 | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | **42** | 42 | 0 | green | **CONFIRMED** | executed a non-zero count and the result matches the prior claim |
| WP49 | set1 | vitest | WP56 → **WP61** | - | **32** | 32 | 0 | green | **CONFIRMED** | was DIVERGENT (32/31/1). The single failure was class A — a 10 ms timer advance shorter than one 20 ms poll, so the promise never settled; amended under §7 by **WP61**; re-run 2026-08-01 collects 32 and passes 32 |
| WP49 | set2 | vitest | WP56 → **WP61** | - | **34** | 34 | 0 | green | **CONFIRMED** | was DIVERGENT (34/30/4). Four failures across three classes — one class A timing, one class B 4-key `session.info` pin vs WP46's settled 9-key payload, two class C *unsatisfiable as authored*; all amended under §7 by **WP61**; re-run 2026-08-01 collects 34 and passes 34 |
| WP18 | set1 | vitest | **B13** | 16/16 · 14/14<br/>`Worker3Handover_B3b_DataLossFixes.md` | **16** | 16 | 0 | green | **CONFIRMED** | backfill. Re-run 2026-08-02 under the WP55-repaired runner; 12 files staged, depth 3. Counts read verbatim from `_blind_records/WP18_set1_vitest.json`, not from console prose. Reproduces B3b's claim exactly. |
| WP18 | set2 | vitest | **B13** | 16/16 · 14/14<br/>`Worker3Handover_B3b_DataLossFixes.md` | **14** | 14 | 0 | green | **CONFIRMED** | backfill. Re-run 2026-08-02 under the WP55-repaired runner; 12 files staged, depth 3. Counts read verbatim from `_blind_records/WP18_set2_vitest.json`. Reproduces B3b's claim exactly. |
| WP63 | set1 | vitest | **B13** | 12/12 · 14/14<br/>`Worker3Handover_B3b_DataLossFixes.md` | **12** | 12 | 0 | green | **CONFIRMED** | backfill. Re-run 2026-08-02 under the WP55-repaired runner; 4 files staged, depth 3. Counts read verbatim from `_blind_records/WP63_set1_vitest.json`. Reproduces B3b's claim exactly. |
| WP63 | set2 | vitest | **B13** | 12/12 · 14/14<br/>`Worker3Handover_B3b_DataLossFixes.md` | **14** | 14 | 0 | green | **CONFIRMED** | backfill. Re-run 2026-08-02 under the WP55-repaired runner; 4 files staged, depth 3. Counts read verbatim from `_blind_records/WP63_set2_vitest.json`. Reproduces B3b's claim exactly. |

## Pair totals, reconciled against the combined claims

Several handovers recorded only a `blind_set1 + blind_set2` combined figure. Those are
reconciled here against the sum of the two measured rows.

| WP | Framework | Claimed combined | Measured combined (collected / pass / fail) | Files | Match |
|---|---|---|---|---|---|
| WP1 | vitest | 12 files / 59 tests / 59 pass / 0 fail | 59 / 59 / 0 | 12 | exact |
| WP2 | vitest | 12 files / 99 tests / 99 pass / 0 fail | 99 / 99 / 0 | 12 | exact |
| WP3 | vitest | 20 files / 101 tests / 101 pass / 0 fail | 101 / 99 / 2 | 20 | count matches, but **2 now FAIL** where the claim said 0 |
| WP3 | vitest | *(same claim, re-measured by B13 2026-08-02)* | 101 / 99 / 2 | 20 | still 101 collected and still 2 failing — but **they are not the same 2**. WP59 fixed set2's two; one new failure surfaced in each set behind them. The unchanged total is a coincidence of arithmetic, not evidence of a stable state. |
| WP3 | vitest | *(same claim, re-measured by B15 2026-08-02 after Worker 2 extended WP59's licence)* | **101 / 101 / 0** | 20 | **exact — the claim now holds.** Both `edges.bare` pins amended to read through the sanctioned inverse; 56/56/0 + 45/45/0. Collected count unmoved at 101 throughout, which is why it was never a usable health signal here. |
| WP4 | vitest | 14 files / 53 tests / 53 pass / 0 fail | 53 / 53 / 0 | 14 | exact |
| WP5 | vitest | 14 files / 50 tests / 50 pass / 0 fail | 50 / 50 / 0 | 14 | exact |
| WP10 | vitest | 8 files / 12 tests (6+6) / 12 pass / 0 fail | 12 / 12 / 0 | 8 | exact |
| WP41 | vitest | 16 files / 44 tests / 44 pass / 0 fail | 44 / 44 / 0 | 16 | exact |
| WP42 | vitest | 14 files / 73 tests / 73 pass / 0 fail | 73 / 73 / 0 | 14 | exact |
| WP43–WP48 | pytest | 647 blind tests / 645 pass / 2 fail (aggregate over WP43-WP48 Python, both sets)<br/>`Worker3Handover_B9a_T3infra.md:113` | 647 / 645 / 2 | 124 | **exact — 647/645/2 reproduced, and the 2 failures are the same two** |

## Coverage boundary

- **Re-run by WP56** (previously framework-discoverable): TypeScript sets for WP1–WP5,
  WP8–WP16 and WP49, both sets each.
- **Re-run by WP57** (non-discoverable, cross-package, or Python): WP41, WP42, the
  TypeScript half of WP46, the TypeScript files inside WP44 and WP47, and the Python sets
  for WP43–WP48, both sets each.
- **No blind set exists** for WP6 (declared deviation — its deliverable *is* a test suite),
  WP7, and WP20–WP40. These are "no blind set" rows, not missing rows: nobody looked,
  because there is nothing to look at.
- **Added by WP62:** the TypeScript sets for **WP17**, both sets. See the closure note below.
- **Added by B13:** the TypeScript sets for **WP18** and **WP63**, both sets each (4 rows).
- Directory check, re-measured **2026-08-02 06:5x UTC** (B13):
  `tests/blind_set1/` and `tests/blind_set2/` each contain **31** WP folders = **62**
  `(WP, set)` pairs. This ledger carries **58** rows. As before, the two numbers are not
  comparable directly and reading them as "complete" would be the error this ledger exists to
  prevent. The row count exceeds one-row-per-pair because WP44, WP46 and WP47 each hold a
  TypeScript **and** a Python half, measured separately (6 extra rows); the pair count exceeds
  the rows because **five WP folders still carry no row at all** (see below). Rows cover
  **26 of the 31** folders — 46 rows for the 23 single-framework WPs, plus 12 rows for the
  3 dual-framework ones (WP44/WP46/WP47) = 58.
- **The folder count moved again during B13** (27 → 31). `WP20`–`WP23` appeared with the batch
  that authored them. This is now the third consecutive charter to find the filesystem ahead of
  it, which is a property of a live tree, not a defect in any one charter.

### Closed by WP62: WP17 now has rows

The previous edition of this section recorded `tests/blind_set{1,2}/WP17/` as *deliberately
not covered* — created by the then-live batch B2 between 21:42 and 21:49 on 2026-08-01, after
the WP56/WP57 sweep had begun, and therefore named as a gap rather than skipped silently.
**That gap is now closed by WP62 and the two rows are in the table above.**

The closure was made the honest way, not by asserting a pass:

1. The **12 authored files were run first, unchanged and on their own**, and reproduced the
   B2 claim (`Worker3Handover_B2_P1cores.md:99`) *exactly*: 13 collected / 13 pass / 0 fail
   on both sets. The prior claim is CONFIRMED on its own terms before anything was added.
2. WP17 has since gained **AC5** (Worker 2's 2026-08-02 amendment), which **postdates the
   blind files** — all 12 were authored 21:42–21:49 on 2026-08-01 against AC1–AC4 only. A
   survey of all 24 files found **zero** coverage of any of AC5's three parts. WP62 therefore
   added three counterparts per set (`tp13`/`tp14`/`tp15`), derived independently per set.
3. **Nothing was edited, renamed, deleted or weakened.** The counts move UP: set1 12 → 15
   files and 13 → 22 tests, set2 12 → 15 files and 13 → 110 tests.

### Closed by B13: WP18 and WP63 now have rows

The previous edition named `WP18`, `WP19` and `WP63` as uncovered. **B13 closed WP18 and
WP63.** Both were re-run under the WP55-repaired runner and both reproduced the executed
counts B3b reported, so their rows CONFIRM a prior claim rather than establishing a baseline.
Counts were transcribed from `_blind_records/*.json`, never from console prose.

`WP19` was **deliberately excluded from the backfill and remains open.** Its blind sets pin
delete oracles that Worker 2 may amend imminently; ledgering them now would record a row that
is about to change. It is named here as outstanding rather than closed silently — the same
discipline B12 applied.

### Still NOT covered, and absence is still not a pass: WP19, WP20, WP21, WP22, WP23

| Folder | Why it has no row |
|---|---|
| `WP19` | Excluded from B13's charter **on purpose**: its blind sets pin delete oracles awaiting a Worker 2 amendment licence. The 8 reds currently in the plugin suite are these oracles. Ledger after the amendment lands, not before. |
| `WP20` | Appeared after B13's scope was set; outside its declared scope (WP18 + WP63 only). |
| `WP21` | Appeared after B13's scope was set; outside its declared scope. |
| `WP22` | Appeared after B13's scope was set; outside its declared scope. |
| `WP23` | Appeared after B13's scope was set; outside its declared scope. |

**These five are unverified — not failing, not passing; nobody with a charter has looked.**
`_blind_records/` does contain JSON for some of them from their authoring batch, but a record
written by the batch that authored the set is not independent re-verification and is not
promoted to a row here. Handed back to the Dispatcher.

> **Note on the WP62 charter's AC2.** C62 AC2 asked that on completion the ledger cover
> *every* blind set present on disk "with no gaps". That was written when WP17 was the only
> gap. Three further folders have appeared since, one of them during this work package, so
> the literal no-gaps condition is not satisfiable by WP62 alone — and closing it by staying
> silent about the three would be precisely the failure mode AC2 was written to prevent. What
> AC2 actually demands is delivered: **the ledger's own coverage claim is checkable against
> the filesystem**, and the count it states (27 folders, 54 pairs, 54 rows, 24 folders
> covered, 3 uncovered and named) can be verified by a reader's directory listing.

## Findings that are NOT verification failures

These are real, reproducible test failures surfaced by the re-verification. Under this
batch's hard constraint they are **recorded, never repaired**: no blind assertion was
touched. Each needs a Worker 2 charter.

| WP | Set | Failing test | Symptom | Suspected owner |
|---|---|---|---|---|
| WP3 | set2 | `test_value_preservation_blind2` (2 tests) | round trip returns 5 keys, expected 7; edge optional fields 5 vs 9 | **RESOLVED by WP59.** Re-measured after B2 closed and reproduced in exactly this shape, then amended under §7 to read through `decodeCanvasDataToFlat`. Both now pass; strictness increased. |
| WP3 | set2 | `test_value_preservation_blind2:79` → `:103` (1 test) | `parsed.edges.bare` is `{from, id, to}`, test pins `{fromNode, id, toNode}` | Surfaced by WP59; was never observed before because the `:76` failure in the same test masked it. WP10 AC5 made a side-less `{fromNode}` a whole register. **RESOLVED by B15** — Worker 2 extended WP59's licence, ruling it a stale expectation rather than a defect: the pre-AC5 green was itself produced by the defect AC5 fixes. Amended to read the already-bound `flat`; strictness increased. |
| WP3 | set1 | `test_file_shape_tabs_blind1:79` (1 test) | `parsed.edges["e-only"].fromNode` is `undefined` | Surfaced by B13's re-measurement. Set1 was CONFIRMED green at WP56's sweep and B13 changed nothing in it. Same WP10-AC5 root cause. **RESOLVED by B15** under the same extended licence — amended to read through `decodeCanvasDataToFlat`; strictness increased. |
| WP44 | set2 | `test_tp12_no_server_no_port_blind2` | imports `{node:crypto, node:http}`, test pins exactly `{node:http}` | a later WP added `node:crypto`; stale expectation. **RESOLVED by WP60** — amended to the sanctioned two-builtin set, strictness held (exact whole-set `toEqual`). |
| WP46 | set1 | `test_probe_side_effect_free_blind1` | `bump` called **2** times after one edit, expected 1 | **WP58** (this batch) |
| WP47 | set2 | `test_tp04_teardown_exit_paths_blind2` (2 tests) | `DID NOT RAISE` — structurally unsatisfiable | **defective test**, not an implementation failure. Left unmodified per WP57 §5. |
| WP49 | set1 | `test_tp4_timeout_semantics_preserved_blind1` | timeoutMs 0 boundary — the test advanced fake timers 10 ms, less than one 20 ms poll, so the promise never settled and it died on vitest's 5 s timeout | WP49. **RESOLVED by WP61** (class A) — advance raised to one full poll interval; both `toEqual` verdicts kept verbatim. |
| WP49 | set2 | 4 tests incl. `test_tp3_control_edit_still_bumps_blind2` | <!-- Updated: WP61 AC6 — the assertion is a FOUR-key exact toEqual (`clientId`,`role`,`roomId`,`connected`), not 2-key as first recorded 2026-08-01 --> `test_tp3` expects a **4-key** `session.info`, gets WP46's 9-key payload; `test_tp1` is the same class-A timing staleness as set1; `test_tp2` and `test_tp10` are **unsatisfiable as authored** | stale expectation vs WP46's settled payload (`test_tp3`). **RESOLVED by WP61** — one class A, one class B, two class C repairs, each with a §7 ledger entry; the two class C mechanisms are demonstrated, not asserted. |

