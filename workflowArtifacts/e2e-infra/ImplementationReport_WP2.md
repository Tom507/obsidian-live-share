# Implementation Report — WP2 (Two-peer canvas convergence harness)

> Worker 3 Coder artifact. Batch A, depends on WP1 (DONE). Native sub-agent,
> built-in tools only. Companion to `BUILD_SPEC_CanvasE2EInfra.md` §9 WP2 + US2/US7.

## Status

**DONE.** All US2 acceptance criteria implemented and self-verified. Quality gates
green with zero regression.

## Files created

| File | Purpose |
|---|---|
| `plugin/src/__tests__/harness/two-peer.ts` | Two-peer harness: `CanvasDoubleBridge` glue + `makeTwoPeer` + `waitQuiescent` + `assertConverged`/`convergenceDiff` + per-peer counters + instrument routing. |
| `plugin/src/__tests__/harness/two-peer.test.ts` | WP2 self-test (10 tests). |

No production `plugin/src/canvas/*` change. No new `plugin/package.json` dependency
(yjs already present). No `main.ts` touch.

## Quality gates (from `plugin/`, BUILD_SPEC §7)

- `npm run build` → **PASS** (exit 0; `tsc -noEmit -skipLibCheck` + esbuild production).
- `npm test` (`vitest run`) → **PASS**: **497 passed / 497, 0 fail, 27 files**.
  - WP2 self-test `harness/two-peer.test.ts`: **10/10 green**.
  - WP1 `harness/canvas-double.test.ts`: **12/12 still green** (no regression).
  - Prior baseline before WP2 was 487 (per WP4 memory) → +10 additive, matches the
    self-test count exactly. No pre-existing test changed status.

## What WP3 needs to know (build the matrix on top; do NOT read the source)

### Module: `plugin/src/__tests__/harness/two-peer.ts`

Public exports:

- `makeTwoPeer(opts?: TwoPeerOptions): TwoPeer`
  - `TwoPeerOptions = { nodes?: DoubleNodeRecord[]; edges?: DoubleEdgeRecord[]; aOpts?; bOpts? }`
  - `nodes`/`edges` seed BOTH peers to the same initial state (they start converged).
  - `aOpts`/`bOpts` = `Omit<CanvasBindingOpts,"seedModelFromDoc">` — per-peer binding
    options, e.g. `bOpts: { canWriteNode: (_p, id) => id !== "n1" }` for lock-gate
    matrix cases (T8-style). `seedModelFromDoc` is managed by the harness.
- `TwoPeer` object:
  - `a`, `b`: `Peer`
  - `waitQuiescent(): void` — deterministic settle (no sleep); exchanges Yjs updates
    both ways until docs converge.
  - `assertConverged(): void` — convenience for `assertConverged(a, b)`.
  - `resetCounters(): void` — zero both peers' counters (call before measuring a
    single action; counters already start at 0 after `makeTwoPeer`).
  - `destroy(): void` — destroy both bindings, unpatch both bridges. **Call in
    `afterEach`.**
- `Peer` object (each peer):
  - `double: CanvasDouble` (WP1) — the live model.
  - `driver: InteractionDriver` (WP1) — **originate ALL local intent through this**
    (`driver.driveDrag/driveResize/driveAddNode/driveEdge/driveDeleteNode/driveTextEdit`).
    Never call `moveAndResize`/doc mutators directly (false-green trap).
  - `bridge: CanvasDoubleBridge` — the `CanvasModelBridge` glue (read via
    `bridge.getNodeIds()/getEdgeIds()/getNode(id)/getEdge(id)`).
  - `binding: CanvasBinding`, `doc: Y.Doc`, `counters: PeerCounters`.
  - `counters: { applyRemote, captureLocal, rePush, originUpdates }` (all numbers,
    readable after `waitQuiescent`).
- Standalone functions (also exported): `assertConverged(a: Peer, b: Peer): void`
  (throws `Error("assertConverged failed: …")` on drift), `convergenceDiff(a, b):
  string | null` (null == converged; a diff string otherwise — use this for a
  boolean-style matrix pass/fail), `waitQuiescent(a: Peer, b: Peer, maxRounds=100)`.
- Also exported: `CanvasDoubleBridge`, `PeerCounters`, `Peer`, `TwoPeer`,
  `TwoPeerOptions`.

### Canonical matrix-case pattern for WP3

```ts
const tp = makeTwoPeer({ nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 60 }] });
try {
  tp.a.driver.driveDrag("n1", { x: 300, y: 200 }); // local intent via driver
  tp.waitQuiescent();                               // deterministic settle
  tp.assertConverged();                             // model↔model + model↔doc
  expect(tp.b.counters.rePush).toBe(0);             // zero-re-push for the receiver
} finally {
  tp.destroy();
}
```

## Design decisions / how the ACs are met

- **AC1 (glue):** `CanvasDoubleBridge` implements the exact 9-member
  `CanvasModelBridge`. Reads project the double's records (fresh copies via
  `toRecord()`); remote appliers (`applyNode*/applyEdge*`) REPLACE the double's
  record (remove+upsert, so a doc-removed key cannot linger) and update a synced
  snapshot — they never emit `onLocalChange` (I5).
- **AC1 local capture (BUILD_SPEC §5 risk):** No production adapter→bridge wiring
  exists, so the glue owns capture. It monkey-patches the double's `setDragging` /
  `updateSelection` (the SAME signals the WP1 driver fires) and, on each signal,
  diffs the double against the synced snapshot to emit one `LocalChange` per changed
  node/edge. This runs the real `captureLocal` path only for genuine driver-issued
  intent — direct `moveAndResize` calls fire no signal and are NOT captured.
- **AC2 (non-local propagation):** `waitQuiescent` exchanges missing ops via
  `Y.encodeStateAsUpdate(doc, targetStateVector)` / `Y.applyUpdate(doc, update,
  HARNESS_REMOTE_ORIGIN)`. The applied transaction is `tr.local === false`,
  `origin !== CANVAS_BINDING_ORIGIN`, so the receiver's binding runs a genuine
  `applyRemote` (verified by a self-test asserting every B transaction is non-local).
- **AC3 (assertConverged):** checks model(A)==model(B) AND model==doc per peer,
  order-independent (sorted id sets + `recordsEqual` shallow primitive equality
  mirroring `canvas-binding.ts` L100-107). A self-test proves it THROWS before
  `waitQuiescent` (real assertion, not a no-op).
- **AC4/AC5 (counters + settle):** counters derived from `setCanvasBindingInstrument`
  (the WP4 seam). It is a module-level singleton, so per-peer attribution is done by
  a `runAs(counters, fn)` wrapper around every synchronous binding-triggering span
  (construction seed, driver-signal emit, `waitQuiescent` apply). `waitQuiescent` is
  a state-vector fixpoint (converges in 1 round for a correct binding), no sleep.
- **AC6 (zero-re-push):** the receiver only integrates via `applyRemote`; its
  appliers do not emit `onLocalChange`, so `captureLocal`/`rePush` never fire for an
  integrated delta. Self-tests assert `b.counters.rePush === 0` for a single move, a
  20-step streamed drag, add-node+edge, and delete-node+edge-prune. Bidirectional
  concurrent moves converge with each peer re-pushing only its own edit.

## Self-test coverage (10 tests, all green)

- Bridge contract: 9 members present, `getNode/getEdge` return fresh copies / null.
- Peers start converged from seed.
- Single driver move A→B converges; `assertConverged` passes; `b.rePush==0`,
  `b.originUpdates==0`, `a.rePush==1`, `b.applyRemote>=1`, `b.captureLocal==0`.
- Integration on B is a genuine non-local transaction (`tr.local===false`).
- `assertConverged` throws before settle, passes after.
- 20-step streamed drag converges, `b.rePush==0`.
- Add node + edge converges (non-dangling), `b.rePush==0`.
- Delete node prunes incident edge, converges, `b.rePush==0`.
- Bidirectional concurrent moves survive (no lost update); each peer `rePush==1`.
- `resetCounters` zeros both peers.

## RISKY flags / notes for W4 and WP3

- **RISKY (low): global instrument singleton.** `setCanvasBindingInstrument` is a
  module-level hook in `canvas-binding.ts`. The harness installs it once (lazily in
  `makeTwoPeer`) and routes callbacks to the "active" peer via a synchronous
  `runAs(...)` context. Correct because ALL binding-triggering actions in the harness
  are synchronous and harness-owned. If WP3 (or a future test in the SAME file)
  drives a `CanvasBinding` OUTSIDE the harness, its instrument callbacks would route
  to whatever counters are active (likely none → ignored). Vitest file isolation
  keeps this from affecting `canvas-binding.test.ts` (separate module instance). WP3
  should drive everything through `makeTwoPeer`.
- **NOTE: node records need full geometry.** `assertConverged`'s model↔doc check uses
  exact shallow key equality; `DoubleNode.toRecord()` always emits `id/x/y/width/
  height`. Seed and drive node records with all five (canvas nodes always have them,
  as in the matrix). Sparse geometry records could show a spurious `undefined`-key
  drift. Not a concern for the SPEC_04 matrix.
- **NOTE: file-node round-trip.** Dynamic fields (`type`, `text`, `file`, etc.)
  round-trip through the double, the glue, and the doc (confirmed by add/delete
  tests). The WP3 file-node case (`{ type: "file", file: "…" }`) is supported.
- No `ESCALATE_TO_W2` conditions hit — no spec/impl conflict; every AC implementable.
