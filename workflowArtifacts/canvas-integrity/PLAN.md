# Plan: Obsidian Live Share — Canvas Integrity Round

Generated: 2026-07-26
Task: Fix the four live canvas defects reported against v0.6.0 (cursor inversion, incomplete node locking, view drift on partial load, decay after window unfocus) and make the CRDT the single authoritative writer for `.canvas` files.

Round folder: `workflowArtifacts/canvas-integrity/`
Baseline: HEAD `4b34d5e` + uncommitted Phase 2–4 wiring, shipped as **v0.6.0**, installed in both test vaults.
Gate baseline to preserve: `npm run build` PASS, vitest **526 passed / 32 files**.

---

## User Story Sketch

1. As a collaborator, I want remote cursors to appear where the other person's pointer actually is, at any zoom level, so that pointing at a card means something.
2. As a collaborator, I want a card I am editing to be protected from a peer's concurrent edit, and my own rejected edit to never silently persist locally, so that cards stop jumping.
3. As a collaborator, I want every remote change — not just position — to reach my open canvas, so that scrolling into a region never reveals stale content that then overwrites my peer.
4. As a collaborator, I want my locks and presence to survive an unfocused window, so that switching apps does not silently disable collaboration safety.
5. As a collaborator, I want a `.canvas` file to be written by exactly one authority, so that two writers can never interleave and destroy connections.
6. As a maintainer, I want the next occurrence of a drift incident to be provable from a log, so that diagnosis stops depending on reproduction luck.

(W2 expands these into USER_STORIES.md with acceptance criteria)

---

## Tech / Approach Decisions

- **D1 — `useCanvasBinding` stays dormant and OFF.** User decision. Only the legacy `CanvasSync` path is repaired this round. The known `{id}`-edge-capture data-loss defect on the binding path (`canvas-model-bridge.ts:215-222` + `canvas-binding.ts:134-140`) is **documented, not fixed**. W2 must record it as a rollout blocker in the BUILD_SPEC risk section, and no WP may enable the flag.
- **D2 — Cursor fix goes in the adapter, not at the call sites.** `canvas.zoom` is `log2(scale)`; the linear factor is `canvas.scale`, which the plugin never reads (`grep '\.scale' plugin/src` → 0 hits). Correcting the transform inside `canvas-adapter.ts` leaves `canvas-presence.ts:485/493` untouched, which keeps the S4 work file-disjoint from the locking work and lets the two run in parallel.
- **D3 — S2 is fixed defensively AND instrumented.** User decision. All three candidate mechanisms get a cheap, low-risk guard, plus log/probe points so the next incident is provable. No WP may claim S2 is *diagnosed*; the acceptance criteria are "the failure mode is structurally impossible" or "the failure mode is observable", never "the bug is gone".
- **D4 — Option 4 (wire `CanvasPersistence`) is the target end state, with the text-path exclusion as its precondition.** User decision. Wiring `CanvasPersistence` as the single CRDT→disk writer cannot achieve single-writer semantics while `BackgroundSync` still holds a second `Y.Text` document for the same path and writes it — so WP6 (exclusion) is a prerequisite of WP7 (persistence), not an alternative to it.
- **D5 — Red-first for every defect fix.** `w4_fix_as_failing_test: true`. Each WP must land a test that is confirmed RED against current `main` before the fix, then green after. This is explicitly budgeted for S4, where the **existing tests encode the bug as correct behaviour** and must be corrected, not accommodated.
- **D6 — Grounding is degraded.** `graphify_enabled: false`; no `graph.json` in this repo. Structural grounding is `workflowArtifacts/RepoMap.md` (refreshed 2026-07-26) + `ARCHITECTURE.md` (repo root, verified against source 2026-07-26).

---

## Constraints

- **No new production dependency.** Plugin ships as a single bundled `main.js`.
- **Do not enable `useCanvasBinding`** anywhere, including tests that assert production defaults.
- **Do not mass-reformat.** The repo carries ~93 pre-existing biome findings on untouched files; leave them.
- **Existing suite must stay green** (526/32 baseline) except where a test provably encoded a defect — those changes must be called out explicitly in the ImplementationReport with the reason.
- **`plugin/manifest.json` is a broken symlink stub**; the real manifest is the repo-root `manifest.json`. Version is **0.6.0**; bump only on explicit instruction.
- **Do not touch** `server/` source, the deploy stack, or `docker/.env`.
- Windows/Git Bash environment: prefer `visible-console` MCP over Bash background processes.

---

## Discovery Grounding

W1 exploration (2026-07-26, `FALLBACK_REPOMAP`) read Obsidian's own canvas controller from
`obsidian.asar`, so the following are quoted behaviours, not inferences:

- **`canvas.zoom` is `log2(scale)`**, clamped `[-4, 1]`; render transform is
  `translate(w/2,h/2) scale(2**zoom) translate(-canvas.x,-canvas.y)`; `domFromPos(p) = ((p.x-x)*scale, (p.y-y)*scale)`.
  The plugin multiplies by `zoom`. At `zoom === 0` (100 %) all remote cursors collapse to the
  wrapper centre; at `zoom < 0` (any zoom-out) the factor is **negative** → point-mirrored.
  The false claim originates in the comment at `canvas-adapter.ts:13`/`:25`.
- **Viewport virtualization is NOT the cause of S3 — hypothesis refuted.** `Canvas.virtualize()`
  only calls `attach`/`preDetach`/`detach`; `canvas.nodes`/`canvas.edges` always hold the
  complete model. `getLiveNodeIds`/`getLiveEdgeIds` (`canvas-adapter.ts:368-378`) are therefore
  viewport-independent, and `applyNodeGeometry` works off-screen.
- **S3's real mechanism:** `reconcileLiveCanvas` classifies "structural" by **ID-set difference
  only** (`main.ts:1013-1016`) and its non-structural branch applies **geometry only**
  (`main.ts:1048-1068`). Remote changes to `text`/`color`/`label`/`fromSide`/`toSide` with
  unchanged id sets **never reach the open view**. Obsidian's model drifts; `requestSave()`
  then serialises its *entire* drifted model, and `handleLocalModify` pushes the stale values
  back as a local edit, reverting the peer.
- **S3, second independent vector:** `GEOMETRY_KEYS` protects only `x/y/width/height`
  (`canvas-sync.ts:155`, `:192`) — **`type` is deletable**. Obsidian's `importData` skips any
  node whose `type` is not `file|text|link|group` and creates an edge only if both endpoints
  exist, so one partial disk read that strips `type` makes every peer silently drop that node
  **and all its edges**. `auditCanvasState` (`canvas-sync.ts:723-761`) checks only `x`/`y` and
  dangling endpoints, so it cannot see this.
- **S1, three holes:** (1) edges are diffed with no `opts`, so `canWriteNode`/`canDeleteNode`
  are never consulted and the destructive `new Y.Map()` edge re-create at `canvas-sync.ts:581-586`
  is unguarded; (2) a denied write does `continue` (`:556`, `:572`) but `lastWrittenContent` is
  still advanced at `:503` — the edit stays on local disk and in the local view, invisible to
  every later diff → permanent divergence, the observed card jump; (3) GAP-1 loser-revert is
  dead code: `canvas-presence.ts:387` calls `this.onRevert?.()` but `mountCanvasPresence`
  (`main.ts:1195-1208`) never passes it. GAP-7 confirmed: `epoch` (`canvas-presence.ts:32`) is
  declared and never read or written — no lock TTL.
- **S2, no focus handling exists at all** (`grep 'blur|visibilitychange|document.hidden'` over
  `plugin/src` → 0 hits). Candidate A (most likely): locks live only in awareness; the
  keep-alive is a 12 s `setInterval` (`sync.ts:39`, started `:380-383`) against y-protocols'
  30 s `outdatedTimeout`, and Chromium throttles timers in occluded windows to 1 Hz→1/min — one
  slipped tick past 30 s and every peer prunes our state, so all locks vanish silently and
  return on refocus. Candidate B: `isDragging` has **no watchdog**, so a missed
  `setDragging(false)` latches `isBusy()` forever and silently disables all CRDT→view
  reconciliation. Candidate C: `patch()` early-returns on `__lsWrapped` (`canvas-adapter.ts:221-241`)
  and presences are keyed by path, never by `view.canvas` identity, so a failed mount can leave
  a second adapter with **no patches installed** — that canvas never claims a lock again.
- **Corrections to `ARCHITECTURE.md` for W2 to fold into the spec:** Part V's `isBusy()` row
  claims no blind spot (wrong — see Candidate B); its `GEOMETRY_KEYS` row omits `type`
  deletion; Part IV-B omits the third `reconcileLiveCanvas` case (non-structural,
  non-geometry changes silently dropped).
- **Tests that currently encode the S4 defect as correct** and must be fixed with it:
  `__tests__/canvas-adapter.test.ts:16` (`zoom: 2`), `:26-27` ("scales by live zoom"),
  `:55-56` ("returns null on zero zoom" — zero is Obsidian's 100 %),
  `__tests__/harness/canvas-double.ts:200` (default `zoom: 1`).

---

## Work Package Sketch

| WP | Title | Scope summary | Depends on |
|---|---|---|---|
| WP1 | Cursor transform (S4) | Use the linear scale (`canvas.scale`, `2**zoom` fallback) in `canvas-adapter.ts` `canvasToScreenRel` / `clientToCanvasManual` / `viewport` / `canvasToScreenRelativeToWrapper`; drop the `zoom === 0` bail; correct the false "linear" comments; fix the four tests that encode the bug | — |
| WP2 | Awareness survival (S2-A) | `sync.ts` heartbeat resilient to background-timer throttling (absolute time base, tighter interval, re-announce on wake) + instrumentation proving liveness; must not depend on a focus event existing | — |
| WP3 | Adapter robustness (S2-B/C) | `isBusy()`/`isDragging` watchdog so a missed `setDragging(false)` cannot latch forever; make adapter (re)mount detectable by `view.canvas` identity so an unpatched second adapter is impossible; log both | WP1 |
| WP4 | Node + edge locking (S1) | Gate edge writes through the lock seam; a denied write must **not** advance `lastWrittenContent`; wire `onRevert` in `mountCanvasPresence` so the tiebreak loser actually reverts | — |
| WP5 | Reconcile completeness + key protection (S3) | `reconcileLiveCanvas` must apply non-geometry field changes to the open view; protect `type` (and any other structurally-required key) from deletion; extend `auditCanvasState` to flag a node missing `type` | WP4 |
| WP6 | Single-writer precondition | Exclude `.canvas` from the text path: `vault-events.ts:131` becomes an `else`, and `BackgroundSync.startAll` skips canvas paths so no `Y.Text` doc is created. Ships the **composition regression test** (both subsystems, one path, two peers, edge endpoints must survive) confirmed RED first. Resolves: what happens to a `.canvas` that is not subscribed to `CanvasSync` | WP5 |
| WP7 | Wire `CanvasPersistence` (Option 4) | Make the CRDT the single authority for `.canvas` on disk via the built-but-unwired `CanvasPersistence` + `createVaultPersistenceIO` (`canvas-persistence.ts`, currently zero production callers); route or retire `CanvasSync.writeToDisk` accordingly; keep `coldOpen` semantics | WP6 |

**Parallelism (from W1 blast-radius analysis):**

```text
Batch A  WP1 ──► WP3            canvas-adapter.ts only
Batch B  WP2                    sync.ts only
Batch C  WP4 ──► WP5 ──► WP6 ──► WP7   canvas-sync.ts / main.ts / presence / vault-events
```

Batches A, B, C are file-disjoint and may run concurrently. Within Batch C the chain is strictly
serial — WP4/WP5 collide on both `canvas-sync.ts` and `main.ts`, and WP6/WP7 build on WP5's
key-protection work. 7 WPs ≥ `w3_parallel_threshold` (5) → **W3 runs in dispatcher mode**.

---

## Open Questions

- **WP6 fallback semantics:** if a `.canvas` file is excluded from `CanvasSync` (exclusion
  pattern, or a failed/pending `subscribe`), removing it from the text path means it syncs
  through **neither**. W2 must specify the intended behaviour — most likely "fall back to the
  text path only while `canvasSync.isSubscribed(path) === false`", which needs a defined
  transition when the subscribe later succeeds.
- **WP7 scope boundary:** does `CanvasSync` keep its debounce/sequence-gate and delegate only
  the actual write, or does `CanvasPersistence` own scheduling too? The latter is cleaner but
  touches the `remoteSeq` gate that currently protects against clobbering in-flight deltas.
- **S2 remains unproven.** If the defensive guards in WP2/WP3 do not stop the decay, the
  instrumentation from those WPs is the diagnosis path for a follow-up round. This is accepted
  going in, per D3.
