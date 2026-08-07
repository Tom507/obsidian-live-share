# SPEC 01 — CanvasBinding (the "y-canvas" binding)

> The CRDT↔model core of the canvas redesign. Analogous to `y-codemirror.next`'s
> `yCollab`, but for Obsidian's canvas model. **Spec only — not implemented.**

Related: parent rationale `../CANVAS_SYNC_REDESIGN.md`; peer specs
`SPEC_02_CanvasModelBridge.md` (the model side), `SPEC_03_Persistence.md` (the file
side), `SPEC_04_Phasing_Acceptance.md` (rollout).

---

## 1. Purpose & one-line contract

Bind a per-canvas `Y.Doc` to a live canvas model so that **the Y.Doc is the single
source of truth and the model is a pure projection of it**, with local user edits
captured back into the Y.Doc. The `.canvas` file is *not* involved.

**Contract:** for any interleaving of local edits and remote deltas, all peers'
Y.Docs converge (Yjs guarantee), every peer's live model equals its Y.Doc after
quiescence, and **no remote apply is ever re-captured as a local edit** (no echo,
no oscillation).

---

## 2. Position in the system

```
   ┌──────────────────────── one peer ────────────────────────┐
   │  live canvas model  ◀── applyNode*/applyEdge* ──┐         │
   │        │ onLocalChange (user edits only)        │         │
   │        ▼                                         │         │
   │   CanvasBinding.captureLocal ──▶ Y.Doc ──observer──▶ CanvasBinding.applyRemote
   │        ▲   (minimal diff)          │                        │
   │        └─ applyingRemote flag ─────┘  (reentrancy guard)    │
   │                                    │                        │
   │              (downstream, Spec 03) └──▶ .canvas  (write-only persistence) │
   └──────────────────────────────────────────────────────────┘
                                        ▲
                        SyncManager / relay (unchanged)
```

The binding sits between `SPEC_02` (the model bridge) and the `Y.Doc` obtained from
the existing `SyncManager`. Persistence (`SPEC_03`) observes the same `Y.Doc`
independently and never feeds back into the binding.

---

## 3. Data model (Y.Doc shape)

Unchanged from the legacy `CanvasSync` doc shape, so a binding client and a legacy
file-bridge client interoperate on the wire during migration:

- `doc.getMap("nodes")` : `Y.Map<Y.Map<unknown>>` — key = node id, value = node record.
- `doc.getMap("edges")` : `Y.Map<Y.Map<unknown>>` — key = edge id, value = edge record.

A **record** is a flat `Record<string, unknown>` of primitive values (the exact
fields Obsidian stores per node/edge: `id,type,x,y,width,height,text,file,color,…`
for nodes; `id,fromNode,toNode,fromSide,toSide,color,label,…` for edges). All
values are primitives, so **shallow per-key equality is exact**.

---

## 4. Interfaces

```ts
export type CanvasRecord = Record<string, unknown>;

// A user-originated change. record === null ⇒ removed.
export type LocalChange =
  | { kind: "node"; id: string; record: CanvasRecord | null }
  | { kind: "edge"; id: string; record: CanvasRecord | null };

// What the binding needs from the live canvas (implemented by SPEC_02).
export interface CanvasModelBridge {
  getNodeIds(): Iterable<string>;
  getEdgeIds(): Iterable<string>;
  getNode(id: string): CanvasRecord | null;
  getEdge(id: string): CanvasRecord | null;
  // Remote → model. MUST NOT surface back through onLocalChange.
  applyNodeUpsert(id: string, record: CanvasRecord): void;
  applyNodeRemove(id: string): void;
  applyEdgeUpsert(id: string, record: CanvasRecord): void;
  applyEdgeRemove(id: string): void;
  // User-originated changes only. Returns unsubscribe.
  onLocalChange(cb: (change: LocalChange) => void): () => void;
}

export const CANVAS_BINDING_ORIGIN: unique symbol; // tx origin stamp

export class CanvasBinding {
  readonly applyingRemote: boolean;
  constructor(
    doc: Y.Doc,
    model: CanvasModelBridge,
    opts?: { logger?: CanvasBindingLogger; seedModelFromDoc?: boolean },
  );
  destroy(): void;
}
```

---

## 5. Invariants (the whole point)

- **I1 — Single source of truth.** The Y.Doc is authoritative. The model is derived.
  On any conflict, the model is reconciled to the doc, never vice-versa except via
  an explicit `captureLocal`.
- **I2 — Reentrancy guard.** `applyingRemote` is `true` for exactly the synchronous
  span of `applyRemote()`. While true, `captureLocal` is a no-op.
- **I3 — Minimal-diff capture.** `captureLocal` writes only keys that differ from
  the current Y state. If nothing differs, **no Yjs update is produced** (no
  transaction content ⇒ no observer fire on any peer).
- **I4 — Origin isolation.** Binding-authored transactions are stamped
  `CANVAS_BINDING_ORIGIN`; the observer ignores `tr.local === true` *and* that
  origin, so capture writes never re-enter apply on the same peer.
- **I5 — Model mutators are silent.** `applyNode*/applyEdge*` (remote → model) MUST
  NOT emit `onLocalChange`. (Enforced in SPEC_02; the binding additionally
  tolerates violations via I2 + I3.)
- **I6 — No file I/O.** The binding never reads or writes `.canvas`. Persistence is
  strictly downstream (SPEC_03).

**Why I2 + I3 together (belt & suspenders):** I2 kills the *synchronous* echo (a
model that reports a change during our own apply). I3 kills the *asynchronous* echo
(Obsidian's debounced `requestSave` firing a change signal *after* `applyingRemote`
has cleared, carrying the already-applied value → empty diff → dropped). The file
bridge had neither and relied on timing windows; this design needs no timing.

---

## 6. Algorithms

### 6.1 `applyRemote()` — CRDT → model (targeted reconcile)

```
applyRemote():
  applyingRemote = true
  try:
    liveNodeIds = set(model.getNodeIds())
    for (id, ymap) in nodesMap:
      next = record(ymap)
      cur  = model.getNode(id)
      if cur is null or not recordsEqual(cur, next):
        model.applyNodeUpsert(id, next)      # includes geometry, type, content
      liveNodeIds.discard(id)
    for id in liveNodeIds:                    # in model but gone from doc
      model.applyNodeRemove(id)
    # …identical block for edges…
  finally:
    applyingRemote = false
```

- **Targeted, not wholesale.** Only entities that differ are touched, so a
  well-behaved model performs no redundant `moveAndResize`/re-render.
- **Order:** nodes before edges on upsert (an edge may reference a new node);
  edges are removed before nodes are removed is *not* required because the model
  bridge (SPEC_02) tolerates dangling edges transiently and the doc prunes them.
  (See SPEC_02 §edges.)
- **Busy handling:** if `model` reports the user is mid-drag on node X
  (`isBusy`/interacting — SPEC_02), `applyNodeUpsert(X, …)` is a no-op for X only;
  all other entities still reconcile. The deferred X converges on the next delta or
  on drag end. (This replaces the old global `isBusy()` bail.)

### 6.2 `captureLocal(change)` — model → CRDT (minimal diff)

```
captureLocal(change):
  if applyingRemote: return                  # I2
  map = change.kind == "node" ? nodesMap : edgesMap
  doc.transact(origin = CANVAS_BINDING_ORIGIN):
    if change.record is null:
      if map.has(change.id): map.delete(change.id)
      return
    ymap = map.get(change.id) or new Y.Map inserted at change.id
    writeRecordMinimal(ymap, change.record)   # I3: sets/deletes only diffs
```

`writeRecordMinimal(ymap, next)`: for each key in `next`, `set` iff value differs;
delete keys present in `ymap` but absent from `next`. Returns whether anything
changed (for logging / no-op detection).

### 6.3 Observer — the demux

```
observer(events, tr):
  if tr.local or tr.origin == CANVAS_BINDING_ORIGIN: return   # I4: our own write
  applyRemote()                                                # remote delta only
```

### 6.4 Lifecycle

- **Construct:** wire observer on both maps; subscribe `onLocalChange`; if
  `seedModelFromDoc !== false`, run one `applyRemote()` to bring an
  already-open-onto-a-populated-doc view up to truth (this is the redesign's clean
  replacement for v0.5.9's forced-`setData` initial reconcile).
- **Destroy:** unobserve, unsubscribe, set a `destroyed` guard so any late
  `onLocalChange`/observer callback is inert.

---

## 7. Concurrency model & race-freedom argument

- **Different entities, concurrent edits:** independent keys in the top-level Y.Map
  → commute. Converge by Yjs. ✔
- **Same node, concurrent geometry edits:** last-writer-wins per key at the CRDT
  layer (Yjs Map semantics). Optionally gated by the existing **WP3 per-node
  advisory lock** (presence layer): a non-holder's `captureLocal` for a locked node
  is dropped before the transact (hook point in §8). Loser's model reconciles to
  the winner on the next `applyRemote`. ✔
- **Add vs delete of same node:** Yjs Map add/delete resolve deterministically;
  the WP3 "delete-wins / no-resurrect" policy is preserved by dropping a capture
  upsert for an id the doc no longer holds *when a lock says it was remotely
  deleted* (carried over from `applyLocalDiffToYMaps` GAP-2). ✔
- **Follower echo (the killer bug):** impossible by I2 (sync) + I3 (async). ✔
- **Two writers to the file:** eliminated — the file is no longer a sync channel
  (SPEC_03). ✔

**Claim:** under these rules the system is race-free in the sense that (a) all
Y.Docs converge, (b) each model equals its doc at quiescence, (c) no apply is
re-captured. (a) is Yjs. (b) follows from `applyRemote` being a total reconcile
toward the doc. (c) follows from I2∧I3. ∎

---

## 8. Integration seams (kept from the current design)

- **Read-only guard (Bug G):** `captureLocal` consults an injected
  `canWrite(path)` predicate; drop the capture if false.
- **Per-node lock gates (WP3):** `canWriteNode(path,id)` / `canDeleteNode(path,id)`
  checked in `captureLocal` before writing/deleting a node; `onLocalNodeChange`
  fired to claim the advisory lock on first user touch (diff-inferred fallback
  becomes signal-driven here — cleaner).
- **Awareness/presence:** unchanged. Cursors & locks ride the same doc's awareness
  channel (`getCanvasDocHandle`), independent of the binding.
- **Logger:** optional `CanvasBindingLogger.debug(category,message)` for the status
  console (`apply: upserts=… removes=…`, `capture: node <id> pushed`).

---

## 9. What this DELETES from the current code

Once the binding + SPEC_03 land, the following become dead code and are removed
(Phase 4, SPEC_04):

- `CanvasSync.handleLocalModify` (file→CRDT read for OPEN canvases).
- `reconcileLiveCanvas` in `main.ts` (replaced by `applyRemote`).
- Mute windows for canvas (`mutePathEvents` around reconcile), `recentDiskWrites`
  for canvas, the semantic **echo-breaker** (v0.5.8), the **sequence gate**
  (`remoteSeq`/`expectedSeq`), and the forced initial reconcile (v0.5.9).
- The **geometry-key guard** may remain only if the cold-open file→CRDT load
  (SPEC_03) can still observe partial reads; otherwise it too is removed.

Their existence is the current design's technical-debt fingerprint; the binding
makes them unnecessary rather than better-tuned.

---

## 10. Test contract (headless, no Obsidian)

A fake in-memory `CanvasModelBridge` + two `Y.Doc`s wired peer-to-peer (via
`Y.encodeStateAsUpdate`/`Y.applyUpdate`, as in the existing
`canvas-sync.test.ts::applyRemoteCanvasDelta`). The fake deliberately re-emits
`onLocalChange` on *every* mutation (faithfully modelling Obsidian's
"can't-tell-who-moved-it" hazard) so the guards are actually exercised.

Required cases:

- **T1 seed:** binding brings an empty model up to a populated doc on construct.
- **T2 capture:** a user node move emits exactly one Yjs update carrying the diff.
- **T3 apply:** a remote node move updates the follower model.
- **T4 no-echo (sync):** during `applyRemote`, the fake's synchronous
  `onLocalChange` produces **zero** local Yjs updates (I2).
- **T5 no-echo (async):** the fake emits `onLocalChange` on a *timer* after apply;
  still **zero** updates because the diff is empty (I3). (Uses fake timers.)
- **T6 streamed drag → follower:** 50 sequential geometry deltas from peer A;
  peer B converges and peer B pushes **zero** updates back (the exact
  "guest stable / host scatters" scenario, now provably stable).
- **T7 concurrent different nodes:** A moves n1 while B moves n2; both converge,
  neither reverts.
- **T8 same-node LWW / lock:** with `canWriteNode=false` on B, B's capture of n1 is
  dropped and B reconciles to A's value.
- **T9 add/remove:** remote add and remote delete reflect in the follower model;
  local delete removes from the doc; no-resurrect on remote-deleted id.
- **T10 minimal diff:** capturing a record identical to the doc produces no update.

Green T1–T10 = the contract is locked; only then does Phase 1 code proceed
(SPEC_04). Target: these run in the existing vitest suite alongside the current
440 tests.
