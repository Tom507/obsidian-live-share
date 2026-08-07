# Implementation Report — WP57: Blind re-verification, non-discoverable and cross-package sets

**Status:** DONE · **Changed file:** `BlindVerificationLedger.md` (completed)
**No source code, no test and no blind file was modified by this work package.**

---

## 1. The headline, stated plainly

**Every blind set in the project executes. Not one row is VACUOUS.**

| Verdict | Rows (whole project) | of which WP57 scope |
|---|---|---|
| CONFIRMED | 48 | 21 |
| DIVERGENT | 4 | 1 |
| VACUOUS | **0** | 0 |
| UNRUNNABLE | 0 | 0 |

Whole-project totals across all 52 ledger rows; WP56 owns the other 30.

The verification debt this batch existed to measure turned out to be a debt of
**reproducibility**, not of execution. The prior claims were, with one exception, *true*. What
was missing was any committed instrument capable of reproducing them — which is a real and
serious process defect, but it is a different defect from the one that was suspected, and the
difference is worth more than a clean bill of health would have been.

---

## 2. The WP41 / WP42 contradiction — resolved

`Worker3Handover_B8_P6.md` claims, for sets whose stored filenames no vitest glob can discover:

| Claim | Artefact | Files | Tests |
|---|---|---|---|
| WP41 `blind_set1 + blind_set2` | `Worker3Handover_B8_P6.md:54` | 16 | **44** |
| WP42 `blind_set1 + blind_set2` | `Worker3Handover_B8_P6.md:87` | 14 | **73** |

Measured under the repaired runner:

| WP | set1 | set2 | Combined | Files | Claimed |
|---|---|---|---|---|---|
| WP41 | 24 | 20 | **44** | 8 + 8 = 16 | 44 / 16 |
| WP42 | 28 | 45 | **73** | 7 + 7 = 14 | 73 / 14 |

**Both counts reproduce exactly, and so do both file counts.** All 44 and all 73 pass, as
claimed.

### What actually happened

Worker 2's ruling was that "both statements cannot be true". On the evidence available at
charter time that was a sound inference. It is now falsified, and the resolution is:

**The counts are real and are attributable to the stored artefacts.** Four independent numbers
(44, 73, 16, 14) match on the nose. That is not a coincidence anyone should explain away.

What could *not* have produced them is the committed `_run_blind.py`. WP55 established that the
old runner did not silently pass a non-discoverable set — vitest 4 exits **1** on zero
discovery and the runner propagated it. So B8/P6's coder did not misread a silent green; it
staged these files through a mechanism that renamed them to a discoverable pattern and targeted
`server/` for WP41 — that is, it did by hand or by throwaway script exactly what WP55 has now
made permanent. **The numbers were honestly reported. The method was never recorded, and the
committed tooling could not reproduce it.**

### Why this is recorded as CONFIRMED and not as a fresh green

The charter's instruction was not to paper over the contradiction by re-running and logging a
new green, because "a fresh green confirms the *code*; it does not confirm the *claim*". That
instruction is respected here, and the distinction is the reason this row is CONFIRMED rather
than merely green:

- A fresh green alone would only show the implementation currently works.
- What is recorded instead is an **exact match of four previously-claimed quantities** —
  44, 73, 16, 14 — that were written down months of work earlier by an agent that could not have
  known what this run would produce. That is evidence about the *claim*, not just the code.

Had the counts come back as, say, 51 and 66, the verdict would have been DIVERGENT and B8/P6's
claim would have been invalidated. They did not.

**The residual finding, which is not dismissed:** a claim that cannot be reproduced by committed
tooling is unverifiable at the time it is made, however true it turns out to be. B8/P6 recorded
a result without recording a repeatable path to it. WP55 closes that gap going forward; the
ledger now carries the reproduction.

---

## 3. The Python aggregate — confirmed exactly, including "the same two"

`Worker3Handover_B9a_T3infra.md:113` claims **647 blind tests, 645 pass, 2 fail** across the
WP43–WP48 Python halves.

Measured: **647 collected, 645 passed, 2 failed.** Exact.

The two failures are the same two, in the same file:
`tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` —
`test_the_inner_context_manager_unwinds_before_teardown_finishes` and
`test_forty_notes_are_all_still_there_after_an_interrupted_run`.

These are **defective tests, not implementation failures**: `drive()` already wraps the body in
`pytest.raises`, consuming the exception, and both points wrap `drive()` in a second outer
`pytest.raises` that can therefore never see one. `DID NOT RAISE` is guaranteed regardless of
implementation. Recorded as a finding; **left unmodified**, per WP57 §5.

A failing test is itself proof of execution, which is why the Python halves were the most
credible prior claim in the project — and the measurement bears that out.

---

## 4. WP46's TypeScript half — CONFIRMED, and the "already proven vacuous" framing corrected

The charter describes WP46's TS half as "already proven vacuous". The ledger records something
more precise. `Worker3Handover_B9a_T3infra.md:223` reported it as **"WP46 blind_set1 TS, 1
failure (21/22)"** — explicitly *open and not green*. Measured before the WP58 fix: **22
collected, 21 passed, 1 failed.** Exact match.

So B9a executed this set correctly and reported it honestly. What was vacuous was every *gate*
run before it, not B9a's final claim. The distinction matters because the two readings assign
blame very differently, and the record supports the more generous one.

After WP58's fix: **set1 22/22, set2 19/19**, both green with recorded counts.

---

## 5. Which claims are invalidated

**Invalidated — DIVERGENT (4 rows).** These sets execute, but now fail where the claim said they
passed, or had no claim and fail. Note that WP46 set1 and WP47 set2 are **not** in this list:
their prior claims *predicted* the failures they still produce, so reproducing them confirms
those claims rather than contradicting them.

| WP | Set | Claim status | What now fails |
|---|---|---|---|
| WP3 | set2 | `Worker3Handover_B1_P0.md:125` claimed 101/101/0 | 2 tests in `test_value_preservation_blind2` — round trip returns 5 keys where 7 expected. **B2 territory (`canvas-canonical`/`canvas-sync`) — not touched, recorded and left.** |
| WP44 | set2 (TS) | no TS blind count ever recorded | `test_tp12_no_server_no_port_blind2` — imports `{node:crypto, node:http}`, test pins exactly `{node:http}` |
| WP49 | set1 (TS) | no TS blind count ever recorded | `test_tp4_timeout_semantics_preserved_blind1` |
| WP49 | set2 (TS) | no TS blind count ever recorded | 4 tests, incl. `test_tp3_control_edit_still_bumps_blind2` expecting a 2-key `session.info` and receiving WP46's settled 9-key payload |

Note the shape of most of these: **stale expectations**, where a later additive WP changed a
shared surface and an earlier blind set still pins the older shape. WP49's `session.info`
expectation and WP44's import-set expectation are both of this kind. That is a sequencing
consequence of serialising WPs over one shared module, not necessarily an implementation defect
— but under this batch's hard constraint **no assertion was adjusted to find out.** Each needs a
Worker 2 charter.

**Confirmed.** B8/P6 (WP41, WP42) in full. B9a's Python aggregate in full. B9a's WP46-TS claim.
B1/P0's WP1, WP2, WP4, WP5 (WP3 diverges). WP10's recorded claim.

**Never claimed, now measured.** The TypeScript halves of WP44, WP47 and WP49 carried no blind
count in any handover. They now have rows — three of the four DIVERGENT findings above come from
sets nobody had ever measured, which is exactly the gap AC4's "absence of a row is never
readable as a pass" was written to close.

---

## 6. Coverage

The ledger covers **every** blind set on disk: 23 WP folders × 2 sets = 46 pairs, carried as 52
rows (WP44, WP46 and WP47 hold both a TypeScript and a Python half, measured separately). A
reader can check the row count against `ls tests/blind_set{1,2}/`.

No blind file was edited, renamed in place, deleted or weakened. No implementation defect
surfaced by this WP was repaired inside it.
