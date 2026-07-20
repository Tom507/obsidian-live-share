# Implementation Report — WP1: CanvasDouble + interaction driver

> Worker 3 (Coder). Batch A root, no dependencies. Native sub-agent, built-in tools.

## Status

**DONE** — all WP1 acceptance criteria satisfied; quality gates green; zero production footprint.

## Files Changed (all created; no production files touched)

| File | Purpose |
|---|---|
| `plugin/src/__tests__/harness/canvas-double.ts` | Reusable contract-faithful `CanvasDouble` (+ `DoubleNode`/`DoubleEdge`) |
| `plugin/src/__tests__/harness/interaction-driver.ts` | `InteractionDriver` — signal-injecting driver ops |
| `plugin/src/__tests__/harness/canvas-double.test.ts` | WP1 self-test (12 tests) |

No `plugin/src/canvas/*` production change. No new `plugin/package.json` dependency.

## Export names (for WP2 consumption)

- From `canvas-double.ts`: `CanvasDouble` (class), `DoubleNode`, `DoubleEdge` (classes),
  types `DoubleNodeRecord`, `DoubleEdgeRecord`, `CanvasDoubleData`, `DoubleCanvas`,
  `DoubleView`, `CanvasDoubleOptions`.
  - `new CanvasDouble({ nodes, edges, zoom, x, y })`
  - `double.view` → `{ canvas }` to pass to `createCanvasAdapter`
  - `double.canvas` → the live `DoubleCanvas` (patchable methods, maps, selection, nodeInteractionLayer)
  - `double.getData()` → `{ nodes, edges }` records (US1 AC6)
  - `double.upsertNode/removeNode/upsertEdge/removeEdge/getNode/getEdge/incidentEdgeIds`
  - instrumentation: `setDataCount`, `requestFrameCount`, `requestSaveCount`, `lastSetData`
- From `interaction-driver.ts`: `InteractionDriver` (class), types `GeometryPatch`, `DriveOptions`.
  - Ops: `driveDrag(id, {x,y}, opts?)`, `driveResize(id, geoPatch, opts?)`,
    `driveAddNode(record)`, `driveEdge(record)`, `driveDeleteNode(id) → {removedEdges}`,
    `driveTextEdit(id, text)`.
  - Primitives: `beginDrag(id)`, `endDrag()`, `select(ids[])`.
  - `DriveOptions.during` — callback fired mid-drag (setDragging(true) active) for busy-state assertions.

## ACs Satisfied (with verification method)

| AC | Statement | Verification |
|---|---|---|
| US1 AC1 | double → `createCanvasAdapter(double.view).isAvailable() === true` | Self-test asserts `isAvailable()===true` and the full gated shape (nodes/edges Map, numeric zoom/x/y, patch points, `nodeInteractionLayer.target`, per-node `moveAndResize`). |
| US1 AC2 | Built by extending the `FakeNode`/`makeView` pattern, behaviors preserved | Pattern lifted into `canvas-double.ts` (NOT imported from `.test.ts`). Tests assert `moveAndResize` mutates geometry and `setData`/`requestFrame` observable via adapter `reloadCanvasData`. |
| US1 AC3 | Driver ops pair mutation with the correct real signal | `driveDrag`/`driveResize` bracket geometry with `setDragging(true)`+target→mutate→`setDragging(false)`; `driveAddNode`/`driveEdge`/`driveDeleteNode`/`driveTextEdit` set `selection` then fire `updateSelection`. A control test proves a direct `moveAndResize` (no signal) fires NO capture — false-green guard. |
| US1 AC4 | Adapter reports held node via `onNodeInteractionStart/End`; `getNodeGeometry` reflects post-drag geometry | Self-test registers real adapter listeners, runs `driveDrag("n1",{x:300,y:200})`, asserts start+end contain `n1` and `getNodeGeometry("n1")` equals post-drag geometry. |
| US1 AC5 | mid-drag `isBusy()===true`; `applyNodeGeometry(dragged)==="interacting"`; different node reconcilable | `during` hook asserts `isBusy()===true`, dragged node → `"interacting"`, a different node → `"applied"`; post-drag `isBusy()===false`. |
| US1 AC6 | `getData()` returns current `{nodes, edges}` | Self-test asserts records round-trip; `driveTextEdit` change visible via `getData()`. |
| US7 AC3 | Existing suite green; self-tests additive | Baseline 453/24 → 465/25 (12 additive), 0 fail, 0 pre-existing regressions. |

## ACs Not Satisfied

None.

## Quality Gates (run from `plugin/`)

| Command | Result |
|---|---|
| `npm run build` (tsc -noEmit -skipLibCheck && esbuild production) | **PASS** (exit 0) |
| `npm test` (vitest run) — baseline | **453 passed / 24 files** (pre-change baseline recorded) |
| `npm test` (vitest run) — post-change | **PASS — 465 passed / 25 files** (0 fail) |
| Self-test file alone | **PASS — 12 passed** |

No regression vs baseline (453 → 465 = +12 additive self-tests, all green).

## Risk Notes

- **No production footprint:** harness lives entirely under `src/__tests__/`; esbuild entry is `main.ts`, so nothing here can reach the bundle. No production dependency added.
- **Signal fidelity is enforced, not assumed:** a dedicated self-test proves that bypassing the driver (direct `moveAndResize`) does NOT trigger adapter capture — this is the concrete guard against the false-green PLAN §Why warns about.
- **`setData` semantics:** the double's `setData` rebuilds the live node/edge maps from the supplied data (contract-faithful "replace contents"); WP2/WP3 should drive structural changes via the driver ops or `upsert*`/`remove*`, not by hand-mutating the maps, to keep capture signals firing.
- **`nodeInteractionLayer.target` is cleared on `endDrag()`**, mirroring real canvas idle state; `applyNodeGeometry` only returns `"interacting"` while a drag is open on that specific node (matches adapter's `dragTargetId` logic).
- **WP2 note (carried from W2 grounding):** `CanvasBinding` consumes a `CanvasModelBridge`, a DIFFERENT surface from `CanvasAdapter`. WP2 must supply the `CanvasDouble → CanvasModelBridge` glue itself; this WP intentionally does not provide it (out of scope). The `getData()`/`upsert*`/`remove*`/`getNode`/`getEdge` accessors on `CanvasDouble` are the intended read/write seam for that glue.
