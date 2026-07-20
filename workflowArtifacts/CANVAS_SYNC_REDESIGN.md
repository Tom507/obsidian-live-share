# Canvas Sync — Architecture Review & Redesign

> Authoritative design doc for canvas multiplayer. Supersedes the scattered
> reasoning in `CANVAS_FIX_REPORT.md` and the fix log in `BUGFIX_STATUS.md`.
> Written after the v0.5.4–0.5.9 bug-fix rounds failed to produce a stable
> experience. Read this before touching canvas sync again.

**Verdict up front:** the current file-mediated canvas sync **cannot** be made
race-free by further patching. It is architecturally mismatched to how Obsidian
owns an open canvas. The text-collab path in this same repo already demonstrates
the correct pattern; canvas must be rebuilt to match it. Details below.

---

## 0. The one-sentence diagnosis

**Text collab binds the CRDT directly to the open editor (`yCollab`), so the open
document has exactly one writer. Canvas collab bridges the CRDT through the
`.canvas` file, so the open document has two writers — our `writeToDisk` and
Obsidian's own `requestSave` — and they race. Every canvas bug is a symptom of
that two-writer race.**

Evidence in-tree:
- `docs/architecture.md` line 55: *"The active file syncs through yCollab in the
  editor"* — open text file = single writer, CRDT-bound.
- `background-sync.ts:267`: *"Single-writer invariant: the active file is owned
  exclusively by yCollab"* — the codebase already knows this rule for text.
- `editor/collab.ts:107`: `yCollab(docHandle.text, docHandle.awareness, …)` — Yjs
  is bound to CodeMirror, **not** to the `.md` file. The file is a projection.
- Canvas has no equivalent binding. `canvas-sync.ts` reads the `.canvas` file on
  every `modify` event and writes it back on every remote delta. The file *is*
  the sync channel — the exact thing text sync deliberately avoids.

---

## 1. Why "guest stable, host scatters" (the latest finding)

Observed: the editing side is always rock-solid; the *following* side scatters as
soon as the other participant touches the canvas. It is not that the guest is a
privileged "main session" — it is that **the editor's view is Obsidian-native and
therefore authoritative, while the follower's view is driven by our reconcile
code, which makes Obsidian a second writer and loses the race.**

Step-by-step when the guest drags a card and the host is the follower:

1. Guest drags → Obsidian mutates the guest's live canvas model → Obsidian
   `requestSave()` writes the guest `.canvas`.
2. Vault `modify` fires → `handleLocalModify` (guest) → diff vs baseline → push
   to CRDT. Guest's own view was never touched by us → **stable**.
3. Host integrates the delta → observer → `reconcileLiveCanvas` → `setData()` /
   `moveAndResize()` on the host's **live** canvas.
4. **That view mutation makes Obsidian call `requestSave()` on the host**, writing
   the host `.canvas` a second time, from a *second* serializer (Obsidian's, which
   differs from ours in formatting, key order, and normalized fields).
5. We mute host `modify` events for `VAULT_EVENT_SETTLE_MS` around the reconcile —
   but Obsidian's `requestSave` is async/debounced and frequently lands **after**
   the unmute. When it does, `handleLocalModify` (host) runs, diffs Obsidian's
   just-written disk against our baseline, sees "changes," and **pushes them back
   into the CRDT** as if the host user had edited.
6. While the guest keeps dragging, the CRDT has already advanced (seq N+1) but the
   host's late write reflects seq N → the host pushes a **stale regression**. The
   guest integrates it, its card jumps back, its reconcile re-fires → oscillation.
   On the host, the stream of `setData` calls + its own racing `requestSave` =
   cards visibly flying.

The mute window and the semantic echo-breaker (v0.5.8) are timing/heuristic
mitigations. They hold for a single discrete edit (which is why "host-only
editing looked perfect") and **lose under a continuous stream of deltas from the
other side** (which is why bidirectional / follower-side breaks instantly).

Secondary asymmetry (why the host specifically looked worse in the last test):
baseline provenance differs by role — the host seeds `lastWrittenContent` from its
own file, the guest from the serialized CRDT / a forced initial reconcile — so the
two sides enter steady state with slightly different baselines and lose the race at
different rates. This is noise; the structural cause above is the signal. Do not
tune it.

---

## 2. Design decisions made during the bug-fix rounds (chronicle)

Each was locally correct and each revealed a layer of the structural problem.

| Ver | Decision | Rationale | What it revealed |
|---|---|---|---|
| 0.5.4 | Rebuild the canvas adapter against the **real** private Canvas API (monkey-patch `updateSelection`/`setDragging`/`markViewportChanged`; live viewport = `x/y/zoom`) | Canvas has no event emitter; there was no other way to observe it | The API is patch-only and untyped — every integration point is defensive |
| 0.5.5 | **Lazy-subscribe** canvases opened mid-session + `[canvas]` logging | Session-start loop only subscribed manifest canvases; opening one later left it dead | Subscription lifecycle ≠ view lifecycle — they must be reconciled continuously |
| 0.5.6 | **Geometry-key guard** — never delete `x/y/w/h` from the CRDT on a partial disk read | A stray partial read was stripping positions → scatter on all peers | The `.canvas` file is read in states we don't control; partial/interleaved reads are normal |
| 0.5.7 | **Live-view reconciliation** — drive the open canvas via the private API on each remote delta (per-node `moveAndResize`, structural `setData`), guarded by `isBusy()` | Obsidian's open canvas ignores external file writes, so file-only sync left the view stale | Introduced the **second writer**: driving the view makes Obsidian `requestSave` |
| 0.5.8 | **Echo-breaker** — `handleLocalModify` bails when disk *semantically equals* the CRDT | Kill the reconcile→save→modify feedback loop | Works only when disk has settled to the CRDT; a moving target defeats it |
| 0.5.9 | **Initial-sync reconcile** (forced `setData` at first sync, both mount and guest-subscribe) + **edge-reflow** (escalate to `setData` when a moved node is an edge endpoint) | First render was stale; moving a multi-edge card left arrows detached and triggered a re-save fight | Even "correct" reconciles must re-serialize the whole view → more two-writer pressure |

**The pattern:** every fix added another guard (mute window, sequence gate,
geometry guard, semantic echo-break, forced reconcile) to compensate for the fact
that we are round-tripping the open document through a file that Obsidian also
owns. We are fighting the platform. The guards multiply; the races don't stop.

---

## 3. Current architecture (as-built)

```
        ┌─────────────── peer A (editor) ───────────────┐         ┌─── peer B (follower) ───┐
user →  │ Obsidian canvas model ──requestSave()──▶ .canvas│         │ .canvas ◀──writeToDisk── │
        │        ▲                                   │     │         │   │ (Obsidian ignores it │
        │        │ moveAndResize (reconcile)         │ modify         │   │  while view is open) │
        │        │                                   ▼     │         │   ▼                      │
        │   reconcileLiveCanvas ◀─observer─ Y.Doc ◀─handleLocalModify─┼─▶ Y.Doc ─observer─▶ reconcileLiveCanvas
        └────────────────────────────────────────────────┘         │        │ setData/moveAndResize │
                                                                    │        ▼ → Obsidian requestSave │
                                                                    │      .canvas (2nd writer!) ─modify─▶ handleLocalModify ─▶ Y.Doc
                                                                    └──────────────────────────┘
```

Three states are kept in sync per peer: **CRDT ↔ `.canvas` file ↔ live canvas
model.** The file sits *between* the CRDT and the model as the sync bus. Both the
sync layer and Obsidian write to it. There is no single source of truth.

Trigger points:
- **Local edit in:** vault `modify` event → `handleLocalModify` (reads file, diffs
  vs `lastWrittenContent`, pushes to CRDT).
- **Remote delta out:** Yjs `observeDeep` → `scheduleDiskWrite` (CRDT→file) **and**
  `onRemoteCanvasUpdate` → `reconcileLiveCanvas` (CRDT→live model, which makes
  Obsidian write the file *again*).

The core defect: a vault `modify` event **cannot be demultiplexed**. It fires
identically for (a) a genuine user edit, (b) our own `writeToDisk`, and (c)
Obsidian's `requestSave` triggered by our reconcile. We disambiguate with
`recentDiskWrites`, `mutePathEvents`, and semantic equality — all timing/heuristic,
all defeated by a continuous stream.

---

## 4. Conceptual check — are the critical paths covered?

**No.** Coverage of the concurrency-critical paths, honestly assessed:

| Critical path | Covered? | Failure mode |
|---|---|---|
| Single discrete node move (one side) | ✅ mostly | Fine; the guards win a one-shot race |
| Continuous drag streamed to a follower | ❌ | Follower `setData` → Obsidian re-save → stale re-push → oscillation/scatter |
| Move a node with ≥2 edges | ⚠️ patched (0.5.9) | Edge reflow needs full `setData` → more re-save pressure |
| Concurrent edits, both sides | ❌ | Two-writer race on both followers; regressions cross-pollinate |
| Initial render of an already-open canvas | ⚠️ patched (0.5.9) | Forced `setData` fixes render but adds a re-save on mount |
| Node add / delete during a peer's drag | ❌ | Structural `setData` deferred by `isBusy()`; ordering vs geometry deltas unspecified |
| Edge add / remove / re-route | ⚠️ | Serialize-time dangling prune self-heals data; live view re-route only via `setData` |
| `file` / embed nodes (Properties) | ❌ | Interaction writes transient partial state; breaks follower (B7) |
| Node ↔ its linked markdown file edited in parallel | ❌ | Two independent Y.Docs; no reconciliation (dual-document desync) |
| Cursor / selection coordinates | ⚠️ | Inversion (B5) — separate transform bug, not the two-writer issue |
| Undo/redo | ❌ | Not modeled; undo replays through the file bridge unpredictably |

**Race-freedom:** the current approach **cannot** provide it. Race-freedom in a
CRDT system requires that local intent be captured at a single, unambiguous point
and that remote application be reentrancy-guarded against re-capture. The file
bridge violates both: capture is ambiguous (`modify` demux) and remote application
re-enters capture (reconcile → requestSave → modify). No amount of muting closes a
timing gap against an async, platform-owned second writer.

---

## 5. The redesign — mirror the text architecture

**Principle: the Yjs doc is the single source of truth. The live canvas model is a
pure projection of it. The `.canvas` file is a write-only persistence sink, never a
sync input while the canvas is open.** This is exactly the text-collab contract,
applied to canvas.

### 5.1 Target data flow

```
        ┌──────────── each peer (symmetric) ────────────┐
user →  │ Obsidian canvas model  ◀──apply(remote)──┐    │
        │        │  capture(local)                 │    │
        │        ▼                                 │    │
        │   CanvasBinding ──local delta──▶ Y.Doc ──observer──▶ CanvasBinding.apply
        │        │                          │                                     │
        │  applyingRemote flag ─────────────┘  (reentrancy guard, not a timer)    │
        │                                                                          │
        │   Y.Doc ──debounced, on close/idle──▶ .canvas   (persistence only)      │
        └──────────────────────────────────────────────────────────────────────┘
```

One writer to the live model at a time, arbitrated by an explicit
**`applyingRemote` reentrancy flag** (a boolean, not a time window):

- **Capture (local → CRDT):** hook the canvas *model* mutation points, not the
  file. When `applyingRemote` is false and the local user changes a node/edge,
  read the change straight from `canvas.nodes` / `canvas.edges` and write the
  minimal diff into the Y.Doc. When `applyingRemote` is true, capture is inert.
- **Apply (CRDT → local):** on a remote Yjs delta, set `applyingRemote = true`,
  patch the live model (`moveAndResize`, add/remove node/edge), then set it back
  to false in a `finally`. Because capture checks the flag synchronously, the
  applied change never re-enters as a "local edit." No mute window, no semantic
  compare, no sequence gate — the ambiguity is gone by construction.
- **Persist (CRDT → file):** debounced, and **only** for durability (closed
  canvases, cold reopen, crash safety). Suppress Obsidian's own `requestSave`
  while the canvas is open (we own the file), OR accept Obsidian's save purely as
  an fsync and never read it back as sync input.

This is a "y-canvas" binding — the structural analog of `y-codemirror.next`. It
does not exist off the shelf (canvas is a private API), so we build a thin one
against the adapter we already have.

### 5.2 Why this is race-free

- **Single capture point.** Local intent enters the CRDT from exactly one place
  (the model hook), never from the file. There is nothing to demultiplex.
- **Reentrancy guard, not timing.** `applyingRemote` closes the feedback loop
  deterministically. The follower's view update can never masquerade as a local
  edit, regardless of how fast deltas stream.
- **CRDT does the merge.** Concurrent moves of different nodes commute in Yjs
  (already true). Concurrent moves of the *same* node resolve by the existing
  per-node advisory lock (WP3) + last-writer-wins on geometry keys — now applied
  at the model layer where it is authoritative, not via a file diff.
- **Symmetric.** Host and guest run the identical binding. No seeding asymmetry,
  no "main session." Whoever edits, both views converge to the CRDT.

### 5.3 What changes concretely

- **Delete the file→CRDT path for open canvases.** `handleLocalModify` on a
  `.canvas` is removed while the canvas is open; capture moves to the binding.
  Keep a file→CRDT load path only for the *cold open* of a canvas that has no live
  view yet (and for a canvas that is shared but not currently open on this peer).
- **`reconcileLiveCanvas` becomes `binding.apply`** — same private-API calls, but
  wrapped in the `applyingRemote` guard and *not* followed by any of our own file
  write. We stop calling `writeToDisk` as part of live sync.
- **Persistence becomes a separate, debounced CRDT→file writer** that runs
  independently of the live loop and is the *only* thing that touches the file
  while open. It never feeds back.
- **Local capture hooks:** extend the adapter to emit per-node/edge change events
  (patch `moveAndResize`/`addNode`/`removeNode`/`requestSave` on the model, or
  diff `canvas.getData()` snapshots taken inside a capture tick). Emit the diff to
  the binding, which writes it to the CRDT under `!applyingRemote`.

### 5.4 Fallback when the private API is unavailable

If a future Obsidian build hides the members we patch, the binding reports
unavailable and we fall back to the **current** file-bridge as a degraded,
best-effort mode (read-mostly, accept occasional scatter) — clearly logged. The
private API is already the backbone of presence/cursors, so this is not a new
dependency, only a deeper one.

---

## 6. Critical-path coverage — target design

| Path | How the redesign covers it |
|---|---|
| Continuous drag → follower | `applyingRemote` guard: follower applies per-node geometry, never re-captures, never re-saves into the loop |
| Multi-edge move | Model-layer apply re-routes edges natively (Obsidian does it) with no extra file write; no reflow hack needed |
| Concurrent same-node edit | Per-node advisory lock (WP3) at the model layer + geometry LWW; loser reverts via CRDT |
| Concurrent different-node edit | Commutes in Yjs (unchanged) |
| Node add / delete mid-drag | Structural apply gated only by *this peer's* active drag (`isBusy`), applied atomically from CRDT; no file ordering |
| Edge add/remove/reroute | Native model apply; dangling handled in CRDT, not by serialize-time pruning |
| Initial load | Cold open loads model from CRDT once; no forced re-save; open canvas simply reflects the doc |
| `file`/embed nodes | Captured as model nodes; their linked-file content stays on the text path (see dual-doc below) |
| Node ↔ linked md file | Still two docs — **explicitly out of scope for v1**; document the limitation, consider a later unified doc or one-active-side lock |
| Undo/redo | Model-layer capture makes undo a normal local edit → captured like any other change |
| Cursor coordinate inversion (B5) | Independent transform bug; fix separately, unaffected by this redesign |

---

## 7. Phasing (do not big-bang this)

1. **Phase 0 — instrument & prove.** Add a headless two-client harness that drives
   the *model layer* (not the file) with a streamed drag and asserts convergence
   with zero re-push. This locks the target contract before code moves.
2. **Phase 1 — persistence split.** Make CRDT→file a standalone debounced writer;
   stop `reconcileLiveCanvas` from being followed by our writes. Verify text sync
   untouched.
3. **Phase 2 — reentrancy guard.** Introduce `applyingRemote`; wrap apply; verify
   the follower no longer re-captures (the host-scatter test).
4. **Phase 3 — model-layer capture.** Replace `handleLocalModify` (open canvas)
   with adapter-emitted change events. Remove the file→CRDT read for open
   canvases. Keep cold-open load.
5. **Phase 4 — retire the guards.** Delete mute windows, `recentDiskWrites` for
   canvas, the semantic echo-breaker, the sequence gate — they become dead code
   once capture is unambiguous. Keep the geometry guard only if cold-open still
   needs it.
6. **Phase 5 — edges, structural, file-nodes, undo** hardening + coverage tests.

Text sync must stay green throughout (shared `SyncManager`, awareness, relay).

---

## 8. Risks & open questions

- **Private-API surface for capture.** We currently patch selection/drag/viewport.
  Capturing *content* changes may need `moveAndResize` interception plus add/remove
  hooks, or periodic `canvas.getData()` snapshot-diffing inside a capture tick.
  Needs a short spike to pick the cleanest hook.
- **Suppressing Obsidian's `requestSave` while open.** If we cannot suppress it, we
  must make our persistence writer idempotent with Obsidian's format so its save is
  a no-op fsync (never a diff). Achievable by writing byte-identical to Obsidian's
  serializer, or by simply *ignoring* the file while open and only reading it on
  cold open.
- **Dual-document (node ↔ linked md).** Out of scope for v1; must be documented as a
  known limitation so testers don't chase it.
- **Undo semantics** across peers — Yjs `UndoManager` is disabled for text
  (`undoManager: false`); decide canvas policy explicitly.

---

## 9. Answer to the three questions

1. **Are all critical paths covered?** No. Continuous drag to a follower,
   concurrent bidirectional editing, file-nodes, and dual-document editing are all
   uncovered by the current design and cannot be closed by patching.
2. **Will this approach yield stable multiplayer without race conditions?** No. The
   file bridge is a two-writer, ambiguous-capture, timing-guarded loop — structurally
   racy. The direct-binding redesign will, by the same construction that already
   makes text sync stable.
3. **What must be redesigned?** Move the sync boundary from the `.canvas` file to
   the in-memory canvas model; make the CRDT the single source of truth; guard
   remote application with a reentrancy flag instead of mute windows; demote the
   file to write-only persistence. Build the "y-canvas" binding as the analog of
   `y-codemirror.next`.
