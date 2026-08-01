# Obsidian Live Share — Architecture

> **Scope.** The whole system: the relay, the plugin, the document model, the
> concurrency model, the trust boundaries, and the edge cases. It is written to be
> the one document you read before touching this codebase.
>
> **Verified against** the working tree at HEAD `4b34d5e` plus the uncommitted
> canvas-redesign and canvas-integrity rounds — i.e. what a build of this tree
> actually does, not what any spec intends. Every structural claim carries a
> `file:line` reference and was read from source. Test claims were produced by
> running the suites: **plugin 35 files / 674 tests green in 40.8 s**, **relay
> 10 files / 122 tests green in 19.6 s** (2026-07-29). Where something is *not*
> verified, it says so in those words.
>
> **Supersedes** the canvas sections of [docs/architecture.md](docs/architecture.md)
> (which still describes canvas sync as "KNOWN-RACY, redesign in progress" — that
> redesign has landed) and absorbs
> [workflowArtifacts/canvas-integrity/ANALYSIS_CanvasTwoWriter_2026-07-26.md](workflowArtifacts/canvas-integrity/ANALYSIS_CanvasTwoWriter_2026-07-26.md),
> which is retained as the historical record of how the two-writer defect was
> found and closed.

---

## Contents

```text
Part I     ← Philosophy: the real problems, and the shape each one forced
Part II    ← Topology: processes, channels, deployment
Part III   ← The document model: what a CRDT is used for here, and what it is not
Part IV    ← The data paths, hop by hop
Part V     ← Threading and concurrency (there are no threads — read this anyway)
Part VI    ← Trust boundaries: auth, encryption, permission, path safety
Part VII   ← Observability
Part VIII  ← Testing architecture
Part IX    ← Risk register: what is known-unfinished
Appendix A ← Edge-case catalogue (~55 entries, grouped)
Appendix B ← Constants and tunables
Appendix C ← Log signature reference
Appendix D ← Invariant index
```

---

# Part I — Philosophy

## What the product is

Two or more people open the same Obsidian vault on their own machines and edit it
at the same time — markdown *and* canvas — through a relay they host themselves.
That is the entire product. Everything below is a consequence of doing that
honestly on top of an application that was never designed for it.

## Problem 1 — Latency versus authority

If every keystroke needs a server round trip to be confirmed, typing feels broken.
If it does not, two people will edit the same byte at once and someone must lose.

**Conceptual solution: a CRDT, so there is no arbiter at all.** Each replica
applies its own change instantly and exchanges deltas; the merge function is
commutative, associative and idempotent, so any arrival order converges to the
same state without anyone asking permission. This project uses **Yjs**.

The consequence that shapes the rest of the system: **the relay is not an
authority on content.** It cannot resolve conflicts, cannot repair state, and does
not even hold a `Y.Doc` ([server/src/ws-handler.ts](server/src/ws-handler.ts) has
no Yjs import). It fans bytes out. All correctness lives in the clients.

## Problem 2 — Convergence is not correctness

A CRDT guarantees that all replicas agree. It does not guarantee that what they
agree on means anything.

- `Y.Text` merges two concurrently rewritten JSON documents **character-wise**.
  The result converges, is often still valid JSON, and can have edges whose
  `fromNode` now names a node that never existed.
- `Y.Map` resolves per key by last-write-wins. Converged — and the loser's work
  is simply gone.
- Replacing a nested `Y.Map` wholesale (`parent.set(id, new Y.Map())`) does not
  merge; it detaches the old record, discarding a peer's concurrent edit to a
  *different* key of it.

**Conceptual solution: application-level semantic invariants, enforced on the way
in and on the way out.** Concretely:

- Structured data is never synced as text. A canvas becomes keyed maps so entries
  merge by identity rather than by array position
  ([canvas-sync.ts:74-93](plugin/src/files/canvas-sync.ts#L74-L93)).
- Records are merged **per key**, never re-created
  ([`applyKeyDiff`](plugin/src/files/canvas-sync.ts#L210-L233)).
- Keys whose loss is silently catastrophic are undeletable by a merge:
  `PROTECTED_KEYS = {x, y, width, height, type, fromNode, toNode, fromSide, toSide}`
  ([canvas-sync.ts:53-60](plugin/src/files/canvas-sync.ts#L53-L60)), honoured on
  **both** delete paths. Content keys (`text`, `color`, `label`, `file`, `url`)
  stay deletable — removing those is real, reversible user intent.
- Referential integrity is enforced at both ends: a deleted node cascade-prunes
  its edges in the CRDT
  ([`pruneEdgesForDeletedNodes`](plugin/src/files/canvas-sync.ts#L723-L738)), and a
  dangling edge is never serialized to disk
  ([`buildCanvasData`](plugin/src/files/canvas-sync.ts#L119-L126)).

The asymmetry worth internalising: **a node damaged by a bad merge usually still
renders — a number is a number. An edge is nothing but references**, so one lost
field turns it into garbage and the integrity rules then delete it. That is why
every canvas symptom users report reads as *"connections break"*.

## Problem 3 — Canvas has no editor to bind to

Markdown collaboration is easy because CodeMirror can *be* the CRDT: `yCollab`
binds `Y.Text` to the editor state, so the open document is a projection of the
CRDT and the `.md` file is written by exactly one owner. There is no ambiguity
about who is authoritative.

A canvas has no such binding. Obsidian's canvas is a private controller with its
own model, which persists itself by calling `requestSave()` on the `.canvas` file
whenever it feels like it, and which **ignores external writes to a file whose
view is open**.

The original design bridged the CRDT *through the file*: read on vault `modify`,
write back on remote deltas. That gave one open canvas **four writers** (our disk
write, Obsidian's `requestSave`, and — because `"canvas" ∈ TEXT_EXTENSIONS` — a
second, unrelated `Y.Text` CRDT of the same bytes, plus its own disk writer). Two
independent CRDTs for one file have no shared clock and no merge relationship;
each converges beautifully with itself while contradicting the other.

**Conceptual solution: restore the single-writer invariant by making ownership
global rather than per-subsystem.** Three moves, all present in the current tree:

```text
├── ONE OWNER per path      canvasOwned() decides, once per event, which CRDT owns a
│                           .canvas. The other path becomes UNREACHABLE for it —
│                           not "usually skipped".            vault-events.ts:53,:236
├── ONE WRITER per path     CanvasPersistence is the only component that writes a
│                           .canvas during a session. It emits ZERO CRDT writes, so
│                           it cannot loop back.              canvas-persistence.ts
└── THE FILE IS NOT AN INPUT while the canvas is owned. It is read exactly once,
    at cold open, before any observer exists.  canvas-persistence.ts:310-325
```

The deeper lesson, and the reason this took several rounds: **every echo guard in
the codebase was correct in isolation and blind to the existence of the other
subsystem.** `recentDiskWrites`, `mutePathEvents`, `remoteSeq`, `lastWrittenContent`
each protect one component from itself. None of them can see a second writer. A
defect of that class cannot be fixed by adding another local guard; it is fixed by
making ownership a property of the *system*, decided in one place, and by making
the losing path structurally unreachable rather than conditionally skipped.

## Problem 4 — The API you must use is private, untyped and not observable

Obsidian's canvas exposes no events. There is no `canvas.on()`. Its viewport
`zoom` is `log2(scale)` and not a multiplier. Node cards live in a private `Map`.
Nothing is typed, and any of it can change in a point release.

**Conceptual solution: one isolation layer, defensive at every access, with an
explicit degradation ladder.**

- Exactly one file may touch `view.canvas` internals
  ([canvas-adapter.ts](plugin/src/canvas/canvas-adapter.ts)).
- Activity is detected by **monkey-patching** `updateSelection`, `setDragging` and
  `markViewportChanged` — wrap, call original, call our callback, restore on
  destroy ([canvas-adapter.ts:369-400](plugin/src/canvas/canvas-adapter.ts#L369-L400)).
- A patch is **adopted**, not skipped, if another adapter over the same canvas got
  there first: unwrap via `__lsOriginal`, re-wrap the pristine method. An early
  return would leave the newest adapter blind to every drag signal.
- `isAvailable()` gates on the two members that actually matter (`nodes instanceof
  Map`, `typeof zoom === "number"`); everything else is optional with a fallback,
  and `availabilityReport()` names which member is missing.
- When the private API is absent the locking path does not fail — it degrades to a
  **diff-inferred** acquisition: the first time the local diff sees a node's keys
  change, that is treated as the lock claim
  ([canvas-sync.ts:641](plugin/src/files/canvas-sync.ts#L641) →
  [canvas-presence.ts:339](plugin/src/canvas/canvas-presence.ts#L339)).
- Anything that could throw from private-shape drift is wrapped so it can never
  break the data path or canvas interaction.

## Problem 5 — Everything private is also a source of *false* signals

A programmatic `moveAndResize()` looks, to the rest of the system, exactly like a
user dragging a card. Capture the apply path and you have built a perpetual motion
machine.

**Conceptual solution: distinguish intent from effect with synchronous
re-entrancy flags, not with time windows.**

- `applyingRemote` is held for exactly the synchronous span of an apply and reset
  in `finally`; capture no-ops while it is true
  ([canvas-binding.ts:211-262](plugin/src/canvas/canvas-binding.ts#L211-L262)).
- Every binding-authored write runs in one transaction stamped
  `CANVAS_BINDING_ORIGIN`; the observer ignores both that origin and any
  `tr.local` transaction
  ([canvas-binding.ts:193-200](plugin/src/canvas/canvas-binding.ts#L193-L200)).
- Mute windows (`mutePathEvents`, `recentDiskWrites`) still exist but are demoted
  to what they are: **mechanical echo suppression, explicitly not a correctness
  mechanism** ([canvas-persistence.ts:36-39](plugin/src/files/canvas-persistence.ts#L36-L39)).
  Correctness comes from ownership; the windows only stop noise.

## Problem 6 — Two people grabbing the same card

CRDT convergence will happily let both moves land and pick one by clientID. The
user experience of that is a card that jumps.

**Conceptual solution: advisory locks that ride awareness, with a deterministic
tiebreak and a visible loser-revert.** Awareness (not the document) carries
`lockedNodes`, which means a lock **cannot strand**: awareness auto-clears when a
client disconnects. The tiebreak is the lowest `clientID` among holders
([canvas-presence.ts:102-113](plugin/src/canvas/canvas-presence.ts#L102-L113)), a
loser releases and rolls its view back to shared truth
([main.ts:1364-1380](plugin/src/main.ts#L1364-L1380)), and a denied write causes
the diff baseline to be **held rather than advanced** so the rejected edit stays
detectable instead of becoming permanent local divergence
([canvas-sync.ts:573-580](plugin/src/files/canvas-sync.ts#L573-L580)).

They are *advisory* on purpose: the authority for permission is the server
([ws-handler.ts:160-170](server/src/ws-handler.ts#L160-L170)); locks are a UX
mechanism for concurrent intent, not a security mechanism.

## Problem 7 — The clients you must keep alive are inside a browser

Locks live in awareness. y-protocols prunes an awareness state after **30 s**
without an update. Chromium throttles timers in occluded windows to 1 Hz and then
to roughly once a minute. A fixed-period keep-alive is therefore a correctness bug
waiting for the user to switch windows: miss the window and every peer prunes this
client's awareness — **and its locks with it**.

**Conceptual solution: drive liveness from an absolute-time deadline evaluated at
every available opportunity, including opportunities that are not timers.**

```text
lastPulseAt ─── compared against wall clock, pulse when D has elapsed
      ▲
      ├── (a) short tick every T = 4 000 ms                         sync.ts:451
      └── (b) EVERY inbound framed mux message — socket delivery    sync.ts:406
              is not timer-throttled, so the first packet after a
              throttled window is what actually recovers liveness

worst case between pulses while ticks fire = T + D = 12 000 ms  <  30 000 ms prune
measured on every pulse; warned above 20 000 ms as `AWARENESS GAP:`
```

## Problem 8 — Self-hosting behind SSO, when the client has no browser

The deployment gates the service with NeuralAngels-Access (OIDC forward-auth). The
plugin connects from Obsidian's Electron process: it has **no browser cookie** and
authenticates only via query parameters. A cookie-based forward-auth gate
therefore cannot gate the WebSocket.

**Conceptual solution: the git-analog access model.** SSO gates the *credential
landing page*; the protocol itself runs past the gate authenticated by its own
shared secret — exactly as an SSH-key `git clone` runs past a Forgejo SSO gate.
Path-split at the proxy: `/` is gated, `/ws-mux/`, `/control/`, `/rooms`,
`/healthz` are explicitly un-gated. See
[Projects/_external/liveshareCollab/CONTEXT.md](../CONTEXT.md).

Offboarding is therefore **rotation, not revocation**: `SERVER_PASSWORD` is one
shared secret, and the landing page shows the new value automatically.

## The five invariants

Everything above condenses to these. Each has a mechanism and a test.

```text
I1  ONE OWNER    a shared .canvas has exactly one CRDT owner at any instant, decided
                 by one predicate, evaluated once per event
I2  ONE WRITER   at most one component writes a given file during a session
I3  DOC IS TRUTH the CRDT is authoritative; the view and the file are projections
I4  NO LOOPBACK  a component's own writes can never re-enter its own capture path,
                 proven synchronously (origins, re-entrancy flags), not by timing
I5  DEGRADE      a missing private API disables a feature, never the data path
```

---

# Part II — Topology

## Processes

```text
┌─ Obsidian (Electron renderer, one process per participant) ───────────────────┐
│  plugin/  ← the entire correctness surface: CRDT replicas, merge policy,      │
│              disk writers, locks, reconciliation                              │
└───────────────┬───────────────────────────────────┬───────────────────────────┘
                │  wss  /ws-mux/<room>              │  wss  /control/<room>
                │  binary, multiplexed, Yjs         │  JSON, one message per op
                ▼                                   ▼
┌─ liveshare-relay (single Node process, single event loop) ────────────────────┐
│  ws-handler.ts     ← content-blind fan-out. NO Y.Doc. NO merge.               │
│  control-handler.ts← routing, host election, per-client rate limit            │
│  rooms.ts          ← room CRUD + 24 h expiry; LevelDB metadata only           │
│  audit-log.ts      ← append-only per-room event log (LevelDB)                 │
│  github-auth.ts    ← optional OAuth → HS256 JWT (7 d)                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

Deployment adds one hop in front: NPM terminates TLS and applies the NA
forward-auth gate to `/` only. The relay never sees a host port
([docker/ServerCompose.yaml](../docker/ServerCompose.yaml), network
`na-liveshare-net`).

## The two channels, and why there are two

| | `/ws-mux/:room` | `/control/:room` |
|---|---|---|
| Payload | binary lib0 frames | JSON |
| Carries | Yjs deltas + awareness | file ops, presence, permissions, approval, follow/summon, host transfer, ping |
| Multiplexed | yes — `docId` in every frame | no |
| Relay role | fan-out to peers of that doc's room | routing + policy |
| Rate limited | no (10 MB `maxPayload`) | 100 msgs / 10 s per client |
| Backpressure | none | pacing is the sender's job (see [Part V](#chunk-pacing)) |

They are separate because they answer different questions. The mux channel is
"what changed inside a document"; the control channel is "what happened to the
vault, the session, or a person". A binary file is not a CRDT, so it travels the
control channel in 512 KB chunks; a markdown character is, so it never does.

The plugin treats *both being up* as the online condition
([main.ts:147-150](plugin/src/main.ts#L147-L150)) — `muxConnected && controlConnected`
drives `FileOpsManager.setOnline`, which in turn drains the offline queue.

## The mux frame

```text
varString docId  ·  varUint msgType  ·  [varUint8Array payload]
```

11 types ([mux-protocol.ts](plugin/src/sync/mux-protocol.ts)): `SYNC(0)`,
`AWARENESS(1)`, `SUBSCRIBE(2)`, `UNSUBSCRIBE(3)`, `SUBSCRIBED(4)`,
`SYNC_REQUEST(6)`, `SYNC_ENCRYPTED(7)`, `AWARENESS_ENCRYPTED(8)`, `PING(9)`,
`PONG(10)`.

`PING`/`PONG` are **application-level on purpose**: an Electron/browser
`WebSocket` cannot send protocol-level pings, so a half-dead socket (Wi-Fi
dropped, no FIN) is otherwise undetectable
([sync.ts:29-32](plugin/src/sync/sync.ts#L29-L32)).

On the relay, one *document* is one room: `roomId = ${baseRoomId}:${docId}`
([ws-handler.ts:107](server/src/ws-handler.ts#L107)). Subscribing tells the
newcomer how many peers were already there
(`MUX_SUBSCRIBED` carries `peerCount`), and tells the incumbents to re-announce
(`MUX_SYNC_REQUEST`) — the mechanism that gets a static, never-moved caret across
to a late joiner.

## Deployment facts that shape the code

- The relay's LevelDB at `data/yjs-docs` stores **room metadata only** (`room:<id>`
  keys) despite the directory name — no document is persisted anywhere. If every
  peer leaves, the document is gone; the vault files are the durable store.
- Rooms expire after 24 h of inactivity, reaped hourly
  ([index.ts:168-173](server/src/index.ts#L168-L173)); `touchRoom` persists on a
  5 s debounce.
- `setNoDelay(true)` is applied at upgrade
  ([index.ts:100-101](server/src/index.ts#L100-L101)) — without it Nagle coalesces
  small control/mux frames and adds ~40 ms per hop.

---

# Part III — The document model

## Inventory: what exists for one session

| Doc id | Content | Owner | Notes |
|---|---|---|---|
| `__manifest__` | `Y.Map<path, FileEntry>` | `ManifestManager` | hash/size/mtime/binary/directory |
| `<path>` | `Y.Text` "content" | `CollabManager` (open file) or `BackgroundSync` | every text file except owned canvases |
| `__canvas__:<path>` | `Y.Map` "nodes" + `Y.Map` "edges" | `CanvasSync` (up) / `CanvasPersistence` (down) | `Y.Map` of `Y.Map`, keyed by Obsidian id |
| *(each of the above)* | `Awareness` | `CollabManager` / `CanvasPresence` | cursors, and for canvas also `lockedNodes` |

**The document id is the sole identity.** Two different id strings are two
unrelated documents with two `clientID` spaces, no shared clock and no merge
relationship. That single fact is what made the historical two-writer defect
possible, and it is why `skipsAutoTextSync` exists in exactly one place with four
declared consumers ([utils.ts:228-260](plugin/src/utils.ts#L228-L260)) rather than
as four private `path.endsWith(".canvas")` copies.

`SyncManager.getDoc()` **creates on demand**
([sync.ts:200-251](plugin/src/sync/sync.ts#L200-L251)). Every automatic caller
that passes a bare path therefore needs a guard, or it silently mints a second
CRDT for a canvas. Two production callers still pass a bare path unguarded —
see [Part IX](#part-ix--risk-register).

## Why a canvas is maps and not text

An Obsidian `.canvas` is `{ nodes: [...], edges: [...] }` JSON. Arrays are
converted to id-keyed maps at parse time
([`parseCanvas`](plugin/src/files/canvas-sync.ts#L74-L93)) so entries merge by
identity instead of by array index:

```text
Y.Doc "__canvas__:Board.canvas"
├── nodes : Y.Map<id, Y.Map<field, primitive>>     ← x,y,width,height,type,text,file,color…
└── edges : Y.Map<id, Y.Map<field, primitive>>     ← fromNode,toNode,fromSide,toSide,label,color
```

Records without an `id` are dropped silently; a parse failure yields empty maps
rather than throwing. Values are always primitives, which is why a shallow
per-key comparison is *exact* everywhere in this codebase
([`canvasRecordsEqual`](plugin/src/files/canvas-sync.ts#L152-L169)).

## Why the text path uses a minimal diff

Replacing a whole `Y.Text` on every save would destroy every peer's cursor and
produce enormous updates. `applyMinimalYTextUpdate`
([utils.ts:64-116](plugin/src/utils.ts#L64-L116)) computes a common prefix/suffix
and replaces only the middle — and then **snaps both boundaries off surrogate
pairs**, so a delete/insert can never cut between a high and a low surrogate and
corrupt an emoji into two lone halves.

## The three snapshot/baseline concepts (do not confuse them)

| Name | Where | What it means |
|---|---|---|
| `lastWrittenContent` | canvas-sync, background-sync, canvas-persistence | the last content **this client believes is on disk**. The three-way-diff base. |
| `lastQueuedContent` | canvas-persistence only | the last content **handed to the write queue**, assigned synchronously. The redundant-write skip must test this one — `lastWrittenContent` only advances after the await, so two overlapping flushes would both see the pre-write value and both proceed. |
| `canvasApplied` (the "shadow") | main.ts, canvas-model-bridge | the last data **successfully applied to the live view**. Reconcile classification is relative to this, not to the live id sets. |

---

# Part IV — The data paths

## A. Text, open in the editor

```text
keystroke ──► CodeMirror ──► yCollab ──► Y.Text ──► mux ──► peers
                  ▲                        │
                  └────────────────────────┘   the editor IS the projection
disk: written by the editor / Obsidian. BackgroundSync is BARRED from this path.
```

The bar is two identity checks, both set **synchronously** in
`onActiveFileChange` ([main.ts:911-919](plugin/src/main.ts#L911-L919)):
`activeFile` and `collabBoundFile`. The synchrony is the point — an earlier
version nulled the guard and only restored it in a `.then()` up to 10 s later,
which opened a window in which yCollab *and* `BackgroundSync` both wrote the same
disk-originated frontmatter edit into `Y.Text` and produced interleaved YAML.

`CollabManager.activateForFile` carries a **generation token** (`activationGen`,
[collab.ts:29](plugin/src/editor/collab.ts#L29)) because activation awaits
`waitForSync` (up to 10 s) and the user can switch files three times in that
window; any activation whose generation is stale returns without dispatching.

## B. Text, not open (background files)

```text
remote Δ ──► Y.Text.observe ──► remoteSeq++ ──► debounce 300 / cap 500
                                                    │
                                  writeQueue ──► seq gate ──► disk
local disk edit ──► vault modify ──► handleLocalTextModify ──► applyMinimalYTextUpdate
```

The sequence gate ([background-sync.ts:425](plugin/src/files/background-sync.ts#L425),
re-checked at [:440](plugin/src/files/background-sync.ts#L440)) is the interesting
part: a flush snapshots content **and** the remote sequence together with no
interleaving `await`; if the sequence has advanced by write time, a remote delta
landed after the snapshot and the flush yields rather than clobbering it. Strict
`>` and not `!=`, so a reset to 0 on `destroy()` is not misread as staleness.

## C. Canvas — local edit → CRDT (production path, `useCanvasBinding` OFF)

Entry: [`handleLocalModify`](plugin/src/files/canvas-sync.ts#L496), triggered by
Obsidian's vault `modify` after it saves the canvas itself.

```text
1. gates      recentDiskWrites? subscribed? canWrite(path)?
2. baseline   base = parse(lastWrittenContent)   ← "what THIS client knew"
              next = parse(freshly read file)
3. echo break if CRDT == next semantically → advance baseline, log no-op, RETURN
4. diff       nodes and edges, both through the SAME lock seam
5. cascade    deleted nodes → prune their edges
6. baseline   advance ONLY if nothing was denied
7. telemetry  +N ~N -N, plus a warn if a "changed" node arrived without geometry
```

Two decisions in there are load-bearing and non-obvious:

- **The diff base is not the CRDT.** A record absent from *both* `base` and `next`
  is an un-flushed remote delta, so it is left alone. A naive "disk is truth"
  diff would delete every remote change not yet written to disk.
- **The echo breaker is semantic, not byte-wise**, because Obsidian's JSON
  serialization differs from ours. Without it: our reconcile moves a card to match
  a remote delta → Obsidian saves → we push that back as a local edit → the peer
  reconciles → re-saves → forever. This oscillation only appears when *both* sides
  edit, which is why it survived single-peer testing.

The lock seam ([`canWriteEntity`](plugin/src/files/canvas-sync.ts#L705-L719)) gates
a node on its own id and an **edge on both of its endpoint nodes, checked across
the intended *and* the previous record** — otherwise re-routing an edge away from
a locked node would slip past the lock on the endpoint it is leaving.

Delete-wins / no-resurrect now applies to nodes **and** edges: a record removed
from the CRDT by a remote delete is never re-created, even if the local user also
edited it ([canvas-sync.ts:670-677](plugin/src/files/canvas-sync.ts#L670-L677)).
Edges used to be exempt, and that exemption was a live defect.

## D. Canvas — CRDT → live view (flag OFF)

Obsidian ignores external writes to an open canvas, so the file is not enough: the
live view must be patched through the private API.

The decision is a pure function, extracted so it is testable without Obsidian
([reconcile-plan.ts](plugin/src/canvas/reconcile-plan.ts)):

```text
planReconcile(desired, lastApplied, liveNodeIds, liveEdgeIds, initial)
├── initial                                   → "structural"   (fresh mount / revert)
├── live-view membership differs from desired  → "structural"
├── no lastApplied yet                         → "structural"   (cannot prove otherwise)
├── any EDGE field differs                     → "structural"   (arrows need re-routing)
├── only node x/y/w/h differ, number→number    → "geometry"
└── nothing differs                            → "noop"         (make NO adapter call)
```

Classifying against `lastApplied` rather than the live id sets is what fixed a
whole symptom class: a remote change to `text`/`color`/`type`/`fromSide`/`label`
has identical id sets, so the old code took the geometry-only branch and the change
never reached the open view — Obsidian then serialized its own stale model and
`handleLocalModify` pushed the stale values back, **reverting the peer who made
the change**.

Execution ([main.ts:1046-1166](plugin/src/main.ts#L1046-L1166)) adds three
practical rules:

- `adapter.isBusy()` → return. Never reconcile mid-drag.
- `"noop"` makes no mutating call **and does not mute the path** — muting would
  swallow an unrelated genuine local save.
- After per-node geometry moves, if a node that is an **edge endpoint** actually
  moved, escalate to one `reloadCanvasData` so arrows re-route from authoritative
  data. Per-node moves cannot re-route an edge; the live arrows keep their old
  routing, look detached, and Obsidian re-saves its own recomputed routing —
  which then fights the sync. This is why "moving a card with more than one
  connection breaks sync" used to be reproducible.
- The shadow advances **only when the apply landed** (`ok`, or zero `interacting`
  nodes). Never mark unapplied data as applied.

## E. Canvas — CRDT → disk (the single writer)

[canvas-persistence.ts](plugin/src/files/canvas-persistence.ts). One instance per
subscribed canvas path. Strictly downstream: it opens no `Y.Doc` transaction, so
it cannot loop back into the CRDT. Its observer has **no origin filter** — local
captures and remote deltas must both be persisted.

```text
attachCanvasPersistence(doc, io, diskPath, opts)
├── new CanvasPersistence(...)
├── await coldOpen()        ← AFTER waitForSync, BEFORE start(). Not negotiable.
│     ├── doc non-empty        → "doc-wins"          flush(); the file is NEVER read
│     ├── doc empty + file     → "seeded-from-file"  parse once under CANVAS_SEED_ORIGIN
│     └── doc empty + no file  → "empty"
└── start()                 ← observers attach; from here the file is not an input
```

The ordering is the whole contract: if `start()` ran first, the one-time
file→CRDT seed would race the observer that would persist it straight back out.

Below `start()` the writer is a small state machine worth knowing in full, because
each element exists to close a specific hole:

| Element | Why |
|---|---|
| trailing debounce 200 ms, capped 500 ms since first pending change | a continuous remote stream would otherwise reset the trailing timer forever and never flush |
| snapshot taken **synchronously** immediately before enqueueing | this is what makes the retired `remoteSeq` gate *unnecessary* rather than merely absent: a stale snapshot cannot exist |
| `writeQueue` promise chain | guarantees the last enqueued snapshot is the last to reach disk; an older flush can never resolve after a newer one |
| `lastQueuedContent` (sync) vs `lastWrittenContent` (post-await) | two overlapping flushes would both see the pre-write value and both proceed |
| `muteDepth` 0/1 refcount | `FileOpsManager` mutes are **refcounted**, so an unbalanced mute is not a glitch — it drops every vault `modify` for that canvas **forever** |
| `destroy()` calls `releaseMute()` | the settle timer it just cancelled was the only thing that would have released the mute — same leak class, teardown path |
| write failure rolls `lastQueuedContent` back | otherwise an identical later snapshot is deduplicated away and never retried |
| `onWritten` → `CanvasSync.noteExternalDiskWrite` | keeps the three-way-diff baseline fresh and the echo window open now that CanvasSync no longer writes the file |
| injected `isPathSafe` + `ensureFolder`, both **required** | the two guarantees the retired writer provided that a bare `adapter.write` does not |

The class imports no Obsidian runtime: I/O, scheduler and guards are all injected
([`PersistenceIO`](plugin/src/files/canvas-persistence.ts#L47),
[`PersistenceScheduler`](plugin/src/files/canvas-persistence.ts#L61),
[`PersistenceGuards`](plugin/src/files/canvas-persistence.ts#L420)), so the whole
writer is certifiable without a vault or real timers.

Its lifetime tracks the **subscription, not the open view** — deliberately. A
closed canvas still receives remote deltas, and persisting those is the writer's
entire reason to exist. Teardown happens in `teardownCanvasPresences()`
([main.ts:1408-1421](plugin/src/main.ts#L1408-L1421)), i.e. on session end and
plugin unload only.

## F. Canvas — the ownership seam

```text
vault "modify"
└── vault-events.ts:224
    ├── not a TFile / not shared / path muted ──────────────► drop
    ├── isTextFile? ── no ──► fileOpsManager.onFileModify (binary path)
    ├── backgroundSync.isRecentDiskWrite ── yes ──► drop (echo)
    ├── canvasOwned(path, canvasSync)?          (= .canvas && isSubscribed)
    │   ├── TRUE  → unless recentDiskWrite or useCanvasBinding:
    │   │             canvasSync.handleLocalModify(path)
    │   │           …then RETURN unconditionally — the text path is UNREACHABLE
    │   └── FALSE → warnCanvasTextFallback + backgroundSync.handleLocalTextModify
    └──               (the announced R10 raw-text fallback)
```

The unconditional `return` matters more than it looks. A naive `else` would route
both the disk-write echo *and* the flag-ON capture case into the text path — i.e.
re-create the two-writer race from inside the fix.

Transitions go through one helper so both call sites get identical ordering
([`subscribeCanvasWithHandover`](plugin/src/files/vault-events.ts#L101-L116)):

```text
backgroundSync.unsubscribe(path)   ← immediately preceding, SAME synchronous block:
                                     flushes the pending Y.Text write and detaches the
                                     observer, so the final text flush lands before
                                     CanvasSync's seed reads the file
canvasSync.subscribe(path, role)   ← adds to subscribedPaths BEFORE its first await,
                                     so there is no unowned window while in flight
├── owned  → main.ts attachCanvasWriter(path)
└── FAILED → warnCanvasTextFallback + backgroundSync.subscribe(path)
```

The fallback is **exclusive, never concurrent** — which is why it cannot reproduce
the interleaving corruption even though it does sync a canvas as character-merged
text. `BackgroundSync.subscribe()` is the single place that deliberately does not
consult `skipsAutoTextSync`: it is that door.

There are exactly two production call sites
([main.ts:834](plugin/src/main.ts#L834) session start,
[main.ts:995](plugin/src/main.ts#L995) lazy on-open) and a source-level test pins
that count.

## G. Presence and locks

```text
adapter patched signals ──► CanvasPresence.acquireLock / releaseLock
diff-inferred fallback  ──► onDiffInferredChange              (private API absent)
        │
        ▼
awareness.setLocalState({ canvasPath, nodeId, x, y, lockedNodes, identity })
        │  mux MUX_AWARENESS (encrypted variant under E2E)
        ▼
peers: reconcileClaims() → refresh()
       ├── pure gates      computeCanWriteNode / computeCanDeleteNode
       ├── loser-revert    lower clientID also holds → release + onRevert
       ├── cursors         canvas coords on the wire → each peer converts to its own screen space
       └── held ring       styled onto the real nodeEl (resolveHighlights carries no geometry)
```

Cursors travel in **canvas space**, not screen space, because peers have different
viewports; the receiving side converts with `canvasToScreenRel` using the
**linear** factor (`canvas.scale ?? 2 ** zoom`) — multiplying by `canvas.zoom`
would collapse at 100 % and mirror below it.

Every race-critical decision here is a pure function (`holdersOf`,
`computeCanWriteNode`, `computeCanDeleteNode`, `resolveHolder`, `resolveCursors`,
`resolveHighlights`, `computeRingDelta`) so it is deterministically testable with a
hand-built states map and no transport.

## H. Files, renames and binaries

The control channel path, for everything a CRDT is wrong for.

```text
local create/delete/rename/binary-modify ──► FileOpsManager ──► control channel
                                              ├── sendQueues per path (serialize)
                                              ├── offlineQueue when not online
                                              └── chunking >512 KB, ≤50 MB
remote op ──► applyRemoteOp ──► opQueues gate on ALL affected paths
                             ├── path safety on path/oldPath/newPath
                             ├── mute every affected path (refcounted)
                             └── unmute after 250 ms settle
```

Notable conceptual solutions in here:

- **Rename pairing by content hash, not iteration order.** Two concurrent renames
  arriving as `removed=[A,C], added=[D,B]` must map A→B and C→D by identity;
  positional pairing produces A→D and silently swaps two files' contents
  ([`matchRenamesByHash`](plugin/src/utils.ts#L140-L161), used at
  [main.ts:188-193](plugin/src/main.ts#L188-L193)).
- **Offline-queue op coalescing with a rename rewrite.** A pending `modify`
  rewritten onto a rename target would replay before the file exists and be
  silently dropped (file-ops only mutates existing files), losing the edit — so it
  is converted to a `create`
  ([offline-queue.ts](plugin/src/sync/offline-queue.ts)).
- **Chunk resume.** `chunk-end` with gaps sends `chunk-resume` listing received
  sequence numbers instead of failing the whole transfer.

<a id="chunk-pacing"></a>
- **Chunk pacing.** A >100-chunk file emitted in one synchronous burst trips the
  relay's own 100-msg/10 s limit, so the sender yields to the event loop every 32
  chunks ([file-ops.ts:511-525](plugin/src/files/file-ops.ts#L511-L525)). The relay
  side has a matching exemption, pinned by a test ("does not rate-limit chunked
  file-transfer frames").

---

# Part V — Threading and concurrency

**There are no threads.** Not one. Both halves of this system are single-threaded
event loops:

```text
Obsidian renderer   one JS event loop. Plugin code, CodeMirror, the canvas
                    controller, Yjs merges and every timer share it.
liveshare-relay     one Node event loop. Every client's frames are handled on it.
Crypto              WebCrypto (subtle.encrypt/decrypt/deriveKey) is async and may
                    run off-thread inside the runtime, but it re-enters as a
                    microtask like any other promise.
```

That does **not** make concurrency a non-issue — it relocates it. Nothing is
pre-empted mid-statement, so you never need a mutex; but every `await` is a
yield point at which arbitrary other code runs, and the entire bug history of this
project lives in those gaps. The discipline is therefore: **know which spans are
atomic, and know exactly what each await lets in.**

## V.1 Synchronous islands (atomic by construction)

Inside these, no interleaving is possible, so no guard is needed:

| Island | Extent |
|---|---|
| `doc.transact(fn)` | one Yjs transaction. Observers fire *after* it, `afterTransaction` exactly once. |
| A Yjs observer callback | runs to completion before the next one. |
| `applyRemote()` | `applyingRemote` is held for exactly this span and reset in `finally` — even on throw. |
| A monkey-patch wrapper | original call, then our callback, in one tick. |
| serialize-then-enqueue | `serializeCanvas(...)` followed immediately by `writeQueue.then(...)`, no await between. |
| `setActiveFile` / `setCollabBoundFile` | both assigned before any async activation begins. |
| `CanvasSync.subscribe`'s claim | `subscribedPaths.add(path)` before the first `await`. |

The last three are not incidental. They are the reason a *pending* subscribe
already counts as owned, and the reason a stale snapshot cannot reach disk.

## V.2 The await inventory — what each yield point admits

| Await | What can land during it | Mitigation |
|---|---|---|
| `waitForSync(docId)` (≤10 s) | user switches file, closes the canvas, ends the session, subscribe is cancelled | `activationGen`, `cancelledSubscribes`, `doc.isDestroyed`, `subscribedPaths` re-check ([canvas-sync.ts:381](plugin/src/files/canvas-sync.ts#L381)) |
| `vault.read(file)` before a diff | a remote delta into the CRDT | the three-way diff is base-relative, so an un-flushed remote record is untouched |
| `ensureFolder()` inside a write | a remote delta | `remoteSeq` gate **re-checked after** the await ([background-sync.ts:440](plugin/src/files/background-sync.ts#L440)) |
| `adapter.write()` | another flush of the same path | `writeQueue` serializes; `lastQueuedContent` deduplicates |
| `coldOpen()` inside `attachCanvasWriter` | session teardown | `if (!this.canvasSync) { persistence.destroy(); return; }` ([main.ts:1220](plugin/src/main.ts#L1220)) |
| `attachCanvasPersistence` (per path) | the *other* subscribe call site firing for the same path | `canvasWriterAttaching` set ([main.ts:1201](plugin/src/main.ts#L1201)) |
| E2E `encrypt`/`decrypt` | reordering of sends | `sendQueue` promise chain in `SyncManager.sendMux` ([sync.ts:667-675](plugin/src/sync/sync.ts#L667-L675)) |
| `vault.rename()` in a manifest replay | vault `create`/`delete` events for the same paths | `pendingRename` chain + `renamedPaths` set ([vault-events.ts:201-220](plugin/src/files/vault-events.ts#L201-L220)) |
| `trashFile`, `modify`, `createBinary` in `applyRemoteOp` | another op on an overlapping path | `opQueues`, gated on **all** affected paths at once ([file-ops.ts:137-159](plugin/src/files/file-ops.ts#L137-L159)) |
| the 100 ms poll loops (guest seed wait) | anything | bounded (20 × 100 ms, 10 × 100 ms) and re-checks its cancellation flags each iteration |

## V.3 Serialization devices (the "locks" of a single-threaded system)

Seven promise chains, each with a different scope. Knowing which one covers a path
is how you reason about ordering here.

```text
SyncManager.sendQueue           global, mux    ← keeps encrypted frames in order
BackgroundSync.writeQueue       global, text   ← last snapshot wins on disk
CanvasPersistence.writeQueue    per path       ← same, per canvas
FileOpsManager.opQueues         per path       ← remote op application
FileOpsManager.sendQueues       per path       ← outgoing op emission
plugin.manifestHandlerQueue     global         ← manifest change handling
vault-events pendingRename      global         ← rename vs create/delete/leaf-change
```

Two of them are worth a second look:

- `opQueues` chains on **every** path an op touches (`path`, `oldPath`, `newPath`)
  and installs the new promise for all of them *before* awaiting — otherwise a
  rename and a modify of the same file could interleave.
- `manifestHandlerQueue` exists because a manifest change handler is `async` and
  the manifest can change again while it runs; without the chain, two handlers
  would race on the same rename-pairing decision.

## V.4 Timer devices, and why each is shaped that way

| Device | Values | Purpose and shape |
|---|---|---|
| Trailing debounce **+ max-wait cap** | canvas 200/500, text 300/500 | a bare trailing debounce starves under a continuous remote stream — the timer resets forever. The cap forces a flush every ~500 ms since the *first* pending change. |
| Settle window | `VAULT_EVENT_SETTLE_MS = 250`, mirrored as `DISK_WRITE_SETTLE_MS` | how long our own write's echo is suppressed. Mechanical only. Mirrored (not imported) in `canvas-persistence` to keep that module free of the Obsidian-importing `utils`. |
| Drag watchdog | `DRAG_WATCHDOG_MS = 5000` | `isBusy()` is an **inactivity predicate**, not a flag read: a `setDragging(true)` whose `false` never arrives would otherwise disable reconciliation for the lifetime of the view. Measured against the last drag-related signal (`setDragging`, `markViewportChanged`, `pointermove`) — during a real drag those arrive continuously, so 5 s of silence is far outside any real drag. `dragTargetId` is **retained** after release, so the one card the user may still hold stays protected while whole-canvas reconcile becomes possible again. |
| Awareness keep-alive | tick 4 000, deadline 8 000, warn 20 000, prune 30 000 | deadline-driven, not periodic — see [Problem 7](#problem-7--the-clients-you-must-keep-alive-are-inside-a-browser). Also pulses on every inbound framed message. |
| Mux heartbeat | ping 15 000, pong deadline 10 000 | half-dead socket detection. If a pong deadline is already pending, no new ping is sent. |
| Control heartbeat | same values | also doubles as the latency readout in the status bar. |
| Reconnect backoff | mux `100 · 2^n` capped 30 s, 15 attempts; control `300 · 2^n` capped 30 s, 10 attempts | mux exhaustion ends the session; control exhaustion reports `disconnected` or `auth-required` depending on whether it ever connected. |
| Reclaim defer | `RECONNECT_RECLAIM_DEFER_MS = 250` | must exceed the resubscribe → peer-re-emit round trip so a node a peer grabbed during the outage is visible before we decide, yet stay well under a second. |
| Stale-transfer purge | 60 s interval, 5 min age | abandoned chunk assemblies. |
| Room cleanup / reaper | 30 s empty-room delay; hourly reap of 24 h-idle rooms | relay side. |

## V.5 Re-entrancy and echo guards

Every guard, its scope, and what it cannot see. The pattern is uniform and worth
stating plainly: **each guard is scoped to one subsystem, and none of them knows
another subsystem exists.** That is fine *now* only because ownership is decided
globally; it is exactly why adding another local guard could never have fixed the
two-writer defect.

| Guard | Location | Protects against | Blind to |
|---|---|---|---|
| `recentDiskWrites` | canvas-sync (via `noteExternalDiskWrite`), background-sync | our own write returning as a local edit | another subsystem's writes |
| `mutePathEvents` (refcounted) | file-ops registry, used by all writers | vault events from our own writes | unbalanced calls — a leak is permanent |
| `muteDepth` | canvas-persistence | overlapping flushes double-muting | — |
| `recentLocalEdits` | canvas-sync | our CRDT write firing our own observer | — |
| `remoteSeq` gate | background-sync (live), canvas-sync (retained, no caller) | a stale flush clobbering an in-flight remote delta | only counts its own doc's deltas |
| `lastWrittenContent` | all three writers | redundant identical writes | goes stale if another component writes the file — which is why `onWritten` exists |
| `lastQueuedContent` | canvas-persistence | two overlapping flushes both proceeding | — |
| echo breaker (semantic) | canvas-sync `handleLocalModify` | reconcile → save → push oscillation | structured doc only |
| `PROTECTED_KEYS` | canvas-sync, both delete paths | a partial disk read stripping structure | keys outside the set |
| dangling-edge prune | `buildCanvasData`, `pruneEdgesForDeletedNodes` | serializing an edge to a missing node | an edge that **lost** the key entirely (guard requires a `string`) |
| `activeFile` / `collabBoundFile` | background-sync | yCollab vs background double-write | unreachable for `.canvas` (a canvas leaf is not a `MarkdownView`) — harmless now that a canvas never gets a `Y.Text` doc |
| `isBusy()` defer | main.ts reconcile | reconciling mid-drag | — |
| `applyingRemote` (I2) | canvas-binding | apply → capture echo | flag ON only |
| origin demux (I4) | canvas-binding | our own capture re-entering | also ignores *all* `tr.local`, including the ungated host seed |
| `canvasOwned` | vault-events | two CRDTs per path | — (this is the global decision) |

## V.6 Ordering contracts

Statements whose *order* is the correctness argument. Reordering any of these
reintroduces a closed defect.

```text
1  coldOpen()  BEFORE  start()                       else the seed races its own persist
2  backgroundSync.unsubscribe  IMMEDIATELY BEFORE  canvasSync.subscribe, same sync block
                                                     else the final text flush lands after
                                                     CanvasSync's seed read
3  subscribedPaths.add  BEFORE  the first await      else an unowned window exists
4  remoteSeq++  BEFORE  the active/collab gate returns
                                                     else a queued flush for the active file
                                                     can clobber a remote delta
5  onReconnectCallback  BEFORE  the awareness clock tick
                                                     else the re-emit blind-reasserts stale
                                                     locks and splits ownership
6  serialize  IMMEDIATELY BEFORE  enqueue            else a stale snapshot exists and a
                                                     sequence gate becomes necessary again
7  nodes applied BEFORE edges in applyRemote          an edge may reference a new node
8  mute  BEFORE  a live-view mutation; unmute after the settle window
```

## V.7 Cancellation and lifecycle tokens

Because awaits are long and users are fast, six different cancellation mechanisms
exist. They are not redundant; each covers a different lifetime.

```text
activationGen           monotonic counter   ← editor activation superseded
cancelledSubscribes     per-path set        ← a text subscribe cancelled by a rename
canvasWriterAttaching   per-path set        ← the second subscribe site racing a writer attach
destroyed / isDestroyed boolean             ← CanvasBinding, CanvasPersistence, SyncManager
doc.isDestroyed         Yjs                 ← the doc was released mid-await
renamedPaths            per-path set        ← create/delete events belonging to a rename
```

## V.8 Concurrency on the relay

The relay's single loop makes its own guarantees trivial and its responsibilities
small:

- Fan-out is a synchronous `for` over `state.clients` with a `safeSend` that
  checks `readyState` and swallows send failures on a closing socket.
- Read-only enforcement **peeks** the sync message type and drops only `STEP2`
  and `UPDATE` ([ws-handler.ts:164-170](server/src/ws-handler.ts#L164-L170)), so a
  read-only client can still *request* state.
- Awareness clocks are tracked per awareness `clientID` so a disconnect can
  synthesize a **valid** removal update: `applyAwarenessUpdate` ignores a removal
  whose clock is not strictly greater, and without the `lastClock + 1` the
  departed peer's caret freezes on every screen forever
  ([ws-handler.ts:229-246](server/src/ws-handler.ts#L229-L246)).
- Per-client rate limit: 100 messages / 10 s sliding window, plus an
  `ALLOWED_TYPES` allowlist and a cap of 10 unknown-type warnings.
- Room state is dropped 30 s after the last client leaves — the delay is what lets
  a reconnect land in the same room.

## V.9 The concurrency failure modes that are *not* defended

Stated explicitly so nobody assumes otherwise:

- **No causal ordering between documents.** The manifest doc, a file's `Y.Text` and
  a canvas doc are independent replicas. "Manifest says the file exists" and "the
  file's doc has content" can arrive in either order; every consumer that cares
  polls or re-checks.
- **No transactional grouping across the two channels.** A control-channel rename
  and a mux-channel delta for the same file are not ordered relative to each other.
- **No exactly-once for file ops.** They are idempotent by construction (create
  degrades to modify, delete tolerates a missing file, rename tolerates a
  pre-existing target) rather than deduplicated.
- **No lock epoch.** `LockEntry.epoch` exists in the shape but is unused; the
  accepted residual risk is bounded LWW on a node whose lock changed hands during
  an in-flight write ([canvas-presence.ts:29-32](plugin/src/canvas/canvas-presence.ts#L29-L32)).

---

# Part VI — Trust boundaries

```text
┌ Obsidian process ────────────────────────────────────────────────────────────┐
│ trusts: the local vault, the user                                            │
│ validates: EVERY peer-supplied path (isPathSafe) before any write             │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │  ① SERVER_PASSWORD  ② room token  ③ optional JWT
┌ NPM / NA gate ───────────┴───────────────────────────────────────────────────┐
│ gates "/" with OIDC forward-auth (the credential landing page)               │
│ does NOT gate /ws-mux/, /control/, /rooms, /healthz  → protocol runs past it │
└──────────────────────────┬───────────────────────────────────────────────────┘
┌ relay ───────────────────┴───────────────────────────────────────────────────┐
│ trusts: nothing about content. Authoritative ONLY for: room token, read-only │
│ enforcement, host election, rate limiting, kick state                        │
│ sees: document ids (= vault paths), frame sizes, timing — always in clear     │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Authentication, three independent layers

1. **`SERVER_PASSWORD`** — one shared secret for the whole relay. Checked as a
   query parameter on every WS upgrade and as `X-Server-Password` on `/rooms`
   ([index.ts:43-52](server/src/index.ts#L43-L52),
   [:103-112](server/src/index.ts#L103-L112)). Charset is restricted to
   URL-unreserved characters because it rides a WS query string *and* lives in a
   `.env`. Rotation, not per-user revocation.
2. **Room token** — `nanoid(24)`, compared via HMAC-SHA256 + `timingSafeEqual`
   ([util.ts](server/src/util.ts)) so comparison time leaks nothing.
3. **JWT (optional)** — GitHub OAuth → HS256, 7-day expiry. Disabled entirely
   unless `JWT_SECRET` is set, and `verifyJWT` returns `null` rather than trusting
   the default ([github-auth.ts:44-52](server/src/github-auth.ts#L44-L52)).
   `REQUIRE_GITHUB_AUTH=true` makes it mandatory at upgrade.

## End-to-end encryption — what it actually covers

This is worth stating precisely because the deployment notes are more pessimistic
than the code.

- A host-started session **generates a passphrase automatically**
  (`generatePassphrase()`, 16 random bytes) and a random 16-byte salt, and ships
  both in the invite ([session.ts:59-60](plugin/src/session/session.ts#L59-L60)).
  So **E2E is on by default** for sessions started by this build.
- KDF: PBKDF2-SHA256, 100 000 iterations → AES-GCM-256. A 12-byte random IV is
  prefixed to every ciphertext. A legacy deterministic salt path remains only so
  pre-random-salt invites still decrypt.
- **Covered:** mux `MUX_SYNC` and `MUX_AWARENESS` payloads (so document deltas,
  cursors *and* canvas locks), and on the control channel the `file-op` /
  `file-chunk-*` message bodies including their `path` fields.
- **Not covered:** the mux frame's `docId` — which *is* the vault path — and all
  other control messages (presence, join/approval, permissions, summon, host
  transfer, ping). Frame sizes and timing are always visible.
- Decryption failure **drops the message silently and never falls back to
  plaintext** ([sync.ts:612-644](plugin/src/sync/sync.ts#L612-L644)). Receiving
  encrypted data without a key also drops rather than corrupting.

> **Discrepancy to resolve:** the workspace deployment note
> ([CONTEXT.md](../CONTEXT.md)) states that the live Yjs stream, cursors and
> presence are "plaintext to the relay; only bulk file transfers are E2E-encrypted".
> Against this fork's source that is too pessimistic for content and too optimistic
> about metadata: content deltas and awareness *are* encrypted when a passphrase is
> set (the default), while document ids — i.e. **file paths** — are not. Neither
> document has been reconciled; the code is the reference.

## Permission model

```text
authoritative   server, per Yjs frame:  ws-handler.isPathReadOnlyForClient
                ├── room.defaultPermission === "read-only"  → deny all non-host writes
                ├── room.readOnlyPatterns (minimatch, ≤50 patterns, ≤200 chars each)
                └── room.hostUserId is always exempt
                    per-user overrides in permissions.ts, pushed live via
                    control → onPermissionChange → yjs.updatePermission

defense-in-depth  client:  canWriteCanvasPath (main.ts), CanvasSync.setCanWrite,
                           CanvasBinding.canWrite, EditorState.readOnly for CM6
                           → stops a read-only client diverging locally; not security

advisory          per-node canvas locks (awareness). UX for concurrent intent.
```

## Path safety

One predicate, applied at every funnel where a peer-supplied string could become a
filesystem path: `isPathSafe` rejects anything absolute or containing a `.` or
`..` segment ([utils.ts:46-50](plugin/src/utils.ts#L46-L50)). Enforced in
`CanvasSync.subscribe`, `BackgroundSync.subscribe`, `writeToDisk` (both),
`createVaultPersistenceIO.write`, `syncFromManifest`, `applyRemoteOpInner` (on
`path`, `oldPath` **and** `newPath`), and the manifest rename replay.

Cross-platform paths are handled by a canonical/local split: ASCII on the wire,
fullwidth Unicode substitution for Windows-forbidden characters at the filesystem
boundary (`toLocalPath` / `toCanonicalPath`,
[utils.ts:24-32](plugin/src/utils.ts#L24-L32)).

Other relay-side input validation: room names ≤100 chars and control-character
free, `hostUserId` ≤128, `maxPayload` 10 MB on the mux socket, 50 MB file cap,
REST rate limits 30/min on `/rooms` and 10/min on `/auth`.

---

# Part VII — Observability

`DebugLogger` is a 500-entry ring buffer plus an optional file sink gated on the
`debugLogging` setting; `LogView` renders the buffer as a live status console.
Entries are prose strings, so they cannot be correlated to individual CRDT
operations — structured per-hop tracing does not exist.

**Ten fixed uppercase signatures**, one per failure mode, stable across releases.
Grep a user-supplied log dump for these before reading any code. Full table in
[Appendix C](#appendix-c--log-signature-reference).

Two caveats before concluding "the signature never fired":

- A logger must be **attached**. `SyncManager` and the canvas adapter both measure
  regardless but report only after `setLogger` / `createCanvasAdapter(view,
  { logger })`. Both are wired in `main.ts`
  ([:341](plugin/src/main.ts#L341), [:1240](plugin/src/main.ts#L1240)) — a file
  with no test coverage. If either wiring is wrong, three of the ten signatures
  are silently suppressed.
- `CanvasAdapterLogger` declares `log(...)` while `DebugLogger`,
  `CanvasSyncLogger` and `SyncLogger` expose `debug(...)`. The two names are
  bridged at the call site, not unified.

Relay-side observability: `GET /healthz` reports uptime, sessions, documents and
client count; `GET /rooms/:id/logs` returns the per-room audit log (token-gated,
≤500 entries).

---

# Part VIII — Testing architecture

```text
plugin   35 test files / 674 tests   green in 40.8 s   (verified 2026-07-29)
relay    10 test files / 122 tests   green in 19.6 s
```

One case deliberately sleeps 33 s ("static caret and idle lock survive a >30 s
idle window") — that is the awareness prune window being tested for real, not a
hang.

The suite's shape follows the invariants:

| Layer | How it is tested | Why it can be |
|---|---|---|
| Pure decision functions | direct unit tests | `planReconcile`, `computeCanWriteNode`, `computeRingDelta`, `holdersOf`, `matchRenamesByHash` have no clock, DOM or Obsidian import |
| Headless subsystems | injected seams | `CanvasPersistence` takes `PersistenceIO` + `PersistenceScheduler` + `PersistenceGuards`; `CanvasBinding` takes a `CanvasModelBridge` |
| The private canvas API | `canvas-double.ts` + `interaction-driver.ts` | a fake `view.canvas` the real adapter patches, so adapter logic is exercised without Obsidian |
| Two-peer convergence | `harness/two-peer.ts` (`makeTwoPeer`) | `waitQuiescent` snapshots **both** state vectors before applying either, so true concurrency is modelled rather than serialized |
| Latency behaviour | `wp5/harness.ts` | injects a 50–150 ms RTT; covers join races, reconnect, tiebreak, prune window |
| Composition | `canvas-single-writer.test.ts` (841 L) | the headline proof: both subsystems, one path, two peers |
| Adversarial probes | `w4-canvas-integrity.test.ts` (1771 L, 50 tests) | includes **discrimination** cases that remove a guard and assert the failure returns |
| Obsidian API | `__mocks__/obsidian.ts`, aliased in `vitest.config.ts` | — |

The discrimination pattern is the most valuable habit in this suite: `A9`
("with `fromNode` removed from the live guard, A1's scenario LOSES the endpoint")
proves the test would fail if the fix were reverted. A green test that would stay
green without the fix is worth nothing, and the historical two-writer defect
survived 526 green tests precisely because **no test instantiated both subsystems
against the same path** — the bug was in their composition, and nothing tested
composition.

**Not covered:** `main.ts` (1689 lines, all the wiring) has no test file; it is
verified only by `tsc` and the build. And nothing in this system has been verified
behaviourally in a real vault — see [Part IX](#part-ix--risk-register).

Live rig, built and never executed: `tools/launch_liveshare_e2e.py` boots two
plugin hosts against one local relay (ports 39421/39422), driven by the flag-gated
control server in `plugin/src/testing/e2e-control.ts`. `__LS_E2E__` is folded to
`false` by the production esbuild build, so the whole `testing/` module is
dead-code-eliminated from `main.js`.

---

# Part IX — Risk register

Ordered by consequence. Every entry is a verified state of the tree, not a
speculation.

**R1 — `useCanvasBinding` must stay OFF.** With the flag ON, edge capture emits
`{ id }` with no endpoints
([canvas-model-bridge.ts:216-221](plugin/src/canvas/canvas-model-bridge.ts#L216-L221))
and `writeRecordMinimal` deletes every doc key absent from the incoming record
([canvas-binding.ts:135-140](plugin/src/canvas/canvas-binding.ts#L135-L140)).
Capturing `{id}` over an existing doc edge therefore **deletes `fromNode`/`toNode`
in the CRDT**, propagates to all peers, and reaches disk endpoint-less — the
dangling-edge guard requires a `string`, so a *missing* key passes it. Default is
`false` ([types.ts:65](plugin/src/types.ts#L65)). Do not enable it on a canvas you
care about.

**R2 — nothing has been verified behaviourally.** No two-vault E2E run, no
real-vault spike, no install, through the main round and two rework cycles. All
674 + 122 tests are headless. In particular `CAPTURE_TRIGGERS`
([canvas-model-bridge.ts:88-91](plugin/src/canvas/canvas-model-bridge.ts#L88-L91))
is *inferred* from the adapter's two patched signals and has never been confirmed
against a live Obsidian canvas for: single move, each resize handle, multi-select
drag, paste, text-node content edit, node add/delete, edge add/delete.

**R3 — `main.ts` has no test file.** 1689 lines, five agents' wiring, including
both logger attachments and the `attachCanvasWriter` seam. Verified by `tsc` and
the build only.

**R4 — destructive host re-seed.** `applyCanvasToYMaps`
([canvas-sync.ts:776-808](plugin/src/files/canvas-sync.ts#L776-L808)) **deletes**
doc entries absent from the host's local file. On a host rejoin whose local file
is older than the shared doc, that discards peers' work. `coldOpen`'s doc-wins
branch does not behave this way, which is exactly why the host branch was not
replaced by it — substituting one for the other would silently change rejoin
semantics.

**R5 — two unguarded `getDoc(bare path)` call sites.**
`background-sync.ts:173` (inside `setActiveFile`, flushing the previously active
path) and `collab.ts:62` (the CM6 binding). Neither inspects the extension.
`collab.ts` is unreachable for a canvas today *only* because `main.ts` gates on
`getActiveViewOfType(MarkdownView)` — an argument from reachability in an untested
file, not a guard.

**R6 — orphaned `Y.Text` after a fallback→owned handover.** If a canvas entered
the R10 text fallback and later becomes canvas-owned, the `Y.Text` doc created by
the fallback is not released. Recorded as P2-2.

**R7 — no lock epoch.** `LockEntry.epoch` is declared and unused; bounded-LWW on a
node whose lock changed hands mid-write is an accepted risk.

**R8 — dead code retained by design.** `CanvasSync.writeToDisk` and its
`remoteSeq` gate have no caller (permitted, keeps a WP4 test green). Retention is
deliberate but means the file reads as if `CanvasSync` still writes canvases.

**R9 — release hygiene.** Root `manifest.json` and `plugin/package.json` say
**0.6.1**; `workflowArtifacts/canvas-integrity/HANDOVER.md` asserts "0.6.0
unchanged" in three abort-criteria blocks. Also `plugin/manifest.json` is a
55-byte **broken symlink** to a POSIX absolute path (`/home/mewski/...`) — the real
manifest is the repo-root one. Do not read or edit the symlink.

**R10 — committed build output.** `plugin/main.js` (626 KB) and `server/dist/` are
committed artifacts. Never hand-edit; rebuild.

---

# Appendix A — Edge-case catalogue

Format: **situation → what happens → mechanism**. Where the outcome is a known
gap it says so.

## A.1 Canvas cold start and empty documents

1. **First peer opens a canvas, shared doc empty, file has content** → file is
   parsed once and seeds the doc under `CANVAS_SEED_ORIGIN`; `coldOpen` returns
   `"seeded-from-file"`. Geometry keys are protected even on this one read, so a
   partial read cannot seed a node without `x`/`y`.
2. **Peer joins a room where the canvas doc already has content** → `"doc-wins"`:
   the file is **never read** and is immediately overwritten from the doc. The
   guest's local file, however stale, cannot contaminate shared state.
3. **Doc empty and file missing or empty** → `"empty"`, nothing written, no
   observer noise.
4. **Guest already had the canvas OPEN when the CRDT synced** → the doc observer
   never fires for the seed, so a one-shot authoritative reconcile runs at
   subscribe for guests only ([canvas-sync.ts:459-465](plugin/src/files/canvas-sync.ts#L459-L465)).
5. **Canvas opened *after* the CRDT synced** → `mountCanvasPresence` forces one
   `initial` reconcile from `getCanvasSnapshot`.
6. **`getCanvasSnapshot` on an empty shared doc** → returns `null`, and every
   caller treats `null` as "do nothing". A local view is never wiped by an empty
   room.
7. **Canvas created mid-session** → lazily subscribed by `syncCanvasPresences` on
   the next `layout-change`/`active-leaf-change`; exactly one owner and one writer
   result (pinned by probe K6).
8. **A `.canvas` in the manifest that is not shared / excluded** → never
   subscribed, never written; it simply is not part of the session.

## A.2 Canvas concurrent editing

9. **Two peers move two different cards** → both survive. `Y.Map` resolves per key
   and the two records are different keys.
10. **Two peers move the SAME card** → the advisory lock decides: lowest
    `clientID` wins, the loser releases, reverts its view to shared truth and logs
    `LOCK REVERT:`.
11. **Peer A deletes a node while peer B edits it** → delete wins, no resurrect,
    for nodes *and* edges. B's presence layer drops the lock via
    `onRemoteNodeDeleted`.
12. **A node is deleted, leaving edges behind** → cascade-pruned in the CRDT
    (`pruneEdgesForDeletedNodes`) *and* filtered at serialization
    (`buildCanvasData`). Two independent nets.
13. **An edge is re-routed away from a node another peer holds locked** → denied:
    the endpoint check runs across both the intended and the previous record.
14. **A local write is denied** → the diff baseline is **held**, so the rejected
    edit stays visible to the next three-way diff and is retried; the next
    remote-driven disk write rolls the local file back to shared truth.
15. **A stale/partial disk read omits `fromNode`** → `PROTECTED_KEYS` refuses the
    delete; the CRDT value survives.
16. **An edge that genuinely lost `fromNode` reaches the CRDT** → **known gap**:
    the dangling-edge guard requires a `string`, so a *missing* key passes it and
    the edge reaches disk endpoint-less. `NO TYPE`/`DETACH` telemetry may fire; no
    repair exists.
17. **A node loses its `type`** → Obsidian's `importData` silently drops that node
    **and every edge attached to it**. `type` is in `PROTECTED_KEYS` and a
    `NO TYPE signature:` warn is emitted at audit. Detection only.
18. **A `type: "file"` node loses its `file`** → same class, same signature,
    detection only.
19. **Reconcile lands while the user is dragging** → deferred wholesale via
    `isBusy()`; the next delta catches the view up.
20. **A single node is mid-drag during a per-node geometry apply** → that node
    returns `"interacting"` and is skipped; the shadow is deliberately **not**
    advanced, so the next delta still sees a difference.
21. **`setDragging(true)` whose matching `false` never arrives** → the watchdog
    releases the flag after 5 s of drag-signal silence, logs `DRAG WATCHDOG:`, and
    keeps protecting the one retained `dragTargetId`.
22. **A remote change to `text`/`color`/`fromSide`/`label`** → classified
    `structural` against the shadow and applied by a full reload. Before the
    shadow existed this change never reached an open view and was actively
    reverted.
23. **A connected card moves** → per-node geometry, then one escalated
    `reloadCanvasData` so arrows re-route.
24. **A record arrives without a usable `id`** → `indexById` returns `null` and the
    plan falls back to `structural` rather than guessing.

## A.3 Canvas view and writer lifecycle

25. **The canvas view is closed while remote deltas keep arriving** → presence,
    adapter, shadow, binding and bridge are torn down; the **writer is not**. Its
    lifetime is the subscription, so a closed canvas still persists correctly.
26. **Both subscribe call sites fire for the same path** → `canvasWriterAttaching`
    prevents a second writer; `CanvasSync.subscribe` early-returns on an already
    subscribed path.
27. **Session teardown races an awaited `coldOpen`** → the attach sees
    `canvasSync === null` and destroys the half-built writer.
28. **`destroy()` while a settle window is open** → `releaseMute()` runs
    explicitly. Skipping it would leak the refcount and drop **every** future
    vault `modify` for that canvas.
29. **A disk write fails** → `lastQueuedContent` rolls back so an identical later
    snapshot is retried rather than deduplicated away; a `CANVAS WRITER: … write
    FAILED` warn is emitted.
30. **Two adapters mount over the same `view.canvas`** (remount, duplicate leaf) →
    the newest **adopts** the patch via `__lsOriginal`; no wrapper stacking, no
    double invocation, and `ADAPTER PATCH: … =adopted` names it in the log.
31. **The private canvas API is absent or changed** → `isAvailable()` false,
    reconcile is skipped (the file write suffices), locks fall back to
    diff-inferred acquisition, `availabilityReport()` names the missing member.
32. **`CanvasSync.subscribe` fails** (no doc, or `waitForSync` timed out) → the
    path is released from `subscribedPaths` and the **announced** raw-text fallback
    is installed, with `CANVAS TEXT FALLBACK:` logged once per path per session.

## A.4 Locks

33. **A lock holder crashes or the process dies** → awareness auto-clears on
    disconnect; the lock evaporates. It cannot strand.
34. **A holder's window is occluded for a minute** → the deadline-driven pulse
    (plus a pulse on any inbound frame) keeps the state inside the 30 s prune
    window; an approach to that limit is logged as `AWARENESS GAP:`.
35. **A holder reconnects after an outage** → it **withholds all locks
    immediately**, broadcasts a lock-free state, waits 250 ms for peers' awareness
    to re-sync, then re-claims **only still-free** nodes. A node a peer took during
    the outage stays with that peer.
36. **Reconnect ordering** → `onReconnect` fires before the awareness clock tick,
    so the re-emit carries no locks. Reversed, the tick would blind-reassert stale
    locks and split ownership.
37. **Two peers claim one node within one RTT** → deterministic lowest-`clientID`
    tiebreak; pinned as stable across repeated runs.
38. **No presence is mounted for a path** (canvas closed) → the lock gates default
    to *allow*, so nothing is blocked by an absent overlay.
39. **A lock changes hands during an in-flight write** → **known gap** (R7):
    bounded LWW; the epoch field exists but is unused.

## A.5 Text and the editor

40. **The user switches files during a 10 s `waitForSync`** → the stale activation
    is discarded by `activationGen`; no extension is dispatched into the wrong
    view.
41. **A disk-only edit to the active file** (Properties UI writing frontmatter) →
    `BackgroundSync` is barred by both `activeFile` and `collabBoundFile`, set
    synchronously. Only yCollab writes it.
42. **A guest opens a file whose `Y.Text` is still empty** → polls 10 × 100 ms for
    the host seed before binding, re-checking generation and view destruction each
    iteration.
43. **The host activates a file whose `Y.Text` is non-empty** → does **not**
    re-seed. Force-seeding on every activation would clobber concurrent guest
    edits whenever the CM6 doc is momentarily stale.
44. **A diff boundary falls inside a surrogate pair** → both boundaries are snapped
    off the whole code point, so an emoji is never split into lone halves.
45. **A remote delta arrives mid-flush** → the sequence gate yields; the observer
    that integrated the delta scheduled its own flush of newer content.
46. **Focus changes away from a file with pending edits** → `setActiveFile` flushes
    the previous path's `Y.Text` to disk immediately (with the sequence gate).

## A.6 Files, renames, binaries

47. **Two concurrent renames** → paired by content hash, not iteration order, so
    contents follow identity.
48. **A rename interleaved with create/delete events for the same paths** →
    serialized by the `pendingRename` chain; `renamedPaths` suppresses the
    create/delete halves.
49. **A remote rename whose source file has not landed yet** → one 300 ms retry,
    then tolerated: if the target already exists and the source does not, the op
    is a no-op.
50. **A chunked transfer loses chunks** → `chunk-end` with gaps triggers
    `chunk-resume` carrying the received sequence numbers; only the missing chunks
    are resent. Without a `transferId` (older peers) the transfer is dropped with a
    notice.
51. **A >100-chunk file** → the sender yields every 32 chunks so it does not
    self-trip the relay's rate limit; the relay exempts chunk frames.
52. **A file over 50 MB** → refused on both sides with a notice.
53. **An abandoned transfer** → purged after 5 minutes by a 60 s sweep.
54. **Ops produced while offline** → queued and coalesced; a pending `modify`
    rewritten onto a rename target becomes a `create` so the content survives any
    replay order.
55. **A peer supplies a path containing `..`** → rejected at every write funnel by
    `isPathSafe`.
56. **A Windows-forbidden character in a shared path** → substituted to fullwidth
    at the filesystem boundary only; the wire stays canonical ASCII.

## A.7 Connection and session

57. **Half-dead socket (Wi-Fi drop, no FIN)** → application-level ping with a 10 s
    pong deadline force-closes it; the existing backoff reconnects.
58. **Mux reconnect exhaustion** (15 attempts) → the session ends with a notice.
    Control exhaustion (10) reports `disconnected`, or `auth-required` if it never
    connected once.
59. **Reconnect reuses the same doc and awareness** → the `clientID` is preserved,
    so no ghost duplicate identity appears in the participant list.
60. **A late joiner and a static, never-moved caret** → `MUX_SUBSCRIBED`'s
    `peerCount` and the relayed `MUX_SYNC_REQUEST` both trigger a full local
    awareness re-emit. "No recent movement" is never treated as "nothing to send".
61. **A peer disconnects** → the relay synthesizes an awareness removal at
    `lastClock + 1`; without that strictly-greater clock the departed caret would
    freeze on every screen permanently.
62. **The last client leaves a room** → relay state is dropped 30 s later, so a
    quick reconnect lands in the same room. Room metadata expires after 24 h.
63. **The relay restarts** → all documents are gone (nothing is persisted);
    room metadata survives in LevelDB. Clients reconnect and re-seed from their
    vaults.
64. **Auth expires mid-session** → control reports `auth-required`, a notice is
    shown and the session ends.

## A.8 Roles and permission

65. **A guest reconnects and finds another host** → `demoteToGuest()`: restarts
    background sync as guest, cleans stale files, re-syncs from the manifest.
66. **A read-only guest edits anyway** → the client guard drops the write locally
    *and* the relay drops `STEP2`/`UPDATE` frames for that path. Two layers, the
    server one authoritative.
67. **A per-path read-only pattern** → enforced server-side by minimatch, host
    exempt, and mirrored client-side into the CM6 `readOnly` extension and both
    canvas write gates.
68. **A permission change mid-session** → pushed over the control channel and
    applied to live mux room membership via `updatePermission`.
69. **A kicked user rejoins** → must be re-approved by the host even when
    `requireApproval` is false (relay tracks kicked ids per room).

---

# Appendix B — Constants and tunables

| Constant | Value | Location |
|---|---|---|
| `DEBOUNCE_MS` / `MAX_WAIT_MS` (canvas) | 200 / 500 | canvas-sync.ts:20-21, imported by canvas-persistence |
| `DEBOUNCE_MS` / `MAX_WAIT_MS` (text) | 300 / 500 | background-sync.ts:22-25 |
| `VAULT_EVENT_SETTLE_MS` | 250 | utils.ts:3 |
| `DISK_WRITE_SETTLE_MS` | 250 (deliberate mirror) | canvas-persistence.ts:39 |
| `GEOMETRY_KEYS` | `{x, y, width, height}` — membership frozen by test | canvas-sync.ts:29 |
| `PROTECTED_KEYS` | geometry ∪ `{type, fromNode, toNode, fromSide, toSide}` | canvas-sync.ts:53 |
| `RECONCILE_GEOMETRY_KEYS` | private mirror of geometry; drift guarded by a test | reconcile-plan.ts:56 |
| `DRAG_WATCHDOG_MS` | 5 000 | canvas-adapter.ts:260 |
| `RECONNECT_RECLAIM_DEFER_MS` | 250 | canvas-presence.ts:24 |
| awareness tick / deadline / warn / prune | 4 000 / 8 000 / 20 000 / 30 000 | sync.ts:57-72 |
| `AWARENESS_HEARTBEAT_INTERVAL_MS` | 12 000 — a **bound**, not a period | sync.ts:68 |
| mux heartbeat / pong deadline | 15 000 / 10 000 | sync.ts:31-32 |
| mux reconnect | base 100, cap 30 000, max 15 | sync.ts:26-28 |
| control reconnect / ping | base 300, cap 30 000, max 10; ping 15 000 | control-ws.ts:16-20 |
| `CHUNK_SIZE` / `MAX_FILE_SIZE` / pacing | 512 KB / 50 MB / every 32 chunks | file-ops.ts:17-22 |
| `STALE_TRANSFER_MS` | 5 min, swept every 60 s | file-ops.ts:24 |
| control rate limit | 100 msgs / 10 s per client | control-handler.ts:43-44 |
| mux `maxPayload` | 10 MB | ws-handler.ts:66 |
| room lifetime / touch debounce / reaper | 24 h / 5 s / hourly | rooms.ts:12-13, index.ts:168 |
| empty-room cleanup delay | 30 s | ws-handler.ts:98-103 |
| PBKDF2 / AES-GCM | 100 000 iterations, SHA-256 → AES-256-GCM, 16 B salt, 12 B IV | crypto.ts |
| JWT | HS256, 7 days, disabled without `JWT_SECRET` | github-auth.ts |
| `useCanvasBinding` | **false** (R1 rollout blocker) | types.ts:65 |
| `showCanvasCursors` / `showCanvasPresence` | true / true | types.ts:63-64 |

---

# Appendix C — Log signature reference

| Signature | What it proves | Emitter |
|---|---|---|
| `SCATTER signature:` | nodes reached the audit with no geometry | canvas-sync.ts (`auditCanvasState`) |
| `DETACH signature:` | edges were pruned because an endpoint was absent | canvas-sync.ts (`auditCanvasState`) |
| `NO TYPE signature:` | a live node lost its `type`, or a `file` node lost its `file` — every peer would silently drop that node **and all its edges** | canvas-sync.ts (`auditCanvasState`) |
| `LOCK DENIED:` | a local write was rejected by the lock seam and the diff baseline was deliberately held | canvas-sync.ts |
| `LOCK REVERT:` | the loser-revert actually ran; names the winning clientID | main.ts (`revertCanvasNode`) |
| `AWARENESS GAP:` | a keep-alive gap approached the 30 s prune window, so peers may have pruned this client — and its locks | sync.ts |
| `DRAG WATCHDOG:` | `isDragging` latched and was force-released; reconciliation had been silently off until then | canvas-adapter.ts |
| `ADAPTER PATCH:` | per-method mount outcome: `installed` / `adopted` / `unavailable`. `adopted` = this canvas was already owned by another adapter | canvas-adapter.ts |
| `CANVAS TEXT FALLBACK:` | a canvas is syncing as raw text because `CanvasSync` does not own it. Once per path per session | vault-events.ts |
| `CANVAS WRITER:` | which component wrote the file, on every canvas disk write, plus attach with its `coldOpen` result | canvas-persistence.ts, main.ts |

One-line audit that every signature still has a production emitter:

```sh
grep -rnE "SCATTER signature:|DETACH signature:|NO TYPE signature:|LOCK DENIED:|LOCK REVERT:|AWARENESS GAP:|DRAG WATCHDOG:|ADAPTER PATCH:|CANVAS TEXT FALLBACK:|CANVAS WRITER:" plugin/src --include=*.ts | grep -v __tests__
```

---

# Appendix D — Invariant index

| # | Invariant | Enforced by | Falsified by |
|---|---|---|---|
| I1 | one CRDT owner per `.canvas` | `canvasOwned` + the unconditional `return`; `skipsAutoTextSync` in its four consumers | a fifth automatic `getDoc(barePath)` caller |
| I2 | one disk writer per file | `CanvasPersistence` sole canvas writer; `activeFile`/`collabBoundFile` for text | reviving `CanvasSync.writeToDisk` or a second `adapter.write` |
| I3 | the CRDT is truth | `coldOpen` doc-wins; file is not an input after `start()` | reading the file on any event while owned |
| I4 | no self-loopback | `applyingRemote`, `CANVAS_BINDING_ORIGIN`, `recentLocalEdits`, `tr.local` | replacing a synchronous flag with a time window |
| I5 | degrade, never break | `isAvailable()` gates, diff-inferred locks, try/catch around every private access | throwing out of a patched canvas method |
| — | no dangling edge on disk | `buildCanvasData` + cascade prune | an edge missing the key entirely (open gap, A.2/16) |
| — | structural keys are undeletable by merge | `PROTECTED_KEYS` on both delete paths | narrowing the set |
| — | a lock cannot strand | locks live in awareness, not the document | moving `lockedNodes` into the doc |
| — | the last snapshot wins on disk | serialize-then-enqueue + `writeQueue` + `lastQueuedContent` | inserting an `await` between serialize and enqueue |
