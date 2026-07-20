# Plan: Canvas E2E Test Infrastructure (T1 + T2)
Generated: 2026-07-20
Task: Build in-addon + MCP infrastructure so the agent can run the canvas-redesign
E2E validation itself, collapsing the human-gated surface from "every phase" to a
one-time real-Obsidian spike + final visual sign-off.

> **Artifact home:** `workflowArtifacts/e2e-infra/` — separate from `canvas-redesign/`
> (the redesign specs) and the `workflowArtifacts/` root (prior round). Do not clobber.

## Why

SPEC_04's acceptance is manual because (a) "no GUI automation is available to the
agent" and (b) the redesign's crux — capturing local intent from **real
interaction signals** (`setDragging(false)`/`updateSelection`), not programmatic
`moveAndResize` (SPEC_02 §4) — means a naive "call mutators, read state" harness
would test the *apply* path and give false-green on *capture*. Useful infra must
drive the **interaction lifecycle** and read binding internals back.

## Scope (approved: T1 + T2; T3 optional/deferred)

- **T1 — Headless adapter E2E (vitest, autonomous, no MCP).** A contract-faithful
  canvas **double** + synthetic interaction driver, a two-peer (adapter+binding)
  harness over two `Y.Doc`s, and the SPEC_04 matrix encoded as automated tests.
  Certifies capture/apply/demux logic + the full matrix at the model layer.
- **T2 — MCP two-instance control (the requested infra).** A flag-gated in-plugin
  control server + a `liveshare-e2e` MCP + a launcher, so the agent drives two real
  plugin instances over the **real relay** and asserts convergence + zero re-push.
- **T3 — real-Obsidian CDP automation.** OUT OF SCOPE this run; noted for later.

## The honest limit (documented, not hidden)

No in-addon infra proves "our model of Obsidian's private Canvas API matches
reality" — only real Obsidian does. T1+T2 make that a **one-time human spike
(SPEC_02 §9) + one final visual sign-off**; afterwards the agent self-runs the
regression matrix. T3 would automate even that, at high cost/brittleness.

## Tech / Approach Decisions

- **Capture fidelity via signal injection.** The driver mutates node geometry AND
  fires the same interaction trigger the adapter hooks (`setDragging(false)` /
  `onNodeInteractionEnd`), so the real capture wiring runs without a real OS drag.
  A once-verified assumption (the spike) — "Obsidian fires these on a real drag" —
  backs it; after that, T1/T2 cover regressions.
- **Canvas double extends existing test fakes.** Grow the fake `view.canvas` already
  in `canvas-adapter.test.ts` (SPEC_02 §10 "headless, fake view.canvas") into a
  reusable `CanvasDouble` — not a greenfield mock.
- **Zero production surface.** The control server is behind `LIVESHARE_E2E` env / a
  hidden `e2eControlPort` setting; the module is dynamically imported only when the
  flag is set and is never referenced by the production entrypoint → tree-shaken out
  of `main.js`. Bound to `127.0.0.1` only.
- **Dependency-light transport.** Prefer Node built-in `http` (JSON POST commands +
  SSE/long-poll for async events) to avoid adding a production dep to `plugin/`
  (`ws` exists in `server/` but not `plugin/`). If WS is chosen, load `ws` as a
  **devDependency via dynamic import under the flag** — never bundled. No new
  production dependency. (npm 7-day rule + `.npmrc`/`npm ci` apply if any dep added.)
- **MCP conventions.** `tools/MCPserver/liveshare_e2e_mcp_server.py`, FastMCP name +
  proxy key `liveshare-e2e`, snake_case tools, test file beside it, registered in
  `tools/mcp_proxy_config.json`; verify with `mcp_list_tools` (not `/mcp`).
- **Ordering / value.** The T1 harness is the TDD scaffold that makes the redesign's
  own Phase 3 (SPEC_02 adapter) autonomously verifiable — the matrix tests are red
  until those phases land, then become the acceptance gate.

## Constraints

- Full existing vitest suite stays green (currently 453/24 after Phase 0).
- No production dependency added to `plugin/`; control surface flag-gated + localhost.
- Follow workspace MCP naming + registration rules; `.venv/Scripts/python.exe`;
  MCP tests in `tools/`; verify via `mcp_list_tools`.
- Launcher must not touch protected infra; relay is the local dockerized `server/`.
- Do not clobber `canvas-redesign/` or root artifacts.

## Discovery Grounding

From `../RepoMap.md` + Phase 0: adapter surface (`canvas-adapter.ts` L32-87:
`getLiveNodeIds/EdgeIds`, `getNodeGeometry`, `applyNodeGeometry`→`moveAndResize`,
`reloadCanvasData`→`setData`, `isBusy`, `onNodeInteractionStart/End`); the two-peer
`applyRemoteCanvasDelta` pattern (canvas-sync.test.ts L62-74); binding at
`canvas-binding.ts`; vitest infra + `src/__tests__/` convention; `server/` has
`ws ^8.18.0`, plugin has none.

## Work Package Sketch

| WP | Tier | Title | Scope summary | Depends on |
|---|---|---|---|---|
| WP1 | T1 | CanvasDouble + interaction driver | Reusable contract-faithful canvas double (nodes/edges maps, `moveAndResize`, `setData`/`getData`, `setDragging`/`updateSelection` patch points) + `driveDrag/driveResize/driveAddNode/driveDeleteNode/driveTextEdit/driveEdge` that fire real interaction signals. In `plugin/src/__tests__/harness/`. | — |
| WP2 | T1 | Two-peer canvas harness | Wire two (adapter+binding) stacks over two `Y.Doc`s (extend Phase-0 `encodeStateAsUpdate`/`applyUpdate`), `waitQuiescent`, `assertConverged(a,b)` (model↔model + model↔doc), re-push/origin-update counters. | WP1 |
| WP3 | T1 | SPEC_04 matrix as tests | Encode the matrix (initial sync, multi-edge move, bidirectional drag, add/delete node+edge, file-node) as vitest tests on WP1+WP2 — the autonomous acceptance gate (red until redesign phases land). | WP2 |
| WP4 | T2 | In-plugin E2E control server | `plugin/src/testing/e2e-control.ts`, flag-gated + localhost HTTP; commands `session.info`, `canvas.open/state/binding/simulateEdit/setFlag`, `sync.waitQuiescent`; binding instrumentation counters. Not bundled when flag off. | — |
| WP5 | T2 | `liveshare-e2e` MCP server | `tools/MCPserver/liveshare_e2e_mcp_server.py` (FastMCP `liveshare-e2e`) connecting to Vault-A/B ports; tools `e2e_connect/open_canvas/read_canvas/edit/binding_stats/assert_converged/run_matrix`; test file; register in `mcp_proxy_config.json`; verify via `mcp_list_tools`. | WP4 |
| WP6 | T2 | Two-instance launcher + usage doc | `tools/launch_liveshare_e2e.ps1` (or python) booting two plugin hosts w/ test vaults + distinct control ports against the local relay; agent-usage doc. | WP4, WP5 |

> **Batching (for W3 dispatcher mode — 6 WPs ≥ threshold 5):** two independent
> roots → **Batch A** WP1→WP2→WP3 (T1, plugin tests), **Batch B** WP4→WP5→WP6 (T2,
> control server + MCP + launcher). A and B are file-disjoint and run in parallel;
> within each, strict dependency order.

## Open Questions

- Control transport: Node built-in `http`+SSE (zero-dep, recommended) vs `ws`
  dynamic-import devDep. → W2 picks; default to built-in `http`.
- WP6 host model: two full Obsidian instances (real, needs xvfb/Docker later) vs two
  lightweight plugin hosts mounting adapter+binding over the real relay WS. → default
  to the lightweight host for T2; real-Obsidian is the T3/spike concern.
- None blocking.
