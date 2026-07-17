# Implementation Report — WP2 — Canvas presence (cursors + here/typing)
Date: 2026-07-17
Status: DONE (unit-observable ACs green; live two-client rendering RISKY → WP5 harness)

Co-batched with WP3 + WP4-canvas under one agent (shared `canvas-sync.ts`, `main.ts`, new overlay).

## ACs Satisfied

- **US2 AC1 — remote cursor markers that update on movement.** `CanvasOverlay.render()`
  paints one DOM marker per remote peer from the canvas-doc awareness snapshot;
  `resolveCursors()` maps each peer state `{x,y}` to a marker; the overlay repaints on
  every awareness `change`. Unit-verified (overlay renders a marker at the peer coords).
- **US2 AC2 — identity color + name per marker.** Each marker carries `color` + `name`
  from the peer's `identity` field on awareness; the label text is the peer name.
  Unit-verified.
- **US2 AC3 — here/typing indicator, absent for peers elsewhere.** `resolveCursors()`
  filters peers by `canvasPath` (a peer on a different canvas produces no marker), and
  sets `typing = nodeId !== null` (editing a node ⇒ typing). The overlay renders a
  `(typing)` label + `is-typing` class. Unit-verified (present peer → marker; other-canvas
  peer → excluded).
- **US2 AC4 — renders with no CodeMirror editor active.** `main.ts onActiveFileChange`
  no longer hard-returns for non-`MarkdownView`: it first calls `syncCanvasPresences()`,
  which mounts a `CanvasPresence` for every open, subscribed `canvas` leaf. Canvas presence
  rides `getCanvasDocHandle().awareness` (the canvas doc's own channel), independent of the
  editor. Wiring verified by build; live render is RISKY (see below).
- **US2 AC6 — exact awareness field shape.** `CanvasPresence.emitLocalState()` writes
  exactly `{ canvasPath, nodeId|null, x, y, lockedNodes }` (+ an `identity` sidecar for
  name/color). Unit-verified the emitted object's keys match the shape.

## ACs Not fully proven here (RISKY — verified by W4 WP5 harness)

- **US2 AC1/AC4 live two-client rendering** and **US2 AC5 marker-removal-within-one-heartbeat
  on leave/disconnect** depend on the real awareness transport + the 12 s heartbeat + a real
  Obsidian Canvas view. The removal path is implemented (awareness auto-clears on disconnect
  → `resolveCursors` drops the peer → overlay repaints; `CanvasPresence.destroy()` sets local
  state null on canvas close), but the end-to-end timing is only provable under the 50–150 ms
  RTT WP5 harness. Flagged RISKY: "verified by W4 WP5 harness".

## Files Changed

- NEW `plugin/src/canvas/canvas-adapter.ts` — thin isolation of Obsidian's PRIVATE, untyped
  Canvas view API (viewport, node-interaction start/end, pointer-move, client→canvas mapping).
  Degrades gracefully: `isAvailable()` false when the private surface is absent — the trigger
  for WP3's diff-inferred fallback. Reused by WP3.
- NEW `plugin/src/canvas/canvas-overlay.ts` — the net-new DOM overlay. A dumb renderer that
  accepts BOTH cursor markers AND per-node held-highlights (so WP3 reuses it). Decoupled from
  the real DOM via a small structural `OverlayHost`/`OverlayNode` interface (unit-testable in
  node; real Obsidian `HTMLElement` passed at runtime).
- NEW `plugin/src/canvas/canvas-presence.ts` — presence controller + pure decision functions;
  owns awareness read/write and drives the overlay. (Lock logic is WP3.)
- `plugin/src/files/canvas-sync.ts` — added `getCanvasDocHandle(path)` to expose the canvas
  doc's awareness channel.
- `plugin/src/main.ts` — `onActiveFileChange` branches to `syncCanvasPresences()`;
  `mountCanvasPresence()` builds adapter + overlay + presence per open canvas; teardown wired
  into `cleanupSession`/`onunload`; `layout-change` + `active-leaf-change` reconcile mounts.
- NEW `plugin/src/__tests__/canvas-overlay.test.ts` (4 tests), NEW
  `plugin/src/__tests__/canvas-presence.test.ts` (12 tests, shared with WP3).

## Quality Gates

- **Build** (`npm run build` = `tsc -noEmit -skipLibCheck && esbuild production`): PASS (exit 0).
- **Test** (`npm test` = `vitest run`): **401 passed / 0 failed / 21 files** (baseline 376 → +25
  new canvas tests; no regressions). Run via visible-console (session `wave2-gate`).
- New files are biome-clean by construction. (Repo-wide `biome check .` remains environment-red
  from the pre-existing corrupted `manifest.json` symlink + CRLF — not a regression.)

## Risk Notes

- **Degraded grounding (no graph).** Structural grounding was DEGRADED — no code graph;
  `load_context` `workflow_brief.hits` were sparse. Grounded on BUILD_SPEC §4/§5/§9 + USER_STORIES
  US2 + a full read of `canvas-sync.ts`, `main.ts`, `sync.ts`, `background-sync.ts`. Anchors
  (`main.ts:749-802`, `694-700`; `canvas-sync.ts:182-183`) confirmed accurate.
- **Private Canvas API untyped/unstable.** All private access is isolated in `canvas-adapter.ts`
  and defended at every field; a shape change downgrades to no-cursor-events + the diff-inferred
  fallback rather than throwing. The `main.ts` canvas mount is guarded by try/catch + feature
  detection and is NOT unit-tested (no `main.test.ts` exists in the repo); it is validated by tsc
  and is RISKY pending the WP5 harness.
