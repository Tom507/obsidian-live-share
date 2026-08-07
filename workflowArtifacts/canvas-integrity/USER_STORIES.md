# User Stories — Obsidian Live Share, Canvas Integrity Round

> Created by Worker 2 (Spec Architect) from `canvas-integrity/PLAN.md` § "User Story Sketch".
> Companion to `BUILD_SPEC_CanvasIntegrity.md` — that file owns architecture and WP scope;
> this file owns the acceptance criteria. W3 and W4 read both.
>
> Baseline: HEAD `4b34d5e` + uncommitted Phase 2–4 wiring, shipped as v0.6.0.
> Gate baseline to preserve: `npm run build` PASS, vitest **526 passed / 32 files**.
>
> **Red-first is mandatory** for every defect story (PLAN D5, `w4_fix_as_failing_test: true`).
> Where an AC says "confirmed RED", the WP is not done until the failing state was
> observed against current HEAD *before* the fix and recorded in the ImplementationReport.

---

## US1 — Remote cursors land where the peer's pointer actually is

**As a** collaborator on a shared canvas,
**I want** a peer's cursor to be drawn at the canvas point their pointer is really over, at any zoom level,
**so that** pointing at a card conveys meaning instead of noise.

### Acceptance Criteria

1. `canvasToScreenRel(cx, cy, vp, size)` multiplies the canvas-space offset by the **linear** scale factor, not by `vp.zoom`. Obsidian's own controller uses `scale = 2 ** zoom` and renders `domFromPos(p) = ((p.x - x) * scale, (p.y - y) * scale)`; the adapter must match that arithmetic exactly.
2. The linear factor is read from `canvas.scale` when that member is a finite number, and falls back to `2 ** canvas.zoom` when it is absent. `grep -rn "\.scale" plugin/src` returns 0 hits at HEAD, so `scale` must be added to the adapter's private-shape typing and to `CanvasViewport`.
3. At `zoom === 0` (Obsidian's 100 %), a peer cursor 100 canvas units right of the viewport origin renders 100 px right of the wrapper centre. At HEAD it renders **at** the centre (factor 0) — this is the observable defect.
4. At `zoom === -1` (50 %), the same point renders 50 px right of centre, i.e. on the **same side**. At HEAD it renders 100 px *left* of centre (negative factor → point mirror).
5. `clientToCanvasManual` is the exact inverse of `canvasToScreenRel` for the same viewport, and no longer bails on `zoom === 0`. It bails only when the linear scale is `0` or non-finite — a state Obsidian never produces, since `2 ** z > 0` for all finite `z`.
6. A round-trip property holds for `zoom ∈ {-4, -1, 0, 1}`: `clientToCanvasManual(canvasToScreenRel(p)) ≈ p` to 6 decimal places, with a zero-origin wrapper rect.
7. The four existing tests that encode the defect as correct behaviour are **corrected**, not accommodated, and the reason is recorded in the ImplementationReport:
   - `plugin/src/__tests__/canvas-adapter.test.ts:16` — fixture `{ x: 100, y: 50, zoom: 2 }`; `zoom: 2` means 4× in Obsidian, not 2×.
   - `plugin/src/__tests__/canvas-adapter.test.ts:26-27` — `"canvasToScreenRel scales by live zoom"` asserts a ×2 factor for `zoom: 2`; must assert ×4 (or the fixture must carry an explicit `scale`).
   - `plugin/src/__tests__/canvas-adapter.test.ts:55-56` — `"clientToCanvasManual returns null on zero zoom"` asserts the bail that AC5 removes; `zoom: 0` is 100 %, a fully valid viewport.
   - `plugin/src/__tests__/harness/canvas-double.ts:200` — `zoom: opts.zoom ?? 1` default; `1` is 200 % in Obsidian, so every harness case silently runs double-scaled.
8. The two false "linear" comments at `plugin/src/canvas/canvas-adapter.ts:13` and `:25` are corrected to state that `canvas.zoom` is `log2(scale)`.
9. `plugin/src/canvas/canvas-presence.ts:485` and `:493` are **not** modified. The fix lives entirely inside the adapter so the cursor work stays file-disjoint from the locking work.

### Definition of Done

A parameterised transform test over `zoom ∈ {-4, -1, 0, 1}` passes; the AC3 and AC4 assertions were observed RED against HEAD before the fix; `grep -n "scales by live zoom\|returns null on zero zoom" plugin/src/__tests__/canvas-adapter.test.ts` shows the corrected assertions; no file outside `canvas-adapter.ts`, `canvas-adapter.test.ts` and `harness/canvas-double.ts` changed.

### Linked WPs

WP1

---

## US2 — A card I hold is protected, and my rejected edit never silently persists

**As a** collaborator,
**I want** the card I am editing to be protected from a peer's concurrent write, and any edit of mine that the lock layer rejects to be rolled back locally rather than left on my disk,
**so that** cards stop jumping and my view stops disagreeing permanently with everyone else's.

### Acceptance Criteria

1. Edge writes are gated by the lock seam. An edge is writable only when **both** of its endpoint nodes are writable by this client: `canWriteNode(path, fromNode) && canWriteNode(path, toNode)`. A peer holding either endpoint blocks the edge write. At HEAD, `applyLocalDiffToYMaps` is called for edges with **no** `opts` (`plugin/src/files/canvas-sync.ts:493`), so neither gate is ever consulted for an edge.
2. A changed edge that still exists in the CRDT is merged **per key** via `applyKeyDiff`, never replaced. The destructive `new Y.Map()` re-create at `plugin/src/files/canvas-sync.ts:581-586` is removed. Test: peer B concurrently sets `color` on edge `e1` while peer A moves its `toSide`; after convergence both survive. At HEAD B's `color` is discarded.
3. An edge deleted remotely is **not** resurrected by a concurrent local change to it — delete-wins, matching the node behaviour at `plugin/src/files/canvas-sync.ts:575-580` (GAP-2). At HEAD the `new Y.Map()` branch re-creates it.
4. When **any** node or edge write in one `handleLocalModify` pass is denied by `canWriteNode` / `canDeleteNode`, `lastWrittenContent` for that path is **not** advanced. At HEAD the `continue` statements at `plugin/src/files/canvas-sync.ts:556` and `:572` skip the write but `:503` advances the baseline unconditionally, so the rejected edit becomes invisible to every later diff — permanent divergence.
5. Given AC4, a second `handleLocalModify` on unchanged disk content re-detects the same denied entity (the divergence stays observable) and still does not push it. The pass is idempotent: no CRDT mutation, no baseline advance, one `warn`-level log line naming the path and the denied ids.
6. `onRevert` is wired. `mountCanvasPresence` (`plugin/src/main.ts:1195-1208`) passes an `onRevert: (nodeId: string) => void` into the `CanvasPresence` options. At HEAD the option is declared (`plugin/src/canvas/canvas-presence.ts:231`), stored (`:287`) and invoked (`:387`) but never supplied, so GAP-1 loser-revert is dead code.
7. The wired `onRevert` rolls the local view back to shared truth: it obtains `canvasSync.getCanvasSnapshot(path)` and drives `reconcileLiveCanvas(path, snapshot, { initial: true })`, i.e. a full authoritative `setData`. A `null` snapshot (shared doc still empty) is a no-op, never a view wipe.
8. `onRevert` is called with the reverted `nodeId` (the existing call signature at `:387` passes it) and emits one `warn` line: path, nodeId, winning clientId.
9. Two-peer test: A and B both claim node `n1`; A has the higher clientID and therefore loses `computeCanWriteNode`. A's optimistic move is denied, A's `lastWrittenContent` is not advanced, `onRevert("n1")` fires exactly once, and A's live view ends at B's coordinates. Confirmed RED against HEAD (`onRevert` never fires).

### Definition of Done

The AC2, AC3, AC4 and AC9 tests were observed RED against HEAD and are GREEN after; `grep -n "onRevert" plugin/src/main.ts` returns a call site; `plugin/src/files/canvas-sync.ts` contains no `new Y.Map()` inside the edge-change branch.

### Linked WPs

WP4

---

## US3 — Every remote change reaches my open canvas, not just position

**As a** collaborator with a canvas open,
**I want** remote changes to a card's text, colour, type or an edge's side/label to appear in my open view,
**so that** scrolling into a region never reveals stale content that my next save then pushes back over my peer.

### Acceptance Criteria

1. `reconcileLiveCanvas` classifies a remote delta as needing a **structural reload** whenever the desired data differs from the last-applied data in **any** non-geometry field, not only when the id sets differ. At HEAD, `plugin/src/main.ts:1013-1016` classifies on id-set difference alone and the non-structural branch at `:1048-1068` applies `x/y/width/height` only, so a `text` / `color` / `label` / `fromSide` / `toSide` change with unchanged id sets never reaches the open view.
2. The classification is implemented as a **pure exported function** in a new module so it is unit-testable without Obsidian. `plugin/src/main.ts` has no test file at HEAD; classification logic must not live only there.
3. The classifier returns one of `"structural" | "geometry" | "noop"`, and is a pure function of (desired data, last-applied data, live node ids, live edge ids, `initial` flag). Same inputs → same output, no clock, no DOM.
4. Test: desired vs last-applied differ **only** in a node's `text` → plan is `"structural"`. Confirmed RED against HEAD (today's equivalent decision yields the geometry branch).
5. Test: desired vs last-applied differ **only** in an edge's `fromSide` → plan is `"structural"`.
6. Test: desired vs last-applied differ only in `x`/`y`/`width`/`height` → plan is `"geometry"`. This preserves the smooth per-node `moveAndResize` path for pure drags; a full `setData` on every mouse move is a regression, not a fix.
7. Test: desired equals last-applied and the id sets match → plan is `"noop"`, and no adapter call is made.
8. The existing escalation semantics are preserved: `opts.initial` still forces `"structural"` (`plugin/src/main.ts:1014`), and a moved node that is an edge endpoint still escalates to a reload (`:1066`, `:1072-1078`).
9. `type` is protected from deletion in the CRDT. The delete guards in `applyToYMap` (`plugin/src/files/canvas-sync.ts:155`) and `applyKeyDiff` (`:192`) refuse `type` as well as `x/y/width/height`. Rationale: Obsidian's `importData` skips any node whose `type` is not `file|text|link|group` and creates an edge only when both endpoints exist, so one partial disk read that strips `type` makes every peer silently drop that node **and all its edges**.
10. `GEOMETRY_KEYS` stays exported with its current membership (`{x, y, width, height}`) — it is imported by `plugin/src/files/canvas-persistence.ts` via `applyToYMap` and asserted by existing tests. The wider set is a new export.
11. Test: a node record whose `type` key is absent in `next` but present in `base` leaves `type` intact in the Y.Map. Confirmed RED against HEAD (`applyKeyDiff` deletes it today).
12. `auditCanvasState` (`plugin/src/files/canvas-sync.ts:723-761`) gains a third signature alongside `SCATTER` and `DETACH`: a `warn` for every live node missing `type`, and for every `type:file` node missing `file`. At HEAD it inspects only `x`/`y` and dangling endpoints, so a `type`-stripped node is invisible to it.
13. The new audit signature is asserted through the injected logger seam (`CanvasSync.setLogger`) with a stable, greppable prefix so the log line is usable as a diagnosis anchor (US6).

### Definition of Done

The AC4, AC5 and AC11 tests were observed RED against HEAD and are GREEN after; the new classifier module has its own test file; `GEOMETRY_KEYS` membership is unchanged; the new audit warning appears in the logger spy for a `type`-less node.

### Linked WPs

WP5

---

## US4 — My locks and presence survive an unfocused window

**As a** collaborator,
**I want** my locks and my presence to stay alive while the Obsidian window is in the background,
**so that** switching to another app does not silently disable collaboration safety and let a peer overwrite the card I am holding.

> **Diagnosis boundary (PLAN D3).** S2's true cause is **unproven**. No AC in this story
> claims the bug is fixed. Each AC states either *"the failure mode is structurally
> impossible"* or *"the failure mode is observable in the log"*. A WP that satisfies
> every AC and the symptom still occurs is a **pass**, and the instrumentation is the
> diagnosis path for the follow-up round.

### Acceptance Criteria

1. The awareness keep-alive no longer depends on a fixed-period timer firing on schedule. It is driven by an **absolute-time deadline**: a pulse is emitted whenever `now - lastPulseAt >= AWARENESS_PULSE_DEADLINE_MS`, evaluated on every heartbeat tick. At HEAD the mechanism is a bare 12 s `setInterval` (`plugin/src/sync/sync.ts:39`, started at `:380-383`) against y-protocols' 30 s `outdatedTimeout`; Chromium throttles timers in occluded windows to 1 Hz and then to ~1/min, so a single slipped tick past 30 s makes every peer prune this client's state and all its locks vanish.
2. The tick is exposed as a directly callable method so the deadline logic is testable without wall-clock waiting. `pulseAwarenessHeartbeat()` already exists as a public seam (`plugin/src/sync/sync.ts:403`) and must keep its current unconditional-pulse behaviour for existing callers.
3. **Structurally impossible, stated precisely:** with a tick interval of `T` and deadline `D`, the worst-case gap between two pulses is `T + D`. The chosen values must satisfy `T + D < 30_000` under the assumption that a throttled Chromium timer fires at least once per 60 s — which it does not satisfy on its own. The WP must therefore also pulse opportunistically on socket activity (see AC4), and the spec-level claim is limited to: *"a pulse is emitted at the first opportunity after the deadline expires, and the gap is always measured and logged"*.
4. An inbound MUX message (`MUX_SYNC`, `MUX_AWARENESS`, `MUX_PONG`, or any framed message) evaluates the deadline and pulses if it has expired. Socket message delivery is not timer-throttled, so this recovers liveness on the first packet after a throttled period. Test: with fake timers advanced past the deadline and **no** interval tick, handling one inbound message emits exactly one pulse.
5. Every pulse logs the measured gap since the previous pulse. A gap exceeding `AWARENESS_GAP_WARN_MS` (< 30 000) emits a `warn` with a stable greppable prefix naming the gap in ms. This is the log line that makes the next decay incident provable (US6).
6. Test: advance the fake clock by 70 000 ms with the interval suppressed, then fire exactly one tick → one pulse is emitted **and** one gap `warn` is logged naming ~70 000 ms. Confirmed RED against HEAD (no deadline logic and no gap instrumentation exist).
7. The pulse is a no-op while the socket is not `OPEN`, preserving the existing guard at `plugin/src/sync/sync.ts:404`.
8. No focus, `blur`, `visibilitychange` or `document.hidden` handler is required for any AC in this story. `grep -rniE "visibilitychange|document\.hidden|'blur'" plugin/src` returns 0 hits at HEAD and may still return 0 after the fix. A focus listener is explicitly **out of scope** — it would make the mechanism depend on an event the failure mode may not deliver.
9. `isBusy()` cannot latch forever. A missed `setDragging(false)` must not permanently disable CRDT→view reconciliation. `isBusy()` becomes an **inactivity** predicate: true only while `isDragging` **and** the time since the last drag-related signal is below `DRAG_WATCHDOG_MS`. At HEAD `plugin/src/canvas/canvas-adapter.ts:394-399` returns the raw `isDragging` flag with no timeout, and `plugin/src/main.ts:994` short-circuits the entire reconcile on it.
10. The watchdog clock is refreshed by real interaction: the `markViewportChanged` patch and the `pointermove` listener both bump it while a drag is in progress, so a long but active drag never trips the watchdog.
11. On watchdog expiry, `isDragging` is cleared and one `warn` is logged, but `dragTargetId` is **retained** until a genuine `setDragging(false)`. Rationale: `applyNodeGeometry` refuses to move the node under an active drag by comparing `dragTargetId === nodeId` (`plugin/src/canvas/canvas-adapter.ts:409`); keeping it means a stuck flag re-enables whole-canvas reconciliation while still protecting the card the user may still be holding.
12. `applyNodeGeometry` (`:405`) and `reloadCanvasData` (`:428`) consult the same watchdog-aware predicate as `isBusy()`, not the raw flag. Test: with the watchdog expired, `reloadCanvasData` returns `true` (it returns `false` at HEAD).
13. Test: `setDragging(true)`, advance fake timers past `DRAG_WATCHDOG_MS` with no further activity → `isBusy() === false` and one `warn` logged. Confirmed RED against HEAD (`isBusy()` stays `true` forever).
14. A second adapter over the same `view.canvas` can never end up with no patches installed. `patch()` currently early-returns when `original.__lsWrapped` is set (`plugin/src/canvas/canvas-adapter.ts:225`), so a failed or duplicated mount leaves an adapter whose `isDragging` never updates and which therefore never blocks a reconcile and never claims a lock. After the fix, `patch()` unwraps an existing marked wrapper via its `__lsOriginal` and re-wraps, so the newest adapter always owns the patch.
15. The displaced adapter's restore is harmless: its disposer is guarded by `if (c[name] === wrapper)` (`:239`), so it no longer matches and does not clobber the new wrapper.
16. Test: build two adapters over one fake canvas, call `setDragging(true)` on the canvas → the **second** adapter reports `isBusy() === true`. Confirmed RED against HEAD (it reports `false`).
17. Adapter (re)mount is observable: one log line per adapter construction naming the path-independent patch outcome (`installed` / `adopted` / `unavailable`) per patched method.

### Definition of Done

The AC6, AC13 and AC16 tests were observed RED against HEAD and are GREEN after; `plugin/src/sync/sync.ts` and `plugin/src/canvas/canvas-adapter.ts` are the only production files changed by this story; no focus/visibility listener was added; the gap `warn`, the watchdog `warn` and the patch-outcome line are all greppable with documented prefixes.

### Linked WPs

WP2 (AC1–AC8), WP3 (AC9–AC17)

---

## US5 — A `.canvas` file is written by exactly one authority

**As a** collaborator,
**I want** each shared `.canvas` file to have exactly one writer at any moment,
**so that** two independent writers can never interleave their bytes and destroy my connections.

### Acceptance Criteria

1. A shared `.canvas` path is synced through **exactly one** subsystem at any instant. At HEAD every shared `.canvas` is synced through two unrelated CRDT documents at once — `__canvas__:<path>` as structured `nodes`/`edges` (`plugin/src/files/canvas-sync.ts:293`) and `<path>` as one raw `Y.Text` of the whole JSON (`plugin/src/files/background-sync.ts:88`, because `"canvas"` ∈ `TEXT_EXTENSIONS` at `plugin/src/utils.ts:184`) — and `plugin/src/files/vault-events.ts` feeds **both** on every modify: `:129` then `:131`, unconditionally, with no `else`.
2. `BackgroundSync.startAll` creates no `Y.Text` document for a `.canvas` path. Test: a manifest containing `board.canvas` runs `startAll` and `syncManager.getDoc("board.canvas")` is never called. At HEAD the loop at `plugin/src/files/background-sync.ts:62-63` skips only non-text and binary entries.
3. Ownership is a single explicit predicate, evaluated once per modify event: a `.canvas` path is **canvas-owned** iff `canvasSync` exists and `canvasSync.isSubscribed(path)` is true.
4. Canvas-owned → `backgroundSync.handleLocalTextModify` is **never** called for that event, whatever the reason the canvas branch itself declined. Specifically, a modify that is CanvasSync's own disk-write echo (`canvasSync.isRecentDiskWrite(path)`, checked at `plugin/src/files/vault-events.ts:121`) or a binding-owned capture (`useCanvasBinding` true, checked at `:127`) is **dropped**, not redirected to the text path.
5. Not canvas-owned → the text path runs exactly as it does today. This is the fallback and it is announced: one `warn` per path on first fallback use, naming the path and that it is syncing as raw text.
6. Test matrix over one `.canvas` modify event, four cases, each asserting exactly which of `handleLocalModify` / `handleLocalTextModify` was called:
   - subscribed, not a recent disk write, flag OFF → `handleLocalModify` ×1, `handleLocalTextModify` ×0
   - subscribed, recent disk write → neither
   - subscribed, flag ON → neither
   - **not** subscribed, shared path → `handleLocalTextModify` ×1, `handleLocalModify` ×0
7. Only a genuinely **failed** subscribe produces the unowned state. Verified against source: `CanvasSync.subscribe` adds to `subscribedPaths` synchronously at `plugin/src/files/canvas-sync.ts:324`, *before* its first `await`, so a **pending** subscribe already reports `isSubscribed() === true` (documented at `plugin/src/main.ts:944-946`); the set is removed again only on `getDoc` returning null (`:328-330`) or `waitForSync` throwing (`:335-337`). An **excluded** path is not shared at all — exclusion is manifest-level (`plugin/src/files/manifest.ts:302`) and `plugin/src/files/vault-events.ts:113` returns early for a non-shared path — so it reaches neither subsystem today and that is unchanged.
8. Transition **unowned → owned**: at every `canvasSync.subscribe(path, role)` call site, `backgroundSync.unsubscribe(path)` is invoked on the immediately preceding statement, in the same synchronous block. Rationale: `unsubscribe` flushes the pending `Y.Text` write and detaches the observer (`plugin/src/files/background-sync.ts:148-156`), so the final text flush lands before CanvasSync's seed reads the file, and no vault event can interleave between the two calls.
9. Transition **owned → unowned**: each `canvasSync.subscribe(...)` call site awaits the returned promise and, if `canvasSync.isSubscribed(path)` is then false, calls `backgroundSync.subscribe(path)` to install the fallback. Both call sites are covered: `plugin/src/main.ts:797-801` (session start) and `plugin/src/main.ts:937-948` (lazy subscribe of a canvas opened mid-session).
10. Test: a `canvasSync.subscribe` that rejects/fails leaves the path syncing via the text path, and a later successful subscribe hands it back with `backgroundSync.unsubscribe` called **before** `canvasSync.subscribe`.
11. The composition regression test exists and is confirmed RED before the fix: **both** subsystems, **one** `.canvas` path, **two** peers, concurrent edits, assert every edge still has its original `fromNode` and `toNode`. At HEAD no test instantiates `BackgroundSync` and `CanvasSync` against the same `.canvas` path, which is exactly why 526 passing tests never caught this.
12. The concurrency in AC11 touches **edges**, not two disjoint nodes. Of the six existing matrix cases only one exercises true concurrency (`plugin/src/__tests__/canvas-matrix.test.ts:118-143`) and it moves two disjoint nodes and touches no edge; all four edge cases are single-peer-then-settle.
13. CRDT→disk has exactly one implementation for a canvas-owned path. `CanvasPersistence` (`plugin/src/files/canvas-persistence.ts`) becomes the writer; `CanvasSync`'s remote-flush scheduling (`plugin/src/files/canvas-sync.ts:398` → `scheduleDiskWrite` → `writeToDisk`) is retired for those paths.
14. The property the retired `remoteSeq` gate protected is preserved: **a flush never writes content older than the newest integrated remote delta.** Test: with fake timers, schedule a flush, integrate a remote delta before the write resolves, and assert the bytes on disk equal the **post-delta** doc state. See `BUILD_SPEC_CanvasIntegrity.md` § 9 WP7 for why this holds structurally rather than by a counter.
15. `lastWrittenContent` never goes stale. `CanvasSync` keeps it as the local three-way-diff baseline (`plugin/src/files/canvas-sync.ts:469-470`); every successful `CanvasPersistence` write feeds the written content back into it. Test: after a persistence write, a `handleLocalModify` with unchanged disk content is a no-op and logs the echo-breaker line, not a spurious diff.
16. The path-safety and folder-creation guarantees of the retired writer are preserved: `isPathSafe(path)` (`plugin/src/files/canvas-sync.ts:765`) and `await ensureFolder(vault, parentDir)` (`:779-780`) both still apply to every canvas disk write. `createVaultPersistenceIO` (`plugin/src/files/canvas-persistence.ts:324-335`) calls `adapter.write` directly and has neither.
17. `coldOpen` semantics survive. `coldOpen()` runs after `waitForSync` and before `start()`, per `plugin/src/files/canvas-persistence.ts:210-222`.
18. Two latent defects in the dormant writer are fixed before it is wired, each with its own test:
    - **Mute refcount leak.** `flushToDisk`'s `finally` clears the previous settle timer before arming a new one (`plugin/src/files/canvas-persistence.ts:200-201`), so two flushes inside one settle window call `mutePathEvents` twice and `unmutePathEvents` once. `FileOpsManager` mutes are refcounted (`plugin/src/files/file-ops.ts:112-125`), so the count never returns to zero and every vault `modify` event for that canvas is dropped **forever**. Overlapping settle windows are the normal case: `DEBOUNCE_MS = 200` with `MAX_WAIT_MS = 500` versus `settleMs = 250`.
    - **Unserialized writes.** `flushToDisk` awaits `io.write` with no queue, and `lastWrittenContent` is assigned after the await, so two overlapping flushes can land out of order and leave older bytes on disk. `BackgroundSync` solves this with a serialized `writeQueue` (`plugin/src/files/background-sync.ts:43`, `:383`).

### Definition of Done

The AC6, AC10, AC11 and AC14 tests were observed RED against HEAD and are GREEN after; `grep -rn "handleLocalTextModify" plugin/src/files/vault-events.ts` shows it unreachable for a canvas-owned path; `grep -rn "CanvasPersistence" plugin/src --include=*.ts | grep -v __tests__ | grep -v canvas-persistence.ts` returns at least one production call site (zero at HEAD); the AC18 tests pass.

### Linked WPs

WP6 (AC1–AC12), WP7 (AC13–AC18)

---

## US6 — The next drift incident is provable from a log

**As a** maintainer,
**I want** every corruption and liveness failure mode in this subsystem to leave a distinct, greppable log line,
**so that** diagnosis stops depending on reproducing the bug by luck.

### Acceptance Criteria

1. Every signature below is emitted through the existing `DebugLogger` seam (`plugin/src/debug-logger.ts`, 500-entry ring buffer plus a file sink gated on the `debugLogging` setting). No new logging framework, no new production dependency.
2. Each signature has a **fixed uppercase prefix** so it is greppable in a user-supplied log dump, and each is asserted by at least one test through an injected logger spy.
3. The two existing signatures keep their exact current text so old log dumps stay comparable: `SCATTER signature:` and `DETACH signature:` (`plugin/src/files/canvas-sync.ts:749-760`).
4. New signatures, one per failure mode introduced by this round's ACs:

   | Signature | Failure mode it proves | Story | WP |
   |---|---|---|---|
   | `AWARENESS GAP:` + gap in ms | a keep-alive gap approached or exceeded y-protocols' 30 s prune window | US4 AC5 | WP2 |
   | `DRAG WATCHDOG:` | `isDragging` latched and was force-released — reconciliation had been silently disabled | US4 AC11 | WP3 |
   | `ADAPTER PATCH:` + per-method outcome | a duplicate/failed mount; distinguishes `installed` / `adopted` / `unavailable` | US4 AC17 | WP3 |
   | `LOCK DENIED:` + path + ids | a local write was rejected by the lock seam and the baseline was held back | US2 AC5 | WP4 |
   | `LOCK REVERT:` + path + nodeId + winner | the loser-revert actually ran | US2 AC8 | WP4 |
   | `NO TYPE signature:` + node ids | a live node lost its `type` — every peer would silently drop it and all its edges | US3 AC12 | WP5 |
   | `CANVAS TEXT FALLBACK:` + path | a canvas is syncing through the text path because `CanvasSync` did not own it | US5 AC5 | WP6 |
   | `CANVAS WRITER:` + path + owner | which component wrote the file, on every canvas disk write | US5 AC13 | WP7 |

5. No signature is emitted on a hot path more than once per occurrence. `AWARENESS GAP:` fires only above `AWARENESS_GAP_WARN_MS`; `DRAG WATCHDOG:` fires once per latch, not per poll; `CANVAS TEXT FALLBACK:` fires once per path per session.
6. Every signature above is documented in a table in `ARCHITECTURE.md` § Appendix so a future debugger finds them without reading this spec. `ARCHITECTURE.md` already lists `SCATTER` / `DETACH` and the `local modify` line at `:622-626`; the new rows are appended there.
7. No log line contains file contents, node text or any user data beyond ids, paths, counts and timings.

### Definition of Done

`grep -rnE "SCATTER signature:|DETACH signature:|AWARENESS GAP:|DRAG WATCHDOG:|ADAPTER PATCH:|LOCK DENIED:|LOCK REVERT:|NO TYPE signature:|CANVAS TEXT FALLBACK:|CANVAS WRITER:" plugin/src --include=*.ts | grep -v __tests__` returns at least one production emitter per signature; each has a logger-spy assertion; the `ARCHITECTURE.md` appendix table lists all ten.

### Linked WPs

WP2, WP3, WP4, WP5, WP6, WP7 (one row each; no WP owns this story alone)
