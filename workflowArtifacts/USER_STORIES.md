# User Stories — Obsidian Live Share (Round 2: Latency-Resistance, Canvas Presence & Per-Card Locking)

> Created by Worker 2 (Spec Architect). All Phase-A user stories with full, numbered,
> observable acceptance criteria. Expanded from `PLAN.md` §User Story Sketch (6 sketches).
> Graph basis: none — Graphify disabled; grounded on PLAN.md discovery + Round-1 code.
> Naming: `obsidian-live-share/workflowArtifacts/USER_STORIES.md`
>
> **Scope:** Phase A only (no external deps). Phase B (OIDC / headless host / admin UI /
> status console) is a decided future direction, not storied here.
>
> **Terminology (from `BUG_ANALYSIS.md` §0, keep distinct):**
> - **In-editor caret** = Yjs *awareness*, per file, over the MUX transport, rendered by yCollab. This is what US1 is about.
> - **Presence panel** = control-channel `presence-update` (who/where). Already correct — out of scope.
> - **Canvas presence** = new awareness channel on the canvas Y.Doc (`getDoc().awareness`), net-new (US2/US3).

---

## US1 — Text caret is always visible within a second and never vanishes while idle

**As a** collaborator,
**I want** to always see everyone's text caret/selection within one second of opening a shared note, and to keep seeing it even when they sit still,
**so that** I know who is where, even over a real internet link with latency.

### Acceptance Criteria

1. When peer B opens a shared note that peer A already has open (A's caret set before B subscribed), B renders A's caret/selection within **≤ 1000 ms** of B's MUX subscription completing, without A moving the caret. (Closes Round-1 Bug A asymmetry — the static-caret join race.)
2. The join transfer is symmetric: A also renders B's caret within ≤ 1000 ms of B joining. Verified in a two-client test where each side asserts the other's caret decoration exists.
3. A caret that has not moved for **> 30 s** remains rendered on every peer (no y-protocols 30 s prune of a static caret). Measured by holding a static caret across a simulated 35 s window and asserting the remote decoration still exists. (GAP-6.)
4. The awareness heartbeat re-emits the **full local awareness state** (including `lockedNodes` when present) at a fixed interval **< 30 s** (target 10–15 s). Verified by capturing outbound MUX awareness frames and asserting the inter-emit gap is < 30 s even with zero local edits.
5. `reemitLocalAwareness` no longer bails when `getLocalState()` is a static (non-null structurally but movement-free) caret: a peer joining during the ~1 s sync/text-wait window still receives the caret. Verified by joining mid-sync and asserting the caret appears without any local caret movement. (Fixes the `null`/static-state re-emit bail at `sync.ts:392-402`.)
6. On **reconnect** after a socket drop, the client ticks its awareness clock via `setLocalState(getLocalState())` so its caret becomes visible again to peers without the user typing. Verified by dropping+restoring the socket and asserting the peer re-renders the caret within ≤ 1000 ms of reconnect. (GAP-4, y-websocket #122 fix.)
7. Reconnect does **not** create a split lock or a duplicated awareness identity: after reconnect the client re-uses its existing `clientID` / awareness slot rather than appearing as a second ghost peer. Verified by asserting exactly one awareness entry for the reconnected client. (GAP-4.)

### Definition of Done

A two-client latency test (50–150 ms RTT, provided by WP5) demonstrates: symmetric caret visibility on join ≤ 1000 ms, static-caret survival past 35 s, sub-30 s full-state heartbeat frames on the wire, and caret re-visibility after reconnect with a single awareness identity — all green.

### Linked WPs

WP1, WP5

---

## US2 — Canvas shows other people's cursors and a "here/typing" indicator

**As a** collaborator on a canvas,
**I want** to see other people's cursors and a typing/"here" indicator on the canvas,
**so that** a canvas feels as alive and coordinated as a text note.

### Acceptance Criteria

1. When two clients have the same canvas open, each renders the other's cursor position as a DOM overlay marker on the canvas surface, updating as the remote cursor moves. Verified by moving one client's cursor and asserting the peer's overlay marker coordinates change.
2. Each remote cursor marker is labelled/colored with that peer's identity (name + color from the awareness field). Verified by asserting the overlay element carries the peer's color and name.
3. A "here/typing" indicator is shown for a peer that is actively present on (and/or editing a node of) the canvas, using the awareness field `{ canvasPath, nodeId|null, x, y, ... }`. Verified by asserting the indicator appears for a present peer and is absent for a peer on a different canvas.
4. Canvas presence rides the **canvas doc's own awareness channel** (`getDoc().awareness`), not the CodeMirror/editor awareness. Verified by asserting canvas cursors render with no `MarkdownView`/CodeMirror editor active (the activation path must branch to `CanvasView`, not hard-return as at `main.ts:749-802`).
5. When a peer closes the canvas or disconnects, its cursor/indicator is removed from every other client's overlay within one heartbeat interval (no stranded ghost canvas cursor). Verified by disconnecting a peer and asserting its overlay marker is gone.
6. The awareness field shape written is exactly `{ canvasPath, nodeId|null, x, y, lockedNodes: {[nodeId]: {color, name}} }` (single shared shape reused by US3). Verified by inspecting the emitted awareness state object shape.

### Definition of Done

Two clients on the same canvas see each other's live cursors and here/typing indicators via the canvas-doc awareness channel and the new DOM overlay; markers carry identity color/name and disappear on leave — demonstrated in a latency test.

### Linked WPs

WP2, WP1 (awareness plumbing), WP5

---

## US3 — Editing or moving a card locks it in the editor's color; others cannot clobber it

**As a** collaborator,
**I want** that when I start editing or moving a card, everyone else sees it locked with my color and cannot edit or move it until I'm done,
**so that** our changes never clobber each other on the same card.

### Acceptance Criteria

1. When a client begins editing or dragging a canvas node, it acquires a lock recorded in `lockedNodes[nodeId] = {color, name}` on its canvas awareness, and every peer renders that node with a "held" highlight in the holder's color. Verified by asserting the peer overlay shows the node highlighted in the holder's color.
2. Lock acquisition is **hybrid**: the client attempts Obsidian's private Canvas view API to detect drag/edit-start; if that internal API is unavailable/unstable it **falls back to diff-inferred locking** (lock the instant a node's keys first change in the diff path). The fallback is a real, tested code path — not a stub. Verified by a test that forces the private-API path to be absent and asserts a lock is still acquired on first key change.
3. **Provisional-claim tiebreak (GAP-1):** if two clients claim the same node within one RTT, the claim with the **lowest `clientID`** (or lowest awareness Lamport clock) wins deterministically; the loser reverts its optimistic edit and releases its claim. After settle there is **exactly one** holder and **no dual ownership**. Verified by a two-client test that issues both claims inside one simulated RTT and asserts: winner = lowest clientID, loser's `lockedNodes` no longer contains the node, loser's optimistic edit is rolled back.
4. **Settle-before-mutate (GAP-3, WP3 half):** a claim is treated as *pending for ~1 RTT / one heartbeat* before the holder commits a mutating write; a competing lower-id claim seen during that window aborts the local mutation. Verified by asserting the loser performs no committed CRDT write to the node.
5. `canWriteNode(path, nodeId)` returns **false** while a lower-id peer also claims the node, and false while another peer holds the lock; the per-node diff path (`canvas-sync.ts:284-318`) drops writes for which `canWriteNode` is false. Verified by asserting a non-holder's attempted node edit produces no CRDT change to that node.
6. **Delete-wins / no-resurrect (GAP-2):** a lock holder that observes a remote delete of its locked node **aborts the edit, drops the lock, and does not resurrect** the node (the diff path must not re-create it as at `canvas-sync.ts:304-311`). Verified by deleting a node remotely while it is locked+edited locally and asserting the node stays deleted and the holder's lock is released.
7. **`canDeleteNode` guard:** a peer cannot delete a node that another peer currently holds locked. Verified by asserting an attempted delete of a peer-held node is dropped (node still present, still locked).
8. Releasing (end drag / end edit / blur) removes the node from `lockedNodes` and clears the "held" highlight on all peers within one heartbeat. Verified by ending an edit and asserting peers no longer highlight the node.
9. **Optional lock-epoch (GAP-7):** if a lock-epoch/Lamport counter is implemented, a resumed holder whose lock has been superseded self-aborts its stale write. If not implemented, the bounded-LWW risk is documented (see BUILD_SPEC §5) and no AC fails on its absence. Verified only when the epoch field is present.

### Definition of Done

Two clients contending for the same card converge to a single deterministic holder with the loser reverted; the held card shows the holder's color on peers; delete-wins and canDeleteNode prevent resurrection/clobber; locks release on end-edit — all demonstrated under simulated latency.

### Linked WPs

WP3, WP2 (shared overlay), WP5

---

## US4 — A crashed or dropped card-holder's lock releases automatically

**As a** collaborator,
**I want** the lock on a card to release automatically if the person holding it crashes or drops offline,
**so that** a card never gets permanently stuck.

### Acceptance Criteria

1. Lock state is carried on the canvas doc's **Yjs awareness** channel, which auto-clears on disconnect; when a holder's socket drops, its `lockedNodes` entry is removed on all peers and the "held" highlight clears within one prune/heartbeat cycle. Verified by hard-dropping the holder's socket and asserting peers can acquire the node afterward.
2. An **idle** holder (no caret/cursor movement) that is still connected for **> 30 s** keeps its lock: the full-state heartbeat (US1 AC3/AC4) re-emits `lockedNodes` under the 30 s prune window so the lock is not silently dropped. Verified by holding a lock idle across a simulated 35 s window and asserting peers still see it held and `canWriteNode` is still false for them. (GAP-6.)
3. On **reconnect**, the returning client does **not** blindly re-assert previously-held locks: it re-requests current `lockedNodes` and only re-claims nodes still free; any node another peer acquired in the interim is not re-grabbed. Verified by having a peer grab the node during the disconnect and asserting the reconnecting client does not reclaim it (no split lock). (GAP-4.)
4. After a holder disconnect + a peer's fresh acquisition, there is never a window with two live `lockedNodes` entries for the same node from different clients (no split ownership). Verified by asserting at most one holder across the disconnect/reacquire sequence.

### Definition of Done

A holder crash/drop frees the card automatically; an idle-but-connected holder keeps it past 30 s; a reconnecting holder does not steal back a reacquired card — all demonstrated under simulated latency with no stuck or split locks.

### Linked WPs

WP1 (heartbeat/reconnect/auto-release plumbing), WP3 (lock lifecycle), WP5

---

## US5 — A guest's canvas text and nodes are not silently deleted by concurrent writes

**As a** guest editing a canvas over the network,
**I want** my text and nodes to not be silently deleted by the host's or another guest's concurrent write,
**so that** I don't lose work to a race I can't see.

### Acceptance Criteria

1. The local text/canvas disk-flush **yields to in-flight remote deltas** via a version/sequence gate instead of racing on the wall-clock debounce: a local whole-file flush must not overwrite a remote delta that has not yet been applied locally. Verified by injecting a remote delta in-flight during a local flush and asserting the remote change survives (not clobbered). (Closes the remaining canvas guest-text-loss window: `canvas-sync.ts` diff path / `background-sync.ts` text path.)
2. On receiving a **remote lock** for a node with un-flushed local edits, the client **drops those local edits** rather than pushing them. Verified by asserting the un-flushed local node edit is discarded and the remote holder's value stands. (GAP-3, WP4 half.)
3. **Cascade/prune dangling edges (GAP-5):** when a node is deleted (locally or remotely), edges whose endpoint is that node are pruned; dangling edges are also pruned on serialize so no edge references a non-existent node. Verified by deleting an endpoint node and asserting no edge in the serialized `.canvas` references the deleted node id.
4. The Round-1 **single-writer text invariant stays intact**: `collabBoundFile` / active-file gating in `background-sync.ts` is not weakened by these changes. Verified by re-running the Round-1 frontmatter/single-writer regression tests green (no reintroduction of Bug B).
5. No change reintroduces the already-fixed ghost-caret or per-key canvas diff behavior (BUG_ANALYSIS "Bug C/D" are stale; ghost-caret fix at `ws-handler.ts:236-237` `lastClock+1` and per-key diff at `canvas-sync.ts:104-119,300-303` stay live). Verified by asserting those Round-1 tests remain green.

### Definition of Done

Under simulated latency, a guest's in-flight canvas node/text edits survive concurrent host/guest writes (version-gated flush, drop-on-remote-lock), edges never dangle, and no Round-1 fix regresses — all green.

### Linked WPs

WP4, WP3 (delete-wins interplay), WP5

---

## US6 — Fixes are validated under simulated latency (50–150 ms RTT)

**As a** maintainer,
**I want** the fixes validated under simulated latency of 50–150 ms RTT,
**so that** I trust the results — because localhost (≈0 ms) hides exactly these races.

### Acceptance Criteria

1. A two-client E2E harness injects a configurable RTT in the **50–150 ms** range between clients and the relay. Verified by asserting the harness applies the delay (measured round-trip within the target band).
2. The harness reproduces, as **red tests first** (fix-as-failing-test is ON, see BUILD_SPEC §7), the WP1–WP4 symptoms: (a) same-card claim within one tick → tiebreak, (b) delete-vs-lock (no resurrect), (c) idle-holder > 30 s lock survival, (d) reconnect no-split-lock, (e) guest canvas text/node survival under concurrent write. Verified by each named test existing and failing on the pre-fix tree, passing post-fix.
3. Each WP1–WP4 acceptance criterion that describes a race has a corresponding assertion in the harness (regression coverage). Verified by a mapping from WP AC → test id being present in the harness.
4. The harness is deterministic (fixed seeds / controlled delays, no ad-hoc timing sleeps that flake). Verified by the suite passing repeatably (no order/timing flakiness) in CI-style repeated runs.
5. A **zero-latency** run of the same harness must **not** be relied on as proof — the suite's race assertions are meaningful only with injected latency; this is documented and the latency path is the gating one. Verified by the suite skipping/annotating race assertions when RTT is 0.

### Definition of Done

A deterministic 50–150 ms RTT two-client harness exists, reproduces every targeted race as an initially-red test, and asserts the fix for each — providing the regression net for WP1–WP4.

### Linked WPs

WP5 (depends on WP1–WP4)

---

<!-- GAP → AC traceability:
     GAP-1 → US3 AC3/AC4 (WP3)   GAP-2 → US3 AC6/AC7 (WP3)
     GAP-3 → US3 AC4 (WP3) + US5 AC2 (WP4)
     GAP-4 → US1 AC6/AC7 + US4 AC3 (WP1)   GAP-5 → US5 AC3 (WP4)
     GAP-6 → US1 AC3/AC4 + US4 AC2 (WP1)   GAP-7 → US3 AC9 (WP3, optional/bounded) -->
