# Handover — ObsidianLiveShare (Round 2: Latency-Resistance, Canvas Presence & Per-Card Locking)
W3 run: 2026-07-17 (W4 rework applied 2026-07-17)

## W4 Rework Summary (Red → Green) — 1 CRITICAL fix

**GAP-4 / US4 AC3/AC4 — reconnecting lock-holder split lock — FIXED, now GREEN.**
On MUX reconnect a returning holder blindly re-asserted stale `lockedNodes` and (being the lower
`clientID`) re-grabbed via the lowest-id tiebreak a node a peer had acquired during the outage →
split lock, then durable wrong holder. Fix: `CanvasPresence.onReconnect()` now WITHHOLDS all locks
immediately (broadcasts a lock-free state) and DEFERS re-claim by `reclaimDeferMs` (~1 heartbeat/RTT,
default 250 ms), then re-claims ONLY still-free nodes; `SyncManager` fires the reconnect seam BEFORE
the clock-tick re-emit so no stale lock is ever re-broadcast. Normal tiebreak and crash-safe
auto-release untouched.

- **Now-passing test:** `plugin/src/__tests__/wp5/latency.test.ts::reconnecting holder re-claims only still-free nodes — no split lock (US4 AC3/AC4, GAP-4)` — GREEN.
- **Files changed in rework:** `plugin/src/canvas/canvas-presence.ts` (withhold + deferred still-free
  re-claim + timer cleanup), `plugin/src/sync/sync.ts` (reconnect seam fires before clock-tick
  re-emit), `plugin/src/__tests__/canvas-presence.test.ts` (unit test updated to deferred semantics).
- **Post-rework gates (visible-console):** plugin build PASS + `npm test` **412/412**; server build
  PASS + `npm test` **122/122**. No regression. Only the known pre-existing environment-only
  `biome check` manifest-symlink lint remains red (out of scope).

## Scope of This Run

Tasks completed: WP1, WP2, WP3, WP4 (text + canvas halves). WP5 is intentionally NOT
implemented here — it is W4's latency E2E harness and the primary consumer of this handover.

Tasks with risk flags: WP2, WP3, WP4 (all carry latency-only ACs that are unit/mechanism-verified
here but only fully provable under WP5's 50–150 ms RTT two-client harness). WP1 has residual
latency-only assertions but its client-side plumbing is fully unit-verified.

Structural grounding was **degraded (no graph — Graphify disabled)** for every WP, as expected per
the Dispatcher directive; grounded on BUILD_SPEC §4/§5/§9 + USER_STORIES + Round-1 code and the
file:line anchors, which were confirmed accurate against the tree.

## Quality Gate Status (authoritative, re-verified by W3 after all WPs)

- **Plugin** `npm run build` (tsc + esbuild): PASS (exit 0). `npm test` (vitest): **401 passed / 0 failed** (21 files). Baseline 367 → 401 (+34 new tests; no regression).
- **Server** `npm run build` (tsc): PASS (exit 0). `npm test` (vitest): **122 passed / 0 failed** (10 files). Baseline preserved; `server/src/` untouched (on-join transfer resolved client-side, no relay redeploy).
- Both suites green under the `visible-console` runtime. Round-1 regression suites (single-writer/Bug-B, ghost-caret, per-key canvas diff) stay green.
- **Known environment red (NOT a code regression):** repo-wide `npm run lint` (`biome check .`) fails from a pre-existing corrupted `plugin/manifest.json` (a git symlink materialized on this Windows checkout as a plain file holding a Linux path → ~87 JSON parse errors) plus CRLF/autocrlf whole-file format diffs. New W3 files were kept biome-clean; no W3 change introduced a lint-rule violation. Recommend a separate cleanup pass to restore `manifest.json` and normalize line endings.

## WP Status Summary

| WP | Title | Status | Risk Flag | Priority for W4 |
|---|---|---|---|---|
| WP1 | Awareness latency-resistance | DONE | MEDIUM | HIGH |
| WP2 | Canvas presence (cursors + here/typing) | DONE | MEDIUM | HIGH |
| WP3 | Per-card locking (acquire/tiebreak/delete-wins/enforce/highlight) | DONE | NONE (GAP-4 split-lock fixed, WP5 harness green) | RESOLVED |
| WP4 | Latency-tolerant editing (text + canvas flush-yield, drop-unflushed, edge prune) | DONE | MEDIUM | HIGH |
| WP5 | Latency E2E harness | NOT STARTED (W4 owns) | — | CRITICAL (W4 builds this) |

## Risk Notes for W4

**WP3 — Per-card locking (HIGH / CRITICAL to probe):**
- One-RTT contention / lowest-`clientID` tiebreak with loser-revert (GAP-1) and settle-before-mutate
  (GAP-3) are deterministic-logic-verified via unit tests but the true two-clients-in-one-tick race
  is only reproducible under injected 50–150 ms RTT. Probe: both clients claim the same node inside
  one RTT → assert exactly one holder = lowest clientID, loser's `lockedNodes` cleared + optimistic
  edit rolled back + NO committed CRDT write by the loser.
- **GAP-7 lock-epoch NOT implemented** — the `epoch?` field exists in the awareness shape but is
  unused; bounded-LWW risk is documented per BUILD_SPEC §5 (US3 AC9 does not fail on its absence). A
  GC-paused resumed holder can still push one stale delta after auto-release; worst case is a per-key
  LWW clobber, not corruption. If W4 wants the epoch path exercised, it must be implemented first.
- Delete-wins/no-resurrect (fix at `canvas-sync.ts:304-311`) and `canDeleteNode` guard are
  unit-verified; probe the remote-delete-while-locked-and-edited race under latency.
- Diff-inferred fallback (private Canvas API forcibly absent) is a real tested path — W4 should keep
  a test that stubs the private API out and asserts a lock is still acquired on first key change.

**WP2 — Canvas presence (MEDIUM / HIGH):** overlay marker render, color/name, other-canvas filtering,
and awareness field shape are unit-green; live two-client cursor movement and marker-removal-within-
one-heartbeat on leave/disconnect need the WP5 harness. Net-new against Obsidian's **private, untyped
Canvas view API** (isolated behind `canvas-adapter.ts`) — the highest structural-fragility surface;
probe activation on a canvas-only view (no MarkdownView/CodeMirror active).

**WP4 (MEDIUM):** text flush version-gate (`background-sync.ts` `remoteSeq`) and canvas flush gate +
edge cascade/prune (`canvas-sync.ts`) are unit-verified; the in-flight-remote-delta-during-local-flush
survival and drop-unflushed-on-remote-lock are only meaningful under injected latency.

**WP1 (MEDIUM):** heartbeat cadence (<30 s, 12 s actual), no-null-bail re-emit, reconnect clock-tick,
and single stable `clientID` are unit-verified with fake timers; ≤1000 ms symmetric caret join,
>35 s static-caret non-prune on peers, and reconnect re-render ≤1000 ms are delegated to WP5.

## Summary for W4 Entry Point

Round-2 latency-resistance, canvas presence, and per-card locking are implemented and both suites are
green (plugin 401, server 122). What is now observable and how to drive it under the WP5 harness:

- **Awareness plumbing (WP1, `plugin/src/sync/sync.ts`):** `AWARENESS_HEARTBEAT_INTERVAL_MS = 12_000`;
  public `pulseAwarenessHeartbeat()` deterministically fires a full-state re-emit (use this instead of
  wall-clock waits); `reemitLocalAwareness` clock-ticks full local state (incl. `lockedNodes`) and
  bails only on genuine `null`; reconnect ticks the clock keeping a stable `clientID`; `onReconnect(docIds)`
  registration seam drives per-doc reconnect policy.
- **Canvas presence (WP2):** new files `plugin/src/canvas/canvas-adapter.ts` (thin private-Canvas-API
  isolation), `canvas-overlay.ts` (DOM markers + per-node held-highlight), `canvas-presence.ts`
  (awareness read/write of `{canvasPath,nodeId|null,x,y,lockedNodes}`). Activation branches to
  `CanvasView` in `plugin/src/main.ts` `onActiveFileChange` (previously hard-returned for non-MarkdownView).
  Canvas doc awareness is exposed via the SyncManager for `getDoc("__canvas__:<path>")`.
- **Locking + enforcement (WP3, `plugin/src/files/canvas-sync.ts`):** `canWriteNode(path,nodeId)` /
  `canDeleteNode(path,nodeId)` are wired into the per-node diff path (`:284-318`); locks ride ephemeral
  canvas awareness (crash-safe auto-release on disconnect); lowest-clientID tiebreak + loser-revert;
  reconnect re-claims only still-free nodes via the WP1 `onReconnect` seam.
- **Latency-tolerant flush (WP4):** `background-sync.ts` (text) and `canvas-sync.ts` (canvas) both gate
  disk flush on a monotonic per-file remote sequence so a stale local flush yields to an in-flight
  remote delta; drop-unflushed-on-remote-lock via the canWriteNode gate; edges cascade-prune on delete
  and dangling edges are pruned on `serializeCanvas`.

**W4 should build the WP5 two-client harness injecting 50–150 ms RTT** and drive: (a) same-card one-tick
tiebreak, (b) delete-vs-lock no-resurrect, (c) idle-holder >30 s lock survival, (d) reconnect no-split-lock,
(e) guest canvas text/node survival under concurrent write — each as a fix-as-failing-test with an
AC→test-id mapping, and skip/annotate race assertions at RTT=0 (a zero-latency run is not proof). All
production seams are injectable (timers, hooks, `pulseAwarenessHeartbeat`, adapter, `canWrite/canDelete`)
so the harness needs no further production changes.
