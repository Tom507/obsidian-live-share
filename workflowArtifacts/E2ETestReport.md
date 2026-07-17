# E2E Test Report — ObsidianLiveShare (Round 2)

W4 run: 2026-07-17 · **Re-validation: rework cycle 1**
Status: **VALIDATION_PASS**

Scope: Latency-Resistance, Canvas Presence & Per-Card Locking (WP1–WP5).
Test levels active (from `workflow.config.json`): smoke + integration + full E2E + fix-as-failing-test — all enabled.

> **Headline (rework cycle 1 — re-validated):** ALL gates green — **plugin 412/412, server 122/122**.
> The WP5 latency harness is now **11/11 green**, including the previously-CRITICAL
> `reconnecting holder re-claims only still-free nodes — no split lock (US4 AC3/AC4, GAP-4)`. W3's fix
> was independently confirmed real (not a relaxed test): under injected ~80 ms RTT, with the adversarial
> `clientID` ordering FORCED (returning holder = lower id), a node a peer acquired during the outage
> **stays with that peer** (no dual ownership), stable across 4 runs. W3's edit to the
> `canvas-presence.test.ts` unit test encodes CORRECT deferred semantics and STRENGTHENS coverage (adds
> an immediate-withhold assertion), it does not hide the bug. **No CRITICAL/HIGH issues remain.**
>
> _(Cycle-0 headline, for history: the CRITICAL split-lock defect below was confirmed-red before rework.)_

---

## Quality Gates (BUILD_SPEC §7)

Run via visible-console (`run_command` powershell + `await_console`).

| Gate | Command | Result |
|---|---|---|
| Plugin typecheck+build | `cd plugin && npm run build` (`tsc -noEmit` + esbuild) | **PASS** (exit 0) |
| Plugin tests | `cd plugin && npm test` (vitest) | **412 / 412 pass** (22 files) after rework cycle 1 — the previously-red WP5 fix-as-failing-test is now GREEN. _(Cycle-0: 411/412, 1 intended red.)_ |
| Plugin lint | `cd plugin && npm run lint` (`biome check .`) | **FAIL — pre-existing, environment-only (LOW).** Verified below; not a W3 regression, not from the new WP5 files. |
| Server typecheck+build | `cd server && npm run build` (`tsc`) | **PASS** (exit 0) |
| Server tests | `cd server && npm test` (vitest) | **122 / 122 pass** (10 files). `server/src` untouched — on-join transfer resolved client-side, no relay redeploy. |

**Lint red is env-only (confirmed, matches HANDOVER):** `plugin/manifest.json` is a git symlink
(`git ls-files -s` → mode `120000`) that materialized on this Windows checkout as a plain text file
containing the Linux path `/home/mewski/Projects/obsidian-live-share/manifest.json`; biome then emits
~87 JSON parse errors on it plus CRLF whole-file diffs. The two **new WP5 files pass `biome check`
with warnings only (no errors)**. Classified **LOW / environment** — a checkout/line-ending cleanup,
not a code fix. Not a WP3 code regression.

---

## Test Level Results

### Smoke Tests (one happy path per user story)

| US | Happy path | Result | Evidence |
|---|---|---|---|
| US1 | Static caret transfers to a mid-sync joiner, symmetric | **PASS** | harness `US1 …≤1000 ms, both directions` |
| US2 | Canvas cursor/highlight render + shared awareness shape | **PASS** | `canvas-presence.test.ts`, `canvas-overlay.test.ts` (unit-green); shape reused by harness |
| US3 | Lock acquisition + peer-held highlight + tiebreak | **PASS** | harness `two clients claim one node…lowest-clientID wins` |
| US4 | Crash-safe auto-release on holder drop (AC1) | **PASS** | harness: after host drop the guest can re-acquire the node (relay cleared host awareness) |
| US5 | Concurrent edits to different nodes converge (no clobber) | **PASS** | harness `concurrent edits to different nodes…do not clobber` |
| US6 | Harness injects a real, in-band RTT | **PASS** | harness `injects a measurable RTT inside the 50–150 ms band` |

### Integration Tests (per WP interaction surfaces; WP3 probed hardest)

| WP | Surface | Result | Evidence |
|---|---|---|---|
| WP1 | Awareness heartbeat cadence <30 s, no-null-bail re-emit, reconnect clock-tick, stable clientID | **PASS** | `sync.test.ts` (18) unit-green; reconnect caret re-render E2E-green in harness |
| WP2 | Canvas awareness expose + overlay render + other-canvas filtering + field shape | **PASS** | `canvas-presence.test.ts` (12), `canvas-overlay.test.ts` (4) |
| WP3 | `canWriteNode`/`canDeleteNode` gates, tiebreak, delete-wins/no-resurrect, diff-inferred fallback | **PASS (mechanism)** + **1 CRITICAL E2E gap** | `canvas-sync.test.ts` (23) unit-green; harness tiebreak + delete-wins E2E-green; **reconnect re-claim E2E RED** (Issue #1) |
| WP4 | Version-gated flush, drop-unflushed-on-remote-lock, edge cascade/serialize prune, single-writer intact | **PASS** | `canvas-sync.test.ts` + `background-sync.test.ts` + `regression.test.ts` unit-green; concurrent-edit convergence E2E-green |

### Full E2E Tests — WP5 Latency Harness (the key deliverable)

**New, repeatable, deterministic.** Runs the **real NeuralAngels relay** (`server/src` `createApp`,
in-process on an ephemeral port) and **two real sync-core clients** (`SyncManager` + `CanvasPresence`)
with a **latency-injecting WebSocket** that holds every frame `20 ms`/hop → one-way ≈40 ms, **RTT ≈80 ms**
(measured in-band 50–150 ms). Injection is delayed message delivery, not wall-clock sleeps in
assertions. Files:
- `plugin/src/__tests__/wp5/harness.ts` (relay start, room, latency WebSocket, client factory)
- `plugin/src/__tests__/wp5/latency.test.ts` (11 scenarios, AC→test mapping in the header)

Run: `cd plugin && npm test` (or `npx vitest run src/__tests__/wp5/latency.test.ts`). Result: **10 pass / 1 fail** (the fail is the fix-as-failing-test below).

| US / AC | Scenario | Result |
|---|---|---|
| US6 AC1 | Injected RTT measured inside 50–150 ms band | **PASS** |
| US6 AC5 | Zero-latency run annotated as non-proof (gating = RTT>0) | **PASS** |
| US6 AC2 | Red-first control: **without** the tiebreak, two raw awareness claims converge to **dual ownership** over the wire (proves the race is real & latency-visible, so the passing tiebreak test is not a false-green) | **PASS** |
| US6 AC4 | Tiebreak deterministic across 3 repeated runs | **PASS** |
| US1 AC1/AC2 | Static caret transferred to a mid-sync joiner ≤1000 ms, both directions, no local movement | **PASS** |
| US1 AC6/AC7 (GAP-4) | Reconnect re-renders the caret ≤ heartbeat and keeps a single stable identity (exactly one awareness entry, same clientID) | **PASS** |
| US3 AC3/AC4 (GAP-1/3) | Two clients claim one node within one RTT → lowest-`clientID` wins, loser reverts (`onRevert` fired) + releases, exactly one holder | **PASS** |
| US3 AC5 | After settle, loser `canWriteNode`=false, winner=true (no dual ownership) | **PASS** |
| US3 AC6 (GAP-2) | Remote delete of a locked node → holder aborts + releases, node stays deleted (no resurrect) | **PASS** |
| US1 AC3/AC4 + US4 AC2 (GAP-6) | Static caret **and** idle lock survive a real **>30 s** idle window on the peer (12 s heartbeat defeats the y-protocols prune); guest `canWriteNode` still false | **PASS** (33 s real-time test) |
| US5 AC1 | Concurrent edits to different nodes over latency don't clobber (per-node LWW converges on both replicas) | **PASS** |
| **US4 AC3/AC4 (GAP-4)** | **Reconnecting holder re-claims only still-free nodes — no split lock** (adversarial clientID ordering forced; peer keeps its outage-time acquisition; stable ×4) | **PASS** (cycle 1) |

**Browser surface:** none applicable — the plugin UI runs inside Obsidian/Electron, not a standalone
browser, so Playwright is not applicable. Flows are covered at the **sync-core protocol level with
injected latency**; the protocol-level harness IS the E2E for this project.

### AC coverage: E2E-reproduced vs mechanism-verified (explicit, per instruction)

- **End-to-end reproduced under injected latency (real relay + real clients):** US1 AC1/AC2/AC3/AC4/AC6/AC7; US3 AC3/AC4/AC5/AC6; US4 AC1/AC2; **US4 AC3/AC4 (RED)**; US5 AC1; US6 AC1/AC2/AC3/AC4/AC5.
- **Mechanism-verified only (deterministic unit tests; not end-to-end reproducible without a live Obsidian Canvas view / disk vault):** US2 AC1–AC6 (DOM overlay render — needs the private Canvas view + DOM); US3 AC1/AC2/AC8 (overlay highlight + private-API-absent diff-inferred fallback + release-highlight — DOM/adapter-bound); US5 AC2/AC3 (drop-unflushed-on-remote-lock and edge serialize-prune — disk-flush path in `canvas-sync.ts`, covered by `canvas-sync.test.ts`); US4 AC1 auto-release is also unit-verified in `ws-handler.test.ts`. These are stated as mechanism-verified, **not** marked PASS-by-assertion-of-faith.
- **GAP-7 (US3 AC9, lock-epoch):** intentionally not implemented; `epoch?` field present but unused. Documented bounded-LWW risk (BUILD_SPEC §5). No AC fails on its absence — **not an issue**.

---

## Issues Found

| Severity | WP | US | Description | AC | Status |
|---|---|---|---|---|---|
| ~~CRITICAL~~ **RESOLVED (cycle 1)** | WP3 (+WP1 reconnect seam) | US4 | On MUX reconnect, a returning lock-holder blindly re-asserted its stale `lockedNodes` and re-grabbed a node a peer acquired during the outage → split ownership / durable wrong holder when the returning holder had the lower `clientID`. | US4 AC3, AC4 (GAP-4) | **Fixed & verified.** `CanvasPresence.onReconnect()` now (1) immediately clears its locks and broadcasts a lock-free state, and (2) defers re-acquisition by `reclaimDeferMs` (250 ms), re-claiming only still-free nodes; `SyncManager` fires the lock-layer callback BEFORE the clock-tick re-emit so stale `lockedNodes` are never re-broadcast. Harness test now GREEN (stable ×4, adversarial ordering forced). |
| LOW | — (env) | — | `plugin/manifest.json` git symlink materialized as a plain text file on Windows → `biome check .` fails (~87 parse errors) + CRLF diffs. Pre-existing; not a W3 code change. Persists after cycle 1 (unchanged — a checkout-hygiene item). | — | Restore the `manifest.json` symlink / normalize line endings in a separate hygiene pass. Not a code fix; not a gate blocker. |

No CRITICAL or HIGH issues remain after rework cycle 1.

**Independent confirmation the fix is real (not a relaxed test):** (a) the WP5 harness FORCES the adversarial ordering (returning holder = lower `clientID`) and asserts the peer keeps its outage-time acquisition end-to-end under real ~80 ms RTT — green ×4. (b) W3's edit to `plugin/src/__tests__/canvas-presence.test.ts` (`onReconnect withholds all locks then re-claims only still-free nodes`) encodes CORRECT deferred semantics: it adds a NEW immediate-withhold assertion (A holds neither n1 nor n2 right after `onReconnect`) — the crux of the fix — then advances the injected `reclaimDeferMs` and asserts n1 stays with B, n2 returns to A. It strengthens coverage rather than weakening it; the synchronous `makeNetwork` cannot express the real latency race, which the harness covers. `CanvasPresence.destroy()` clears the reclaim timer (no leaked handle).

---

## Fix Requests

**Cycle 1 status: RESOLVED — no open fix requests.** The single CRITICAL below was fixed and re-verified; its failing test is now GREEN. Historical detail retained:

- **WP3 (with the WP1 reconnect seam): reconnecting lock-holder must not re-grab a node a peer acquired during the outage (US4 AC3/AC4, GAP-4 — no split lock).** — **FIXED (cycle 1), test now GREEN.**
  - **Expected:** after a holder drops, a peer acquires the node, and the holder reconnects, the node's single and durable holder is the **peer** (the outage-time acquirer), for **any** `clientID` ordering. Never a window with two live `lockedNodes` entries for the same node.
  - **Actual:** `SyncManager.openWebSocket().onopen` (reconnect branch, `plugin/src/sync/sync.ts:277-288`) calls `reemitLocalAwareness(docId)` which re-broadcasts the holder's FULL canvas awareness **including stale `lockedNodes`** (blind re-assert), and then fires `onReconnectCallback` → `CanvasPresence.onReconnect()` (`plugin/src/canvas/canvas-presence.ts:322-338`). `onReconnect()` runs **synchronously**, before the peer's current awareness has arrived over the latency link, so `holdersOf()` shows no other holder and it **keeps** the node. When the returning holder's `clientID` is the lower one, the subsequent `reconcileClaims()` lowest-id tiebreak resolves in the returning holder's favor → it **steals the node back** and the peer that legitimately held it reverts and loses its lock. Production wiring confirmed at `plugin/src/main.ts:717-719`.
  - **Root cause:** the re-claim policy decides before it can know the current `lockedNodes`, and the reconnect re-emit re-asserts locks blindly (contradicting the WP1 "no blind lock re-assert" requirement).
  - **Failing test (confirmed RED now, deterministic — forces the adversarial `clientID` ordering; must be GREEN after fix):**
    `plugin/src/__tests__/wp5/latency.test.ts::reconnecting holder re-claims only still-free nodes — no split lock (US4 AC3/AC4, GAP-4)`

> The fix-as-failing-test is repeatable (`npm test`) and lives in the repo test tree per the workflow rule. All other WP5 harness tests are green and provide the regression net for WP1–WP4 once the fix lands.

---

## New/added test artifacts

- `plugin/src/__tests__/wp5/harness.ts` — real-relay-in-process + latency-injecting WebSocket + client factory (helper, not a suite).
- `plugin/src/__tests__/wp5/latency.test.ts` — 11 deterministic latency E2E scenarios (10 green + 1 confirmed-red fix-as-failing-test); AC→test mapping in the file header (US6 AC3).

## Return to Dispatcher

**Rework cycle 1: `VALIDATION_PASS`.** All gates green (plugin 412/412, server 122/122); the WP5 latency harness is 11/11 including the previously-CRITICAL reconnect no-split-lock test, verified real and stable ×4 with the adversarial clientID ordering forced. Only the pre-existing environment-only `biome check` manifest-symlink red remains (LOW/env, not a code fix, not a gate blocker). No CRITICAL/HIGH issues remain.

_(Cycle 0: `FIXES_REQUIRED` — 1 CRITICAL WP3/WP1 reconnect split-lock, now resolved.)_
