# User Stories — CanvasBinding (Canvas Sync Redesign, Phase 0)

> Created by Worker 2 (Spec Architect). All Phase-0 user stories with full acceptance criteria.
> Scope: headless `CanvasBinding` + fake `CanvasModelBridge` + two-peer harness + tests T1–T10.
> Phases 1–5 (main.ts wiring, adapter changes, persistence split) are OUT OF SCOPE — human-gated.
> Source contract: `SPEC_01_CanvasBinding.md` (§4–§10), `SPEC_04_Phasing_Acceptance.md` (§1).
> Structural basis: `../RepoMap.md` (W1 discovery, graphify disabled).

---

## US1 — The binding contract (CRDT ⇄ model core)

**As a** plugin developer building collaborative canvas sync,
**I want** a headless `CanvasBinding` that keeps a per-canvas `Y.Doc` as the single source of truth and the live model as a pure projection, capturing local edits back into the doc with minimal diffs and no echo,
**so that** any interleaving of local edits and remote deltas converges on all peers with the model equal to the doc at quiescence, and no remote apply is ever re-captured as a local edit.

### Acceptance Criteria

1. **Interfaces exported.** `canvas-binding.ts` exports `CanvasRecord`, `LocalChange` (node/edge, `record === null` ⇒ removed), `CanvasModelBridge` (the exact 9-member interface from SPEC_01 §4: `getNodeIds`, `getEdgeIds`, `getNode`, `getEdge`, `applyNodeUpsert`, `applyNodeRemove`, `applyEdgeUpsert`, `applyEdgeRemove`, `onLocalChange`), the `CANVAS_BINDING_ORIGIN` transaction-origin stamp, and the `CanvasBinding` class with a readonly `applyingRemote: boolean` and a `destroy(): void`.
2. **Doc shape (I1 wire-compat).** The binding reads/writes exactly `doc.getMap("nodes")` and `doc.getMap("edges")`, each a `Y.Map<Y.Map<unknown>>` keyed by id, value = flat record `Y.Map<unknown>` of primitive fields. No other top-level keys are introduced. (SPEC_01 §3.)
3. **I1 — Single source of truth.** On any divergence, `applyRemote()` reconciles the model toward the doc, never the reverse (except via an explicit `captureLocal`). After `applyRemote()` completes, every model entity equals its doc record and model entities absent from the doc are removed.
4. **I2 — Reentrancy guard.** `applyingRemote` is `true` for exactly the synchronous span of `applyRemote()` and `false` otherwise (including in `finally` on throw). While `true`, `captureLocal` returns immediately and produces zero Yjs updates.
5. **I3 — Minimal-diff capture.** `captureLocal` for an upsert writes only keys whose value differs from current Y state, and deletes only keys present in the ymap but absent from the incoming record. When nothing differs, **no Yjs update is produced** (empty transaction ⇒ no observer fires on any peer).
6. **I4 — Origin isolation.** Every binding-authored write runs inside `doc.transact(fn, CANVAS_BINDING_ORIGIN)`. The map observer returns early when `tr.local === true` OR `tr.origin === CANVAS_BINDING_ORIGIN`, and calls `applyRemote()` only for genuine remote deltas.
7. **6.1 apply algorithm (targeted reconcile).** `applyRemote()` upserts nodes before edges; for each doc entry it calls the model upsert only when the model lacks the id or the model record is not `recordsEqual` to the doc record; ids present in the model but absent from the doc are removed. Entities that already match are not touched (no redundant upsert call).
8. **6.1 busy handling.** If the model reports the user is mid-interaction on a specific node id (bridge-provided busy signal), `applyNodeUpsert` for that id only is skipped while all other entities still reconcile; the deferred id converges on a later delta. (Testable via T-level fake if the bridge exposes busy; otherwise documented as a bridge-level concern deferred to SPEC_02 — see BUILD_SPEC Constraints/Risks.)
9. **6.2 capture algorithm.** `captureLocal(change)`: returns early if `applyingRemote`; selects `nodesMap`/`edgesMap` by `change.kind`; inside one `CANVAS_BINDING_ORIGIN` transaction, deletes the id when `record === null` (only if present), else gets-or-creates the entry's `Y.Map` and applies `writeRecordMinimal`.
10. **I6 — No file I/O.** The module imports only `yjs` (`import * as Y from "yjs"`); it never imports Obsidian, never reads or writes `.canvas`, and adds no new runtime dependency.
11. **Lifecycle.** Construct wires the observer on both maps and subscribes `onLocalChange`; when `opts.seedModelFromDoc !== false` it runs one `applyRemote()` on construct. `destroy()` unobserves, unsubscribes, and sets a `destroyed` guard so any late `onLocalChange`/observer callback is inert.
12. **Integration seams (injected predicates).** `captureLocal` consults injected `canWrite(path)` / `canWriteNode(path, id)` predicates (constructor opts) and drops the capture (no transaction) when a predicate returns false; when no predicate is injected, capture proceeds. (Exercised by T8.)

### Definition of Done

`src/canvas/canvas-binding.ts` exists, is headless (no Obsidian import), typechecks under `npx tsc -noEmit -skipLibCheck`, passes `npx biome check .`, and its public surface plus invariants I1–I6 are all directly demonstrated by the passing T1–T10 tests of US3.

### Linked WPs

WP1, WP3

---

## US2 — Deterministic two-peer test harness + adversarial fake bridge

**As a** developer validating the race-free contract,
**I want** an in-memory fake `CanvasModelBridge` that deliberately re-emits `onLocalChange` on every mutation, plus a two-`Y.Doc` peer harness that syncs via `encodeStateAsUpdate`/`applyUpdate`,
**so that** the binding's echo guards (I2 sync, I3 async) are actually exercised under Obsidian's real "can't-tell-who-moved-it" hazard, deterministically and without any Obsidian runtime.

### Acceptance Criteria

1. **Fake bridge state model.** The fake holds in-memory `Map`s of node and edge records and implements all 9 `CanvasModelBridge` members. `getNodeIds`/`getEdgeIds` return the current id sets; `getNode`/`getEdge` return a copy (or immutable view) of the stored record or `null`.
2. **Adversarial re-emit (the hazard).** Every mutator that changes state — including `applyNodeUpsert`/`applyNodeRemove`/`applyEdgeUpsert`/`applyEdgeRemove` (the remote→model path) AND any test-driven local mutation helper — invokes the registered `onLocalChange` callback with the corresponding `LocalChange`. This models a model that cannot distinguish remote-applied changes from user edits, forcing I2+I3 to carry correctness.
3. **`onLocalChange` subscription.** `onLocalChange(cb)` registers the callback and returns an unsubscribe function that removes it; after unsubscribe, no further callbacks fire.
4. **Two-peer harness.** A helper mirrors `canvas-sync.test.ts::applyRemoteCanvasDelta` (RepoMap §2, L62-74): given a source `doc` and a mutation function, it creates a fresh `Y.Doc`, syncs it from the source via `Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))`, applies the mutation on the replica, integrates back via `Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))` (so the integrating transaction is non-local, `tr.local === false`), and destroys the replica. Deletes reference the same synced item so they actually remove on the target.
5. **Update-count instrumentation.** The harness/test can count Yjs updates produced by a given doc (e.g. via a scoped `doc.on("update", …)` counter, filtered to `CANVAS_BINDING_ORIGIN` where the test needs "local pushes only"), enabling the "zero updates" assertions of T4/T5/T6/T10.
6. **Deterministic timing.** Async-echo testing (T5) uses vitest fake timers (`vi.useFakeTimers()` / `vi.advanceTimersByTime`); no real `setTimeout` waits and no wall-clock timing constants appear in any test.
7. **Colocated, headless.** The fake bridge and harness live inline in `src/__tests__/canvas-binding.test.ts` (RepoMap §7); they import only `yjs` and the binding module, never Obsidian.

### Definition of Done

The fake bridge + harness are defined inline in `canvas-binding.test.ts`, drive all of T1–T10 without an Obsidian import, and produce byte-stable results across repeated `npx vitest run` invocations (no flakiness, no real timers).

### Linked WPs

WP2, WP3

---

## US3 — Race-free test contract T1–T10 green

**As a** maintainer gating the redesign,
**I want** SPEC_01 §10 tests T1–T10 implemented and green in the existing vitest suite, with the full suite still green,
**so that** the race-free contract is provably locked (T1–T10 + suite green) before any production code moves in Phase 1+.

### Acceptance Criteria

Each case below is one concrete, testable AC. All run in `src/__tests__/canvas-binding.test.ts` via `npx vitest run`.

1. **T1 seed.** Given a populated doc (nodes + edges seeded) and an empty model, constructing `CanvasBinding` with `seedModelFromDoc` defaulted brings the model up to the doc: after construct, the model's node/edge id sets and every record equal the doc's. (Exercises lifecycle seed + `applyRemote`.)
2. **T2 capture.** A single user node move (one `LocalChange` for one changed geometry key) produces **exactly one** Yjs update stamped `CANVAS_BINDING_ORIGIN`, and that update carries only the changed key(s) — the doc record reflects the new value.
3. **T3 apply.** A remote node move (delivered via the two-peer harness, `tr.local === false`) drives the follower model: the follower's node record updates to the remote value via `applyNodeUpsert`.
4. **T4 no-echo (sync).** During `applyRemote()`, the fake's **synchronous** `onLocalChange` re-emit produces **zero** local Yjs updates (count of `CANVAS_BINDING_ORIGIN`-stamped updates on the follower doc during and after apply is exactly 0). Demonstrates I2.
5. **T5 no-echo (async).** The fake emits `onLocalChange` on a **timer** fired after `applyRemote()` has returned (`applyingRemote === false`); advancing fake timers still yields **zero** local Yjs updates because the captured record equals current Y state ⇒ empty diff ⇒ dropped. Demonstrates I3. (Uses `vi.useFakeTimers()`.)
6. **T6 streamed drag → follower.** Peer A pushes **50 sequential** geometry deltas for one node; peer B (binding + fake) converges to A's final geometry, and peer B pushes back **zero** updates across the whole stream (count of `CANVAS_BINDING_ORIGIN` updates on B === 0). This is the "guest stable / host scatters" scenario, now provably stable.
7. **T7 concurrent different nodes.** A moves n1 while B moves n2 (concurrent, then merged both ways via the harness); after convergence both n1 and n2 hold their respective mover's value and neither reverts.
8. **T8 same-node LWW / lock.** With `canWriteNode` returning `false` for n1 on peer B, B's `captureLocal` of n1 is dropped (no `CANVAS_BINDING_ORIGIN` update for n1 from B), and after A's write propagates, B's model reconciles to A's value for n1. (Exercises the §8 injected `canWriteNode` seam.)
9. **T9 add/remove.** A remote add and a remote delete both reflect in the follower model (upsert then remove via `applyNode*`); a local delete (`record === null`) removes the id from the doc; and an attempted local upsert for an id the doc no longer holds under a remote-delete condition does not resurrect it (no-resurrect).
10. **T10 minimal diff.** Capturing a record **identical** to the current doc record produces **no** Yjs update (zero `CANVAS_BINDING_ORIGIN` updates). Demonstrates I3 at the capture boundary.
11. **Suite green.** `npx vitest run` reports the pre-existing 440 tests still passing plus the new `canvas-binding.test.ts` cases (T1–T10 and any sub-cases), i.e. total ≥ 440 with zero failures; no existing test file is modified to accommodate the new one.

### Definition of Done

`npx vitest run` is green with T1–T10 all passing and total test count ≥ 440 (new tests added, none removed); `npx tsc -noEmit -skipLibCheck` and `npx biome check .` both pass.

### Linked WPs

WP3 (depends on WP1, WP2)
