# Worker 3 Handover — Canvas V2, batch B13 (WP59 + ledger backfill)

**Batch:** B13 · **Phase:** VI · **Scope:** WP59 + WP18/WP63 ledger backfill (narrow)
**Date:** 2026-08-02 · **Returns:** `ESCALATE_TO_WORKER2`

> **Task 2 (the backfill) is COMPLETE.** Task 1 (WP59) is **amended as licensed but its DoD is
> not met**, for a reason that is itself the finding. Both are reported below; the escalation
> is scoped to WP59 only and does not block the backfill.

---

## Scope of This Run

| Task | Status |
|---|---|
| WP59 — WP3 set2 round-trip blind amendment | **AMENDED, DoD NOT MET → escalated** |
| Ledger backfill — WP18, WP63 | **DONE** |
| WP19 backfill | **deliberately NOT done** (excluded by instruction; named, not silently closed) |

**Production source touched: NONE.** Two files were perturbed for falsification and restored
**byte-clean, sha256 verified identical** to their pre-run bytes. Nothing under `server/`,
`docker/`, `deploy/`, `plugin/main.js`, `manifest.json` or `package.json` was opened.

## Risk Summary

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP59 | ESCALATED | HIGH | — (blocked on Worker 2) |
| backfill (WP18, WP63) | DONE | NONE | NORMAL |

---

## The one thing to read if you read nothing else

**WP59's re-measurement gate passed, and applying the licensed amendment then falsified the
charter's own out-of-scope clause.**

C59 §2 fenced off assertion `:79` (`edges.bare`) with the words *"They pass and must keep
passing."* It was not passing. It was **unreachable** — the `:76` failure in the same test
threw first, so `:79` had never executed in any measurement anyone had taken. Greening `:76`
under licence made it run for the first time, and it is red.

The cause is not a defect. WP10 AC5 deliberately made a side-less `{fromNode}` a *whole*
endpoint register, so a bare edge now reads `{from, id, to}`. `decodeCanvasDataToFlat` restores
`{fromNode, id, toNode}` exactly — nothing is lost. But it is a **third site in a test the
charter fenced off**, and adapting the amendment to cover it is precisely the move that turns a
licensed amendment into a papered-over regression. Hence the escalation.

**A masked assertion is not a passing assertion.** Any charter that fences off a test on the
grounds that it currently passes should first check whether the assertion was ever *reached*.

---

## Task 1 — WP59

### Re-measurement outcome: REPRODUCED IN THE SAME SHAPE

C59 §5 made the ruling provisional on B2 closing and required re-measurement before any edit.
Done first, on the quiet tree:

| | Collected | Pass | Fail |
|---|---|---|---|
| `WP3 set2`, pre-amendment | **45** | 43 | **2** |

Same counts as WP56's DIVERGENT row, same two tests, same lines, same symptoms:
`:54` → 5 keys vs 7, `:76` → 5 vs 9. Exactly what C59 §3 predicted. **Licence live; amendment
applied.**

### Ledger entry (BUILD_SPEC §7) — two rows

| Site | Why stale | Strictness after |
|---|---|---|
| `tests/blind_set2/WP3/test_value_preservation_blind2.test.ts:53-54` | `.canvas` bytes unchanged; WP16 AC1 moved the **reader** (`x,y`→`pos`, `w,h`→`size`). `decodeCanvasDataToFlat` is the exact inverse, applied at every internal call site. Visible twin already amended the same way. | Whole-collection exact `toEqual` over the full sorted key list, form unchanged. **Stricter:** the value loop at `:55-57` was dead code (test died at `:54`) and now executes; bridge invertibility now pinned. |
| `…test_value_preservation_blind2.test.ts:76-78`, `:80` | Same cause, edge side: `toV2Edge` folds `from*`→`from`, `to*`→`to`. | Nine-key list kept **verbatim**. **Stricter:** added `toEqual` decodes the `to` register and pins `{toNode,toSide,toEnd}`. |

No `toMatchObject`, subset, `objectContaining`, key-count softening, `skip`/`only` or
destructuring anywhere. **Test count in the file: 4 before, 4 after.**

### Falsification evidence — performed, not asserted

| # | Perturbation | Observed |
|---|---|---|
| P1 | `decodePos` drops `y` | Amendment 1 red (`Array(6)` vs `Array(7)`). Both untouched tests in the file stayed green. |
| P2 | `decodeEndpointToFile` drops `end` | Amendment 2 red (7 keys vs 9) and **only** it — 44/45 pass. |

`canvas-registers.ts` restored to `553c8464…d8b748` and `canvas-sync.ts` verified at
`b2590855…cb880438` — both byte-identical to baseline after every perturbation.

### Why this is an escalation and not a HANDOVER_READY

Post-amendment `WP3 set2` = **45 / 44 / 1**. The residual `:79` is out of licence. Two options
existed and both are Worker 2's to authorise, not mine:

- extend WP59's §7 licence to the `edges.bare` pin in **both** sets (recommended — it is the
  same already-sanctioned staleness class, and the decode bridge proves no data is lost), or
- rule it a real defect in WP10 AC5's presence semantics (I do not believe this, but it is the
  charter owner's call).

---

## Task 2 — ledger backfill (COMPLETE)

Re-run under the **WP55-repaired runner**; counts transcribed **verbatim from
`_blind_records/*.json`**, never from console prose. Both reproduce B3b's reported counts, so
these rows CONFIRM a prior claim rather than establishing a baseline. Staging depth was derived
per set by the runner (both depth 3), not hardcoded.

| WP | Set | Files staged | Collected | Pass | Fail | Verdict |
|---|---|---|---|---|---|---|
| WP18 | set1 | 12 | **16** | 16 | 0 | **CONFIRMED** |
| WP18 | set2 | 12 | **14** | 14 | 0 | **CONFIRMED** |
| WP63 | set1 | 4 | **12** | 12 | 0 | **CONFIRMED** |
| WP63 | set2 | 4 | **14** | 14 | 0 | **CONFIRMED** |

No `ZERO_COLLECTION` anywhere; every count non-zero, so no set is UNVERIFIED-but-green.

**WP19 excluded on purpose**, per instruction: its blind sets pin delete oracles Worker 2 may
amend within the hour, and ledgering them now would record a row about to change. It is named
as outstanding in the ledger, not closed silently.

---

## Updated ledger tally

| | Before B13 | After B13 |
|---|---|---|
| Rows | 54 | **58** |
| CONFIRMED | 53 | **56** |
| DIVERGENT | 1 | **2** |
| VACUOUS | 0 | 0 |
| UNRUNNABLE | 0 | 0 |

Arithmetic: +4 backfilled CONFIRMED rows (53 → 57); **WP3 set1 flipped CONFIRMED → DIVERGENT**
(57 → 56 CONFIRMED, 1 → 2 DIVERGENT).

### WP3 set1 — a CONFIRMED row that no longer holds

Not caused by B13, which changed nothing in set1. Re-measured **56 / 55 / 1**:

```
test_file_shape_tabs_blind1.test.ts
  "stays readable by the unchanged parseCanvas, including edge-only content"
  AssertionError: expected undefined to be 'ghost-a'
```

`parsed.edges["e-only"].fromNode` on a bare edge — **identical root cause** to the `:79` residue
in set2. Its CONFIRMED row predates WP10 AC5. Recorded as DIVERGENT with the cause named; **not
repaired**, because it is outside WP59's licence too. Worker 2 should fold it into the same
amendment decision.

> Note the trap in the pair-total line: WP3 still reads `101 collected / 99 pass / 2 fail`,
> exactly as before. **The 2 are not the same 2.** The unchanged total is arithmetic
> coincidence, not a stable state.

### Coverage boundary moved again

Directory check re-measured this run: `tests/blind_set{1,2}/` now hold **31** WP folders each
(was 27) = **62** pairs. `WP20`–`WP23` appeared with the batch that authored them. Rows cover
**26 of 31** folders. Still uncovered and **not readable as a pass**: `WP19` (deliberate),
`WP20`, `WP21`, `WP22`, `WP23` (appeared after B13's scope was set).

`_blind_records/` *does* contain JSON for some of these from their authoring batch. A record
written by the batch that authored the set is **not** independent re-verification and was not
promoted to a row. This is the third consecutive charter to find the filesystem ahead of it —
a property of a live tree, not a defect in any one charter.

---

## Tree state at handover

| Gate | Result |
|---|---|
| Plugin suite | **1346 tests / 1338 pass / 8 fail** — count **unmoved** from batch start |
| `tsc --noEmit` | **clean, exit 0** (measured with no blind run in flight) |
| Staging hygiene | clean — runner reported `no v2blind staging dirs present` after every run |

### The 8 reds are FOREIGN — not B13's

All 8 are WP19's delete-oracle rows, awaiting Worker 2's amendment licence. None is in a blind
set, none is in WP3, none was touched by this batch:

| File | Test |
|---|---|
| `src/__tests__/canvas-sync.test.ts` | genuine local delete removes the node from the Y map |
| `src/__tests__/canvas-sync.test.ts` | prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5) |
| `src/__tests__/canvas-sync.test.ts` | a genuine local DELETE of a whole record is still honoured (protection is per-key only) |
| `src/__tests__/w4-canvas-integrity.test.ts` | A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS |
| `src/__tests__/v2/wp4/test_tp01_intent_basis_visible.test.ts` | T4 with the view open and a hand-over receipt, the delete still happens |
| `src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts` | T2 after a confirmed apply the same omission is a deletion |
| `src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts` | T3 an interacting record is never handed over, so it cannot be deleted |
| `src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts` | D2 seam `advanceFromReceipt(…, {perFieldReceipt:false})`: the unlanded apply leaks and deletes |

### One intermittent, worth flagging

`src/__tests__/wp5/latency.test.ts > harness injects a measurable RTT inside the 50–150 ms band
(US6 AC1)` failed in **one** of two consecutive full-suite runs (9 fails once, 8 the other) with
no intervening change. A wall-clock timing band on a loaded machine. Not B13's, not a new red —
flagged so a future batch does not mistake it for a regression.

---

## Note for Worker 4

**W4 Test Targets: `0`.** WP59 produces no runtime behaviour — it amends unit-level blind test
expectations and documentation artefacts. There is nothing to observe in a running system.

**Staging hygiene:** if you see a `v2blind` / `_blind[12]` path in a build error, it is a
transient staging artefact of a concurrent blind run — re-check before diagnosing it as a break.
It is never a build failure.

## Summary for Worker 4 Entry Point

Nothing new is observable at runtime. The verifiable outputs are:

- `python workflowArtifacts/canvas-v2/_run_blind.py WP18 both` → PASS, 16 and 14 collected
- `python workflowArtifacts/canvas-v2/_run_blind.py WP63 both` → PASS, 12 and 14 collected
- `python workflowArtifacts/canvas-v2/_run_blind.py WP3 both` → **still FAIL**, 1 per set, both
  the `edges.bare` staleness awaiting Worker 2
- `BlindVerificationLedger.md`, whose coverage claim (31 folders, 62 pairs, 58 rows, 26 folders
  covered, 5 named uncovered) can be checked against a directory listing
