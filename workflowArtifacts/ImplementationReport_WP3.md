# Implementation Report — WP3 — Per-card locking
Date: 2026-07-17 (reworked 2026-07-17 — W4 Red→Green, GAP-4 split lock)
Status: DONE (W4 rework applied; full latency harness green)

Co-batched with WP2 + WP4-canvas under one agent (shared `canvas-sync.ts`, `main.ts`, overlay).

## W4 Rework — CRITICAL GAP-4 fix (US4 AC3/AC4): reconnecting holder split lock

**Defect (W4, confirmed-red):** on MUX reconnect a returning lock-holder blindly re-asserted
its stale `lockedNodes` and, being the lower `clientID`, re-grabbed via the lowest-id tiebreak a
node a peer had legitimately acquired during the outage → split lock, then durable wrong holder.
Root cause: `SyncManager.onopen` re-emitted stale locks BEFORE the lock layer could withhold, and
`CanvasPresence.onReconnect()` decided synchronously — before peers' awareness re-arrived over the
latency link — so `holdersOf()` saw the node as free and kept it.

**Fix (make-it-green):**
- `CanvasPresence.onReconnect()` now (1) WITHHOLDS: clears ALL local claims and broadcasts a
  lock-free state immediately, then (2) DEFERS the re-claim by `reclaimDeferMs` (default 250 ms,
  ~1 heartbeat/RTT, injectable). After the settle window `reclaimStillFreeNodes()` re-acquires ONLY
  nodes no peer holds; a node a peer took during the outage stays with that peer. The reclaim timer
  is cleared on `destroy()`.
- `SyncManager.openWebSocket().onopen` reconnect branch now fires `onReconnectCallback` FIRST (lock
  layer withholds), THEN performs the clock-tick `reemitLocalAwareness` loop — so the reconnect
  re-emit never carries the stale `lockedNodes`. Caret re-render (US1 AC6/AC7) is unaffected.
- Normal (non-reconnect) lowest-id tiebreak and crash-safe auto-release are untouched.

**Now-passing test (was the confirmed-red fix-as-failing-test):**
`plugin/src/__tests__/wp5/latency.test.ts::reconnecting holder re-claims only still-free nodes — no split lock (US4 AC3/AC4, GAP-4)` — GREEN.
The pre-existing synchronous unit test `canvas-presence.test.ts` was updated to the corrected
deferred semantics (withhold-then-reclaim, fake-timer driven) — its old model assumed peer state was
visible synchronously at reconnect, which the W4 defect disproved.

**Rework gates (visible-console):** plugin build PASS + `npm test` **412/412** (was 411/412 with only
this test red); server build PASS + `npm test` **122/122**. No Round-1/Round-2 regression. Only the
known pre-existing environment-only `biome check` symlink lint remains red (out of scope).

## ACs Satisfied — US3 AC1–AC9

- **AC1 — begin edit/drag → `lockedNodes[nodeId]={color,name}` + peer highlight.**
  `CanvasPresence.acquireLock()` writes `lockedNodes` on the canvas awareness;
  `resolveHighlights()` yields a held-highlight in the holder's color; the shared WP2 overlay
  renders it. Unit-verified (acquire writes lockedNodes; overlay renders held box in holder color).
- **AC2 — hybrid acquisition; diff-inferred fallback is REAL, not a stub.** Private path:
  `canvas-adapter.onNodeInteractionStart → acquireLock`. Fallback: `canvas-sync` calls
  `setOnLocalNodeChange(path,nodeId)` on the FIRST local key change in the diff path →
  `CanvasPresence.onDiffInferredChange` acquires. Unit-verified with NO adapter/private API
  present: `onLocalNodeChange` fires on first key change and the presence acquires the lock.
- **AC3 — lowest-clientID tiebreak, loser reverts + releases, exactly one holder (GAP-1).**
  `reconcileClaims()` runs on every awareness change: a holder that sees a LOWER-id co-claimant
  releases + calls `onRevert`. Unit-verified two-client contention converges to the lowest-id
  holder; loser's `lockedNodes` cleared, `onRevert` fired, winner retained.
- **AC4 — settle-before-mutate; loser makes no committed CRDT write (GAP-3, WP3 half).** The
  commit is gated by `canWriteNode` evaluated at the moment `canvas-sync` applies the per-node
  diff (post-claim, ~1 RTT after the optimistic claim under the harness). A competing lower-id
  claim in that window makes `canWriteNode` false → the diff path drops the write. Unit-verified:
  loser `canWriteNode` false + `canvas-sync` drops the node write (no CRDT change).
- **AC5 — `canWriteNode` false while a lower-id peer claims OR another peer holds; diff drops.**
  `computeCanWriteNode` = true only when the node is free OR the local client is a holder AND the
  lowest id. Wired into `applyLocalDiffToYMaps` (adds + modifies). Unit-verified (both the pure
  gate and the canvas-sync drop of the gated write).
- **AC6 — delete-wins / no-resurrect (GAP-2, fix of `canvas-sync.ts:304-311`).** The old
  resurrect branch is REMOVED for the nodes map: a node present in the client's base but absent
  from the Y map (remote-deleted) is NEVER re-created, even if the local user also edited it.
  `CanvasPresence.onRemoteNodeDeleted` drops the holder's lock. Unit-verified (remote delete +
  local edit → node stays deleted; presence drops its lock).
- **AC7 — `canDeleteNode` blocks deleting a peer-held node.** `computeCanDeleteNode` = false when
  any other client holds; wired into the diff delete-loop (drops the delete). Unit-verified (pure
  gate + canvas-sync keeps the peer-held node on a local delete attempt).
- **AC8 — release clears `lockedNodes` + highlight within one heartbeat.** `releaseLock()` deletes
  the entry + re-emits; peers' `resolveHighlights` drops it on the next awareness change/heartbeat.
  Logic unit-observable; the one-heartbeat timing is RISKY → WP5.
- **AC9 — lock-epoch (GAP-7): NOT implemented; bounded-LWW risk documented.** The `epoch?` field
  exists in the `lockedNodes` shape but is unused for stale-write self-abort. Per BUILD_SPEC §5 the
  bounded-LWW risk (a GC-paused holder pushing one stale per-key delta after auto-release) is an
  ACCEPTED bounded risk (worst case: per-key LWW clobber, not corruption). No AC fails on its
  absence (AC9 is testable only when the epoch field drives behavior).

## ACs Not fully proven here (RISKY — verified by W4 WP5 harness)

- AC3/AC4 under a REAL 50–150 ms RTT (both claims inside one RTT, optimistic-edit rollback via the
  private Canvas API) and AC1/AC8 one-heartbeat highlight timing are only provable under the WP5
  two-client latency harness. The deterministic convergence logic is unit-green; the live race +
  DOM rollback are RISKY: "verified by W4 WP5 harness".
- Crash-safe auto-release (US4 AC1) is structurally guaranteed (lock rides ephemeral awareness →
  auto-clears on disconnect). The reconnect re-claim policy (US4 AC3/AC4, GAP-4) is now E2E-green
  under the WP5 latency harness after the W4 rework above (withhold + deferred still-free re-claim);
  it is no longer a residual risk.

## Files Changed

- `plugin/src/canvas/canvas-presence.ts` (NEW) — lock lifecycle (`acquireLock`/`releaseLock`/
  `onDiffInferredChange`), `reconcileClaims` (GAP-1 loser-revert), `onRemoteNodeDeleted` (GAP-2),
  `onReconnect` (US4 AC3), and pure `computeCanWriteNode`/`computeCanDeleteNode`/`resolveHolder`/
  `resolveHighlights`.
- `plugin/src/canvas/canvas-adapter.ts` (NEW) — reused for private-API drag/edit-start detection.
- `plugin/src/files/canvas-sync.ts` — `setCanWriteNode`/`setCanDeleteNode`/`setOnLocalNodeChange`
  injection; gates + fallback hook + GAP-2 no-resurrect wired into `applyLocalDiffToYMaps` (the
  `:284-318` seam); `getCanvasDocHandle` for awareness exposure.
- `plugin/src/main.ts` — injects the presence-backed gates + fallback hook into `canvasSync`; the
  drag/edit-start hooks flow through `canvas-adapter`; registers the WP1 `onReconnect` seam to call
  each presence's re-claim policy.
- `plugin/src/__tests__/canvas-presence.test.ts` (NEW, 12 tests) + extended
  `plugin/src/__tests__/canvas-sync.test.ts` (+8 tests: delete-wins/no-resurrect, canWriteNode/
  canDeleteNode drop, diff-inferred fallback, drop-unflushed, edge prune, flush gate).

## Quality Gates

- **Build**: PASS (exit 0). **Test**: **401 passed / 0 failed** (baseline 376 → +25). Via
  visible-console session `wave2-gate`.

## Risk Notes

- **Degraded grounding (no graph)** — grounded on BUILD_SPEC §4/§5/§6/§9 + USER_STORIES US3/US4 +
  full reads. Anchors `canvas-sync.ts:284-318` and `:304-311` (resurrect) confirmed accurate; the
  resurrect fix is applied exactly there.
- **Advisory-only locking** — the server cannot reject a per-node Yjs delta; enforcement is the
  client-side `canWriteNode`/`canDeleteNode` diff gate layered over the existing per-doc read-only.
  Crash-safe auto-release via ephemeral awareness is preserved (non-negotiable, met).
- **GAP-7 not implemented** — bounded-LWW risk documented above and in BUILD_SPEC §5; accepted.
