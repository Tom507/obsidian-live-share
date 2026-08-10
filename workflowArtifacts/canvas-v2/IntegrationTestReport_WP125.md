# Integration Test Report - WP125 Cycle 3

## Overall Status: VALIDATION_PASS (HEADLESS SCOPE)

## worker4_mode Applied: full charter gate

Cycle 3 closes the remaining headless acceptance gaps from cycle 2. The updated direct A2, A3, A5, and mounted-lifecycle tests pass on the restored implementation, and an independent physical mutation for each newly closed class produced a targeted RED before an exact snapshot restore returned the suite to GREEN. No product defect was demonstrated. A7/BK11 remains `HUMAN_OBSERVABLE`: both live control endpoints refused the probe, so no live branch, occlusion, or loaded-bundle claim is made.

## Test Summary

| Gate | Status | Result |
|---|---|---|
| Direct WP125 baseline | PASS | 2 files / 26 tests / 0 failed |
| A2 physical control | PASS | RED 1 failed / 19 passed; restored 20/20 |
| A3 physical control | PASS | RED 7 failed / 13 passed; restored 20/20 |
| A5 physical control | PASS | RED 4 failed / 16 passed; restored 20/20 |
| Mounted structural-event control | PASS | RED 2 failed / 4 passed; restored 6/6 |
| Focused WP125+B72 | PASS | 6 files / 55 tests / 0 failed |
| TypeScript | PASS | exit 0 |
| Build | PASS | exit 0 |
| Full Vitest | PASS | direct foreground process exit 0; 450 files / 3430 tests inventory |
| Signal-register checker | PASS | 262 files; all control classes proved; no new violations |
| A7/BK11 live | HUMAN_OBSERVABLE | A and B probes refused connection; no live test executed |

## Cycle 3 Physical Controls

| Class | Physical mutation | RED evidence | Exact restore and GREEN |
|---|---|---|---|
| A2 interaction ownership | Removed the active-drag refusal guard from `repaintNode` | Active-drag row alone failed: reload returned `true` instead of refusal | Adapter restored from `worker4-cycle3-preplants`; SHA-256 `E633F77341739987C8B0BCF9970E67621EE75F8F1B800A8EAC14EEE216EECA2A`; 20/20 green |
| A3 fairness | Changed `priorityLimit` to consume the whole batch | 7 planner/fairness rows failed, including 11/200 saturation and reorder/deletion coverage | Same adapter SHA; 20/20 green |
| A5 attribution | Routed all tally results to `sourceCounters.sweep` | 4 source-attribution rows failed, including the direct mixed-source equation | Same adapter SHA; 20/20 green |
| Mounted lifecycle | Removed the structural `requestRepaintSweep?.()` call after `setData` | Source census and mounted structural-composition rows failed; mounted row observed zero event requests | Same adapter SHA; 6/6 green |

The cycle-2 BK6/BK7/BK8/BK10 controls remain valid and are retained in `ImplementationReport_WP125.md`. Cycle 3 deliberately re-planted the newly closed acceptance classes rather than relying only on Worker 3's recorded hashes.

## Acceptance Assessment

| Criterion | Status | Evidence / residual |
|---|---|---|
| A1 | PASS headless | Changed-id structural repaint and `setData` exception behavior are direct |
| A2 | PASS headless | Editing ownership, active-drag refusal, detached deferral, and later fair recovery are directly exercised; A2 mutation reddened |
| A3 | PASS headless | Planner table covers 0/1/11/200, priority bands, duplicate pressure, reorder, and deletion; A3 mutation reddened |
| A4 | PASS headless | Burst coalescing, re-request during run, teardown, and mounted structural request-to-event sweep without a periodic tick are direct |
| A5 | PASS headless | Mixed per-node/structural/sweep attribution and compatibility aggregate are exact; refusals are not repairs; A5 mutation reddened |
| A6 | PASS headless | Real Python diagnostic renderer and pre-WP125 compatibility behavior are executed; BK10 already reddened in cycle 2 |
| A7 | HUMAN_OBSERVABLE | Live endpoints offline; branch-positive, occlusion, paint, and BK11 controls were not run |
| A8 | PASS headless | Focused, typecheck, build, full suite, and signal checker green |

## Gate Evidence

- Direct baseline: visible-console `3952d658`, 2 files / 26 tests.
- A2 RED: visible-console `349764eb`; restore SHA `E633...CA2A`; GREEN `7d77b451`.
- A3 RED: `07afa57f`, 7 failed / 13 passed; restore/GREEN `5b7fbb70`.
- A5 RED: `5f28b3a5`, 4 failed / 16 passed; restore/GREEN `b379771b`.
- Mounted RED: `c1f2e043`, 2 failed / 4 passed; restore/GREEN `2198e3f3`.
- Focused: `896085f7`, 6 files / 55 tests.
- TypeScript: `6ebfec0f`, exit 0.
- Build: `5d694172`, exit 0.
- Full suite: visible wrapper `500d3687` failed only while replacing its own status file with `WinError 5`; the required reliable direct foreground rerun completed in 48.2 seconds with exit 0.
- Signal checker: `88a43030`, exit 0, 262 files scanned, all control classes proved, no new violations.
- Live probe: `liveshare-e2e.e2e_connect` returned `connected: false`; both `127.0.0.1:39431` and `127.0.0.1:39432` refused the connection.

## Verdict

`VALIDATION_PASS` for the charter's headless scope. There is no active headless fix request. Do not upgrade A7/BK11 or the release/live verdict until the owner-operated three-vault branch-positive, occluded/visible, and plant-positive controls are completed.
