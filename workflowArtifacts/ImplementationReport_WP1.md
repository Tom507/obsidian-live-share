# Implementation Report — WP1 — Awareness latency-resistance
Date: 2026-07-17 (reworked 2026-07-17 — W4 Red→Green, GAP-4 reconnect seam)
Status: DONE

## W4 Rework — reconnect seam ordering (GAP-4, shared with WP3)

The reconnect re-emit in `SyncManager.openWebSocket().onopen` was re-broadcasting the FULL local
state (including stale `lockedNodes`) BEFORE handing control to the WP3 lock layer, so a returning
holder blindly re-asserted locks a peer had taken during the outage (US4 AC3/AC4 split lock). The
reconnect branch now fires `onReconnectCallback` (lock layer WITHHOLDS its locks) FIRST, THEN runs
the clock-tick `reemitLocalAwareness` loop — so the reconnect re-emit carries no stale locks. The
caret clock-tick / single-stable-identity behavior (AC5/AC6) is unchanged; `sync.test.ts` reconnect
tests stay green (18/18). See ImplementationReport_WP3.md for the CanvasPresence withhold+defer half
and the now-passing WP5 harness test.

## ACs Satisfied
1. New peer renders an existing static caret ≤ 1000 ms, symmetric — verified via the on-join re-emit path (`handleSubscribed`/`handleSyncRequest` → `reemitLocalAwareness`) which now clock-ticks the full local state so a mid-sync joiner (peer clock = 0) applies it. Sub-1000ms wall-clock timing is provable only under the WP5 50–150 ms RTT harness (see Risk Notes).
2. Static caret survives > 30 s on peers — verified via unit test "keeps broadcasting a static caret past 30 s without local movement": 36 s of idle fake-time still yields outbound awareness frames, local cursor unchanged. Peer-side non-prune fully provable only under WP5 harness.
3. Heartbeat emits full local state incl. `lockedNodes`, inter-emit gap < 30 s with zero edits — verified via unit test decoding the emitted MUX frame and asserting `lockedNodes.nodeA` is present; `AWARENESS_HEARTBEAT_INTERVAL_MS = 12_000` asserted `< 30_000`.
4. `reemitLocalAwareness` no longer bails on a static/non-moving caret — verified via unit tests "pulseAwarenessHeartbeat re-emits a static caret (does not bail)" and the existing SYNC_REQUEST re-emit test; bail now triggers ONLY on genuine `getLocalState() === null`.
5. Reconnect clock-tick re-renders caret on peers without typing — verified via unit test "reconnect ticks the awareness clock and keeps a single stable identity": after socket drop + backoff reopen, an awareness frame is emitted on the new socket. Sub-1000ms peer re-render provable under WP5 harness.
6. Reconnect keeps exactly one awareness identity, no ghost duplicate — verified: same `clientID` before/after reconnect (docs+awareness reused, never recreated), `getStates().size === 1`. "No split lock" (US4 AC3/AC4) provable end-to-end under WP5 harness.
7. Idle-but-connected lock holder keeps its lock past 30 s — verified structurally: heartbeat re-emits the FULL state including `lockedNodes` every 12 s (AC3 test decodes `lockedNodes` from the frame). `canWriteNode`-false-on-peer assertion belongs to WP3 + WP5 harness.

## ACs Not Satisfied
- None outright unmet. ACs 1/2/5/6/7 have residual latency-only assertions delegated to the WP5 harness (marked RISKY below), but the client-side plumbing each depends on is implemented and unit-verified.

## Files Changed
- `plugin/src/sync/sync.ts`:
  - Added exported `AWARENESS_HEARTBEAT_INTERVAL_MS = 12_000` (< 30 s prune window).
  - Added awareness heartbeat interval (started/stopped alongside the existing MUX ping heartbeat) + public `pulseAwarenessHeartbeat()` seam (deterministic trigger for WP5 harness/tests).
  - Rewrote `reemitLocalAwareness` to tick the awareness clock via `setLocalState(getLocalState())` (bumps the Lamport clock so peers refresh their 30 s `lastUpdated` and mid-sync joiners apply the state). Bails ONLY on genuine `null` local state — never on a merely-static caret. Emits FULL local state (caret + arbitrary fields incl. `lockedNodes`) via the existing awareness `update` handler → `sendMux` (E2E-safe).
  - `ws.onopen`: distinguishes reconnect from first connect (`hasEverConnected`); on reconnect performs the clock-tick per doc and fires a new `onReconnect(docIds)` seam for WP3 to re-request `lockedNodes` and re-claim only still-free nodes (no blind lock re-assert implemented here).
  - Added `onReconnect()` registration; reset `hasEverConnected` on explicit `disconnect()`.
- `plugin/src/__tests__/sync.test.ts`: added 5 WP1 unit tests (heartbeat full-state+lockedNodes cadence, static-caret survival, no-bail pulse, reconnect clock-tick + single identity, no-reconnect-seam-on-first-connect) + two decode helpers.
- `plugin/src/editor/collab.ts`: NOT modified — remote caret rendering rides yCollab's own awareness listener, which reacts to the heartbeat/reconnect re-emits; no full-state/idle handling needed at the editor layer.
- Server (`server/src/`): NOT touched. On-join transfer resolved fully client-side per BUILD_SPEC §5 open-question resolution (no relay redeploy). Ghost-caret fix `ws-handler.ts:236-237` untouched.

## Quality Gates
- `npx biome check src/sync/sync.ts src/__tests__/sync.test.ts` (lint, WP1 files): PASS
- `npm run build` (tsc typecheck + esbuild): PASS
- `npm test` (vitest run): PASS — 376/376 (19 files); sync.test.ts 18/18. Baseline (367) preserved; +new WP1 tests, suite fully green.
- Note: repo-wide `npm run lint` (`biome check .`) reports 90 PRE-EXISTING errors, all in a corrupted `manifest.json` whose sole line is a literal filesystem path (`/home/mewski/Projects/...`). Unrelated to WP1, not introduced by this change; flagged for cleanup, not fixed here (out of WP1 scope).

## Risk Notes
- degraded grounding (no graph): Graphify disabled; grounded on BUILD_SPEC §5/§9 WP1 + US1/US4 + Round-1 code and file:line anchors. No structural graph was available — expected, not an escalation.
- RISKY / verified-by-W4-WP5-harness: the true race/timing guarantees — symmetric caret join ≤ 1000 ms (AC1/AC5), peer-side non-prune of a static caret past 35 s (AC2), reconnect re-render ≤ 1000 ms (AC5), and "no split lock / peers still see held + `canWriteNode` false" (AC6/AC7) — are only fully provable under the WP5 two-client 50–150 ms RTT harness. Locally they are verified via fake-timer unit tests asserting the outbound MUX awareness frames, clock ticks, and single stable `clientID`; the wall-clock latency assertions are delegated to WP5.
- Concurrent edit observed: a parallel process introduced a duplicate `AWARENESS_HEARTBEAT_INTERVAL_MS` declaration during the run; reconciled to a single exported const (kept the richer comment). No functional impact.
- WP3 seam: reconnect re-claim policy is intentionally NOT implemented here. `onReconnect(docIds)` is the exposed hook; WP3 supplies "re-claim only still-free nodes".
