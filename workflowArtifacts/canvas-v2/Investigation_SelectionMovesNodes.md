# Investigation — a selection on one client moves cards on another

**Branch:** `fix-bugs-and-raceconditions` · **HEAD:** `5539578` · **Role:** investigator, no product code changed
**Deliverable test:** `plugin/src/__tests__/v2/selmove/test_selection_moves_nodes.test.ts` — 12 rows, one of them
RED on the defect (`it.fails`), driving shipped code on both ends.
**Rig:** not used. Another investigator owns the three vaults on `93c65f06a347e6cc`; nothing was rebuilt,
reinstalled, deployed or driven. Everything below is code, history and headless measurement.

---

## 0. Verdict in one line

**A selection is not read-only in this plugin: `CanvasPresence` turns it into an awareness lock claim, and one
contested lock on the receiving peer triggers `revertCanvasNode` → `reconcileLiveCanvas(..., {initial: true})`,
which is an unconditional `setData` of the ENTIRE board.** The trigger is one card; the effect is every card.
The `.canvas` file on the *selecting* client is not touched at all — the mutation is manufactured on the
*receiving* client, out of a presence message.

**No commit in the bisect window touches any part of that chain.** I could not attribute the worsening to one of
the eight, and I have positive evidence against all eight — see §4.

---

## 1. The mechanism, line by line

Every step is production code on the default configuration (`useCanvasBinding` defaults to `false`,
`types.ts:287`, so the CanvasBinding/model-bridge path is OFF and the legacy reconcile path is live).

| # | File:line | What happens |
|---|---|---|
| 1 | `canvas/canvas-adapter.ts:874` | `patch("updateSelection", () => emitHeld(readSelectionIds()))` — Obsidian's selection method is monkey-patched. Clicking a card fires it. |
| 2 | `canvas/canvas-adapter.ts:845` | `emitHeld` fans newly-held ids to `startListeners`. |
| 3 | `canvas/canvas-presence.ts:320` | `onNodeInteractionStart((nodeId) => this.acquireLock(nodeId))`. |
| 4 | `canvas/canvas-presence.ts:343-348` | `acquireLock` writes `lockedNodes[nodeId]` and calls `emitLocalState()` — **an awareness write. This is where a read-only gesture becomes a peer-visible event.** |
| 5 | `canvas/canvas-presence.ts:308-316` | On the peer, the awareness `change` listener runs `reconcileClaims()` first, then `refresh()`. |
| 6 | `canvas/canvas-presence.ts:375-393` | `reconcileClaims`: for every node **this** client holds, if any **lower** clientID also holds it, drop the claim and call `onRevert(nodeId)` (GAP-1 loser tiebreak). |
| 7 | `main.ts:3896` | `onRevert: (nodeId) => this.revertCanvasNode(rawPath, nodeId, awareness)` — the production seam. |
| 8 | `main.ts:3914-3931` | `revertCanvasNode` fetches `getCanvasSnapshot(rawPath)` and calls `this.reconcileLiveCanvas(rawPath, snapshot, { initial: true })`. **It passes the WHOLE snapshot, not the reverted node.** |
| 9 | `canvas/reconcile-plan.ts:166` | `if (input.initial) return "structural";` — unconditional, no diff consulted. |
| 10 | `main.ts:3180-3184` | `structural` ⇒ `adapter.reloadCanvasData({nodes: surfaceData.nodes, edges: surfaceData.edges})`. |
| 11 | `canvas/canvas-adapter.ts:1159-1172` | `reloadCanvasData` ⇒ `canvas.setData(data)` + `requestFrame()`. Every card is re-laid-out from the shared document. |

**The asymmetry is the defect.** Step 6 is per node — one contested id. Step 8 discards that id and hands the
whole board to an authoritative reload. So the user clicks card *n2* on client 1 and cards *n1*, *n3*, … snap on
client 2. The clicked card is typically the one card that does **not** move, because it is the one both peers
already agree about — which matches the report exactly: *"other cards jump around"*.

### Why it is deterministic rather than occasional

The revert only fires if the receiving peer holds a lock on the selected node and loses the lowest-clientID
tiebreak. Two properties make that the normal state rather than a coincidence:

- **Locks are acquired by the capture path, not only by gestures.** `canvas-sync.ts:4130` calls
  `onLocalNodeChange` for **every node record a local capture upserts**; `main.ts:2505` forwards it to
  `CanvasPresence.onDiffInferredChange`, which acquires a lock. One save that upserts twenty nodes claims twenty
  locks, without the user having selected anything.
- **Those locks are effectively unreleasable.** `releaseLock` is reached from exactly two places
  (`canvas-presence.ts:321` via `emitHeld`'s end-branch, and `onRemoteNodeDeleted`). `emitHeld` can only release
  ids it put into `held` itself, and a diff-inferred claim never was. The only gesture that clears one is
  selecting that same card in person and then dropping the selection. Measured, both directions, in T3.
- **The tiebreak is fixed for the session.** Yjs clientIDs are stable, so whichever peer is higher loses **every**
  contest for the whole session. That is "every time", not "sporadic".

---

## 2. Does the `.canvas` file change on disk when a card is merely selected?

**On the selecting client: no.** The plugin never calls `canvas.requestSave()` — the only reference in the whole
of `plugin/src` is the type declaration at `canvas-adapter.ts:321` and comments; the only method the adapter
invokes is `requestFrame()`. A selection reaches `emitLocalState()` and stops. T1 measures this positively:
after `driver.select([...])` the selecting peer's canvas has `setDataCount === 0`, `requestSaveCount === 0` and
unmoved geometry. **So the ranked starting hypothesis — "Obsidian rewrites the file on select and
`handleLocalModify` reads it as intent" — is REFUTED as the primary cause.** The cause is in our own
awareness/apply path, exactly as the brief's fallback branch predicted.

**On the receiving client: yes, indirectly, and this is the second-order half of the defect.** The
selection-triggered reload is a `setData`, and `main.ts:3169-3171` says so in its own words: *"Live mutations may
trigger Obsidian's own requestSave; mute our modify handler for the settle window so the reconcile never loops
back into a sync."* That mute does not hold for a canvas-owned path, and `main.ts:3274-3284` states it
explicitly: the canvas `modify` gate returns through WP91's byte-identity branch, **which does not consult the
mute at all** (`files/vault-events.ts:390-407`). The only remaining guard is the byte compare
`content === this.lastWrittenContent.get(path)` at `canvas-sync.ts:3552`.

That guard is exactly what `S150` says is unreliable: a canvas has **two stable byte forms**, and a host's file
keeps its authored one (`139/140 B` against the guests' `173/174 B`, still divergent 25 minutes later, both
arms, every round). When Obsidian re-serialises the board after our `setData`, the bytes it writes need not equal
the bytes we last wrote — and when they do not, `handleLocalModify` runs a full-file capture, upserts nodes
(claiming yet more diff-inferred locks at `canvas-sync.ts:4130`) and pushes them back to the peers.

**That is the "it no longer heals itself" half.** A revert that lands on a peer whose byte form differs from ours
does not terminate: it produces a save, the save produces a capture, the capture produces a push, the push
produces a reconcile on the other side. `S150` was filed as a cosmetic serialisation divergence and declined as a
defect pending its rule-owner's decision; through this path it is a **liveness** problem, not a cosmetic one.

**⚠ This paragraph is the one part of the report that is traced rather than measured.** Whether Obsidian's
`requestSave` actually fires after our `setData`, and with which byte form, is a live-rig question. See §6.

---

## 3. Why the arrows hold still while the nodes move

This is diagnostic, and the codebase already wrote the diagnosis down. `main.ts:3157-3161`:

> *"Nodes that are an endpoint of some edge. Moving one of these per-node only repositions the card; the live
> edges keep their OLD routing (fromSide/toSide) → arrows look detached and Obsidian re-saves its own recomputed
> routing, which fights the sync. This is why moving a card with >1 connection breaks sync."*

Both apply routes write geometry into Obsidian's node objects without recomputing edge routing from the moved
endpoints:

- **the geometry route** — `applyNodeGeometry` (`canvas-adapter.ts:1130-1156`) calls `node.moveAndResize(...)`
  and returns. Note what it does **not** do: unlike `reloadCanvasData` two functions below it
  (`canvas-adapter.ts:1168`), it never calls `canvas.requestFrame()`. Nothing asks the canvas to re-render.
- **the structural route** — `setData` reuses existing nodes rather than rebuilding them (WP37's own measured
  note, `canvas-editing-deferral.ts:14-18`: *"Obsidian's `setData` reuses existing nodes, so handing it a record
  whose fields already match the live card is a no-op"*). An edge record whose `fromNode`/`toNode`/`fromSide`/
  `toSide` are unchanged is handed back identical, so there is nothing in the data to make Obsidian re-route it.

**What that implies, and it is the useful part:** the cards are being moved by writing coordinates into Obsidian's
model from outside its own move gesture. A card the *user* drags takes its arrows with it because Obsidian's drag
path marks the incident edges dirty. Arrows that stay put are therefore positive evidence that **the plugin, not
the user, moved those cards** — the owner's observation is a clean attribution signal, not a cosmetic annoyance.

The `movedEndpoint` escalation at `main.ts:3225-3240` was added for precisely this symptom, but it only re-issues
`setData`, which has the node-reuse property above, and it is skipped entirely when `reloadCanvasData` declines
(`dragActive()`), so it is not a guarantee.

**Not settled here:** the CanvasDouble has no renderer, so the harness cannot witness the arrows. This is one of
the two things I want the rig for (§6).

---

## 4. Which commit made it worse — I cannot name one, and here is the evidence against all eight

The eight candidates were `39255ee` WP109, `6b191d8` WP110, `0be2227` WP114, `08dc888` WP115, `b68eb73` WP112,
`8585475` WP116, `31f7e26` WP113, `a81b4ee` WP117.

**Measured, not argued:**

1. **`plugin/src/canvas/**` — the whole selection, presence, adapter, reconcile-plan and deferral layer — has not
   been touched since `9249746` (B60/S82+S83), which is far outside the window.** `git log -- plugin/src/canvas`
   confirms it. Every one of the eleven steps in §1 lives either there or in the `reconcileLiveCanvas` region of
   `main.ts`, and `git log -L 3020,3040:plugin/src/main.ts` gives the same commit, `9249746`, as the last edit.
2. **None of the eight diffs mentions any symbol on the chain.** A grep of all eight `plugin/src` + `server/src`
   diffs for `reconcileLiveCanvas|revertCanvasNode|onDiffInferredChange|acquireLock|onLocalNodeChange|
   getCanvasSnapshot|planReconcile|applyNodeGeometry|reloadCanvasData|setOnRemoteCanvasUpdate|canvasPresence`
   returns **zero hits** across all eight.
3. **The two priors are cleared specifically.**
   - `0be2227` (WP114, S147) is entirely on the **text** side. Its `attachObserver`-before-`waitForSync` move is
     `BackgroundSync.subscribe` (`files/background-sync.ts:413-437`), not `CanvasSync.subscribe`; and its new
     `registerAnnounced` filters `.canvas` out by name — `skipsAutoTextSync(path)` at
     `background-sync.ts:242`. It cannot reach a canvas document. By extension **`S164` is not in play here
     either**: the five observer-attached-but-unreconciled exits it describes are the same text `subscribe`.
   - `a81b4ee` (WP117) does add an `attachCanvasWriter` re-bind, but only on the **adopt arm** of the mirror
     (`files/canvas-mirror.ts`, `verdict === ADOPT_LOCAL_FILE`), which is reachable only for a path this peer
     asked the host to create in this session, and is one-shot (`noteAdopted`). It cannot fire for an existing
     board, which is what the owner is selecting on.
4. **Nothing in the window added a mirror-pass call site** (`armCanvasMirrorPass`: zero added lines in all eight),
   so the reconcile cadence was not raised either.

**So what did change?** The chain in §1 fires whenever three conditions hold together, and none of them is code
the window touched:

- **(a)** the receiving peer holds a diff-inferred lock on the selected card;
- **(b)** that peer loses the clientID tiebreak — a per-session coin flip, stable for the session;
- **(c)** the shared snapshot disagrees with that peer's live view, so the reload is *visible*.

**(c) is the one that decides "sporadic and self-healing" versus "every time and permanent",** and it is the one
`S150` speaks to: once a peer's own byte form differs from the form the reload produces, the loop in §2 keeps
re-supplying disagreement instead of settling. `S150` was promoted from anomaly to verdict by **WP118**, i.e.
during exactly the period the owner is describing — but WP118 is a *measurement* package, it changed no product
code, so the honest statement is that the condition became **visible** then, not that it was introduced then.

**Ranked candidates for the worsening, with what would discriminate:**

| | Candidate | Discriminator |
|---|---|---|
| 1 | **`S150`'s two byte forms defeat the echo breaker at `canvas-sync.ts:3552`, so the reconcile→save→capture→push loop no longer terminates.** | On the rig: after a selection-triggered reload on the peer, does `handleLocalModify` decline `echo`, or does it capture? `CanvasSync`'s own `captureDeclineCounts()` answers it without a log grep. A capture where an echo was expected confirms it. |
| 2 | **Session luck on the clientID tiebreak (b).** Nothing changed; this session's clientIDs simply put the owner's client 2 on the losing side. | Restart both clients and re-test. If the direction of the jumping flips or the symptom disappears, it is (b). Cheap, and it must be ruled out before anything else is believed. |
| 3 | **Accumulated diff-inferred locks (a) grew** because this run's boards were edited more than the last one. | `CanvasPresence` exposes `isLockedByMe`; a live probe over the board's node ids after a quiet minute gives the lock census directly. A census that covers most of the board confirms it. |
| 4 | A relay-side change from WP118's redeploy altering awareness delivery. | Awareness is Yjs-native and content-blind to the relay; I found nothing in `server/src/control-handler.ts`'s diff touching it. Lowest prior. |

I am not going to name a culprit commit on this evidence. **The mechanism is older than the bisect window and
the window does not touch it.** If the Dispatcher wants a bisect anyway, the discriminator is row 2 above and it
costs one restart.

---

## 5. The failing test

`plugin/src/__tests__/v2/selmove/test_selection_moves_nodes.test.ts` — **12 rows, all green as committed**, with
the defect row expressed as `it.fails` so it is a red measurement that does not wedge the shared gate.

- **T1 — a read-only selection is a peer-visible event.** Two real `CanvasPresence` instances over one shared
  awareness map, real `createCanvasAdapter` over a real `CanvasDouble`, real `InteractionDriver`. Peer A selects;
  peer B's `onRevert` fires. Controls: swap the clientIDs (no revert), select a card B does not hold (no revert),
  and a positive read that A's own canvas took no `setData` and no `requestSave`.
- **T2 — one contested node re-lays out the whole board.** The real `revertCanvasNode` and the real
  `reconcileLiveCanvas` are invoked off `LiveSharePlugin.prototype` with a fake `this` (the `v2/wp85` precedent),
  so the code measured is the shipped code. Reverting `n2` moves `n1` and `n3` and leaves `n2` alone; one
  whole-board `setData`. Controls: no snapshot ⇒ view untouched; the same pass without `initial` ⇒ `noop`, no
  adapter call, nothing moves.
- **T3 — the lock leak.** A selection-acquired lock IS released on deselect (the control that gives the row
  teeth); a diff-inferred lock survives selecting, deselecting and dragging *other* cards. The claim is bounded
  in the same row: selecting that card in person and dropping it does clear it.
- **T4 — the defect end to end, RED.** Both halves joined at `main.ts:3896`. Peer A makes one selection; the
  assertion *"a read-only selection on peer A must not move any card on peer B"* fails on
  `expect(bDouble.setDataCount).toBe(0)` — **received 1**. A `SANITY` row proves the world is wired before the
  gesture, and a `WITNESS` row measures the movement positively (`n1` → `-900`, `n3` → `900`, `n2` unmoved), so
  the failure is attributable to the movement and not to a wiring error.

**Verification discipline (S146).** The file was run three times in isolation with identical results
(12/12; and 1 genuine failure with `it.fails` flipped to `it`, failing on the named assertion with `received 1`).
`npx tsc --noEmit -skipLibCheck` is clean. `canvas-presence.test.ts`, `reconcile-plan.test.ts` and
`canvas-adapter.test.ts` re-run green (74/74). **No full-suite gate figure was taken** — the tree is shared.

**No product code was changed. No signal numbers allocated.**

---

## 6. What only the live rig can settle

1. **Do the arrows really hold still, and on which route?** The `CanvasDouble` has no renderer. On the rig, the
   discriminator is the debug line `reconcile <path>: … structural reload ok` versus
   `reconcile <path>: geometry applied=N …` (both at `main.ts:3186` / `:3234`) taken at the instant the cards
   jump. If it is `structural`, then Obsidian's `setData` is not re-routing reused edges and the fix belongs
   there; if it is `geometry` with `movedEndpoint === false`, `applyNodeGeometry`'s missing `requestFrame` is the
   whole of it.
2. **Does the reload produce a `requestSave` whose bytes defeat the echo breaker?** §2's loop is traced, not
   measured. `CanvasSync.captureDeclineCounts()` (`files/canvas-sync.ts:3343`) distinguishes `echo` from a real capture
   without any log grep, and it is the single reading that turns §2 from a hypothesis into a verdict.
3. **The lock census.** How many nodes does a peer hold diff-inferred locks on after ten minutes of ordinary
   editing? That number is the answer to "why every time".
4. **The tiebreak control (§4 row 2).** Restart both clients and re-run the gesture. Must be done before anything
   else in this report is treated as the explanation for the *worsening* specifically.

---

## 7. Handoff notes for whoever repairs it

Not my call to make, but the seams are worth naming since I have them open:

- The narrow repair is at `main.ts:3914-3931`: `revertCanvasNode` knows the node it is reverting and throws it
  away. Reverting one node does not need `initial: true` and does not need the whole board.
- The wider one is `canvas-presence.ts:339-341`: a lock acquired by a *capture* is not a lock the user is holding,
  and giving it the same authority as a gesture-held lock is what makes an unrelated selection contested at all.
- Neither is safe to do blind. `initial: true` at `reconcile-plan.ts:166` exists for the fresh-mount case
  (US3 AC8) and the loser-revert was deliberately given the same authority; changing it needs its own package
  with the WP5 rows re-run.
