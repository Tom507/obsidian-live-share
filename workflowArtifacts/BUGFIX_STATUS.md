# Live Share — Canvas Collab Bugfix Status

> Living status doc for the canvas multiplayer debugging effort. Updated as
> findings land. Newest facts near the top of each section.

**Fork:** `Tom507/obsidian-live-share` · **Branch:** canvas collab work
**Test setup:** ONE PC, two Obsidian instances (host + guest) against the live relay.
Vaults:
- Host:  `H:/Developement/_NeuralAngels/ObsidianOrga/`
- Guest: `H:/Developement/_NeuralAngels/ObsidianOrga - Kopie/`
- Shared test canvas: `SyncTesting.canvas` (10 nodes, 6 edges, incl. a `file` "Properties" node + a pasted map image).

**Constraint:** No Obsidian-GUI automation available → the live canvas private API
cannot be E2E-tested by the agent. The sync layer *is* covered headlessly
(vitest: 434 tests, incl. the WP5 real-relay latency harness). User runs all
GUI verification.

---

> **⚠️ ARCHITECTURAL STOP (post-0.5.9):** The per-bug patching below hit its
> ceiling. The `.canvas` file bridge is a two-writer race and **cannot** be made
> stable by more fixes. The follower's view is driven by our reconcile, which makes
> Obsidian a second writer to the file → "guest stable, host scatters." Full
> analysis, design-decision chronicle, race-coverage matrix, and the redesign
> (CRDT-as-source-of-truth "y-canvas" binding) are in
> **`CANVAS_SYNC_REDESIGN.md`**. Treat that as the forward plan; the sections below
> are the historical fix log that led to it.

## 1. THE root cause (definitive)

**The scatter is NOT data corruption. The on-disk `.canvas` is always correct.**

Captured live during an active "scatter": both vault copies of `SyncTesting.canvas`
were **byte-identical and correct** (all 10 nodes valid coords, all 6 edges intact),
mtime static. The scatter existed only in Obsidian's rendered view.

> **Obsidian's OPEN canvas view is authoritative over its file. External writes to
> the `.canvas` while the view is open are IGNORED by the view, and Obsidian
> overwrites them with its in-memory state on the next interaction.**

Consequences that match every symptom:
- File-based sync writes correct data to disk, but the open view never picks it up
  → cards look "scattered"/stale.
- Self-heals briefly on a full reload / window blur (Obsidian re-renders).
- Comes back "after a few actions" (next interaction re-asserts stale in-memory).
- Works for **markdown** (Obsidian hot-reloads md on external change) but **not
  canvas**.

**Fix direction:** drive the LIVE canvas via its private API on every remote delta,
instead of relying on file reload. Implemented in v0.5.7 (per-node patching).

---

## 2. Fix log (shipped, chronological)

| Ver | Change | Result |
|---|---|---|
| 0.5.4 | Canvas cursors + card-anchored presence + status console (rebuilt adapter vs REAL private API) | cursors/rings still invisible |
| 0.5.5 | **Lazy-subscription** for canvases opened mid-session + `[canvas]` diagnostic logging before the silent `isSubscribed` bail | **cursors + node highlight now visible** ✓ |
| 0.5.6 | **Geometry-key guard** (never delete `x/y/width/height` from CRDT on a partial disk read) + SCATTER/DETACH telemetry in canvas-sync | scatter persisted (cause was elsewhere) |
| 0.5.7 | **Live-view reconciliation**: on remote delta, patch open canvas via private API — per-node `moveAndResize` (geometry), `setData` reload (structural add/remove), guarded by `isBusy()` (never during local drag); muted path events to avoid self-trigger. +8 adapter tests | cards **stop self-moving** ✓; host-only editing **perfect** ✓; bidirectional still breaks |
| 0.5.8 | **Echo-breaker**: `handleLocalModify` bails when disk **semantically equals** the shared CRDT state (nothing local to push) → kills the reconcile→save→modify feedback loop. + **cursor coord telemetry** (`BCAST`/`RENDER` throttled logs) | awaiting bidirectional + cursor-coord test |
| 0.5.9 | **Initial-sync reconcile** + **multi-edge move fix**. (1) The live reconcile previously ran ONLY on subsequent remote deltas — never on the seed → a canvas open at first sync stayed stale (wrong positions, detached edges). Now a **forced full `setData`** fires from whichever side finishes last: guest `subscribe()` after `waitForSync`, and `mountCanvasPresence` via new `getCanvasSnapshot()`. (2) Geometry-only reconcile moved a card but never re-routed its edges → moving a card **with >1 connection** left arrows detached on the peer and the peer re-saved its own routing → sync fight. Now when a moved node is an edge endpoint the reconcile **escalates to `setData`** so edges re-route from authoritative data. + `getNodeGeometry()` adapter method. +6 tests (440 total) | **needs verification** |

### Key mechanisms
- **Lazy-subscribe** (`main.ts` `syncCanvasPresences`): a shared canvas opened after
  session start was never subscribed → silent bail before any log. Now subscribes on
  detection. This was why the status console showed zero `[canvas]` lines.
- **Geometry guard** (`canvas-sync.ts` `GEOMETRY_KEYS`): `applyKeyDiff` / `applyToYMap`
  never delete geometry keys — a live node losing x/y is always a transient partial
  read, never user intent.
- **Live reconciliation** (`main.ts` `reconcileLiveCanvas` ← `canvasSync.onRemoteCanvasUpdate`):
  - geometry-only diff → `adapter.applyNodeGeometry(id, geo)` per node
  - structural (node/edge id-set changed) → `adapter.reloadCanvasData(data)` (setData)
  - `adapter.isBusy()` (tracks `setDragging`) → defer while user drags
  - wrapped in `mutePathEvents` for the settle window
- **Echo-breaker** (`canvas-sync.ts` `handleLocalModify`): `canvasRecordsEqual(CRDT, disk)`
  → early return. Distinguishes our own reconcile-induced save (disk == shared) from a
  genuine local edit (disk differs). Semantic, not byte (Obsidian formats JSON
  differently than our `serializeCanvas`).

---

## 3. Bug status

| # | Bug | Status |
|---|---|---|
| B1 | No canvas cursors / no node highlight | ✅ fixed v0.5.5 |
| B2 | Guest can't see host cursor | ✅ was awareness lag, self-resolved |
| B3 | Cards self-scatter (existing nodes move) | ✅ fixed v0.5.7 (live reconciliation) |
| B4 | Bidirectional editing corrupts fast (host-only fine) | 🟡 fix shipped v0.5.8 (echo-breaker) — **needs verification** |
| B5 | Cursor coordinates fully inverted (BOTH axes) | 🔎 instrumented v0.5.8 — awaiting `BCAST`/`RENDER` numbers |
| B6 | Arrows/edges stay disconnected in view | 🔴 open (likely same loop; recheck after B4) |
| B7 | Clicking the "Properties" (file) node breaks guest view | 🔴 open (file-node handling; recheck after B4) |
| B8 | New cards land at different position on guest | 🟡 possibly viewport-perception OR same loop — recheck after B4 |
| B9 | Resize bottom edge shrinks instead of grows (Y inverted) | 🔴 open — likely same frame issue as B5 |
| B10 | Initial sync already wrong (detached edges / wrong positions on first render) | 🟡 fix shipped v0.5.9 (forced full setData at first sync) — **needs verification** |
| B11 | Moving a guest card with >1 connection breaks sync | 🟡 fix shipped v0.5.9 (edge-endpoint move → setData reflow) — **needs verification** |

---

## 4. Open hypotheses

- **B5/B9 (coordinate inversion):** the plugin's forward (`canvasToScreenRel`) and
  inverse (`clientToCanvasManual`) transforms are internally consistent (round-trip
  unit-tested), so a *full* inversion must come from a frame mismatch between the
  sender's broadcast (`posFromEvt` / manual) and the receiver's render, OR from a
  wrong assumption about `canvas.x/y` (viewport CENTER vs top-left). The v0.5.8
  telemetry will localize it to sender or receiver. Candidate robust fix if math is
  intractable: mount cursor markers inside the **transformed** `canvasEl` using raw
  canvas coords and counter-scale by `1/zoom`, eliminating all manual math.
- **B6 (edges):** `serializeCanvas` prunes dangling edges only during serialization
  (self-heals when node returns); live view may not re-render edges after per-node
  `moveAndResize`. May need an edge-aware reconcile or a `requestFrame` nudge.
- **B7 (file node):** file/embed nodes may write transient partial state on
  interaction; interacts with the dual-document (canvas node ↔ linked md file)
  problem noted separately.
- **Dual-document desync (separate known issue):** editing a canvas node AND its
  linked markdown file in parallel diverges — they are two Yjs docs. Deferred.

---

## 5. Real Obsidian Canvas private API (verified ground truth)

- Canvas at `(view as any).canvas` when `getViewType() === "canvas"`.
- **NO event emitter** — activity detected by monkey-patching `updateSelection(fn)`,
  `setDragging(bool)`, `markViewportChanged()` (call original → our cb → return).
- Live viewport = `canvas.x / canvas.y / canvas.zoom` (linear). `tx/ty/tZoom` are
  animation TARGETS (`tZoom = log2(zoom)`) — never for live rendering.
- `canvas.nodes: Map<id, CanvasNode>`, `canvas.edges: Map<id, …>`.
- `CanvasNode`: `.id/.x/.y/.width/.height`, `.nodeEl` (card DOM), **`.moveAndResize({x,y,width,height})`** (live reposition/resize).
- `canvas.setData(data)` → replace contents; `canvas.requestFrame()` → re-render;
  `canvas.requestSave()` → persist.
- `canvas.wrapperEl` = fixed screen-space overlay host; `canvas.canvasEl` = transformed layer.
- `canvas.posFromEvt(evt)` = client → canvas; `canvas.nodeInteractionLayer?.target` = hovered node.
- Availability gate: `canvas.nodes instanceof Map && typeof canvas.zoom === "number"`.

---

## 6. Build / package / test protocol

- Build+test: `plugin/ → npm run build && npm test` (via visible-console; path has no
  spaces so use `H: && cd \Developement\...\plugin` unquoted). Current: **434 tests**.
- Package: copy `plugin/main.js`, `plugin/styles.css`, repo-root `manifest.json` into
  both vault plugin dirs (`.obsidian/plugins/live-share/`). Bump version in
  `plugin/package.json` AND repo-root `manifest.json` together.
- User must **Reload app without saving** (Ctrl+P) in BOTH windows to load a new build.
- Server landing zip: **NOT pushed** until canvas is visually confirmed stable.
- Server code unchanged since round 1 — no relay redeploy needed for any 0.5.x.

## 7. Current test ask (v0.5.9)

**Prio 1 — initial sync (B10):** Open the shared canvas fresh on BOTH sides. Is the
FIRST render correct — all edges connected, all cards at the right spots? (This is
the "can only get worse later" root the user flagged.)

**Prio 2 — multi-edge move (B11):** On the guest, drag a card that has **2+ arrows**.
Does sync stay intact now (no detached arrows, no oscillation)?

Prior asks still open once the above pass:
- Bidirectional stability (B4): both windows edit simultaneously — stable?
- Cursor numbers (B5): move guest mouse RIGHT then DOWN; report `BCAST` (guest) and
  `RENDER` (host) lines to localize the inversion.

---

## 8. Open TODO — remaining work (prioritized)

### P0 — verify in flight
- [ ] **B4 bidirectional stability** — confirm the v0.5.8 echo-breaker actually stops
      the oscillation when both sides edit. If NOT stable, next step: `moveAndResize`
      may still trigger an Obsidian save outside the mute window → add an explicit
      "applying remote" suppression flag in `canvas-sync` that `handleLocalModify`
      honors for a generous settle window (instead of/along with the semantic guard).

### P1 — coordinate frame (blocks trustworthy cursors + resize)
- [ ] **B5 cursor inversion (both axes)** — from the `BCAST`/`RENDER` telemetry,
      localize to sender or receiver, then apply the sign/offset fix. Fallback if
      math stays wrong: mount markers in the transformed `canvasEl` with raw canvas
      coords + `scale(1/zoom)` counter-transform (removes all manual math).
- [ ] **B9 resize bottom-edge inverted (Y)** — determine whether this is our
      monkey-patch/overlay interfering with Obsidian's own resize handler, or a
      separate Obsidian quirk. Likely shares the frame root cause with B5.
- [ ] **B8 new-card position offset** — decide if it's genuine (coords wrong) vs
      viewport perception (different pan on each device). If genuine, same fix as B5.

### P2 — structural rendering
- [ ] **B6 edges/arrows stay disconnected in the live view** — after per-node
      `moveAndResize`, edges may not re-render. Try a `canvas.requestFrame()` nudge
      after geometry reconcile; if insufficient, reconcile edges explicitly or fall
      back to `setData` when the edge set is stale. Confirm the serialize-time
      dangling-edge prune isn't hiding edges the CRDT still holds.
- [ ] **B7 "Properties" (file) node click breaks guest view** — investigate how
      file/embed nodes serialize on interaction; guard partial writes; verify the
      reconcile handles `type:"file"` nodes.

### P3 — architecture / follow-ups
- [ ] **Dual-document desync** — editing a canvas node AND its linked markdown file in
      parallel diverges (two Yjs docs). Design: treat the linked file as one doc, or
      make one side read-only while the other is active. (Deferred, separate from B1–B9.)
- [ ] **Cursor telemetry cleanup** — once B5 is fixed, gate/remove the throttled
      `BCAST`/`RENDER` debug logs (or keep behind a verbose flag).
- [ ] **Regression tests** — add a headless two-client concurrent-edit test that
      asserts disk stays converged AND no echo re-push occurs (locks the echo-breaker).
- [ ] **Ship gate** — only after B4–B9 confirmed: push the landing zip
      (`scp` to `/home/deploy/liveshare/landing/rendered/live-share-plugin.zip` as
      `deploy`), user commits, bump to a release version.

### Phase B (deferred, not part of this bug sweep)
- [ ] NA-Access OIDC as primary auth for the sync plugin.
- [ ] Standalone Node headless client on the server + per-client session UI.
- [ ] Admin web UI (majorTom / Thomas Schmidt) — start/stop sessions, remote-control
      headless client, lock settings, monitoring/logging.
- [ ] Persistent sync + headless client auto-syncs repos via git.
- [ ] (Partially done) in-Obsidian status console with log levels + real logging.
