# Obsidian Live Share — Architecture & Canvas Sync Analysis

> Written 2026-07-26 against the working tree at HEAD `4b34d5e` + the uncommitted
> Phase 2–4 wiring, shipped as **v0.6.0**. Every claim below carries a `file:line`
> reference and was read from the source, not inferred. Where something is *not*
> verified it says so explicitly.
>
> Purpose: give enough grounding to make an informed decision about the
> "connections break when two people edit in parallel" defect, documented in
> [Part VI](#part-vi--the-current-conflict).

---

## Contents

```text
Part I    ← CRDT primer: what Yjs actually guarantees (and what it doesn't)
Part II   ← Topology: relay, rooms, mux, and the document inventory
Part III  ← The canvas data model
Part IV   ← The algorithms, path by path (this is the bulk)
Part V    ← Guard inventory: every anti-echo mechanism and its blind spot
Part VI   ← THE CURRENT CONFLICT + fix options
```

---

# Part I — CRDT primer

## The problem being solved

Two people edit the same document with no central arbiter. Each applies their own
change instantly (no round-trip latency), changes cross in flight, and both sides
must end up identical without asking a server "who won". A **CRDT** (Conflict-free
Replicated Data Type) is a data structure whose merge operation is commutative,
associative and idempotent, so applying the same set of changes in *any order, any
number of times* yields the same result.

This plugin uses **Yjs**. The concrete pieces:

## `Y.Doc` — the replica

A `Y.Doc` is one replica of one logical document. It has a random **`clientID`**
assigned at construction. Every change is recorded as an **item** stamped with
`(clientID, clock)` — a Lamport-style logical timestamp, where `clock` increments
per client. That pair is the item's permanent identity, and it is how two replicas
recognise "this is the same change" versus "these are two different changes".

## Updates and state vectors

- A **state vector** is a map `clientID → highest clock seen`. It is a compact
  summary of everything a replica already knows.
- `Y.encodeStateAsUpdate(doc, theirStateVector)` produces exactly the bytes the
  other side is missing — a delta, not a snapshot.
- `Y.applyUpdate(doc, bytes, origin)` integrates them.

Deletions are **tombstones** recorded in a delete set, not physical removals. This
is why a deleted item can never be silently "resurrected" by a concurrent edit —
the tombstone travels with the document.

## `Y.Map` — last-write-wins, per key

`Y.Map` resolves concurrent writes **independently for each key**:

- A writes `x`, B writes `y`, concurrently → **both survive**. No conflict; they
  touched different keys.
- A and B both write `x` concurrently → one wins, deterministically, by comparing
  `clientID`. The loser's value is *gone*, not merged. There is no "3-way merge"
  of a scalar.

The critical corollary for this codebase: **replacing a nested `Y.Map` wholesale
is destructive.** Writing `parent.set(id, new Y.Map())` does not merge with the
existing map at `id` — it detaches it. Any concurrent edit the peer made to a
*different key* of the old map is discarded along with it. Compare:

```text
merge-friendly   ymap.set("x", 600)              ← touches one key; peer's "color" edit survives
destructive      parent.set(id, new Y.Map(...))  ← replaces the whole record; peer's edit is lost
```

Both patterns are present in this code. See [Part IV-A](#a4-the-nodeedge-asymmetry).

## `Y.Text` — a sequence CRDT

`Y.Text` is for prose. Every character has its own `(clientID, clock)` identity,
and the merge algorithm (YATA) places concurrent insertions in a deterministic
total order. Two people typing in the same paragraph both keep their characters,
interleaved.

That is exactly right for prose and **actively wrong for structured data**. If two
peers concurrently rewrite a JSON document as text, `Y.Text` will faithfully merge
their *characters*. The result converges — every replica agrees — and can still be
semantically ruined, because nothing in the algorithm knows that `"fromNode"` must
name an existing node. This is the mechanism behind the defect in Part VI.

## Transactions and origins

All mutations happen inside a transaction. Two properties matter here:

- **`tr.local`** — `true` if this replica authored the change, `false` if it
  arrived from a peer. This is how observers tell "my own edit" from "someone
  else's edit".
- **`tr.origin`** — an arbitrary tag the writer attaches. Used for echo
  suppression: a component ignores updates carrying its own origin so its own
  writes don't re-enter its own capture path.

Both are used as the primary echo guards throughout this codebase:
`CANVAS_BINDING_ORIGIN` at [canvas-binding.ts:68](plugin/src/canvas/canvas-binding.ts#L68),
demuxed at [canvas-binding.ts:198](plugin/src/canvas/canvas-binding.ts#L198).

## Observers

- `ymap.observe` — shallow, fires for direct key changes.
- `ymap.observeDeep` — fires for changes anywhere in the subtree. Used for
  `nodes`/`edges` because the interesting mutations are one level down, inside
  each record's own `Y.Map`.
- `doc.on("afterTransaction")` — fires **once per transaction**, whereas two
  `observeDeep` registrations on two maps can both fire for one transaction. This
  distinction is deliberately exploited by the sequence counter at
  [canvas-sync.ts:379-383](plugin/src/files/canvas-sync.ts#L379-L383).

## What CRDTs guarantee — and what they do not

**Guaranteed:** *strong eventual consistency*. Replicas that have seen the same
set of updates are byte-identical, regardless of arrival order, with no
coordination.

**Not guaranteed, and this is the whole story of Part VI:**

1. **Semantic validity.** Convergence is agreement, not correctness. "Every peer
   agrees this edge points at a node that no longer exists" is a perfectly
   converged state. Referential integrity must be enforced by application code —
   and it is, at [canvas-sync.ts:88-96](plugin/src/files/canvas-sync.ts#L88-L96)
   and [canvas-sync.ts:603-618](plugin/src/files/canvas-sync.ts#L603-L618).
2. **Intent preservation.** LWW discards a loser. Converged, but someone's work
   is gone.
3. **Anything about a second copy of the same data.** A CRDT coordinates *within
   one document*. Two independent documents describing the same underlying state
   have no relationship whatsoever — no shared clock, no merge, no ordering. Each
   converges beautifully with itself while contradicting the other. **This is the
   bug.**

---

# Part II — Topology and the document inventory

## Transport

```text
Obsidian (Electron renderer)
   │
   │  ONE WebSocket per session:  wss://liveshare.neuralangels.de/ws-mux/<room>?password=…
   │  Multiplexed — many logical documents share the socket.
   ▼
liveshare-relay (Node, Yjs-aware)   ← plaintext to the relay; TLS only in transit
```

A small **mux protocol** frames every message with its document id
([sync/sync.ts:11-20](plugin/src/sync/sync.ts#L11-L20)):
`MUX_SUBSCRIBE`, `MUX_SUBSCRIBED`, `MUX_SYNC`, `MUX_SYNC_REQUEST`,
`MUX_AWARENESS`, their `_ENCRYPTED` variants, `MUX_UNSUBSCRIBE`, and an
app-level `MUX_PING`/`MUX_PONG` liveness pair (the Electron `WebSocket` cannot
send protocol-level pings, [sync/sync.ts:29](plugin/src/sync/sync.ts#L29)).

## The document registry

`SyncManager` keeps **one `Y.Doc` per document id** in a single map, ref-counted:

- `docs = new Map<string, Y.Doc>()` — [sync/sync.ts:50](plugin/src/sync/sync.ts#L50)
- `getDoc(id)` — returns/creates the doc and its `doc.getText("content")`
  ([sync/sync.ts:139](plugin/src/sync/sync.ts#L139), [:188](plugin/src/sync/sync.ts#L188))
- `releaseDoc(id)`, `waitForSync(id, 10s)` — [:192](plugin/src/sync/sync.ts#L192), [:220](plugin/src/sync/sync.ts#L220)

**The document id is the sole identity.** Two different id strings are two
different documents with two different `clientID` spaces and no merge
relationship. This is the fact everything in Part VI hinges on.

## Inventory: what documents exist for one shared `.canvas` file

| Doc id | Field(s) | Owner | Purpose |
|---|---|---|---|
| `__canvas__:<path>` | `nodes`, `edges` (`Y.Map` of `Y.Map`) | `CanvasSync` | structured canvas model |
| `__canvas__:<path>` | `.awareness` | `CanvasPresence` | canvas cursors + per-node locks |
| `<path>` | `content` (`Y.Text`) | `BackgroundSync` | **the same file as raw JSON text** |

The prefix is `__canvas__:` — [canvas-sync.ts:16](plugin/src/files/canvas-sync.ts#L16),
applied at [canvas-sync.ts:293](plugin/src/files/canvas-sync.ts#L293) and
[:326](plugin/src/files/canvas-sync.ts#L326). `BackgroundSync` uses the bare path —
[background-sync.ts:88](plugin/src/files/background-sync.ts#L88).

Row 3 is the defect. It is analysed in Part VI.

---

# Part III — The canvas data model

An Obsidian `.canvas` file is JSON: `{ nodes: [...], edges: [...] }`. Every entry
carries an Obsidian-generated `id`. Nodes hold geometry (`x`, `y`, `width`,
`height`), a `type` (`text` / `file` / `group` / `link`), and type-specific
content. Edges hold **only references**: `fromNode`, `toNode`, `fromSide`,
`toSide`, plus optional `color` / `label`.

That asymmetry is why this bug class hits connections hardest. A node damaged by a
bad merge usually still renders — a number is a number. An edge is *nothing but*
references, so a single corrupted or dropped field turns it into a dangling
reference, and the pruning rules then delete it outright.

In the CRDT the arrays become keyed maps, so entries merge per id rather than by
array position:

```text
Y.Doc "__canvas__:Board.canvas"
├── nodes : Y.Map<id, Y.Map<field, primitive>>
└── edges : Y.Map<id, Y.Map<field, primitive>>
```

Array→map conversion happens in `parseCanvas`
([canvas-sync.ts:43-62](plugin/src/files/canvas-sync.ts#L43-L62)); entries without
an `id` are silently dropped, and a parse failure yields empty maps rather than
throwing.

---

# Part IV — The algorithms, path by path

Four hops exist, and which code owns each depends on the `useCanvasBinding`
setting ([types.ts](plugin/src/types.ts), default **`false`**).

```text
                      ┌──────────────── flag OFF (production default) ───────────────┐
(a) local edit  →  .canvas file on disk  →  CanvasSync.handleLocalModify  →  Y.Maps
(b) remote Δ    →  observer  →  reconcileLiveCanvas  →  open canvas view
(c) CRDT        →  scheduleDiskWrite → writeToDisk  →  .canvas file
(d) file        →  host seed at subscribe  →  Y.Maps

                      ┌──────────────── flag ON (experimental) ─────────────────────┐
(a) local edit  →  adapter interaction signal  →  bridge snapshot-diff  →  captureLocal
(b) remote Δ    →  binding's own observeDeep  →  applyRemote  →  adapter
(c) CRDT        →  UNCHANGED — still CanvasSync.writeToDisk
(d) file        →  host seed STILL RUNS (not flag-gated)
```

## A. Local edit → CRDT (legacy path, flag OFF)

Entry: `handleLocalModify` — [canvas-sync.ts:445](plugin/src/files/canvas-sync.ts#L445).
Triggered by Obsidian's vault `modify` event after it saves the canvas.

**A1. Preconditions** ([:447-451](plugin/src/files/canvas-sync.ts#L447-L451))
- skip if this path was just written by us (`recentDiskWrites`)
- skip if not subscribed
- skip if `canWrite(path)` is false — the read-only guard, injected from
  `main.ts` as `canWriteCanvasPath` (global read-only, or a host-designated
  read-only glob for a guest). Server-side `ws-handler` remains authoritative;
  this only stops a read-only client diverging locally.

**A2. The three-way diff baseline.** The file is re-read and parsed, then diffed
against `lastWrittenContent` — *the last content this client knew*
([:469-470](plugin/src/files/canvas-sync.ts#L469-L470)) — not against the CRDT.
This is deliberate and load-bearing: a node that is absent from both `base` and
`next` is an un-flushed remote delta, so it is left alone rather than deleted. A
naive "disk is truth" diff would delete every remote change not yet on disk.

**A3. The echo breaker** ([:480-487](plugin/src/files/canvas-sync.ts#L480-L487)).
If the CRDT already equals the disk *semantically*, return. This kills the
oscillation that appears only when both sides edit: our own `reconcileLiveCanvas`
moves a card to match a remote delta → Obsidian saves → without this check we'd
push that back as a "local edit" → peer reconciles → re-saves → forever. The
compare is semantic, not byte-wise, because Obsidian's JSON serialization differs
from ours (`canvasRecordsEqual`, [:121-138](plugin/src/files/canvas-sync.ts#L121-L138)).

**A4. The node/edge asymmetry** — `applyLocalDiffToYMaps`,
[:541-599](plugin/src/files/canvas-sync.ts#L541-L599). **This is the most
consequential asymmetry in the file.** Nodes are called *with* an `opts` argument;
edges are called *without* it ([:492-493](plugin/src/files/canvas-sync.ts#L492-L493)):

| Case | Nodes (`opts` set) | Edges (no `opts`) |
|---|---|---|
| new locally | claim lock, gate on `canWriteNode`, then create | create |
| changed, exists in CRDT | gate, then **`applyKeyDiff`** — per-key merge | *(falls through)* |
| changed, **deleted remotely** | **no-op — delete wins, no resurrect** ([:575-580](plugin/src/files/canvas-sync.ts#L575-L580)) | **`new Y.Map()` — resurrected and wholly replaced** ([:581-586](plugin/src/files/canvas-sync.ts#L581-L586)) |
| deleted locally | gate on `canDeleteNode`, record for cascade | delete |

So a **changed edge is always destroyed and re-created as a fresh `Y.Map`**, never
key-merged. Per Part I that discards any concurrent peer edit to that edge, and
resurrects it if the peer had deleted it. Nodes were explicitly fixed for this
(GAP-2, "delete-wins / no-resurrect"); edges kept the original behaviour with the
comment *"Edges (no lock semantics): keep the original re-create behavior."*

**A5. Geometry protection.** `applyToYMap` ([:140-158](plugin/src/files/canvas-sync.ts#L140-L158))
and `applyKeyDiff` ([:175-196](plugin/src/files/canvas-sync.ts#L175-L196)) both
refuse to delete `GEOMETRY_KEYS` = `{x, y, width, height}`
([:29](plugin/src/files/canvas-sync.ts#L29)). Rationale: Obsidian never removes
geometry from a live node, so a node missing `x`/`y` is always a partial disk read,
and honouring it would strip positions CRDT-wide → cards scatter on every peer.
Note this guard is **node-shaped**; it is inert for edges, which have no geometry
keys.

**A6. Cascade prune.** If nodes were deleted, `pruneEdgesForDeletedNodes`
([:603-618](plugin/src/files/canvas-sync.ts#L603-L618)) deletes every edge
touching them, so the CRDT never holds a dangling edge.

## B. CRDT → open canvas view (flag OFF)

Obsidian **ignores external writes to an open `.canvas` view**, so writing the
file is not enough — the live view must be patched through Obsidian's private
canvas API (`CanvasAdapter`).

The observer ([:385-399](plugin/src/files/canvas-sync.ts#L385-L399)) skips if
`recentLocalEdits` is set, then does two things: fires `onRemoteCanvasUpdate`
(→ `reconcileLiveCanvas`) and schedules a disk write.

`reconcileLiveCanvas` — [main.ts:986](plugin/src/main.ts#L986):
- no adapter / unavailable → return; the file write suffices
- **`adapter.isBusy()` → return.** Never reconcile mid-drag; the trailing disk
  write keeps data safe and the next delta catches the view up
  ([main.ts:994-999](plugin/src/main.ts#L994-L999))
- then distinguishes structural (add/remove) changes from pure geometry moves

Two seeded reconciles exist because the observer only fires on *subsequent*
deltas, never the initial sync: one for a guest at subscribe time
([canvas-sync.ts:413-419](plugin/src/files/canvas-sync.ts#L413-L419)) and one at
mount via `getCanvasSnapshot` ([:302-313](plugin/src/files/canvas-sync.ts#L302-L313),
returns `null` when the shared doc is still empty so a local view is never wiped
by an empty room).

## C. CRDT → disk (both flag states — unchanged by the redesign)

`scheduleDiskWrite` ([:686-717](plugin/src/files/canvas-sync.ts#L686-L717)):

- **trailing debounce** `DEBOUNCE_MS = 200`, **capped** by `MAX_WAIT_MS = 500`
  since the first pending update — so a continuous remote stream still flushes
  roughly every 500 ms instead of the timer resetting forever
- `auditCanvasState` logs two corruption signatures before serializing:
  **SCATTER** (live node missing geometry) and **DETACH** (edge with an absent
  endpoint) — [:723-761](plugin/src/files/canvas-sync.ts#L723-L761). *These are
  the log lines worth grepping for.*
- snapshots content **and** the remote sequence together, with no interleaving
  `await`

`writeToDisk` ([:763-794](plugin/src/files/canvas-sync.ts#L763-L794)):

- `isPathSafe` — final path-traversal gate
- no-op if content equals `lastWrittenContent`
- **the sequence gate:** `if (currentSeq(path) > expectedSeq) return` — if a
  remote delta was integrated *after* this flush snapshotted its content, the
  snapshot is stale and writing it would clobber the peer's change. Strict `>`
  (not `!=`) so a reset to 0 on `destroy()` isn't misread as staleness. Re-checked
  after the awaited folder-ensure ([:783](plugin/src/files/canvas-sync.ts#L783))
  because a delta can land during the await.
- brackets the write with `recentDiskWrites` + `fileOpsManager.mutePathEvents`,
  cleared after `VAULT_EVENT_SETTLE_MS`, so our own write doesn't come back as a
  local edit

The counter it gates on is bumped in `afterTransaction`, once per transaction,
only when `!tr.local` ([:379-383](plugin/src/files/canvas-sync.ts#L379-L383)).

## D. The binding path (flag ON)

`CanvasBinding` — [canvas-binding.ts](plugin/src/canvas/canvas-binding.ts) — is a
clean CRDT⇄model binding with explicit invariants:

- **observer demux (I4):** `if (tr.local || tr.origin === CANVAS_BINDING_ORIGIN) return`
  ([:198](plugin/src/canvas/canvas-binding.ts#L198)) — ignore both our own writes
  and *any* local transaction
- **`applyingRemote` (I2):** a synchronous flag held across an apply
  ([:214](plugin/src/canvas/canvas-binding.ts#L214), reset in `finally`
  [:250](plugin/src/canvas/canvas-binding.ts#L250)) so a model callback fired by
  our own apply can't be mistaken for user intent
  ([:262](plugin/src/canvas/canvas-binding.ts#L262))
- **origin isolation (I4):** every capture runs in one transaction tagged
  `CANVAS_BINDING_ORIGIN` ([:299](plugin/src/canvas/canvas-binding.ts#L299))
- **`writeRecordMinimal`** ([:126-142](plugin/src/canvas/canvas-binding.ts#L126-L142)):
  sets only changed keys, **and deletes every doc key absent from the incoming
  record**

`createCanvasModelBridge` — [canvas-model-bridge.ts](plugin/src/canvas/canvas-model-bridge.ts) —
sources local intent from real adapter interaction signals plus a snapshot diff,
and applies remote changes through the adapter: `applyNodeGeometry` for a pure
geometry move, otherwise `structuralReload()` (wrapping `reloadCanvasData`/`setData`)
([:155-158](plugin/src/canvas/canvas-model-bridge.ts#L155-L158), [:263](plugin/src/canvas/canvas-model-bridge.ts#L263)).
**All four `applyEdge*` handlers go through `structuralReload()`** — a whole-canvas
rebuild ([:273-307](plugin/src/canvas/canvas-model-bridge.ts#L273-L307)).

Two defects in this path (see Part VI-B):

- edge capture is **membership-only**: a new edge is captured as
  `const rec: CanvasRecord = { id }` — no endpoints, no sides
  ([:215-222](plugin/src/canvas/canvas-model-bridge.ts#L215-L222))
- combined with `writeRecordMinimal`'s delete-absent-keys rule, capturing `{id}`
  over an existing doc edge **strips its endpoints**

Also note the interaction between the demux and the legacy path: the binding
ignores **all** `tr.local` transactions, but `CanvasSync`'s host file-seed
([canvas-sync.ts:347-360](plugin/src/files/canvas-sync.ts#L347-L360)) is a local
transaction on the *same* doc and is **not** flag-gated. Anything it seeds is
invisible to the binding's shadow.

## E. The text path — `BackgroundSync`

This is the generic "sync every text file" subsystem, and it treats `.canvas` as
prose because `"canvas"` is in `TEXT_EXTENSIONS`
([utils.ts:184](plugin/src/utils.ts#L184)).

- **subscribes every text file in the manifest**, skipping only non-text/binary:
  [background-sync.ts:62-63](plugin/src/files/background-sync.ts#L62-L63)
- host seeds `Y.Text` from disk, or writes remote→disk if the room already has
  content ([:102-118](plugin/src/files/background-sync.ts#L102-L118)); a guest
  polls up to 2 s for the host's seed ([:121-128](plugin/src/files/background-sync.ts#L121-L128))
- local capture: `handleLocalTextModify` ([:264-292](plugin/src/files/background-sync.ts#L264-L292))
  diffs disk against `Y.Text` and applies a minimal update
- remote apply: `attachObserver` ([:321-340](plugin/src/files/background-sync.ts#L321-L340))
  bumps the sequence, then schedules a whole-file disk write
- same debounce (300/500 ms) and the same style of sequence gate, plus a
  serialized `writeQueue` ([:383](plugin/src/files/background-sync.ts#L383))

**Its two exclusion guards both key on the active file:**

```text
capture      if (path === this.activeFile) return   ← :272
             if (path === this.collabBoundFile) return  ← :273
disk write   if (path === this.activeFile) return   ← :334
             if (path === this.collabBoundFile) return  ← :335
```

These exist to enforce a single-writer invariant: the focused editor's file is
owned exclusively by `yCollab` in CodeMirror, never by `BackgroundSync`.

**For a canvas, all four are unreachable.** `activeFile` and `collabBoundFile` are
only ever assigned in `onActiveFileChange`
([main.ts:868](plugin/src/main.ts#L868), [:876](plugin/src/main.ts#L876)) — and
that method returns early at
[main.ts:856-857](plugin/src/main.ts#L856-L857):

```ts
const view = this.app.workspace.getActiveViewOfType(MarkdownView);
if (!view) return;
```

A canvas leaf is not a `MarkdownView`, so the lookup returns `null` and the
function exits **before** either setter. A `.canvas` path can therefore never be
`activeFile`. (Side effect, separate from the main defect: opening a canvas leaves
`activeFile` pointing at the *previously* focused markdown file rather than
clearing it.)

`grep -i canvas plugin/src/files/background-sync.ts` → **zero matches.** Nothing
in this subsystem is canvas-aware.

## F. Built but unwired — `CanvasPersistence`

[canvas-persistence.ts](plugin/src/files/canvas-persistence.ts) implements SPEC_03
Phase 1: a downstream-only `.canvas` writer with a `coldOpen` path and an injected
`PersistenceIO` seam. `grep -rn "CanvasPersistence\|coldOpen\|createVaultPersistenceIO"`
across `src/` excluding tests returns **only matches inside the file itself** —
**zero production callers.** It is tested and dormant; SPEC_03's design goal
("the file is never a sync input while the canvas is open") does **not** hold in
the shipped code.

---

# Part V — Guard inventory

Every echo/clobber guard, and what it does not cover.

| Guard | Location | Protects against | Blind to |
|---|---|---|---|
| `recentDiskWrites` | canvas-sync [:776](plugin/src/files/canvas-sync.ts#L776), bg-sync [:405](plugin/src/files/background-sync.ts#L405) | our own write returning as a local edit | **the other subsystem's writes** |
| `mutePathEvents` | canvas-sync [:777](plugin/src/files/canvas-sync.ts#L777), bg-sync [:406](plugin/src/files/background-sync.ts#L406) | vault event from our own write | same — per-subsystem |
| `recentLocalEdits` | canvas-sync [:490](plugin/src/files/canvas-sync.ts#L490) | our CRDT write firing our own observer | — |
| `remoteSeq` gate | canvas-sync [:774](plugin/src/files/canvas-sync.ts#L774), bg-sync [:403](plugin/src/files/background-sync.ts#L403) | stale flush clobbering an in-flight remote delta | **only counts its OWN doc's deltas** |
| `lastWrittenContent` | canvas-sync [:766](plugin/src/files/canvas-sync.ts#L766), bg-sync [:382](plugin/src/files/background-sync.ts#L382) | redundant identical writes | goes stale when the *other* writer changes the file |
| echo breaker | canvas-sync [:480](plugin/src/files/canvas-sync.ts#L480) | reconcile→save→push oscillation | structured doc only |
| `GEOMETRY_KEYS` | canvas-sync [:29](plugin/src/files/canvas-sync.ts#L29) | partial disk read scattering cards | node-shaped; inert for edges |
| dangling prune | canvas-sync [:88-96](plugin/src/files/canvas-sync.ts#L88-L96), [:603](plugin/src/files/canvas-sync.ts#L603) | serializing an edge to a missing node | only prunes when `fromNode` is a **string**; a *missing* key passes |
| `activeFile` / `collabBoundFile` | bg-sync [:272](plugin/src/files/background-sync.ts#L272), [:334](plugin/src/files/background-sync.ts#L334) | yCollab vs BackgroundSync double-write | **unreachable for `.canvas`** (Part IV-E) |
| `isBusy()` defer | main.ts [:994](plugin/src/main.ts#L994) | reconciling mid-drag | — |
| `applyingRemote` (I2) | canvas-binding [:214](plugin/src/canvas/canvas-binding.ts#L214) | apply→capture echo | flag ON only |
| origin demux (I4) | canvas-binding [:198](plugin/src/canvas/canvas-binding.ts#L198) | our own capture re-entering | also ignores *all* `tr.local`, incl. the ungated host seed |

The pattern: **every guard is scoped to one subsystem.** Each is correct in
isolation. None knows the other exists.

---

# Part VI — The current conflict

## A. Primary defect: one file, two CRDTs, four writers

**Every shared `.canvas` file is synced twice, concurrently, through two
independent CRDT documents.**

The proof chain, each link verified:

1. `"canvas" ∈ TEXT_EXTENSIONS` → `isTextFile("x.canvas") === true`
   — [utils.ts:184](plugin/src/utils.ts#L184), [:222-226](plugin/src/utils.ts#L222-L226)
2. `CanvasSync` syncs it as structured `nodes`/`edges` under doc id
   **`__canvas__:<path>`** — [canvas-sync.ts:293](plugin/src/files/canvas-sync.ts#L293)
3. `BackgroundSync.startAll` subscribes **every** text file, skipping only
   non-text/binary, under doc id **`<path>`**
   — [background-sync.ts:62-63](plugin/src/files/background-sync.ts#L62-L63), [:88](plugin/src/files/background-sync.ts#L88)
4. Per Part II, two different ids are two unrelated documents. No shared clock,
   no merge, no ordering between them.
5. Local capture is **not** either/or. On a `.canvas` modify, `vault-events.ts`
   calls `canvasSync.handleLocalModify` at
   [:129](plugin/src/files/vault-events.ts#L129) **and then**
   `backgroundSync.handleLocalTextModify` at
   [:131](plugin/src/files/vault-events.ts#L131) — **unconditionally, not in an
   `else`**, and outside the flag check that guards line 129.
6. The only guards that could suppress step 5 key on `activeFile` /
   `collabBoundFile`, which are **unreachable for a canvas** (Part IV-E).
7. Both subsystems then write the same bytes on independent debounce timers
   (200/500 ms vs 300/500 ms) with sequence gates that each track only their own
   doc.

So one card drag produces: a structured per-key CRDT update **and** a whole-file
`Y.Text` update, followed by two independently scheduled writes of the same file.

## B. Why this produces *your* symptom specifically

Under parallel editing, the `Y.Text` replica merges two peers' concurrent JSON
rewrites **character-wise** (Part I). It converges — and converged nonsense is
still nonsense. The resulting JSON can be well-formed while `edges[]` entries have
lost, crossed or interleaved their `fromNode`/`toNode` strings.

Then the application-level integrity rules finish the job. An edge whose
`fromNode` names a node that no longer exists is pruned from disk
([canvas-sync.ts:93-94](plugin/src/files/canvas-sync.ts#L93-L94)) — **the
connection disappears.** An edge that merely *lost* its `fromNode` key isn't
pruned at all (the guard requires a `string`), so it reaches disk endpoint-less.

Nodes mostly survive the same treatment because a mangled coordinate is still a
coordinate. Edges are pure references, so they are the visible casualty. That is
why the symptom reads as "connections break" rather than "the canvas is corrupt".

Compounding it, the two writers desynchronise each other's baselines: when
`BackgroundSync` writes the whole JSON, `CanvasSync`'s `lastWrittenContent` for
that path is silently stale, so its *next* three-way diff (Part IV-A2) computes
against the wrong base — turning a peer's changes into apparent local edits or
apparent local deletes.

## C. Why the canvas redesign did not fix it

`useCanvasBinding` only switches which code feeds the **structured** doc.
[vault-events.ts:131](plugin/src/files/vault-events.ts#L131) sits outside the flag
condition and runs in **both** states, and hop (c) CRDT→disk is explicitly
unchanged by the redesign (Part IV). The text document and its writer are
untouched by the entire redesign.

**Falsifiable prediction:** the defect reproduces with `useCanvasBinding` OFF *and*
ON. If it reproduces only in one state, this analysis is wrong.

## D. Why 526 passing tests never caught it

No test instantiates `BackgroundSync` and `CanvasSync` against the same
`.canvas` path. Each subsystem is unit-tested in isolation, so an interaction
between them is structurally invisible to the suite. The bug is not in either
component; it is in their composition, and nothing tests the composition.

A secondary gap, in the canvas tests themselves: of the six SPEC_04 matrix cases,
exactly one exercises true concurrency
([canvas-matrix.test.ts:118-143](plugin/src/__tests__/canvas-matrix.test.ts#L118-L143)),
and it moves **two disjoint nodes and touches no edge**. All four edge cases are
single-peer-then-settle. The harness *can* model concurrency — `waitQuiescent`
snapshots both state vectors before applying either
([two-peer.ts:460-471](plugin/src/__tests__/harness/two-peer.ts#L460-L471)) — it
is simply never pointed at edges or at same-entity conflicts.

## E. Secondary defect (blocks the redesign rollout)

Independent of the above, and active only with `useCanvasBinding` ON:

- edge capture emits `{ id }` with no endpoints — [canvas-model-bridge.ts:215-222](plugin/src/canvas/canvas-model-bridge.ts#L215-L222)
- `writeRecordMinimal` deletes doc keys absent from the record — [canvas-binding.ts:134-140](plugin/src/canvas/canvas-binding.ts#L134-L140)
- ⇒ capturing `{id}` over an existing doc edge **deletes `fromNode`/`toNode` in
  the CRDT**, propagates to all peers, and reaches disk endpoint-less (the
  dangling-prune guard requires a `string`, so it does not catch a missing key)

**Do not enable `useCanvasBinding` on a canvas you care about** until this is
fixed. Also unresolved on that path: the legacy edge-reflow workaround at
[main.ts:1024-1028](plugin/src/main.ts#L1024-L1028) / [:1072-1078](plugin/src/main.ts#L1072-L1078)
has no equivalent, and `applyEdge*` always triggers a whole-canvas
`structuralReload`.

## F. Fix options for the primary defect

Ordered by blast radius. All are unimplemented; this is the decision to make.

**Option 1 — exclude `.canvas` from the text path (surgical, recommended).**
Make [vault-events.ts:131](plugin/src/files/vault-events.ts#L131) an `else` so a
canvas owned by `CanvasSync` never reaches `handleLocalTextModify`, **and** skip
canvas paths in `BackgroundSync.startAll`
([:62-63](plugin/src/files/background-sync.ts#L62-L63)) so no `Y.Text` doc is ever
created for one. Two small, local, testable changes. Risk: a `.canvas` file that
is *not* subscribed to `CanvasSync` (e.g. excluded, or a subscribe failure) would
then sync through neither path — needs an explicit fallback decision.

**Option 2 — drop `"canvas"` from `TEXT_EXTENSIONS`.** One line, but
`isTextFile` also drives manifest binary-detection and file transfer
([manifest.ts:75](plugin/src/files/manifest.ts#L75), [file-ops.ts:384](plugin/src/files/file-ops.ts#L384), [:416](plugin/src/files/file-ops.ts#L416)),
so canvases would be transferred as **binary** — changing initial sync and
conflict handling for every canvas. Wider blast radius than it looks.

**Option 3 — make the canvas the active-file owner.** Fix
[main.ts:856-857](plugin/src/main.ts#L856-L857) so a canvas leaf also sets
`activeFile`/`collabBoundFile`, reviving the existing single-writer guards. Fixes
the stale-`activeFile` side effect too, but relies on a guard designed for the
*focused* editor — a canvas open in a background tab would still double-sync.
Insufficient alone.

**Option 4 — wire `CanvasPersistence` (Part IV-F)** and make CRDT→disk the only
writer, per SPEC_03's original intent. The correct end state, and the largest
change; it does not by itself remove the second `Y.Text` document, so it needs
Option 1 regardless.

Recommended sequence: write the missing composition test first (both subsystems,
one path, two peers, assert edge endpoints survive), confirm it goes red, then
apply Option 1 and watch it go green. That converts this analysis into a
regression gate instead of an argument.

---

## Appendix — where to look when debugging

- **`DETACH` / `SCATTER`** warnings — [canvas-sync.ts:723-761](plugin/src/files/canvas-sync.ts#L723-L761).
  The two corruption signatures, logged before every disk write. Grep these first.
- `local modify <path>: +N ~N -N node(s)` — [canvas-sync.ts:521](plugin/src/files/canvas-sync.ts#L521),
  what a local edit actually pushed.
- `local modify <path>: no-op (disk == shared state)` — the echo breaker firing.
- Log plumbing: [debug-logger.ts](plugin/src/debug-logger.ts) — 500-entry ring
  buffer, subscribable, plus a file sink gated on the `debugLogging` setting.
  Entries are **prose strings**, so they cannot be correlated to individual CRDT
  operations; structured per-hop tracing does not exist yet.
- Headless repro harness: `makeTwoPeer()` — [two-peer.ts:392](plugin/src/__tests__/harness/two-peer.ts#L392).
- Live two-instance rig: `tools/launch_liveshare_e2e.py` + the `liveshare-e2e`
  MCP server (7 tools), documented in
  `workflowArtifacts/e2e-infra/E2E_USAGE.md`.

### Log signature table (US6)

Ten fixed uppercase prefixes, one per failure mode. All are emitted through the
`DebugLogger` seam and are stable across releases — grep a user-supplied log dump
for them before reading any code. `SCATTER` and `DETACH` keep their original text so
older dumps stay comparable.

| Signature | What it proves | Emitter |
|---|---|---|
| `SCATTER signature:` | nodes reached the audit with no geometry | `plugin/src/files/canvas-sync.ts` (`auditCanvasState`) |
| `DETACH signature:` | edges were pruned because an endpoint was absent | `plugin/src/files/canvas-sync.ts` (`auditCanvasState`) |
| `AWARENESS GAP:` + gap in ms | a keep-alive gap approached or exceeded y-protocols' 30 s prune window, so peers may have pruned this client's awareness — and its locks with it | `plugin/src/sync/sync.ts` |
| `DRAG WATCHDOG:` | `isDragging` latched and was force-released; CRDT→view reconciliation had been silently disabled until then | `plugin/src/canvas/canvas-adapter.ts` |
| `ADAPTER PATCH:` + per-method outcome | a duplicate or failed mount; distinguishes `installed` / `adopted` / `unavailable` | `plugin/src/canvas/canvas-adapter.ts` |
| `LOCK DENIED:` + path + ids | a local write was rejected by the lock seam and the diff baseline was deliberately held back | `plugin/src/files/canvas-sync.ts` |
| `LOCK REVERT:` + path + nodeId + winner | the loser-revert actually ran | `plugin/src/main.ts` (`revertCanvasNode`) |
| `NO TYPE signature:` + node ids | a live node lost its `type`; every peer would silently drop that node **and all its edges** | `plugin/src/files/canvas-sync.ts` (`auditCanvasState`) |
| `CANVAS TEXT FALLBACK:` + path | a canvas is syncing through the raw-text path because `CanvasSync` does not own it. Once per path per session | `plugin/src/files/vault-events.ts` |
| `CANVAS WRITER:` + path + owner | which component wrote the file, on every canvas disk write | `plugin/src/files/canvas-persistence.ts`, `plugin/src/main.ts` (attach) |

One-line audit that every signature still has a production emitter:

```sh
grep -rnE "SCATTER signature:|DETACH signature:|AWARENESS GAP:|DRAG WATCHDOG:|ADAPTER PATCH:|LOCK DENIED:|LOCK REVERT:|NO TYPE signature:|CANVAS TEXT FALLBACK:|CANVAS WRITER:" plugin/src --include=*.ts | grep -v __tests__
```

Two caveats worth knowing before concluding "the signature never fired":

- A logger must be **attached** for anything to be recorded. `SyncManager` and the
  canvas adapter both measure regardless, but report only once `setLogger` /
  `createCanvasAdapter(view, { logger })` has run — both are wired in `main.ts`.
- `CanvasAdapterLogger` declares `log(...)` while `CanvasSyncLogger` and `SyncLogger`
  declare `debug(...)`. `main.ts` bridges the two names at the adapter call site;
  the interfaces have not been unified.
