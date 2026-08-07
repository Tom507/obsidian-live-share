# BUILD_SPEC — Canvas E2E Test Infrastructure (T1 + T2)

> Worker 2 (Spec Architect) artifact. Joint source of truth with
> `workflowArtifacts/e2e-infra/USER_STORIES.md` — W3 and W4 read both.
> Source of scope: `workflowArtifacts/e2e-infra/PLAN.md` (2026-07-20).
> **Do NOT clobber** `canvas-redesign/` specs or the `workflowArtifacts/` root
> (prior-round) artifacts — this project's artifacts live in `e2e-infra/`.

---

## 1. Project Overview

- **Project name:** Canvas E2E Test Infrastructure (T1 headless harness + T2 in-plugin control / MCP / launcher)
- **Target vision:** Give the agent in-addon + MCP infrastructure to run the canvas-redesign E2E validation itself, collapsing the human-gated surface from "every phase" to a one-time real-Obsidian spike (SPEC_02 §9) plus a final visual sign-off.
- **Primary user group / consumers:** The autonomous coding agent (drives the regression matrix); secondarily the maintainer (runs/inspects the launcher).
- **Non-goals:**
  - **T3 real-Obsidian CDP automation is OUT OF SCOPE** this run (noted for later; needs xvfb/Docker + real Obsidian).
  - Does NOT attempt to prove "our model of Obsidian's private Canvas API matches reality" — only the one-time human spike can. T1+T2 cover *regressions* after that spike.
  - Does NOT modify production canvas behavior, add production dependencies, or touch protected/deployed infrastructure.
- **UI language / locale:** n/a (test infra + agent tooling). Code comments/docs in English.

---

## 2. Scope and Deliverables

- **User stories:** see `USER_STORIES.md` (US1–US7).
- **Must-have (P0):**
  - **T1** (WP1→WP2→WP3): `CanvasDouble` + interaction driver; two-peer (double+`CanvasBinding`) convergence harness with `assertConverged`/`waitQuiescent`/counters; SPEC_04 matrix as vitest tests — a self-contained, all-green, additive model-layer regression gate (the harness owns its `CanvasDoubleBridge` glue, so nothing is left red).
  - **T2** (WP4→WP5→WP6): flag-gated localhost in-plugin control server; `liveshare-e2e` MCP server; two-instance launcher + usage doc.
  - Zero production footprint; existing plugin + server vitest suites stay green (US7).
- **Should-have (P1):**
  - SSE async-event channel on the control server (US4 AC4). Long-poll is an acceptable fallback.
  - `run_matrix` MCP tool that runs the full matrix over two live instances (US5 AC4).
- **Nice-to-have (P2):**
  - Launcher reusing the in-process relay pattern from `wp5/harness.ts` verbatim vs. spawning separate host processes (whichever is lower-friction — see §5 A2).
- **Explicitly out of scope:** T3 CDP automation; changes to `plugin/src/canvas/*` production logic; any production dependency; deploy/infra changes.

---

## 3. System Architecture

- **Graph basis:** Graphify DISABLED for this workflow (`graphify_enabled=false`); no `graph.json`. Structural grounding = `workflowArtifacts/RepoMap.md` (degraded) + direct source verification of every anchor in PLAN §"Discovery Grounding" against `plugin/src/` (done by W2 — all anchors confirmed accurate, see §5 notes).
- **Frontend stack:** Obsidian plugin — TypeScript (strict), esbuild bundle to `main.js`. No UI framework.
- **Backend stack:** (a) Relay = existing `server/` (Node, Express + `ws ^8.18.0`, yjs). (b) Control server (new) = Node built-in `http` inside the plugin process. (c) MCP = Python FastMCP under `tools/MCPserver/`.
- **Data storage:** In-memory `Y.Doc` CRDTs (per canvas). Test vaults are ephemeral local dirs. No DB.
- **External integrations:** The local relay (`server/`, dockerized or dev). MCP proxy (`tools/mcp_proxy_config.json` → runtime `tools/mcp_active_config.json`).
- **Runtime environment:** Local. T1 runs entirely in vitest (node env). T2 runs plugin host(s) + relay + Python MCP locally.
- **Key subsystems (in scope for wiring, not modification):**
  - `plugin/src/canvas/canvas-adapter.ts` — private-API isolation layer; interface at L32-87 (`getLiveNodeIds/EdgeIds`, `getNodeGeometry`, `applyNodeGeometry`→`moveAndResize`, `reloadCanvasData`→`setData`, `isBusy`, `onNodeInteractionStart/End`). Detects activity by monkey-patching `updateSelection`/`setDragging`/`markViewportChanged`.
  - `plugin/src/canvas/canvas-binding.ts` — `CanvasBinding` (yjs↔model), consumes a `CanvasModelBridge` interface; origin-stamps its writes with `CANVAS_BINDING_ORIGIN` and demuxes them in its observer.
  - `plugin/src/files/canvas-sync.ts` — file/CRDT sync (`CanvasSync`), two-peer test pattern precedent.
  - `plugin/src/__tests__/wp5/harness.ts` — existing real-relay + real-client E2E harness (reuse target for T2).
- **Key architecture decisions (with rationale):**
  1. **Signal-injection capture fidelity.** The driver mutates geometry AND fires the real interaction trigger (`setDragging(false)` / `updateSelection`) the adapter hooks — because the redesign's crux is capturing intent from *real interaction signals*, so a "call mutator, read state" harness would test *apply* and give false-green on *capture* (PLAN §Why). A once-verified spike assumption ("Obsidian fires these on a real drag") backs it.
  2. **Grow existing fakes, don't greenfield.** `CanvasDouble` extends the `FakeNode`/`makeView` fakes already in `canvas-adapter.test.ts` (L64-104) — keeps one contract-faithful shape, avoids divergence.
  3. **Reuse the two-peer delta pattern.** WP2 exchanges Yjs updates via `Y.encodeStateAsUpdate`/`Y.applyUpdate` exactly like `canvas-sync.test.ts` `applyRemoteCanvasDelta` (L62-74), so integrated updates are genuine *remote* transactions (`tr.local === false`) — the only way the binding's demux + zero-re-push invariant is exercised.
  4. **Dependency-light transport = Node built-in `http` + SSE.** The plugin has NO `http`/`ws` production dependency (only `server/` has `ws ^8.18.0`). Built-in `http` adds zero production dep; if WS is ever needed it must be a flag-gated dynamic-import `devDependency`. (PLAN Open Question → resolved default; §5 A1.)
  5. **Zero production surface via flag + dynamic import.** Control server lives in `plugin/src/testing/`, imported only via `import()` under `LIVESHARE_E2E`/`e2eControlPort`, unreferenced by `main.ts` on production paths → tree-shaken from `main.js`; binds `127.0.0.1` only.
  6. **Lightweight plugin host for WP6.** Two lightweight plugin hosts (adapter+binding+sync over the real relay WS), not two full Obsidian instances — real Obsidian is the T3/spike concern. (PLAN Open Question → resolved default; §5 A2.)

---

## 4. Data Architecture

- **Primary data sources:** Canvas records inside per-canvas `Y.Doc`s. Shape mirrors Obsidian `.canvas` JSON: `nodes` and `edges` as `Y.Map<Y.Map<unknown>>` keyed by id.
- **Core data models / schemas:**
  - **Node record** (flat, primitive values): `{ id: string, x: number, y: number, width: number, height: number, type?: string, text?: string, file?: string, ... }`.
  - **Edge record:** `{ id: string, fromNode: string, toNode: string, ... }`. An edge is *dangling* if either endpoint node id is absent; dangling edges are pruned on serialize/snapshot (per `canvas-sync.ts`).
  - **`CanvasRecord`** = `Record<string, unknown>` with primitive values only (shallow equality is exact) — matches `canvas-binding.ts` `CanvasRecord`.
  - **`NodeGeometry`** = `{ x, y, width, height }` (all numbers) — matches `canvas-adapter.ts`.
  - **Instrumentation counters** (per peer/instance): `{ applyRemote: number, captureLocal: number, rePush: number, originUpdates: number }`.
- **Normalisation rules:** Records are flat; comparisons are order-independent shallow primitive equality (mirrors `recordsEqual` in `canvas-binding.ts` L79-86 and `canvasRecordsEqual` in `canvas-sync.ts`).
- **Consistency and integrity rules:** `assertConverged` requires model(A) == model(B) AND model == its own doc projection for each peer (no CRDT/model drift). Zero-re-push: a delta integrated as remote on a peer must not be re-captured to that peer's doc.
- **Data flow (T1 two-peer):** driver → `CanvasDouble` mutation + interaction signal → adapter capture / model `onLocalChange` → `CanvasBinding.captureLocal` (origin-stamped) → peer-A `Y.Doc` → `encodeStateAsUpdate`/`applyUpdate` → peer-B `Y.Doc` (remote tx) → peer-B `CanvasBinding.applyRemote` → peer-B model. **Data flow (T2):** MCP tool → control-server HTTP command → live plugin instance canvas/binding/sync → real relay WS → other instance → SSE event / `canvas.state` read → MCP `assert_converged`.

---

## 5. Constraints, Risks, and Assumptions

**Constraints (from PLAN):**
- Full existing vitest suite stays green (PLAN baseline: **453 tests / 24 files** after Phase 0). No production dependency added to `plugin/`. Control surface flag-gated + `127.0.0.1`.
- Follow workspace MCP naming + registration: `tools/MCPserver/liveshare_e2e_mcp_server.py`, FastMCP name + proxy key `liveshare-e2e`, snake_case tools, test file beside it in `tools/`, register in `tools/mcp_proxy_config.json`, verify via `mcp_list_tools` (NOT `/mcp`). Use `.venv/Scripts/python.exe`; run tests from workspace root.
- npm rules if any dep is added: `.npmrc` with `save-exact=true`, `npm ci`, 7-day publish-age wait, `npm audit signatures`.
- Launcher must not touch protected infra; relay is the local dockerized `server/`. Do not clobber `canvas-redesign/` or root artifacts.

**Non-blocking assumptions (PLAN Open Questions — resolved by W2, none blocking):**
- **A1 — Control transport = Node built-in `http` + SSE (zero-dep).** Chosen over `ws` because the plugin has no `http`/`ws` production dependency and PLAN mandates zero new production dep. If a WP hits a hard limitation of built-in `http`+SSE, `ws` may be introduced ONLY as a flag-gated dynamic-import `devDependency` (never bundled) — this is a fallback, not the default.
- **A2 — WP6 host model = lightweight plugin host over the real relay.** Two lightweight hosts (mount adapter+binding+sync against the real relay WS), not two full Obsidian instances. Real-Obsidian orchestration is the T3/spike concern and is out of scope. Prefer extending `plugin/src/__tests__/wp5/harness.ts` (already boots the real `server/` relay in-process via `createApp(noopPersistence)` and spins real `SyncManager` clients) over a parallel stack.

**Risks:**
- **False-green on capture** if the driver skips the interaction trigger — mitigated by US1 AC3/AC4 requiring the real `setDragging`/`updateSelection` signal path.
- **Interface impedance:** `CanvasAdapter` (getLiveNodeIds/applyNodeGeometry/onNodeInteractionStart) is a DIFFERENT surface from `CanvasBinding`'s `CanvasModelBridge` (getNodeIds/getNode/applyNodeUpsert/onLocalChange). `main.ts` wires the adapter + `CanvasSync` + presence/overlay but does NOT currently reference `CanvasBinding` — the binding is a standalone module with a fake in-memory bridge in `canvas-binding.test.ts`. **Therefore WP2 must supply the CanvasDouble→`CanvasModelBridge` glue itself** and must NOT assume a production adapter→bridge wiring exists. If the redesign later ships that glue, the harness should consume it; until then the harness owns it. (Because the harness owns this glue, the SPEC_04 matrix is fully implemented at the model layer and lands all-green — there is nothing unimplemented left to be red. Model-layer fidelity to Obsidian's real private Canvas API is out of the matrix's reach and remains the one-time human spike + visual sign-off.)
- **Test flakiness from real timers** — mitigated by deterministic `waitQuiescent` (T1) and `waitUntil`-style polling with real timers only in T2 (per `wp5/harness.ts` precedent), never sleeps in assertions.

---

## 6. API and Interfaces

### 6.1 Control server (WP4) — localhost HTTP, flag-gated

- **Bind:** `127.0.0.1:<port>` where `port` = `process.env.LIVESHARE_E2E` (or `e2eControlPort` hidden setting). Not started otherwise.
- **`POST /command`** — body `{ cmd: string, args?: object }` → `200 { ok: true, result }` or `4xx { ok: false, error }`. Commands:
  | cmd | args | result |
  |---|---|---|
  | `session.info` | — | `{ clientId, role, roomId, connected }` |
  | `canvas.open` | `{ path }` | `{ opened: bool, subscribed: bool }` |
  | `canvas.state` | `{ path }` | `{ nodes: [...], edges: [...] }` (shared-doc snapshot, dangling edges pruned) |
  | `canvas.binding` | `{ path }` | `{ applyRemote, captureLocal, rePush, originUpdates }` |
  | `canvas.simulateEdit` | `{ path, change }` | `{ applied: bool }` (drives the capture path) |
  | `canvas.setFlag` | `{ name, value }` | `{ set: bool }` |
  | `sync.waitQuiescent` | `{ timeoutMs }` | `{ quiescent: bool }` |
- **`GET /events`** — SSE stream (fallback: long-poll) of `{ type, path, payload }` async events (binding capture/apply, convergence). P1.
- **Errors:** unknown `cmd` / malformed body → `400 { ok: false, error }`; never throws into the canvas view.
- **Auth:** none needed — localhost + flag gate is the boundary.

### 6.2 `liveshare-e2e` MCP tools (WP5) — snake_case

| tool | args | returns |
|---|---|---|
| `e2e_connect` | `{ a: {host, port}, b: {host, port} }` | `{ connected: bool }` |
| `open_canvas` | `{ path }` | `{ a: {...}, b: {...} }` |
| `read_canvas` | `{ path }` | `{ a: {nodes, edges}, b: {nodes, edges} }` |
| `edit` | `{ instance: "a"|"b", path, change }` | `{ applied: bool }` |
| `binding_stats` | `{ path }` | `{ a: counters, b: counters }` |
| `assert_converged` | `{ path }` | `{ converged: bool, diff? }` |
| `run_matrix` | `{ path? }` | `{ cases: [{name, pass}], allPass: bool }` |

- **Persistence:** none (stateless except the two connected endpoints from `e2e_connect`).

### 6.3 Launcher (WP6)

- `tools/launch_liveshare_e2e.ps1` (or python): boots host A (vault A, control port A) + host B (vault B, control port B) against the local relay; prints both control ports; clean shutdown on stop.

---

## 7. Quality Gates

- **Lint / typecheck / test commands (exact):**
  - Plugin: from `plugin/` → `npm run lint` (biome), `npm run build` (`tsc -noEmit -skipLibCheck && esbuild production`), `npm test` (`vitest run`).
  - Server: from `server/` → `npm test` (`vitest run`) — must remain green/untouched.
  - MCP: run Python tests from the **workspace root** with `.venv/Scripts/python.exe`; verify tool discovery via `mcp__tools__mcp_list_tools(server_id="liveshare-e2e")`.
- **Execution order:** typecheck/build → unit/harness tests (T1) → MCP tool tests → (manual/agent) T2 two-instance run via launcher + MCP.
- **Abort criteria:** existing plugin or server suite goes red (the SPEC_04 matrix is additive and all-green, so any red is a real regression); production `main.js` bundle contains control-server identifiers; any new production dependency appears in `plugin/package.json`.
- **Definition of Done (project-level):** WP1–WP6 DoDs met; existing suites green, including the additive all-green SPEC_04 matrix; production build clean of test identifiers; MCP tools discoverable; launcher yields two reachable control ports on the same relay room.
- **Test framework and runner:** vitest `^4.0.18` (plugin + server); Python/FastMCP unit test for the MCP server.
- **Active W4 test levels (read from `workflow.config.json`):**
  - Smoke tests: **enabled** (`w4_smoke=true`)
  - Integration tests: **enabled** (`w4_integration=true`)
  - Full E2E: **enabled** (`w4_e2e_full=true`)
  - Fix-as-failing-test (TDD rework): **enabled** (`w4_fix_as_failing_test=true`) — every CRITICAL/HIGH fix request from W4 ships a confirmed-red failing test for W3 to drive green.

---

## 8. Validation and Test Strategy

- **Test levels active:** smoke + integration + full E2E + fix-as-failing-test (see §7).
- **Test data sources:** deterministic fixtures — the `CanvasDouble` + driver (WP1), hand-authored SPEC_04 matrix records (WP3), ephemeral test vaults (WP6). No ad-hoc LLM-generated test data.
- **Known flaky areas / patterns to avoid:**
  - Wall-clock `sleep` in assertions — use `waitQuiescent` (T1) or `waitUntil` polling with real timers (T2, per `wp5/harness.ts`).
  - Localhost ~0 ms hides races (see `wp5/harness.ts` latency injection); if a T2 race must be tested, inject link latency the same way rather than asserting on raw localhost timing.
  - Originating a *local* edit by calling `moveAndResize`/doc mutators directly — that bypasses capture and gives false-green; always drive via the WP1 interaction driver.

---

## 9. Work Package Breakdown

> Two independent roots. **Batch A** = WP1→WP2→WP3 (T1, plugin tests). **Batch B** =
> WP4→WP5→WP6 (T2, control server + MCP + launcher). A and B are **file-disjoint** and
> run in **parallel**; within each batch, strict dependency order. (PLAN batching note;
> 6 WPs ≥ W3 dispatcher threshold 5.)

### WP1 — CanvasDouble + interaction driver
- **Status:** planned
- **Depends on:** none (Batch A root)
- **Scope:** Create a reusable, contract-faithful `CanvasDouble` (nodes/edges `Map`s, per-node `moveAndResize`, `setData`/`requestFrame`, `setDragging`/`updateSelection`/`markViewportChanged` patch points, `nodeInteractionLayer.target`, numeric `x/y/zoom`) plus an interaction driver (`driveDrag`, `driveResize`, `driveAddNode`, `driveDeleteNode`, `driveTextEdit`, `driveEdge`) that fires the real interaction signals. Add a `getData()`-style read of current records.
- **Out of scope:** Two-peer wiring, `CanvasBinding`, any Y.Doc, the matrix. No production `plugin/src/canvas/*` change.
- **User stories covered:** US1, US7
- **Acceptance Criteria:**
  1. US1 AC1 — double satisfies `createCanvasAdapter(double).isAvailable() === true`.
  2. US1 AC2 — built by extending `canvas-adapter.test.ts` `FakeNode`/`makeView` (L64-104), preserving their behaviors.
  3. US1 AC3 — driver ops pair geometry/structure mutation with the correct real signal (`setDragging` bracket for drag/resize; `updateSelection` for selection).
  4. US1 AC4 + AC5 — an adapter over the double reports held nodes via `onNodeInteractionStart/End`, `getNodeGeometry` reflects post-drag geometry, `isBusy()` true mid-drag, `applyNodeGeometry` returns `"interacting"` for the dragged node.
  5. US1 AC6 — `getData()` returns current `{nodes, edges}`.
  6. US7 AC3 — full existing vitest suite stays green; harness self-tests are additive.
- **Definition of Done:** `CanvasDouble` + driver under `plugin/src/__tests__/harness/`; ≥1 self-test builds a real `createCanvasAdapter` over the double and observes interaction callbacks fire from driver signals; suite green.
- **Key files (create):** `plugin/src/__tests__/harness/canvas-double.ts`, `plugin/src/__tests__/harness/interaction-driver.ts`, `plugin/src/__tests__/harness/*.test.ts` (self-test). *(Verify exact filenames at impl time; directory confirmed absent today — greenfield.)*
- **Architecture notes:** Reuse the existing fake shape; do not import from `canvas-adapter.test.ts` (test files aren't modules to depend on) — lift the pattern into the harness. The double must expose EXACTLY the members `canvas-adapter.ts` gates on (`nodes instanceof Map`, `typeof zoom === "number"`) plus the optional patch methods.
- **Handover summary:** *(filled by W3 on completion)*

### WP2 — Two-peer canvas harness
- **Status:** planned
- **Depends on:** WP1
- **Scope:** Wire two peers, each = one `CanvasDouble` + a `CanvasModelBridge` glue over it + a `CanvasBinding` bound to that peer's `Y.Doc`. Exchange Yjs updates between the two docs (`Y.encodeStateAsUpdate`/`Y.applyUpdate`, non-local). Provide `waitQuiescent()`, `assertConverged(a, b)` (model↔model + model↔doc), and per-peer counters (`applyRemote`, `captureLocal`, `rePush`, `originUpdates`).
- **Out of scope:** The SPEC_04 matrix cases (WP3); any real relay/network; T2.
- **User stories covered:** US2, US7
- **Acceptance Criteria:**
  1. US2 AC1 — two independent stacks constructed with the WP2-provided CanvasDouble→`CanvasModelBridge` glue (getNodeIds/getEdgeIds/getNode/getEdge/applyNode*/applyEdge*/onLocalChange).
  2. US2 AC2 — cross-peer propagation uses the `applyRemoteCanvasDelta`-style pattern (`canvas-sync.test.ts` L62-74) so integrated updates are genuine remote transactions.
  3. US2 AC3 — `assertConverged` enforces model(A)==model(B) AND model==doc per peer.
  4. US2 AC4 + AC5 — counters readable after `waitQuiescent`; `waitQuiescent` deterministic (no sleep).
  5. US2 AC6 — zero-re-push invariant observable (receiving peer's `rePush` stays 0 for an integrated remote delta).
  6. US7 AC3 — suite green; self-test proves a single move on A converges to B with B `rePush` = 0.
- **Definition of Done:** two-peer harness under `plugin/src/__tests__/harness/`; self-test drives one node move A→B and asserts convergence + B `rePush` 0; suite green.
- **Key files (create):** `plugin/src/__tests__/harness/two-peer.ts` (harness + bridge glue + `assertConverged`/`waitQuiescent`), `plugin/src/__tests__/harness/*.test.ts` (self-test). *(Verify exact filenames at impl time.)*
- **Architecture notes:** **Do not assume a production adapter→bridge wiring exists** (see §5 risk). Model the `CanvasModelBridge` glue over the `CanvasDouble` here. Reference the fake in-memory bridge in `canvas-binding.test.ts` for the bridge contract. Origin-stamp discipline: local captures carry `CANVAS_BINDING_ORIGIN`; the receiving peer integrates via `applyUpdate` (remote), so its observer must NOT re-capture (that is the invariant under test).
- **Handover summary:** *(filled by W3 on completion)*

### WP3 — SPEC_04 matrix as tests
- **Status:** planned
- **Depends on:** WP2
- **Scope:** Encode the SPEC_04 matrix as vitest tests on WP1+WP2: initial sync, multi-edge move, bidirectional drag, add node + edge, delete node + edge (with edge prune), file-node. Each case drives via the interaction driver and ends in `assertConverged`; each asserts zero-re-push for the receiver.
- **Out of scope:** New harness capability (belongs in WP1/WP2); T2. No `.skip`/`.todo` for any case (each must be a real, strictly-asserted test).
- **User stories covered:** US3, US7
- **Acceptance Criteria:**
  1. US3 AC1 — all six matrix cases present as two-peer convergence tests.
  2. US3 AC2 — every case originates local intent via the WP1 driver (no direct `moveAndResize`/doc mutation for local origination).
  3. US3 AC3 — each case asserts the receiver's zero-re-push invariant.
  4. US3 AC4 — the matrix is a self-contained, all-green headless regression gate: every case is a real, collectable test (no `.skip`/`.todo`, no weakened assertions) that PASSES over the WP1 double + WP2 harness with strict `assertConverged` + zero-re-push assertions. The harness supplies its own `CanvasDoubleBridge` glue (§5), so nothing is unimplemented to be red; this is the standing model-layer regression suite (confirming the model matches Obsidian's real private Canvas API stays the one-time human spike + final visual sign-off per PLAN §"The honest limit").
  5. US3 AC5 — `npm test` collects the file and reports pass/fail without crashing the runner.
- **Definition of Done:** matrix file collected by vitest, all six cases via the harness landing all-green with strict convergence + zero-re-push assertions (status documented in handover); pre-existing suite green and this file additive (no intentional reds — the harness owns its `CanvasDoubleBridge` glue).
- **Key files (create):** `plugin/src/__tests__/canvas-matrix.test.ts`. *(Verify exact filename at impl time.)*
- **Architecture notes:** These tests are the standing model-layer regression gate for canvas convergence — all-green because the harness supplies its own `CanvasDoubleBridge` glue (§5) rather than depending on production adapter→binding wiring; they do NOT cover whether the harness model matches Obsidian's real private Canvas API (that is the one-time human spike + visual sign-off, PLAN §"The honest limit"). Keep case names stable and descriptive so `run_matrix` (WP5) can mirror them.
- **Handover summary:** *(filled by W3 on completion)*

### WP4 — In-plugin E2E control server
- **Status:** planned
- **Depends on:** none (Batch B root)
- **Scope:** Create `plugin/src/testing/e2e-control.ts`: flag-gated (`LIVESHARE_E2E` env / hidden `e2eControlPort` setting), `127.0.0.1`-only Node built-in `http` server exposing the §6.1 commands (`session.info`, `canvas.open/state/binding/simulateEdit/setFlag`, `sync.waitQuiescent`) + an SSE/long-poll `/events` channel; add binding instrumentation counters. Dynamic-import wiring so it is tree-shaken from production `main.js`.
- **Out of scope:** MCP server (WP5), launcher (WP6), any production canvas logic change, any production dependency.
- **User stories covered:** US4, US7
- **Acceptance Criteria:**
  1. US4 AC1/AC2 — module exists, localhost-only, flag-gated, dynamic-imported, tree-shaken from `main.js` (verified by build + grep).
  2. US4 AC3 — all listed commands return well-formed JSON results.
  3. US4 AC4 — SSE (or long-poll) delivers ≥1 async event after a canvas edit.
  4. US4 AC5 — unknown/malformed commands → structured 4xx, never crash the view.
  5. US4 AC6 / US7 AC2 — no new `plugin/package.json` dependency (built-in `http`).
  6. US7 AC1 — production build clean of `e2e-control`/`LIVESHARE_E2E` gated identifiers.
- **Definition of Done:** flag set → localhost control server answers every command; flag unset → no port, no code in `main.js`; ≥1 unit test covers command routing/error handling without a live socket; suite green.
- **Key files (create):** `plugin/src/testing/e2e-control.ts`, `plugin/src/__tests__/e2e-control.test.ts`. **Touch (guarded dynamic import only):** `plugin/src/main.ts` — add a flag-gated `import()` that must remain dead code on production paths. Binding counters may require a small hook in `plugin/src/canvas/canvas-binding.ts` — if so, keep it a no-op unless the flag is set. *(Verify exact filenames/insertion points at impl time.)*
- **Architecture notes:** The `main.ts` touch is the ONLY Batch-B write into a Batch-A-adjacent file; keep it to a guarded dynamic import so Batch A/B stay file-disjoint (Batch A does not touch `main.ts` or `canvas-binding.ts` production code). Counters must be zero-cost when the flag is off.
- **Handover summary:** *(filled by W3 on completion)*

### WP5 — `liveshare-e2e` MCP server
- **Status:** planned
- **Depends on:** WP4
- **Scope:** Create `tools/MCPserver/liveshare_e2e_mcp_server.py` (FastMCP `liveshare-e2e`) with tools `e2e_connect`, `open_canvas`, `read_canvas`, `edit`, `binding_stats`, `assert_converged`, `run_matrix` (§6.2), connecting to the two control ports via the WP4 HTTP protocol. Register in `tools/mcp_proxy_config.json`. Add a beside-server test in `tools/`.
- **Out of scope:** The plugin control server (WP4), the launcher (WP6). No live-Obsidian dependency in the unit test.
- **User stories covered:** US5, US7
- **Acceptance Criteria:**
  1. US5 AC1 — server file + all seven snake_case tools defined.
  2. US5 AC2 — `e2e_connect` records both endpoints; subsequent tools target them.
  3. US5 AC3 — `read_canvas` returns both snapshots; `assert_converged` returns pass/fail + diff.
  4. US5 AC4 — `run_matrix` returns per-case pass/fail.
  5. US5 AC5 — registered under proxy key `liveshare-e2e`; discoverable via `mcp_list_tools(server_id="liveshare-e2e")` (NOT `/mcp`).
  6. US5 AC6 / US7 AC2 — beside-server test passes against a stub control endpoint; no fresh/unpinned dep.
- **Definition of Done:** `mcp_list_tools(server_id="liveshare-e2e")` lists all seven tools; beside-server test green against a stub; `.venv/Scripts/python.exe` conventions honored.
- **Key files (create):** `tools/MCPserver/liveshare_e2e_mcp_server.py`, `tools/test_liveshare_e2e_mcp.py` (beside-server test). **Edit:** `tools/mcp_proxy_config.json` (add `liveshare-e2e` entry — keep valid JSON, double quotes). *(Verify exact test filename against `test_{tool}.py` convention at impl time.)*
- **Architecture notes:** After editing the server, reload via `mcp__general-tools__reload_server("liveshare-e2e")` then verify with `mcp_list_tools` — never ask the user to run `/mcp`. Keep tool schemas snake_case; mirror WP3 matrix case names in `run_matrix`.
- **Handover summary:** *(filled by W3 on completion)*

### WP6 — Two-instance launcher + usage doc
- **Status:** planned
- **Depends on:** WP4, WP5
- **Scope:** Create `tools/launch_liveshare_e2e.ps1` (or python) that boots two plugin hosts (distinct test vaults, distinct `e2eControlPort` A/B) against the local relay, and a usage doc describing the launch command + control ports + MCP drive sequence. Clean shutdown on stop.
- **Out of scope:** Real full-Obsidian orchestration (T3); modifying protected infra; changing the relay.
- **User stories covered:** US6, US7
- **Acceptance Criteria:**
  1. US6 AC1 — launcher boots two hosts with distinct vaults + control ports against the local relay.
  2. US6 AC2 — reuses `wp5/harness.ts` real-relay/real-client pattern, or documents why a separate host process is needed (§5 A2 lightweight-host model).
  3. US6 AC3 — after launch both control ports answer `session.info` with the SAME `roomId`.
  4. US6 AC4 — no protected-infra modification; local processes/ports + local relay only.
  5. US6 AC5 — usage doc gives exact launch command, both ports, and the MCP call sequence (`e2e_connect`→`open_canvas`→`edit`→`assert_converged`/`run_matrix`).
  6. US6 AC6 — clean shutdown frees both ports (no orphans).
- **Definition of Done:** launcher yields two reachable control ports on the same relay room (verified via `session.info`); usage doc documents the full drive sequence; stop frees both ports.
- **Key files (create):** `tools/launch_liveshare_e2e.ps1` (or `tools/launch_liveshare_e2e.py`), usage doc `workflowArtifacts/e2e-infra/E2E_USAGE.md`. *(Verify exact launcher form at impl time; PLAN allows PowerShell or python.)*
- **Architecture notes:** Prefer extending `plugin/src/__tests__/wp5/harness.ts` (`createApp(noopPersistence)` + `server.listen(0)` + real `SyncManager`) for the relay/client bring-up. Follow Windows shell/subprocess rules (`Skill_WindowsShellSyntax.md`); use `%~dp0`-relative paths in any `.bat`/`.ps1`, never hardcoded absolute paths.
- **Handover summary:** *(filled by W3 on completion)*

---

## 10. Operational Rules

- **Logging:** Control server + MCP log to their own channels; keep off by default in tests (no console noise, per `CanvasBindingLogger` precedent). Instrumentation counters are the primary machine-readable signal.
- **Monitoring:** none (local test infra). `session.info` is the health probe for T2.
- **Recovery / backups:** none — test vaults are ephemeral; docs are in-memory.
- **Security and access rules:** Control server binds `127.0.0.1` only and exists only under the `LIVESHARE_E2E`/`e2eControlPort` flag. No auth token needed. MCP server follows workspace `.venv`/proxy conventions.

---

## 11. Repeated-Action Signals and Automation Candidates

Filled progressively as W3 runs.

| Repeated action | Tool / command | Frequency | Friction / failure | Automation candidate |
|---|---|---|---|---|
| | | | | |

---

## Worker 2 Checklist

- [x] Project overview and non-goals aligned with PLAN.md
- [x] USER_STORIES.md written with all stories expanded from PLAN scope (US1–US7; derivation noted)
- [x] All stories have numbered, observable ACs and a definition of done
- [x] Components/interfaces defined with US/WP references (§5 component notes + §6)
- [x] Every WP in §9 has scope, out-of-scope, ACs, DoD, US references
- [x] Every AC observable/testable
- [x] Architecture decisions documented with rationale (§3)
- [x] Data models and flows complete (§4)
- [x] API surfaces specified (§6)
- [x] Quality gates + active W4 levels documented (§7, read from workflow.config.json)
- [x] Graph basis noted (§3 — Graphify disabled; RepoMap degraded + source verification)
- [x] BUILD_SPEC saved under `workflowArtifacts/e2e-infra/`
- [x] PLAN Open Questions resolved as non-blocking assumptions (§5 A1, A2)
