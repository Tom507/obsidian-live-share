# User Stories — Canvas E2E Test Infrastructure (T1 + T2)

> Created by Worker 2 (Spec Architect). Companion to `BUILD_SPEC_CanvasE2EInfra.md`.
> Source: `workflowArtifacts/e2e-infra/PLAN.md` (2026-07-20).
>
> **Note on derivation:** PLAN.md does not enumerate explicit `US<N>` sketches — it
> provides a "Why", scope tiers T1/T2, and a 6-row Work Package Sketch. The stories
> below are derived directly from that scope and WP table (one story per WP, plus one
> cross-cutting non-functional story US7 for the "zero production footprint" hard
> constraint). No behavior beyond PLAN scope is introduced.
>
> **Primary actor:** *the agent* (the autonomous coding agent running the
> canvas-redesign E2E validation). Secondary actor for US6/US7: *the maintainer*.

---

## US1 — Contract-faithful canvas double + interaction driver

**As** the agent,
**I want** a reusable, contract-faithful `CanvasDouble` plus a synthetic interaction
driver that fires the SAME private-API signals the real adapter hooks
(`setDragging`, `updateSelection`),
**so that** headless tests exercise the real *capture* wiring (local-intent detection)
and not just the *apply* path — avoiding the false-green the PLAN §Why warns about.

### Acceptance Criteria

1. A `CanvasDouble` factory produces an object whose `.canvas` shape satisfies
   `createCanvasAdapter(view).isAvailable() === true` (i.e. exposes `nodes: Map`,
   `edges: Map`, numeric `zoom/x/y`, and the patchable methods `updateSelection`,
   `setDragging`, `markViewportChanged`, plus `nodeInteractionLayer.target`,
   `setData`, `requestFrame`, and per-node `moveAndResize`).
2. `CanvasDouble` is built by extending the existing fake `view.canvas` pattern in
   `plugin/src/__tests__/canvas-adapter.test.ts` (the `FakeNode` / `makeView` helpers,
   L64-104) — it is NOT a greenfield mock and must keep those existing behaviors
   (moveAndResize mutates node geometry; setData/requestFrame observable).
3. The interaction driver exposes `driveDrag`, `driveResize`, `driveAddNode`,
   `driveDeleteNode`, `driveTextEdit`, and `driveEdge` operations. Each geometry/
   structure mutation is paired with the real interaction trigger: a drag/resize
   calls `setDragging(true)` (with `nodeInteractionLayer.target` set to the dragged
   node) then mutates geometry then calls `setDragging(false)`; a selection change
   calls `updateSelection`.
4. After `driveDrag(nodeId, geo)`, an adapter built over the same double reports the
   node held during the drag via `onNodeInteractionStart`/`onNodeInteractionEnd`
   callbacks (start fired for `nodeId`, end fired on drag release) and
   `getNodeGeometry(nodeId)` returns the post-drag geometry.
5. While a drag on `nodeId` is in progress (`setDragging(true)`, target = `nodeId`),
   `adapter.isBusy()` returns `true` and `adapter.applyNodeGeometry(nodeId, …)`
   returns `"interacting"`; a *different* node is still reconcilable.
6. `CanvasDouble` supports snapshotting/reading its current node+edge records so a
   test can assert model state (`getData()`-style read returning `{nodes, edges}`).

### Definition of Done

The `CanvasDouble` + driver live under `plugin/src/__tests__/harness/`, the full
existing vitest suite stays green, and at least one harness self-test proves ACs 1,
3, 4, and 5 by constructing a real `createCanvasAdapter` over the double and observing
interaction callbacks fire from driver-issued signals.

### Linked WPs

WP1

---

## US2 — Two-peer headless convergence harness

**As** the agent,
**I want** a harness that wires two independent (canvas-model + `CanvasBinding`)
stacks over two separate `Y.Doc`s connected by direct update exchange, with a
`waitQuiescent` settle helper and an `assertConverged(a, b)` assertion,
**so that** I can drive an edit on peer A and deterministically verify peer B
converges to the same canvas state at the model layer without a network or real
Obsidian.

### Acceptance Criteria

1. The harness constructs two peers, each = one `CanvasDouble` (from WP1) + a
   `CanvasModelBridge` implementation backed by that double + a `CanvasBinding`
   (`plugin/src/canvas/canvas-binding.ts`) bound to that peer's own `Y.Doc`. The
   bridge glue (CanvasDouble → `CanvasModelBridge` interface: `getNodeIds`,
   `getEdgeIds`, `getNode`, `getEdge`, `applyNodeUpsert/Remove`,
   `applyEdgeUpsert/Remove`, `onLocalChange`) is provided by this WP.
2. Updates propagate between the two docs by exchanging Yjs updates in the same
   non-local manner as `canvas-sync.test.ts` `applyRemoteCanvasDelta` (L62-74:
   `Y.encodeStateAsUpdate` / `Y.applyUpdate`), so a delta authored on A is integrated
   on B as a genuine *remote* transaction (`tr.local === false`, origin ≠
   `CANVAS_BINDING_ORIGIN`).
3. `assertConverged(a, b)` passes only when BOTH hold: (a) peer A's model equals peer
   B's model (same node ids + records, same edge ids + records, order-independent),
   and (b) each peer's model equals its own `Y.Doc` projection (model ↔ doc), proving
   no drift between CRDT and model.
4. The harness maintains per-peer instrumentation counters: `applyRemote` invocations,
   `captureLocal` invocations, re-push count (a captured write that produced a Yjs
   update), and origin-update count (updates observed carrying
   `CANVAS_BINDING_ORIGIN`). Counters are readable after `waitQuiescent`.
5. `waitQuiescent()` returns once no further updates are pending on either peer
   (deterministic — no wall-clock sleep in assertions).
6. **Zero re-push invariant is observable:** after a local edit on A converges to B,
   applying that same remote delta on B does NOT cause B's binding to re-capture it
   back to the doc — the re-push counter for B stays 0 for that delta (the observer
   demux in `canvas-binding.ts` §6.3 ignores `tr.local`/`CANVAS_BINDING_ORIGIN`).

### Definition of Done

`plugin/src/__tests__/harness/` contains the two-peer harness; a harness self-test
drives a single node move on A and asserts (via `assertConverged`) B converges with
the B re-push counter at 0. Full vitest suite green.

### Linked WPs

WP2 (depends on WP1)

---

## US3 — SPEC_04 matrix as automated acceptance tests

**As** the agent,
**I want** the SPEC_04 canvas-sync matrix encoded as vitest tests running on the WP1
double + WP2 two-peer harness,
**so that** the redesign's canvas convergence acceptance is self-verifiable by me
(a self-contained, all-green model-layer regression gate) instead of
requiring a human to click through Obsidian for every phase.

### Acceptance Criteria

1. A dedicated test file (e.g. `plugin/src/__tests__/canvas-matrix.test.ts`) encodes
   these matrix cases, each as a two-peer convergence test ending in
   `assertConverged`:
   1. **Initial sync** — B joins after A has populated nodes/edges; B converges to A.
   2. **Multi-edge move** — a node that is an endpoint of ≥2 edges is moved on A;
      both edges remain valid and geometry converges on B.
   3. **Bidirectional drag** — A moves node X while B moves node Y concurrently; both
      moves survive and both peers converge (no lost update).
   4. **Add node + add edge** — A adds a node and an edge referencing it; B converges
      with both present and the edge non-dangling.
   5. **Delete node + delete edge** — A deletes a node; its incident edges are pruned
      and B converges with no dangling edge.
   6. **File-node** — a node of type `file` (with a `file` field) round-trips and
      converges without field loss.
2. Every matrix case drives its mutation through the WP1 interaction driver
   (`driveDrag`/`driveAddNode`/…) so the *capture* path runs — no test calls
   `moveAndResize` or a doc mutator directly to originate a *local* intent.
3. Each case asserts the zero-re-push invariant (US2 AC6) for the receiving peer.
4. The matrix is a self-contained, all-green headless regression gate: every case is a
   real, collectable test (no `.skip`/`.todo`, no weakened assertions) that PASSES over
   the WP1 `CanvasDouble` + WP2 two-peer harness, with strict convergence
   (`assertConverged`) and zero-re-push assertions. Because the harness supplies its own
   `CanvasDoubleBridge` glue (BUILD_SPEC §5) rather than depending on production
   adapter→binding wiring, nothing is left unimplemented to be red — this is the standing
   model-layer regression suite. NOTE: it verifies model-layer convergence only;
   confirming that the harness's model matches Obsidian's real private Canvas API remains
   the one-time human spike + final visual sign-off (PLAN §"The honest limit") and is out
   of scope for this suite.
5. Running `npm test` (vitest) in `plugin/` collects the matrix file; its
   pass/fail count is reported and does not crash the runner.

### Definition of Done

The matrix file exists, is collected by vitest, expresses all six cases via the
harness, and lands all-green with strict convergence + zero-re-push assertions (status
documented in the WP handover). Pre-existing suite remains green and the matrix file is
additive (no intentional reds — the harness owns its `CanvasDoubleBridge` glue, so there
is nothing unimplemented to fail).

### Linked WPs

WP3 (depends on WP2)

---

## US4 — Flag-gated in-plugin E2E control server

**As** the agent,
**I want** a flag-gated, localhost-only control server inside the plugin that exposes
canvas/session/sync commands over a dependency-light transport,
**so that** an external driver (the MCP) can open canvases, read shared state, inject
edits, read binding instrumentation, and await quiescence on a REAL running plugin
instance.

### Acceptance Criteria

1. A new module `plugin/src/testing/e2e-control.ts` starts an HTTP server bound to
   `127.0.0.1` only, on a port from the `LIVESHARE_E2E` env var or a hidden
   `e2eControlPort` setting. It is never listening when neither flag is set.
2. The module is imported ONLY via dynamic `import()` guarded by the flag, is not
   referenced by the production entrypoint (`main.ts`) on any non-flagged path, and
   is therefore tree-shaken out of the production `main.js` bundle (AC verified by a
   build + grep: the production bundle contains no `e2e-control` identifiers).
3. The server accepts JSON command requests and returns JSON results for at least:
   `session.info` (→ clientId, role, roomId, connected), `canvas.open {path}`,
   `canvas.state {path}` (→ shared-doc snapshot {nodes, edges}),
   `canvas.binding {path}` (→ instrumentation counters),
   `canvas.simulateEdit {path, change}` (apply a local edit through the capture path),
   `canvas.setFlag {name, value}`, and `sync.waitQuiescent {timeoutMs}`.
4. Async events (binding/convergence signals) are delivered over an SSE (or
   long-poll) endpoint on the same server; a client can subscribe and receive at
   least one event after triggering a canvas edit.
5. Unknown commands and malformed payloads return a structured error response (HTTP
   4xx + `{error}` body), never crash the plugin or the canvas view.
6. No new entry is added to `plugin/package.json` `dependencies` (transport uses Node
   built-in `http`). If `ws` is ever used it is a `devDependency` loaded by dynamic
   import under the flag only (see BUILD_SPEC §5 assumption A1).

### Definition of Done

With `LIVESHARE_E2E` set, the plugin exposes the control server on localhost and each
listed command returns a well-formed response; with the flag unset, no port is opened
and a production build shows no control-server code. Existing vitest suite green;
control logic covered by at least one unit test that does not require a live socket.

### Linked WPs

WP4

---

## US5 — `liveshare-e2e` MCP server

**As** the agent,
**I want** a `liveshare-e2e` MCP server that connects to two running plugin instances
(Vault-A / Vault-B control ports) and exposes high-level snake_case tools,
**so that** I can drive a real two-instance convergence run over the real relay and
assert convergence + zero re-push from my own tool surface.

### Acceptance Criteria

1. A FastMCP server file `tools/MCPserver/liveshare_e2e_mcp_server.py` defines the
   FastMCP server named `liveshare-e2e` with snake_case tools:
   `e2e_connect`, `open_canvas`, `read_canvas`, `edit`, `binding_stats`,
   `assert_converged`, `run_matrix`.
2. `e2e_connect` accepts the two instance control endpoints (host/port for A and B)
   and records them; subsequent tools target those endpoints via the WP4 control
   protocol.
3. `read_canvas` returns each instance's shared-doc snapshot; `assert_converged`
   returns a pass/fail plus a diff when the two instances' canvas states differ.
4. `run_matrix` executes the SPEC_04 matrix cases against the two live instances and
   returns a per-case pass/fail summary.
5. The server is registered in `tools/mcp_proxy_config.json` under proxy key
   `liveshare-e2e`, and its tools are discoverable via
   `mcp__tools__mcp_list_tools(server_id="liveshare-e2e")` (verification via
   `mcp_list_tools`, NOT the `/mcp` slash command).
6. A test file lives beside the server in `tools/` (per workspace convention) and
   exercises the tool logic against a stub/mock control endpoint (no dependency on a
   live Obsidian instance in the unit test).

### Definition of Done

`mcp_list_tools(server_id="liveshare-e2e")` lists all seven tools; the beside-server
test passes against a stubbed control endpoint; the server uses
`.venv/Scripts/python.exe` conventions and adds no unpinned/fresh (<7-day) Python or
npm dependency.

### Linked WPs

WP5 (depends on WP4)

---

## US6 — Two-instance launcher + usage doc

**As** the agent,
**I want** a launcher that boots two plugin hosts with distinct test vaults and
distinct control ports against the local relay, plus a short usage doc,
**so that** I can start a complete two-instance E2E environment in one command and
know exactly how to drive it via the MCP.

### Acceptance Criteria

1. A launcher `tools/launch_liveshare_e2e.ps1` (or a Python equivalent) starts two
   plugin hosts, each mounting a distinct test vault and exposing a distinct
   `e2eControlPort` (A and B), configured to connect to the local relay
   (the dockerized `server/`, or a `server/` dev instance).
2. The launcher reuses the existing in-process relay + real-client pattern from
   `plugin/src/__tests__/wp5/harness.ts` (real `server/src` relay via `createApp`,
   real `SyncManager`) rather than introducing a parallel connection stack, OR
   documents explicitly why a separate host process is required (lightweight plugin
   host model — see BUILD_SPEC §5 assumption A2).
3. After launch, both control ports respond to `session.info` and report the SAME
   `roomId`, confirming both hosts joined the same relay room.
4. The launcher does not modify, deploy to, or otherwise touch protected
   infrastructure; it only starts local processes/ports and uses the local relay.
5. A usage doc (markdown, in `workflowArtifacts/e2e-infra/` or beside the launcher)
   describes the exact launch command, the two control ports, and the MCP tool call
   sequence (`e2e_connect` → `open_canvas` → `edit` → `assert_converged` /
   `run_matrix`).
6. The launcher shuts both hosts down cleanly on stop (no orphaned ports/processes).

### Definition of Done

Running the launcher yields two reachable control ports on the same relay room
(AC3 verified via `session.info`), the usage doc documents the full drive sequence,
and stopping the launcher frees both ports.

### Linked WPs

WP6 (depends on WP4, WP5)

---

## US7 — Zero production footprint & green existing suite (cross-cutting NFR)

**As** the maintainer,
**I want** all of this E2E infrastructure to add zero production surface and to leave
the existing test suites green,
**so that** shipping the plugin is unaffected and the infra can never leak into a
user's runtime.

### Acceptance Criteria

1. A production build of the plugin (`npm run build` in `plugin/`) succeeds and the
   emitted `main.js` contains no control-server / testing-only identifiers
   (`e2e-control`, `LIVESHARE_E2E` gated module code) — verified by grep over the
   bundle.
2. `plugin/package.json` `dependencies` is unchanged by this work (no new production
   dependency); any added tooling dep is a `devDependency`, pinned exact
   (`save-exact`), and ≥7 days old at install time.
3. The full existing plugin vitest suite (PLAN baseline: 453 tests / 24 files after
   Phase 0) stays green; new T1 harness self-tests are additive. The SPEC_04 matrix
   file (US3) is also additive and all-green (the harness owns its `CanvasDoubleBridge`
   glue, so nothing is left red); any red in it is a real regression, not an expected
   pending case.
4. The existing `server/` vitest suite stays green and untouched by this work.
5. The control server binds `127.0.0.1` only and is only reachable when
   `LIVESHARE_E2E` / `e2eControlPort` is set.

### Definition of Done

Production build clean of test identifiers, dependency manifest unchanged, both
existing suites green (including the additive all-green US3 SPEC_04 matrix), control
surface localhost + flag-gated.

### Linked WPs

WP4, WP5, WP6 (and enforced by WP1–WP3 additive-only test placement)
