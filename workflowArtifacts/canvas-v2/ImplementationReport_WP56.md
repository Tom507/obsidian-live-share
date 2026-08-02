# Implementation Report — WP56: Blind re-verification, previously discoverable sets

**Status:** DONE · **Created:** `BlindVerificationLedger.md` (schema, verdict vocabulary, rows)
**No source code, no test and no blind file was modified by this work package.**

---

## 1. Scope re-run

The TypeScript blind sets for **WP1–WP5, WP8–WP16 and WP49**, both sets each, under the WP55
repaired runner. Counts are transcribed by script from `_blind_records/*.json` into the ledger;
no number in the ledger was retyped by hand (`_gen_ledger.py`).

The prior-probability note in the charter said these were the sets most likely to have genuinely
executed, and that this was "a reason to expect CONFIRMED, not a reason to skip the measurement".
The expectation held — but the measurement was not redundant: it found **three** failing sets
that no prior claim had reported.

## 2. Result

**30 rows (15 WPs x 2 sets). 27 CONFIRMED, 3 DIVERGENT, 0 VACUOUS, 0 UNRUNNABLE.** Every set
executed a non-zero count.

`Worker3Handover_B1_P0.md`'s claims reproduce exactly, per set and in aggregate:

| WP | Claimed (artefact:line) | Measured combined | Match |
|---|---|---|---|
| WP1 | 12 files / 59 tests (`B1_P0:96`) | 59 / 59 / 0 | exact |
| WP2 | 12 files / 99 tests (`B1_P0:111`) | 99 / 99 / 0 | exact |
| WP3 | 20 files / 101 tests (`B1_P0:125`) | 101 / 99 / **2 fail** | count exact, result diverges |
| WP4 | 14 files / 53 tests (`B1_P0:142`) | 53 / 53 / 0 | exact |
| WP5 | 14 files / 50 tests (`B1_P0:188`) | 50 / 50 / 0 | exact |
| WP10 | 8 files / 12 tests (`ImplementationReport_WP10.md:103-104`) | 12 / 12 / 0 | exact |

B1/P0's headline figure of **362** blind tests over WP1–WP5 reconciles precisely:
59 + 99 + 101 + 53 + 50 = 362.

**WP4's documented nondeterminism did not recur.** B1/P0 records a WP4 blind test that failed on
4 of 6 runs on an unchanged tree before being made causally deterministic. Both WP4 rows came
back green (25 and 28), so no re-run was needed and no DIVERGENT verdict was assigned to it — the
charter's warning against a false accusation from a flake did not have to be exercised.

## 3. Divergences found

| WP | Set | Finding | Owner |
|---|---|---|---|
| WP3 | set2 | 2 tests in `test_value_preservation_blind2`: round trip returns 5 keys, expected 7; edge optional fields 5 vs 9. Claim `B1_P0:125` said 0 fail. | **B2 territory** (`plugin/src/canvas/canvas-canonical`, `plugin/src/files/canvas-sync`) — **not touched**, per the batch constraint. Recorded and handed back. |
| WP49 | set1 | `test_tp4_timeout_semantics_preserved_blind1` fails | WP49 |
| WP49 | set2 | 4 tests fail, incl. `test_tp3_control_edit_still_bumps_blind2` expecting a 2-key `session.info` and receiving WP46's settled 9-key payload | WP49 / sequencing |

**WP49's TypeScript half was never reported as a blind count in any handover.** Its rows are
established here for the first time. WP55 additionally found *why* it could not have been: WP49's
TS imports need staging depth 2, which the old runner never used.

**On B2 being in flight:** WP8–WP16 all came back green, so the charter's concern about reporting
in-flight work as an invalidated historical claim did not arise. WP3's failure is in B2's
territory but WP3 is a B1/P0 WP with a closed claim, so it is recorded as DIVERGENT against that
claim, with the caveat that the cause may lie in B2's live edits. Measurement state: working tree
at the time of the sweep, with B2 modifications present in `plugin/src/canvas/` and
`plugin/src/files/` (see `git status`).

## 4. Coverage boundary

Declared in the ledger and matching WP57's charter exactly: WP56 covers WP1–WP16 and WP49
TypeScript; WP41, WP42, WP46-TS, the TS files inside WP44/WP47, and the Python sets for WP43–WP48
are deferred to WP57. WP6 (declared deviation — its deliverable *is* a test suite), WP7 and
WP17–WP40 have no blind set at all and are recorded as such, so a reader can tell a set that
passed from a set nobody looked at.

## 5. Scope discipline

No blind file edited, renamed in place, deleted or weakened. No implementation defect repaired.
Every row carries a collected count.
