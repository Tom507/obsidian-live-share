# Implementation Report - WP125

## Outcome

`HANDOVER_READY` for the headless WP125 scope. The Worker 4 cycle-2 HIGH request is closed with direct A2, A3, A5, and mounted structural-event composition tests, plus physical RED -> SHA-identical restore -> GREEN controls. The new baseline tests exposed no product defect, so this revision changes tests and this report only. A7/BK11 remains `HUMAN_OBSERVABLE`; no live vault, endpoint, credential, token, or `data.json` was accessed.

## Revision 2 evidence added

- A2 editing ownership: a changed node with an open inline editor receives `structuralSeam.interacting`, is not rendered, requests event recovery, performs no persistence request, and later repairs through fair sweep selection after editing ends.
- A2 drag ownership: `reloadCanvasData` returns the named `false` refusal while the drag is active, does not mutate or render the node, and accepts the identical structural reload after the real drag-release seam runs. No persistence request occurs.
- A3 planner matrix: direct rows cover 0, 1, 11, and 200 live ids with priority empty, below batch, equal batch, and above batch. Duplicated and deleted priorities are ignored, every batch is duplicate-free, every cursor is valid, and every surviving id is covered after reorder/deletion.
- A5 attribution: one sequence produces exactly one `perNodeSeam`, one `structuralSeam`, and one `sweep` repair. The compatibility aggregate is asserted as the exact sum. Already-correct repaint, editing refusal, and detached deferral leave all repair counts unchanged.
- Mounted composition: a real adapter is registered in the real `LiveSharePlugin` lifecycle owner. An attached structural reload synchronously paints the changed node, queues one event request, and executes one event sweep after microtasks while `periodicRuns` remains zero.

## Design retained

- `reloadCanvasData` performs an O(n) changed-id comparison before `setData`, then O(k) guarded renders after successful `setData`, where k is the number of changed existing ids. Failed `setData` produces no structural repair.
- `planRepaintSweep` reserves at least one round-robin slot on multi-node boards. Under saturated priority, `rrSlotsPerTick = 1`, so the conservative bounds remain 11 ticks for 11 ids/batch 3 and 200 ticks for 200 ids/batch 10. Sorting live ids makes input reorder stable; cursor modulo the new size plus dead-priority filtering keeps survivors eligible after deletion.
- Mounted lifecycle state remains `idle -> pending -> running`, with one pending microtask, one rerun bit for requests raised during a run, and inactive/map-identity guards after teardown.
- Metrics remain split among `perNodeSeam`, `structuralSeam`, and `sweep`; aggregate `repaired` is compatibility-only and equals the exact source sum.

## Physical break-to-red evidence

The product adapter was copied aside at SHA-256 `E633F77341739987C8B0BCF9970E67621EE75F8F1B800A8EAC14EEE216EECA2A`. Every new plant was restored from that copy, both files were re-hashed to that same digest, and the targeted row returned GREEN.

| Group | Physical product mutation | RED evidence | SHA-identical restore -> GREEN |
|---|---|---|---|
| A2 interaction ownership | Disabled board busy, editing, drag-target, and structural drag guards | `c58f2185`: both new A2 rows failed for forced editing render and accepted active-drag reload | `5f934c6b`: both hashes `E633...CA2A`; 2/2 green |
| A3 bounded/survivor fairness | Restored priority-first full-batch filling (`priorityLimit = batch`) | `3eb6db87`: 7 planner rows failed, including saturated 11/200 and reorder/deletion survivors | `824a7b01`: both hashes `E633...CA2A`; 14/14 green |
| A5 mixed attribution | Routed every source tally into `sourceCounters.sweep` | `be5f3b89`: mixed-source row failed on the first exclusive counter assertion | `38f77c3b`: both hashes `E633...CA2A`; 1/1 green |
| Mounted structural-event composition | Removed the structural `requestRepaintSweep` call | `324bcf79`: mounted row observed zero event requests and no pending callback | `e871c99d`: both hashes `E633...CA2A`; 1/1 green |

These are discriminators against the broken planner/clock/counter behavior: priority-first saturation strands non-priority ids, misrouting changes the named source, and removing the mounted event door prevents the event run without relying on a periodic tick.

## Earlier WP125 controls retained

| Plant | Status before this revision |
|---|---|
| BK1-BK5, BK9 | Physically controlled in the original/cycle-1 WP125 work; restored focused gate remained green |
| BK6 | Cycle 2 RED `7aa17c4e`, GREEN `fd453e5c` |
| BK7 | Cycle 2 RED `f6b66d09`, GREEN `7ef86798` |
| BK8 | Cycle 2 RED `123c1573`, GREEN `61456df0` |
| BK10 | Cycle 2 RED `edc5acf3`, GREEN `35c610f0` |
| BK11 | `HUMAN_OBSERVABLE`; requires the owner-operated occluded three-vault arm |

## Validation

| Gate | Result | Console |
|---|---|---|
| New WP125 baseline | 2 files / 26 tests / 0 failed | `4ee1fd8a` |
| Restored focused WP125+B72 | 6 files / 55 tests / 0 failed | `5047cb75` |
| TypeScript | exit 0 | `fa3a0dae` |
| Build | exit 0 | `5e11bbb8` |
| Full unfiltered Vitest | 450 files / 3430 tests / 0 failed, 41.08 s | `7b7d15f2` |
| Signal-register checker | exit 0; 262 files; all control classes proved; no new violations | `e2988d4c` |

The first TypeScript/build attempt found only a strict optional-return typing error in the new test helper. The helper now fails explicitly when diagnostics are absent; the rerun and full suite are green. No product code was changed for that correction.

## Files and SHA-256

- `plugin/src/canvas/canvas-adapter.ts`: unchanged by this revision, `E633F77341739987C8B0BCF9970E67621EE75F8F1B800A8EAC14EEE216EECA2A`
- `plugin/src/main.ts`: unchanged by this revision, `0109A9A72A47BC7FFCADBED2829CD7C7CF319F7E9C80CC519BE9FEF7338457E3`
- `tools/e2e/canvas_diag.py`: unchanged by this revision, `AF6D446D9123D08E39B83D2306FC79601ECC14575E14F13F445C81B352E63FB5`
- `plugin/src/__tests__/v2/wp125/test_wp125_structural_repaint_and_fairness.test.ts`: `BEC45908475BBB56D71B015E302CB9FDBE708FEA5E7B2B6BF357ABDD4FA8A1BA`
- `plugin/src/__tests__/v2/wp125/test_wp125_event_lifecycle_and_diag.test.ts`: `0725C4EAE9E3696C9D543BF9A42768F43A7F37F66F8D480AEF585210D5A4CDF8`

Pre-edit copies of both tests and the prior report are under `workflowArtifacts/canvas-v2/_snapshots/wp125/worker3-rev2-preedits/`. The physical plant source is under `workflowArtifacts/canvas-v2/_snapshots/wp125/worker3-rev2-plants/`.

## Residuals and safety

- A7/BK11 remains `HUMAN_OBSERVABLE`; headless success does not claim the live occluded arm.
- No signal-register status or known-issues claim was changed.
- No product defect was exposed by the new direct tests, and no product code was retained from any plant.
- No live vault, plugin `data.json`, credential, relay/session token, or secret was read or modified.
