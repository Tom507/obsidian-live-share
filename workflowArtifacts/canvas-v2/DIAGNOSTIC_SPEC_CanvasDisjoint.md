# DIAGNOSTIC SPEC — the board that disjoints on every click (`S188`)

**Batch B67 · Worker 2 (Architect) · 2026-08-08.** Design only. A Worker 3 builds it from here.

> **THE TEST MANDATE IS SUSPENDED FOR THIS PACKAGE BY THE OWNER.**
> *"build every possible measurement and feedback we could use, but build it simple, no testing, just define
> it with an architecture agent and send a w3 to build it, no testing for this."*
>
> There is **no test plan in this document, no break table, no falsifiability plant and no blind set**, and no
> acceptance criterion below requires a test to prove. Nothing here should be read as licence to weaken an
> **existing** assertion — see §0.3.

---

## 0. The whole design in one page

### 0.1 What we are chasing

The owner: *"each click I do on client 1 moves the nodes on client 2 around … it is already disjointed after
the first real click … before this session this was not the case, or at least there was some restoring force
that counteracted it, instead of the error accumulating hugely with every click."*

Error that **grows per click** is a feedback loop: a delta applied against a wrong baseline, re-broadcast as
the new truth. So the instrument has to answer exactly one question per node per click:

> **Who moved it, in which of the three planes, and did that move then become the new truth?**

### 0.2 The one mechanism — three planes, one ring buffer, one command

Every canvas record exists in **three planes** on **three peers**. A disjoint board is a disagreement among
those nine cells.

```text
        ┌── VIEW  ← Obsidian's live canvas   (adapter.getNodeGeometry)
node ───┼── DOC   ← the shared Y.Doc          (canvasSync.getCanvasSnapshot)
        └── FILE  ← the .canvas on disk       (canvas.file → parseCanvasReport → decodeCanvasDataToFlat)
```

Everything in this spec is one of two things:

- a **census** — all three planes for all nodes, taken on demand (`arm`, `dump`), or
- a **ledger row** — one mutation, with its **cause**, appended to a single ring buffer.

Exposure is **one command**, `canvas.diag`, with an `op` argument. One `case` in `routeCommand`, one host
method. Not a framework.

### 0.3 Hard rules — these are not negotiable and they are cheap to obey

| # | Rule | Why |
|---|---|---|
| R1 | **Do not modify `plugin/src/canvas/canvas-presence.ts`.** | It carries a whole-file byte + SHA-256 pin: `v2/wp21/test_tp04_awareness_liveness_unchanged_visible.test.ts:77-78` (`2cefc9a8…f07ff16c9`, 29 831 B LF). Touching it is a `BUILD_SPEC` §7 **ESCALATE** and it reddens the existing suite. Everything this spec needs from that file is reachable by patching the **instance** — see I3/I4. |
| R2 | **Never call `adapter.isBusy()` or `adapter.getEditingNodeId()` from an instrument.** | Both run the staleness **sweep**, which can release the editing flag and fire the blur subscribers — i.e. reading the instrument would trigger WP37's drain. This is `canvas-adapter.ts:1087-1098`'s own stated reason for `describeEditingSignal()` and it is the precedent this whole package follows. Use `getNodeGeometry()` (`:1001-1013`, pure) and `getLiveNodeIds()` (`:989-993`, pure). |
| R3 | **No instrument writes any canvas surface.** No `setData`, no `moveAndResize`, no vault write, no `doc.transact`, no `awareness.setLocalState`. | Beyond the obvious: `v2/wp87/test_tp01_surface_route_census.test.ts` derives the sink set **from the tree** and asserts *"no derived canvas-surface sink is UNGUARDED"*. A diagnostic that writes a surface will fail an existing test. The existing suite is already guarding us here — for free. |
| R4 | **Never read, log, echo or hash `data.json`.** sha256-of-bytes only, and this package needs no hash of it at all. | Live credentials. |
| R5 | **Never score a canvas on bytes.** Records, always. | Three stable spellings (`S174`, `S185`). Bytes may appear in a dump as a *label*, never as a verdict. |
| R6 | **Every counter increments on every branch, including do-nothing.** | `S155`. A revert sweep that declined must be distinguishable from one that never ran. |
| R7 | **If a dump can be lost, the dump says so.** | `S186`. Ring-buffer eviction count, armed/not-armed, patched-vs-mounted path gap, per-plane availability — all surfaced, never silently empty. |
| R8 | **Do not game a pin.** A dynamic `import()` evades the allow-list regex in `wp49/test_tp12:46-59` and `wp72/test_tp4:33-46`. Do not do that. | `S162`'s shape. If an import is needed, amend both lists with a ledger reason (§1.9). |

### 0.4 Where the code goes

| Piece | File | Size | Amendment needed? |
|---|---|---|---|
| Ledger, censuses, patch install/remove, the `canvas.diag` router case and host method | **`plugin/src/testing/e2e-control.ts`** (append; it already owns `canvas.editingSignal`, `canvas.undo`, `canvas.textShape` on exactly this pattern) | ~300 lines | **No** — no new import specifier |
| One read-only accessor onto the mounted surfaces | **`plugin/src/main.ts`** — `canvasDiagTargets()` | ~12 lines, wiring | No |
| The human-readable cross-peer table | **`tools/e2e/canvas_diag.py`** (new) | ~250 lines | No — Python, no allow-list |
| *Optional*, §1.9 | `holdersOf` import into `e2e-control.ts` | 2 lines in each allow-list + 2 ledger rows | **Yes, one** |

**Why `e2e-control.ts` and not a new `testing/canvas-diag.ts`:** a sibling module would need `./canvas-diag`
added to **two** frozen allow-lists (`wp49/test_tp12:46-59`, `wp72/test_tp4:33-46` — verified line ranges;
the charter's `:46-52` / `:33-39` are the pre-WP123 ranges). The charter says prefer not to need an
amendment. One is proposed in §1.9 and it buys a discriminator; a second, bought only for file hygiene, is
not worth it. If the Dispatcher disagrees, the split is mechanical and the two ledger rows are the same shape
as WP123's `A-123-4` / `A-123-5`.

---

## 1. The instruments

| | Instrument | Plane | Hooks | Cost |
|---|---|---|---|---|
| **I1** | Three-plane census | view / doc / file | none — pure reads | trivial |
| **I2** | View-write ledger (the position ledger) | view | `adapter.applyNodeGeometry`, `adapter.reloadCanvasData` | 2 instance patches |
| **I3** | Revert-decision ledger | presence | `presence.reconcileClaims` | 1 instance patch |
| **I4** | Expiry ledger + the `wouldHaveReverted` field | presence | `presence.expireIdleInferredLocks` | 1 instance patch |
| **I5** | Y transaction-origin ledger | doc | `doc.on("afterTransaction")` | 1 listener |
| **I6** | Awareness snapshot | wire | none — pure read | trivial |
| **I7** | Viewport ledger | view | `adapter.onViewportChange` subscriber | 1 subscriber |
| **I8** | **Unattributed delta** — the residual | derived | none | arithmetic |

All of I2/I3/I4 are **instance-property patches**, on the same shape the production adapter already uses to
own Obsidian's private canvas (`canvas-adapter.ts:828-842`): keep the original in a closure, call it, record
around it, restore on `clear`. `CanvasPresence`'s awareness listener calls `this.expireIdleInferredLocks()`
and `this.reconcileClaims()` (`canvas-presence.ts:367` and `:370`), and `this.`-dispatch resolves an own
property before the prototype — so patching the instance intercepts both **without touching the pinned
file**. That single fact is why R1 costs nothing.

### 1.1 I1 — the three-plane census

**Measures.** For one canvas path, for every node id: `view {x,y,width,height}`, `doc {x,y,width,height}`,
`file {x,y,width,height}`. Plus per-plane availability and, for the file plane, `degraded` from
`parseCanvasReport`.

**Hooks.**
- view: `adapter.getLiveNodeIds()` then `adapter.getNodeGeometry(id)` — `canvas-adapter.ts:989` and `:1001`,
  both pure member reads.
- doc: `plugin.canvasSync.getCanvasSnapshot(path)` — `files/canvas-sync.ts:2570-2588`, a pure read
  (`buildCanvasData` over three maps, no transaction opened). Returns `null` when the path is not subscribed
  or the node map is empty — record that as `doc: "unavailable"`, never as an empty board.
- file: the same route `canvas.file` already uses (`e2e-control.ts:3788-3803`), then
  `parseCanvasReport` + `decodeCanvasDataToFlat` — **both already imported** into `e2e-control.ts` under
  WP123's amendment. The production parser, never a second one (`S158`).

**Exposure.** `{"cmd":"canvas.diag","args":{"op":"census","path":"…"}}` — also embedded automatically in
`arm` and `dump`.

**Cannot perturb.** Three pure reads. No adapter method that sweeps (R2), no transaction, no awareness write,
no disk write. Reading the file is a read of bytes the plugin did not author.

**Discriminates.** All seven, coarsely — it is the frame every other reading is placed in. On its own it
already separates *"the view is wrong"* (view ≠ doc) from *"the truth is wrong"* (doc ≠ doc across peers)
from *"only the disk lags"* (file ≠ doc).

**Bounds.** Cap at 500 nodes and set `truncated: true` past it (R7). The owner's board is 11.

### 1.2 I2 — the view-write ledger (**the position ledger; the cause field is the whole point**)

**Measures.** Every mutation this plugin makes to the live view's geometry, with **before → after and a
cause**. The two adapter members below are the *complete* set of view-geometry sinks in the product — that is
not an assumption, it is what `v2/wp87/test_tp01_surface_route_census.test.ts:210-214` derives from the tree
and asserts (`canvas/canvas-adapter.ts#applyNodeGeometry` and `#reloadCanvasData`, both `GUARDED-BY-CALLER`).

**Hooks.** Two instance patches, installed at `arm`:

```
applyNodeGeometry(nodeId, geo):
    before = original-owner's getNodeGeometry(nodeId)      # pure
    outcome = original(nodeId, geo)
    row { t, path, nodeId, from: before, to: geo, outcome, cause }

reloadCanvasData(data):
    beforeAll = { id -> getNodeGeometry(id) for id in getLiveNodeIds() }   # pure
    ok = original(data)
    afterAll = same, taken after
    row { t, path, kind:"setData", ok, nodeCount, moved: [ {nodeId, from, to} … ] }
```

`reloadCanvasData` is the **whole-board blast radius** and it is still reachable in the ordinary remote path
— `main.ts:3231-3235` escalates a per-node geometry pass to a full `setData` the moment a node **with edges**
actually moves (`movedEndpoint`). WP119 removed the revert's escalation; it did **not** remove this one. Its
`moved: []` list is therefore expected to be the loudest row in a broken dump.

**Cause resolution — one boolean, not a framework.** `onRevert` → `main.ts:3990 revertCanvasNode` →
`:4036 applyCanvasNodeRevert` → `:4105 applyNodeGeometry` is **fully synchronous inside**
`presence.reconcileClaims()`. So I3's patch sets a module-level `causeNow = "revert"` before calling the
original and restores it in a `finally`. Any sink call with `causeNow` unset is `remote-apply`
(`main.ts:2521 setOnRemoteCanvasUpdate` → `:3024 reconcileLiveCanvas`) or `mount-initial`
(`main.ts:3890`, `{initial:true}`); distinguish those two by a second flag only if the dumps demand it —
`mount-initial` fires once per open and is obvious by timestamp.

Cause vocabulary, as produced by this design:

| Cause | Emitted by | Meaning |
|---|---|---|
| `revert` | I3's wrapper sets the flag | `reconcileClaims` lost the tiebreak and rolled this node's view to shared truth |
| `remote-apply` | flag clear, via either sink | `reconcileLiveCanvas` from a remote delta |
| `mount-initial` | flag clear, first sink call after a mount | the authoritative open-time reconcile |
| `local-gesture` | I5, `tr.local === true` + a capture origin | the user moved it and capture wrote it |
| `seed` | I5, `canvas-seed-origin` / `canvas-import-seed-origin` | a seed or upsert-seed wrote it |
| `flush` | I1 file-plane delta with no doc delta | `CanvasPersistence` wrote the file |
| `mirror` | existing `canvas.mirror` command, correlated by time | a mirror pass ran |
| `capture` | I5, `canvas-capture-origin` | the file-driven capture path |

**Cannot perturb.** The wrapper calls the original exactly once and returns its value verbatim; the extra work
is `getNodeGeometry` reads (R2-safe) and an array push. It adds no timer, no awareness field, no doc write.
The one honest caveat: the `reloadCanvasData` wrapper takes an O(n) census on both sides of a `setData` —
on a 500-node board that is 1 000 pure property reads inside an already-expensive call. Bounded and stated.

**Discriminates.** H1 (does a `revert` row still appear per click, and how many?), H7 (what position did the
`revert` row restore **to**?), and it is the primary evidence for the accumulation: a `revert` row whose
`from` is the doc's own value and whose `to` is *different* is the loop's first half.

### 1.3 I3 — the revert-decision ledger

**Measures.** Every `reconcileClaims()` call — **including the ones that decide nothing** (R6):

```
row {
  t, path, sweep: "reconcile",
  entered: true,
  myClientId,
  candidates: [ nodeId … ],                  # what this client held on entry
  perNode: [ { nodeId, holders:[…], winner, lower: bool,
               docPos: {x,y,w,h}|null,       # read BEFORE original() — where a revert would aim
               reverted: bool } ],
  revertedCount, declinedCount               # both, always, even at zero
}
```

`candidates` needs the client's own claim set. `presence.isLockedByMe(nodeId)` is **public**
(`canvas-presence.ts:472`) — iterate it over `adapter.getLiveNodeIds()`. That misses a claim on a node not
in the live view (a deleted card — and the leak is known to hold claims on deleted cards, §3 of
`DISPATCHER_STATE`), so **also** read the private map through a cast: `(presence as {lockedNodes?})`.
TypeScript `private` is compile-time only; this is a diagnostic and a cast here is honest. If the field is
absent, emit `lockedNodes: "unreadable"` rather than an empty object (R7).

`docPos` is read from `canvasSync.getCanvasSnapshot(path)` **before** the original runs, because that is
exactly what `revertCanvasNode` will read (`main.ts:3999`) — so the ledger records the value the revert is
about to aim at, not a value taken after the fact.

**Exposure.** In the ring, dumped by `op:"dump"`.

**Cannot perturb.** The wrapper reads and calls; `getCanvasSnapshot` is pure; `isLockedByMe` is a
`hasOwnProperty` test. It emits no awareness state — critically, it must **not** call `presence.refresh()`
or `emitLocalState()`.

**Discriminates.** H1 directly (paired with I4), H7 (`docPos` vs I2's `from`), and it is the only
instrument that can show *"the restoring force ran and declined"* as distinct from *"it never ran"*.

### 1.4 I4 — the expiry ledger, and the one field that settles hypothesis 1

**Measures.** Every `expireIdleInferredLocks()` call:

```
row {
  t, path, sweep: "expire",
  entered: true,
  present: bool,                     # false on a pre-WP120 bundle — see §4
  heldBefore: [ … ], expired: [ … ], heldAfter: [ … ],
  perExpired: [ { nodeId,
                  holders: […], lowerHolderExists: bool,
                  wouldHaveReverted: bool,      # ← THE DISCRIMINATOR
                  docPos: {…}|null,
                  viewPos: {…}|null } ],
  expiredCount                       # 0 rows are still rows (R6)
}
```

`wouldHaveReverted` = *"had this claim survived to `reconcileClaims()` two lines later, would the loser-revert
have fired on it?"* — i.e. `holdersOf(path, nodeId, awareness.getStates()).some(id => id !== myId && id < myId)`,
evaluated **before** the original runs. That is the counterfactual the whole of H1 rests on, and it is a
single boolean per expired claim.

**Exposure.** In the ring.

**Cannot perturb.** Pure reads plus one call to the original. `awareness.getStates()` is a read.

**Discriminates.** **H1, decisively.** If a click produces `expired: [n1,n2,…]` with
`wouldHaveReverted: true` on any of them, WP120's reordering is provably eating reverts that used to fire —
and I2 will show whether those reverts were doing anything (`outcome:"unchanged"` = they were not, and H1
falls). If `expired: []` on every click, H1 is dead and the Dispatcher's leading hypothesis is refuted before
anyone writes a repair.

**Note on H1's own arithmetic, before anyone builds on it:** `INFERRED_LOCK_IDLE_MS = 15_000`
(`canvas-presence.ts:59`). A claim only expires after **15 s idle**. So H1 requires the disjointing to be
driven by claims that are already stale — which the recorded leak (14 and 15 claims on an 11-node board,
never falling) makes entirely plausible, but it is a condition, not a given. I4 measures it.

### 1.5 I5 — the Y transaction-origin ledger (**the doc plane's "who moved it"**)

**Measures.** Every transaction on the canvas doc: `origin`, `tr.local`, and the per-node geometry delta it
produced.

**Hooks.** `plugin.canvasSync.getCanvasDocHandle(path)?.doc.on("afterTransaction", tr => …)`. The handle
accessor is **already declared** on `e2e-control.ts`'s structural mirror (`:2687`) and the file already
attaches a doc listener for quiescence (`:3099 observeDoc`). Keep a private `lastSeen: Map<nodeId,{x,y,w,h}>`
inside the ledger; on each transaction re-read the changed node ids from the `nodes` map and emit the delta
against `lastSeen`, then update it. That avoids having to decode Yjs event internals.

Origins are already a first-class, named vocabulary in this codebase — eight symbols with `.description`:
`canvas-capture-origin` (`canvas/canvas-undo.ts:34`), `canvas-capture-migration-origin` (`:63`),
`canvas-binding-origin` (`canvas/canvas-binding.ts:68`), `canvas-epoch-adopt-origin`
(`canvas/canvas-epoch.ts:312`), `canvas-migration-origin` (`canvas/canvas-schema.ts:417`),
`canvas-import-seed-origin` (`files/canvas-import.ts:102`), `canvas-seed-origin`
(`files/canvas-persistence.ts:131`), `sidecar-load-origin` (`files/canvas-sidecar.ts:147`). Render as
`String(tr.origin?.description ?? tr.origin ?? "null")` and pass through anything unrecognised verbatim —
`null` origin and `tr.local === true` is itself a finding.

**Exposure.** In the ring.

**Cannot perturb.** A Yjs event subscriber. It opens no transaction and writes nothing. It must be
`doc.off(...)` on `clear`.

**Discriminates.** **H2** (WP122's writer bind — a doc write on the host that did not exist before this
session), **H3** (`S177`'s upsert seed — a `canvas-seed-origin` transaction re-proposing a node's old
position **after** the session started is the signature, and it is otherwise invisible), **H6** (does a
selection produce a doc transaction at all? — a straight yes/no), and **the feedback loop**: a
`canvas-capture-origin` transaction with `tr.local === true`, on a node the local user never touched,
arriving right after an I2 `revert` or `remote-apply` row for that same node, **is** the accumulation.

### 1.6 I6 — the awareness snapshot

**Measures.** From `handle.awareness.getStates()`: per clientId → `canvasPath`, `nodeId`, `x`, `y`,
`lockedNodes` (id → `{color, name, epoch?}` — surface `epoch` if present; `S187` says it is in the wire shape
and was never implemented, so **`epoch: undefined` everywhere is itself the confirmation**), `identity.name`.
Plus `myClientId`, plus the local `lockMeta` (`origin` / `touchedAt` per claim) read through the same cast as
I3, reported as `"unreadable"` when absent.

**Exposure.** `op:"awareness"`, and embedded in `arm` and `dump`.

**Cannot perturb.** `getStates()` is a read. The snapshot is **never** written back and no field is added to
the wire — which is the constraint that forbids the obvious alternative design of broadcasting a diagnostic
field. Do not.

**Discriminates.** Supplies `holders` / `winner` for I3 and I4, gives the leak's live count per peer, and
lets the Python side prove the phantom `(typing)` pill (`typing: cs.nodeId !== null`,
`canvas-presence.ts:192`) by showing a peer whose `nodeId` is non-null while it holds no gesture claim.

### 1.7 I7 — the viewport ledger

**Measures.** `{x, y, zoom}` on every viewport change, timestamped.

**Hooks.** `adapter.onViewportChange(cb)` (`canvas-adapter.ts:1209`) — registering adds a callback to an
existing subscriber set; the callback calls `adapter.getViewport()` (`:949`, pure) and pushes a row. The
dispose function returned is stored and called on `clear`.

**Cannot perturb.** It adds a subscriber to a set the product already fans out to, and calls one pure getter.
It does not call `refresh()` and touches no node.

**Discriminates.** **H5.** A view-plane move that correlates in time with a viewport change and has **no**
I2 row is the only shape H5 can produce — see §2 for why H5 is already narrow.

### 1.8 I8 — the unattributed delta (**build this; it needs no hook at all**)

**Measures.** `census(dump) − census(arm)`, minus every move I2 explains. Per node, per plane:

```text
node   plane   armed        dumped       delta        explained-by
n3     view    (120,340)    (188,412)    (+68,+72)    —            ← UNATTRIBUTED
n3     doc     (120,340)    (188,412)    (+68,+72)    capture t=+412ms local=true
```

An unattributed **view** delta means something moved a card that this plugin's two sinks did not — Obsidian
itself, the user, or a route nobody has enumerated. An unattributed **doc** delta with no I5 row means the
ledger dropped or the transaction came from a path we are not watching.

**Cannot perturb.** Arithmetic.

**Discriminates.** It is the honest catch-all: it is how a mechanism that is on **none** of the seven lists
announces itself. Given §7's record — three repairs aimed by inference, all wrong — this is the row I would
read first.

### 1.9 The one amendment I am asking for, and what it buys

`wouldHaveReverted` (I4) is the field that settles H1. Computing it needs *"does a lower-id peer also hold
this node on this path?"*, which is **`holdersOf(path, nodeId, states)`**, exported and pure from
`canvas/canvas-presence.ts:118-130`. Two options:

- **(a) Re-implement it in `e2e-control.ts`** — 5 lines, no amendment. Cost: a **second definer** of the
  predicate the whole diagnosis turns on. This project has been burned by exactly that class.
- **(b) Add `"../canvas/canvas-presence"` to both allow-lists** (`wp49/test_tp12:46-59`,
  `wp72/test_tp4:33-46`) with a §7 ledger row each, importing **`holdersOf` only**. Same shape and same
  reasoning as WP123's `A-123-4`/`A-123-5` for `../files/canvas-sync`: a pure exported function, no new
  package dependency, no new transport, and it removes a duplicate rule rather than adding one. It does
  **not** modify `canvas-presence.ts`, so R1 and the byte pin are untouched.

**I recommend (b), and if the Dispatcher declines, (a) with the duplication named in a comment.** Note the
two lists must move together — WP123 found that WP122's report had missed `wp49` entirely.

---

## 2. Hypothesis × instrument, and the gaps

| # | Hypothesis | Discriminated by | Verdict on inspection |
|---|---|---|---|
| **H1** | WP120's reorder ate the loser-revert | **I4** (`wouldHaveReverted`) + **I3** (`revertedCount`) + **I2** (`outcome` of the reverts that do fire) | **Sound but conditional** — needs claims ≥15 s idle; and note the reorder makes client 2 revert *less*, so H1 only works if the revert was the restoring force. §7.1. |
| **H2** | WP122's writer bind | **I5** (a host-side doc/file write path that is new this session) + **I1** file plane | Live and untested against this symptom |
| **H3** | `S177` upsert seed re-proposes stale geometry | **I5** — a `canvas-seed-origin` transaction after session start, carrying old coords | Live. Only I5 can see it; nothing else can. |
| **H4** | WP21 removed the write denial | **partial** — I6 + I5 show a write landing on a node a peer holds. **The counterfactual is not instrumentable.** | **GAP, and an honest one.** H4 is an *absence*, not a mover: it explains why nothing refuses, not what moves. Confirmed by inspection: `canWriteNode`/`canDeleteNode` (`canvas-presence.ts:476`, `:480`) have exactly one consumer, `CanvasBinding`'s optional gates (`canvas-binding.ts:290-291`), and `mountCanvasPresence` never supplies them. Predates the window. |
| **H5** | Canvas-space vs screen-space via `onViewportChange` | **I7** + **I8** (a view move with a viewport row and no I2 row) | **Already very narrow.** §7.2. |
| **H6** | Capture-on-selection via `emitHeld` | **I5** — does a selection produce *any* doc transaction? | **Already looks wrong.** §7.3. |
| **H7** | The revert's own baseline is wrong | **I3** (`docPos`) + **I2** (`from`→`to`) | **Reframed, not eliminated.** §7.4. |
| **H8** *(new)* | The `movedEndpoint` escalation still `setData`s the whole board | **I2**'s `reloadCanvasData` row with its `moved: []` list | Verified present at `main.ts:3231-3235`. §7.5. |
| **H9** *(new)* | The corrective view-write re-enters capture and becomes the new truth | **I2 row → I5 row** for the same node within a few hundred ms, `tr.local === true`, capture origin | This is the only shape that produces *accumulation*. §7.6. |

**Stated gaps:**

1. **H4 is not discriminable** and no instrument in this design changes that. It is an enabler, and the right
   read is that its consequence — an unrefused write — is already visible everywhere.
2. **Nothing here instruments the relay.** If the doc diverges between peers with matching origins on both
   sides, the next question is transport, and this scaffold will hand you that question rather than answer it.
3. **`.md` is out of scope**, per the owner's canvas-only sequencing.
4. **`CanvasBinding` is dormant.** `types.ts:287` ships `useCanvasBinding: false` and it is frozen behind a
   §7 pin, so `CANVAS_BINDING_ORIGIN` cannot appear live. I5 will still print it if it does — which would be
   a finding in itself — but Worker 3 should not spend effort on that path.

---

## 3. The guided-session runbook

The primary use case is **human-in-the-loop**: arm → the owner performs **one** click → dump. The dump is
read by a person.

### 3.0 Environment (verified 2026-08-08)

```text
H:\Developement\_NeuralAngels\ObsidianOrga             ← A, port 39431
H:\Developement\_NeuralAngels\ObsidianOrga - Kopie      ← B, port 39432
H:\Developement\_NeuralAngels\ObsidianOrga - W4TestC    ← C, port 39433
```

All three currently run `de48fff4e9f7d58d` (re-measured, `sha256(main.js)[:16]`, 5 675 554 B on each).
`sharedFolder` = `_liveshare-test`. Envelope: `POST http://127.0.0.1:<port>/command`, body field **`cmd`**,
not `command`. **Print the raw response** — a wrong field returns a 400 that a careless parser reads as
"no answer".

### 3.1 The sequence

```text
STEP 0  — orientation, every time. Roles migrate between runs.
          POST {"cmd":"session.info"}                       ×3
          → record role, vaultId, pluginBuild per peer

STEP 1  — the board must be OPEN on every peer, or there is no adapter and the VIEW plane is blind.
          POST {"cmd":"canvas.open","args":{"path":"_liveshare-test/<Board>.canvas"}}   ×3

STEP 2  — ARM
          POST {"cmd":"canvas.diag","args":{"op":"arm","path":"…"}}                     ×3
          → { armed:true, diagProto:1, armedAt, patchedPaths:[…], mountedPaths:[…],
              census:{…}, awareness:{…} }
          ✋ REFUSE TO PROCEED unless, on every peer:
               armed === true
               diagProto === 1                    (absent ⇒ that peer has no diag build — §4)
               patchedPaths ⊇ [the path under test]
               census.view.available === true     (false ⇒ board not open on that peer)

STEP 3  — THE OWNER ACTS.  Exactly ONE gesture. Say out loud which one and on which client.
          Good first gestures, in this order:
            (a) click ONE card on client 1, change nothing
            (b) click empty canvas on client 1 (deselect)
            (c) drag ONE card 100 px on client 1
          Wait ~3 s. Do nothing else. Do not scroll, do not pan.

STEP 4  — DUMP
          POST {"cmd":"canvas.diag","args":{"op":"dump","path":"…"}}                    ×3
          → { …, dumpedAt, events:[…], dropped:N, census:{…}, awareness:{…} }

STEP 5  — READ IT
          python tools/e2e/canvas_diag.py --ports 39431,39432,39433 \
                 --path "_liveshare-test/<Board>.canvas" --label "click-1"

STEP 6  — repeat 3–5 for the next gesture. The ring is NOT cleared by a dump; use op:"mark"
          to drop a labelled fence into the ring between gestures instead.

STEP 7  — TEARDOWN, always, before the owner keeps using the vault.
          POST {"cmd":"canvas.diag","args":{"op":"clear"}}                              ×3
          → { armed:false, patchesRemoved:N, listenersRemoved:N }
```

`op:"mark"` takes `{label}` and pushes a fence row. That is what makes *"which click did what"* readable
without re-arming — and re-arming would reset the arm census and destroy the I8 baseline.

### 3.2 What the Python table prints

```text
=== click-1 : one click on card n3, client A (host) ===
peers: A=39431 host build de48fff4  B=39432 guest de48fff4  C=39433 guest de48fff4
ring: A 14 rows (0 dropped) · B 31 rows (0 dropped) · C 9 rows (0 dropped)

NODE   PLANE  A armed      A dumped     B armed      B dumped     C armed      C dumped   FLAG
n1     view   (100,100)    (100,100)    (100,100)    (100,100)    (100,100)    (100,100)
n1     doc    (100,100)    (100,100)    (100,100)    (100,100)    (100,100)    (100,100)
n1     file   (100,100)    (100,100)    (100,100)    (100,100)    (100,100)    (100,100)
n3     view   (400,220)    (400,220)    (400,220)    (517,296)    (400,220)    (400,220)   ⚠ B VIEW MOVED
n3     doc    (400,220)    (400,220)    (400,220)    (517,296)    (400,220)    (517,296)   ⚠ DOC DIVERGED

CAUSAL STORY (merged by wall clock)
  +0.000 A  awareness  local lockedNodes {} -> {n3}          (gesture)
  +0.031 B  expire     entered heldBefore=[n3,n7] expired=[n3] wouldHaveReverted=TRUE  ← H1
  +0.031 B  reconcile  entered candidates=[n7] reverted=0 declined=1                   ← S155 branch
  +0.033 B  applyGeom  n7  (250,180) -> (250,180)  outcome=unchanged  cause=remote-apply
  +0.402 B  setData    ok  moved=[{n3,(400,220)->(517,296)}]        cause=remote-apply  ← H8
  +0.640 B  ytxn       origin=canvas-capture-origin local=TRUE  n3 (400,220)->(517,296) ← H9 !!
  +0.900 C  ytxn       origin=null local=false     n3 (400,220)->(517,296)

UNATTRIBUTED (view/doc deltas no ledger row explains)
  (none)
```

### 3.3 Healthy vs broken

**Healthy, after one click that changes nothing:**

- Every node: all three planes equal on all three peers, armed == dumped.
- `expire` rows present with `expiredCount: 0`, or with `wouldHaveReverted: false` on everything expired.
- `reconcile` rows present with `revertedCount: 0` and `declinedCount ≥ 0` — **the row must exist**; its
  absence means the sweep never ran and that is a different bug (R6/`S155`).
- Any `applyGeom` row has `outcome: "unchanged"` — WP119's own measured signature.
- **Zero** `ytxn` rows with `local: true` on the *non-clicking* peers. A click is not an edit.
- `setData` rows either absent or with `moved: []`.
- `UNATTRIBUTED` empty.

**Broken — and each shape names its suspect:**

| Shape in the dump | Reads as |
|---|---|
| `expire` with `wouldHaveReverted: true`, and no `reconcile` revert for that node | **H1.** The restoring force was removed by ordering. |
| `reconcile` reverts fire, `applyGeom` `outcome: "applied"`, and `to` ≠ the doc's value on the other peers | **H7.** The revert is aiming at a wrong truth. |
| `setData` with a non-empty `moved: []` on a peer that did nothing | **H8.** The whole-board escalation is still live. |
| An `applyGeom`/`setData` row, then within ~1 s a `ytxn` with `local: true` and a capture origin for the **same node** | **H9. This is the loop.** Stop and report it — it is sufficient on its own to explain accumulation. |
| `ytxn` with `canvas-seed-origin` after arm, carrying the pre-click coords | **H3.** |
| A view delta with no ledger row, and an I7 viewport row within ~200 ms | **H5.** |
| A view delta with no ledger row and no viewport row | **Unenumerated mechanism.** The most important possible result. |
| `dropped > 0`, or `patchedPaths` ⊉ the path, or `diagProto` absent | **The dump is incomplete. It is not evidence.** Re-run. |

### 3.4 Losing the record — `S186`

The console log stopped capturing for 11 minutes during B65 and one arm was lost to `w4rig._resolve_targets`
caching stale CDP urls. Therefore:

- `canvas_diag.py` **writes every raw response to `workflowArtifacts/canvas-v2/diag/<label>-<peer>.json`
  before printing anything**, and prints the paths. The table is a rendering of files on disk, not of
  something that lived only in a console.
- It **resolves the control port freshly on every call**. No cached target list.
- If any peer returns non-200, or `armed: false`, or `diagProto` missing, it prints `INCOMPLETE — <peer>:
  <reason>` and **refuses to print the table**. A partial table is worse than none.

---

## 4. The A/B bisect: `d30f671979efaeb5` vs `de48fff4e9f7d58d`

**The old bundle already exists on disk:** `H:\tmp\b65_old_main.js`, 5 540 804 B,
`sha256[:16] = d30f671979efaeb5` — verified. It is the pre-WP120 build B65 used for its one-variable A/B.
**It has no diagnostic in it.** So the bisect has two modes, and both are useful.

### 4.1 Mode 1 — cheap, no rebuild: symptom-only A/B (do this first)

1. Arm all three on `de48fff4e9f7d58d`, run §3 for gesture (a) and (c), keep the dumps.
2. Swap **one** peer's bundle: copy `H:\tmp\b65_old_main.js` over
   `…\ObsidianOrga - Kopie\.obsidian\plugins\live-share\main.js`. Reload that vault's plugin.
3. Re-verify with `session.info` on all three, and **re-measure the sha of all three `main.js` yourself** —
   B65's rule; do not quote the swap.
4. Repeat the identical gesture on the same board.
5. The swapped peer answers `canvas.diag` with a **404/unknown cmd**. That is expected and it is the deploy
   detector: `canvas_diag.py` reports it as `NO_DIAG` for that peer and still prints the other two peers'
   tables plus **the file plane for all three** (`canvas.file` exists on both builds).
6. **The reading:** does the same click still disjoint the board when the peer that *receives* the click's
   effects is on the old bundle? Records only, never bytes (R5) — use `canvas.file` + the records path.

This alone can confirm or kill "the regression is in `WP120`–`WP124`" without any new code, and it should be
run before the instrument exists if the owner has ten minutes.

### 4.2 Mode 2 — the real bisect: a diag build on both trees

The instrument touches only `plugin/src/testing/e2e-control.ts` and ~12 lines of `main.ts`. Neither depends
on any symbol introduced by WP120–WP124 **provided Worker 3 obeys one rule**:

> **Every hook must probe before it patches.** `presence.expireIdleInferredLocks` does not exist pre-WP120;
> the private `lockMeta` map does not exist pre-WP120. Both must be `typeof … === "function"` /
> `in`-guarded, and their absence recorded as `present: false` / `"unreadable"` — **not** crashed on, and
> **not** silently omitted. The absence is a *reading*: it is how the dump proves which build it is on.

Procedure:

```text
1. Land the instrument on the current branch (fix-bugs-and-raceconditions, at 9c57a27).
   npm --prefix plugin run build      # tsc + esbuild, must be clean
   npm --prefix plugin test           # 444 files / 3375 tests, must not regress
   npm --prefix plugin run build:e2e  # the bundle the vaults get

2. git worktree add ../ls-preWP120 e6909ee     # the commit immediately BEFORE 3befded (WP120)
   ⚠ DO NOT junction node_modules into the worktree — `git worktree remove --force` deletes
     THROUGH the link and empties the original (§7 of DISPATCHER_STATE, WP119's tester).
     Run `npm ci` inside the worktree from the committed lockfile.
   Cherry-pick / re-apply the instrument commit there. Only two files move, so this is mechanical.
   npm run build:e2e  →  this is the "old + diag" bundle. Record its sha.

3. Install "old + diag" on ONE peer (B). Leave A and C on "current + diag".
   Re-measure all three shas yourself.

4. Run §3's runbook unchanged. Both bundles now answer canvas.diag.

5. THE DIFFERENCE TO READ, in this order:
     ├── Does B still emit `expire` rows?  (present:false on the old build — proves the swap took)
     ├── Does B emit `reconcile` rows with revertedCount > 0 where the new build emitted 0?
     │      → H1 confirmed, and the exact nodes are named.
     ├── Do B's view-plane deltas SHRINK on the old build for the identical gesture?
     │      → the regression is in the presence path.
     └── Do they NOT shrink?
            → the regression is NOT WP120. Look at H2/H3/H8/H9 and stop theorising about ordering.
```

**Roles migrate**, so re-read `session.info` at the start **and end** of every arm and record which peer was
host. An A/B where the host moved between arms is not a one-variable A/B.

---

## 5. Build order for Worker 3 — simplest and highest value first

Each step leaves something usable. **Stop wherever you run out of time and hand over; a partial build here
is genuinely useful.**

| Step | Build | Why here | Leaves you able to |
|---|---|---|---|
| **1** | **I1 three-plane census** + `op:"census"` + `canvas_diag.py` printing the 9-cell table for three peers, with the `INCOMPLETE` refusal (§3.4) | Zero hooks, zero risk, no patching, no `main.ts` change (census reaches everything through `plugin.canvasSync` + `canvas.file`, both already declared). | Run a guided session **today** and see *where* the disagreement is. This alone may localise the bug to one plane. |
| **2** | **I8 unattributed delta** — `arm` stores the census, `dump` diffs it | Pure arithmetic on step 1. | Say *"the view moved and nothing we know about moved it"* — the finding no hypothesis list can give you. |
| **3** | **`main.ts` accessor + arm/clear patch machinery + I2 view-write ledger** with the `causeNow` flag | The first patching step. Everything after it reuses the same install/remove machinery. | Attribute every view move to `revert` / `remote-apply` / `mount-initial`, and see H8's `setData` rows. |
| **4** | **I5 Y-origin ledger** | One listener, no patch, huge yield. | Answer H3 and **H9 — the accumulation** — and H6 outright. |
| **5** | **I3 + I4 revert & expiry ledgers**, including `wouldHaveReverted` (with §1.9's amendment or the named duplicate) | Needs step 3's machinery. | Settle **H1**, the leading hypothesis, either way. |
| **6** | **I6 awareness snapshot** + **I7 viewport ledger** | Cheap, and they make the other ledgers readable (`holders`, `winner`, H5). | Close H5, quantify the leak per peer, prove the phantom `(typing)` pill. |
| **7** | The **A/B diag build** on `e6909ee` (§4.2) | Only worth it once steps 3–5 exist. | The one-variable bisect. |
| **8** | *(optional, drop if pressed)* per-write disk ledger via `CanvasPersistence.onWritten` | The file-plane record delta already falls out of I1+I8; this only adds per-write causes. | Attribute individual disk writes. |

**Gate before handover — the only bars that survive the suspension:**

```
npm --prefix plugin run build     # tsc -noEmit clean, esbuild clean
npm --prefix plugin test          # baseline 3375 tests / 444 files — must not regress
```

Two known facts about that suite, so you do not chase ghosts:

- **`S181`** — `wp101/test_s123_canvas_mirror_race.test.ts:313` fails **intermittently on contention** with
  `Error: Test timed out in 5000ms` (not an assertion failure) and passes in 1.4 s run alone. One red there
  is not your regression. **Never pipe the run through `tail` before you know it passed.**
- **`S153`** — WP92's `no_collateral` asserts a file is absent from `git diff HEAD`, so it is red while
  uncommitted and green once committed. Not a real failure.

**Do not commit** (Dispatcher's instruction to this batch), and **never** `npx biome check --write` — it
corrupts this tree.

---

## 6. What I deliberately left out, and why

| Left out | Why |
|---|---|
| **Any test, break table, plant or blind set** | Owner instruction, explicit. |
| **A new awareness field carrying diagnostic state** | It is the single most tempting design here and it is forbidden: WP27 AC3 pins the awareness state's six keys, and a diagnostic on the wire perturbs exactly the mechanism under investigation. Every cross-peer correlation is done **out of band**, in Python, from three independent dumps. |
| **A polling timer that samples node positions** | The charter's constraint, and it is right: the sweep is edge-triggered on `awareness.on("change")` (`canvas-presence.ts:360-372`), so a timer that touches awareness would *fire the thing we are measuring*. Every sample is taken on `arm`, on `dump`, on `mark`, or inside a hook that was going to run anyway. |
| **Any edit to `canvas-presence.ts`** | R1 — byte + SHA pin, `BUILD_SPEC` §7 ESCALATE. Instance patching gets everything. |
| **A general instrumentation framework** (registries, pluggable sinks, config) | Owner: *"build it simple"*. One ring buffer, one command, one `op` argument. |
| **A second `.canvas` parser in Python** | `S158`'s family. The file plane is parsed in the plugin with the production `parseCanvasReport` + `decodeCanvasDataToFlat`, already imported. Python renders; it does not judge. |
| **A verdict field** (`healthy: true/false`) | This scaffold's job is to make a human able to read one click. A boolean would be the fifth member of the `S153`/`S88`/`S180`/`S186` family — a summary that can be right for the wrong reason. The Python tool prints flags and refuses on incompleteness; it never says "converged". |
| **Byte-based scoring anywhere** | R5. Bytes appear only as a `size`/`sha256` **label** next to record data. |
| **Anything touching the relay or `server/`** | Out of scope, and the scaffold is designed to hand that question up rather than answer it. |
| **`CanvasBinding` instrumentation beyond what I5 gets free** | `types.ts:287` ships `useCanvasBinding: false`, frozen behind a §7 pin. Dormant. |
| **Reading or hashing `data.json`** | R4. |

**One thing I am flagging as too risky to build untested, for the Dispatcher to decide** — not quietly adding
a test for it, per instruction: **step 3's instance patching of `adapter.applyNodeGeometry` /
`reloadCanvasData` sits directly in the product's view-write path on the owner's live vaults.** If the wrapper
throws, a real remote change fails to reach the view. Mitigation *by construction*, and I would build it this
way regardless: the wrapper calls the original **first**, in its own statement, stores the result, and does
every diagnostic read inside a `try { … } catch { /* diagnostics must never break canvas interaction */ }` —
which is verbatim the pattern `canvas-adapter.ts:828-836` already uses for its own patches. With that shape
the failure mode is a missing ledger row, never a missing apply. **If the Dispatcher is not comfortable with
that on a live vault, steps 1, 2 and 4 have no patching at all and still answer H3, H6, H9 and the
unattributed delta.**

---

## 7. What I found already wrong, or already narrowed, on inspection

Every line number below was re-verified against the tree at `9c57a27` today.

### 7.1 H1 is sound but it is **two** claims, and the second is the load-bearing one

The ordering is exactly as briefed — `this.expireIdleInferredLocks()` at `canvas-presence.ts:367`,
`this.reconcileClaims()` at `:370`, in the same `awareness.on("change")` listener. Confirmed.

But note what the reorder does *directionally*: it makes the **receiving** peer claim less, therefore revert
**less**, therefore write to its own view **less**. For H1 to explain a *worsening*, `reconcileClaims` →
`onRevert` → `revertCanvasNode` → `applyNodeGeometry(sharedTruth)` must have been a **corrective pull toward
the doc** that something else's error was leaning against. That is a coherent story and I think it is the
right one to test first — but it means **H1 cannot be true alone**. Something else has to be moving the cards
wrongly for the removal of a corrective to show up as accumulation. Whoever repairs on H1 should expect to
find H8 or H9 underneath it.

Second, the expiry is gated on `INFERRED_LOCK_IDLE_MS = 15_000` (`canvas-presence.ts:59`), so H1 requires
claims already ≥15 s idle. Plausible given the measured leak, but it is a precondition I4 must confirm rather
than assume.

Third, and this compounds: `expireIdleInferredLocks()` **broadcasts** when it expires anything
(`emitLocalState()` at `:468`). That broadcast is an awareness `change` on every other peer, which runs
*their* expire+reconcile+refresh. **WP120 introduced an awareness event class that did not exist before**, and
every one of those events now runs `reconcileClaims()` — and therefore possibly `applyNodeGeometry` — on
peers that did nothing. I3 and I4 will show this directly and it is not in the charter's seven.

### 7.2 H5 is much narrower than it reads — `refresh()` cannot move a node

`onViewportChange(() => this.refresh())` is real (`canvas-presence.ts:387`). But `refresh()` (`:596-631`)
does exactly two things: it renders **cursors** into the overlay, and it calls `applyRings(desired)`.
`applyRings` → `addRing`/`removeRing` (`:647-675`) only toggles a CSS class, sets a custom property and
appends/removes a `<div>` tag inside the card element. **There is no node-geometry write anywhere on that
path.** So *"a viewport change misread as node movement"* has no route through presence. Cursor coordinates
are canvas-space on the wire and converted per-peer at render (`:608`, `canvasToScreenRelativeToWrapper`), so
a coordinate-space bug there is **cosmetic** — a cursor in the wrong place, not a card.
The only residual worth a row is whether `el.appendChild(tag)` can perturb Obsidian's own layout for a card;
I7 plus I8 will show it if it does. **I would rank H5 last.**

### 7.3 H6 looks wrong as stated — `emitHeld` does not upsert geometry

`emitHeld` (`canvas-adapter.ts:845-858`) does exactly one thing: it diffs the held id set and fires
`startListeners` / `endListeners`. Those land on `presence.acquireLock(nodeId)` / `releaseLock(nodeId)`
(`canvas-presence.ts:378-379`), which write **awareness only** — `emitLocalState()`, no doc, no file, no
geometry. This is consistent with §6 of `DISPATCHER_STATE`, which already records the measurement:
*"Selecting a card does NOT rewrite the `.canvas` file on the selecting client — `setDataCount 0`,
`requestSaveCount 0`."*

What a selection *does* cause is an **awareness change on every peer**, and that is where the damage is done —
on the receiving side, not the selecting side. **H6 should be re-stated as: a selection is an awareness event,
and an awareness event runs expire + reconcile + refresh on every peer.** I5 settles the original claim with a
straight yes/no (does a click produce any doc transaction at all), and it should be one of the first readings
taken.

### 7.4 H7 is reframed: there is **no captured rollback snapshot**

`revertCanvasNode` (`main.ts:3990-4023`) does **not** hold a pre-claim snapshot. It reads
`this.canvasSync.getCanvasSnapshot(rawPath)` **at revert time** (`:3999`) and applies that one record's
geometry (`:4105`). So *"the rollback snapshot is captured at the wrong moment"* is not the mechanism.
The failure mode that survives is different and still live: **the revert faithfully restores whatever the doc
says, and the doc may be wrong.** That makes the revert an *amplifier* of a bad doc rather than an
independent source of error — which is a materially different repair. I3's `docPos` field is what measures
it.

Also worth recording while reading that method: `applyCanvasNodeRevert` deliberately arms **no mute**
(`main.ts:4095-4104`), on the argument that the canvas branch of the modify gate does not consult it and uses
a byte echo breaker instead. That argument is inherited from WP91 and is not re-verified here — see 7.6.

### 7.5 H8 (new) — the whole-board blast radius WP119 removed still exists on the ordinary remote path

`main.ts:3231-3235`: if any node **that is an edge endpoint** actually moved, the per-node geometry pass
escalates to `adapter.reloadCanvasData({nodes, edges})` — `setData` of the entire board. WP119 removed the
*revert's* escalation; this one is untouched and is on the **normal remote-delta path**, which is the path
every click's downstream effects travel. On a board where most cards have arrows, one moved card
re-lays-out everything. **That is the owner's symptom verbatim, from a route none of the seven hypotheses
name.** I2's `reloadCanvasData` row exists specifically to catch it, which is why it is in build step 3.

### 7.6 H9 (new) — the corrective write re-entering capture is the only shape that *accumulates*

Every other candidate explains a *jump*. Only a loop explains *growth*. The loop needs a view write that
becomes a doc write. The ingredients are all present and none of them is speculative:

- `applyNodeGeometry` calls Obsidian's own `node.moveAndResize(...)` (`canvas-adapter.ts:1152`), which is a
  real view mutation and can trigger Obsidian's own `requestSave`.
- `reconcileLiveCanvas` guards against exactly this with `this.fileOpsManager.mutePathEvents(diskPath)`
  (`main.ts:3176`) — *"so the reconcile never loops back into a sync"*, in its own words.
- **`applyCanvasNodeRevert` does not** (`main.ts:4095`, "NO MUTE HERE, and that is a decision").
- If the resulting file write reaches `handleLocalModify` → capture, it is written to the doc under
  `chooseCaptureOrigin(...)` → `CANVAS_CAPTURE_ORIGIN` with `tr.local === true`
  (`files/canvas-sync.ts:3632`, `:3640-3648`) and **broadcast as this peer's own edit**.

I5 detects this in one row: a `canvas-capture-origin`, `local: true` transaction for a node the local user
never touched, arriving right after an I2 row for that same node. **If that row appears, stop the
investigation and report it** — it is sufficient on its own, and it is the only candidate that predicts the
owner's exact phrasing about accumulation.

---

## 8. Signals this package should be ready to allocate

Not allocating — the Dispatcher is the allocation authority and `NEXT_FREE` lives in
`check_signal_register.py`. Flagging what this spec produced that is register-shaped:

- The `movedEndpoint` whole-board `setData` escalation surviving on the ordinary remote path (§7.5).
- `expireIdleInferredLocks()`'s broadcast creating a new class of awareness event that runs
  `reconcileClaims()` on peers that did nothing (§7.1).
- The revert path's absent mute vs `reconcileLiveCanvas`'s present one (§7.6), and the WP91 argument that it
  does not matter — traced, not measured.

---

**Author's note to the Dispatcher.** The single most valuable thing in this document is not any of the seven
hypotheses; it is **§1.8, the unattributed delta**, and it needs no hook at all. This run has aimed three
repairs by inference and missed three times. Build steps 1 and 2, run one guided session, and let the board
tell you which plane is lying before anyone patches anything.
