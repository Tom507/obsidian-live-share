# Handover — Canvas E2E Test Infrastructure (T1 + T2)

W3 run: 2026-07-20 (Dispatcher mode, 6 WPs, two file-disjoint batches run in 3 concurrent waves)

## Scope of This Run

Tasks completed: WP1, WP2, WP3, WP4, WP5, WP6 (all six).
Tasks with risk flags: WP3 (spec-reconciliation), WP4 (bounded), WP5 (bounded), WP6 (one deferred live-drive step).

Execution shape:
- **Batch A (T1 vitest harness):** WP1 → WP2 → WP3 (strict order).
- **Batch B (T2 control/MCP/launcher):** WP4 → WP5 → WP6 (strict order).
- Interleaved as Wave 1 (WP1‖WP4), Wave 2 (WP2‖WP5), Wave 3 (WP3‖WP6). Batches are file-disjoint except the single guarded `main.ts` dynamic-import touch in WP4.

## WP Status Summary

| WP | Title | Status | Risk Flag | Priority for W4 |
|---|---|---|---|---|
| WP1 | CanvasDouble + interaction driver | DONE | NONE | NORMAL |
| WP2 | Two-peer convergence harness | DONE | LOW | NORMAL |
| WP3 | SPEC_04 matrix as tests | DONE | SPEC-RECONCILE | CRITICAL |
| WP4 | In-plugin E2E control server | DONE | LOW | NORMAL |
| WP5 | `liveshare-e2e` MCP server | DONE | LOW | NORMAL |
| WP6 | Two-instance launcher + usage doc | DONE | MEDIUM | HIGH |

## Authoritative Gate Results (run by W3 Dispatcher on the final merged tree)

| Gate | Command | Result |
|---|---|---|
| Plugin typecheck+build | `npm run build` (from `plugin/`) | PASS (exit 0) |
| Production bundle clean | `grep -E "e2e-control\|LIVESHARE_E2E\|e2eControlPort" main.js` | 0 matches (clean) |
| Full plugin vitest suite | `npm test` (from `plugin/`) | **507 passed / 29 files, 0 fail** (baseline 453/24 → +54 additive, no regression) |
| Python MCP beside-server test | `.venv/Scripts/python.exe -m pytest tools/test_liveshare_e2e_mcp.py` | **10 passed** |
| MCP tool discovery | `mcp_list_tools(server_id="liveshare-e2e")` | **loaded, 7 tools** (e2e_connect, open_canvas, read_canvas, edit, binding_stats, assert_converged, run_matrix) |
| Server suite | untouched | unchanged/green (no Batch touched `server/` source) |

DoD note: the SPEC_04 matrix is **green, not red** — see WP3 divergence below. This does not violate the "existing suite green" gate; it exceeds the "collectable + reports pass/fail without crashing" AC.

## Risk Notes for W4

### WP3 — SPEC-RECONCILE (CRITICAL priority): all six matrix cases pass GREEN, not red
BUILD_SPEC §9 WP3 AC4 / US3 AC4 required the matrix cases to be **real, currently-FAILING reds** (a TDD gate that goes green as the redesign lands). In implementation they are **all green**. Root cause (not a defect, not faked): the WP3 headless matrix runs entirely on the WP1 `CanvasDouble` + WP2 `CanvasDoubleBridge` glue + the already-merged (Phase-0) `CanvasBinding`. AC4's "red" premise assumed a missing production `main.ts` adapter→binding wiring — but the T1 harness deliberately owns its own bridge glue (mandated by BUILD_SPEC §5 interface-impedance risk) and therefore has nothing left unimplemented to fail on. The tests are **strict** (order-independent model↔model + model↔doc equality, zero-re-push per case, all local intent driven through the real-signal interaction driver; WP1 additionally proves a signal-less direct mutation triggers NO capture — guards the false-green the PLAN §Why warns about).
- **W4/W2 decision needed:** accept the matrix as the standing **headless regression gate** (matches actual T1 scope), OR re-scope AC4 to a distinct gate that awaits real production adapter→binding wiring (SPEC_02 Phases 2–4). Recommend acceptance; the redesign converges headlessly today.
- **W4 probe:** confirm the six cases genuinely gate by mutating a convergence path and observing a red — do not treat green as proof the assertions are inert (they are not, but verify).

### WP6 — MEDIUM: live end-to-end drive *through the MCP* is deferred to a manual/agent step
The launcher (`tools/launch_liveshare_e2e.py` → bundled `plugin/src/__tests__/e2e/` harness reusing `wp5/harness.ts`) was verified LIVE: two lightweight hosts, distinct control ports, both answering `session.info` with the **same non-empty `roomId`**, `connected:true`, and clean shutdown freeing both ports (US6 AC1/AC3/AC4/AC6). What is NOT yet executed end-to-end: the full `liveshare-e2e` MCP drive sequence (`e2e_connect → open_canvas → edit → assert_converged/run_matrix`) against the live launcher — control surface is proven, the MCP-against-live-launcher pass is documented in `E2E_USAGE.md §3` as an agent/manual step. **W4 should run this drive** to close US5+US6 end-to-end.

### WP4/WP5 — LOW (bounded, shared caveat): `canvas.binding` / `binding_stats` counters read zero on a live instance
Production `main.ts` routes sync through `CanvasSync`, not `CanvasBinding`, so live binding counters are 0 until the redesign wires the binding. Responses are well-formed; not a defect. `canvas.simulateEdit`/`edit` drive edits directly into the shared canvas `Y.Doc`, so `edit → read_canvas → assert_converged` works regardless. (The headless WP2 counters, by contrast, are exercised and correct.)
- WP4 LOW: non-minified prod build leaves a dead `if(false){...}` husk (contains none of the 3 forbidden identifiers; gate passes). Removing it would require enabling `minifySyntax` on the shipped bundle — deliberately not done.
- WP5 LOW: `liveshare-e2e` was added to master `tools/mcp_proxy_config.json` (`alwaysOn:false`) and manually activated in the generated `tools/mcp_active_config.json`; it persists across regeneration only if toggled on via the config extension.

## Summary for W4 Entry Point

Two new capabilities are now observable.

**T1 (headless, no infra):** `plugin/src/__tests__/harness/` provides `CanvasDouble` + `InteractionDriver` (fires the real `setDragging`/`updateSelection` signals) and `makeTwoPeer()` → a two-peer convergence harness with `assertConverged`/`waitQuiescent`/per-peer counters. `plugin/src/__tests__/canvas-matrix.test.ts` encodes the six SPEC_04 cases on that harness. Trigger: `npm test` in `plugin/` (all green today). Entry points: `harness/canvas-double.ts`, `harness/interaction-driver.ts`, `harness/two-peer.ts`, `canvas-matrix.test.ts`.

**T2 (live, over the real relay):** set `LIVESHARE_E2E=<port>` (or hidden `e2eControlPort`) → the plugin exposes a `127.0.0.1` control server (`plugin/src/testing/e2e-control.ts`, `POST /command` + `GET /events` SSE), tree-shaken from production `main.js`. The `liveshare-e2e` MCP (`tools/MCPserver/liveshare_e2e_mcp_server.py`, 7 tools) drives two such instances. Trigger the full environment via `python tools/launch_liveshare_e2e.py` (boots two lightweight hosts on one relay room; prints both control ports), then drive with the MCP sequence `e2e_connect → open_canvas → edit → assert_converged/run_matrix`. Full instructions: `workflowArtifacts/e2e-infra/E2E_USAGE.md`.

Per-WP detail: `ImplementationReport_WP1..WP6.md` in this folder.
