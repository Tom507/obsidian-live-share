# Implementation Report — WP5: `liveshare-e2e` MCP Server

> Worker 3 (Coder) artifact. Batch B, depends on WP4 (DONE). Scope: BUILD_SPEC §9 WP5, §6.2, US5.

## Status: DONE

## Summary

Created the `liveshare-e2e` FastMCP server that drives a two-instance Obsidian
canvas convergence run by talking to two WP4 control ports over the
`POST /command` HTTP protocol. All seven snake_case tools are implemented,
registered in the proxy catalog, discoverable via `mcp_list_tools`, and covered
by a beside-server test that runs against an in-memory HTTP stub of the WP4
control protocol (no live Obsidian dependency).

## Files

| Action | Path |
|---|---|
| Create | `tools/MCPserver/liveshare_e2e_mcp_server.py` — FastMCP server `liveshare-e2e`, 7 tools |
| Create | `tools/test_liveshare_e2e_mcp.py` — beside-server test, 10 tests, HTTP stub |
| Edit | `tools/mcp_proxy_config.json` — added `liveshare-e2e` master-catalog entry |
| Edit | `tools/mcp_active_config.json` — added `liveshare-e2e` runtime entry (activation) |

## Tools implemented (§6.2)

| tool | args | returns |
|---|---|---|
| `e2e_connect` | `{a:{host,port}, b:{host,port}}` | `{connected}` — records both endpoints, probes each via `session.info` |
| `open_canvas` | `{path}` | `{a:{opened,subscribed}, b:{...}}` |
| `read_canvas` | `{path}` | `{a:{nodes,edges}, b:{nodes,edges}}` |
| `edit` | `{instance:"a"\|"b", path, change}` | `{applied}` — routes to one instance's `canvas.simulateEdit` |
| `binding_stats` | `{path}` | `{a:counters, b:counters}` |
| `assert_converged` | `{path}` | `{converged, diff?}` — order-independent node+edge map compare |
| `run_matrix` | `{path?}` | `{cases:[{name,pass}], allPass}` — SPEC_04 matrix over the two live instances |

All tools use stdlib `urllib` for the control-protocol client (no new dependency),
wrap logic in `try/except`, and return a `dict` with a `status` field.

### `run_matrix` case names (mirror WP3 `canvas-matrix.test.ts`)
`initial-sync`, `multi-edge-move`, `bidirectional-drag`, `add-node-edge`,
`delete-node-edge`, `file-node`. Each case drives edits through the control
protocol (`edit` → `canvas.simulateEdit`), settles via `sync.waitQuiescent`,
then asserts convergence plus case-specific post-conditions (non-dangling edges,
node presence/absence, file-field round-trip).

## Design notes

- **Connection state:** module-level `_ENDPOINTS = {"a", "b"}`, populated by
  `e2e_connect`. Every other tool resolves its target endpoint from there and
  raises a clear "not connected" error if `e2e_connect` was not called.
- **Control client:** `_post_command()` parses a 4xx JSON error body (via
  `HTTPError.read()`) into the `{ok:false,error}` envelope rather than raising —
  matching the WP4 contract.
- **Convergence compare:** `_compare()` indexes nodes/edges by `id` and does an
  order-independent shallow-equality diff; `assert_converged` returns the diff
  only on mismatch.

## Gate results (BUILD_SPEC §7)

- **Beside-server pytest:** `PASS — 10 passed in 7.14s`
  (`.venv/Scripts/python.exe -m pytest tools/test_liveshare_e2e_mcp.py -v`, from workspace root).
  Covers: 4xx-body parsing, connect+probe, bad-endpoint error, full
  open/read/edit/converge flow, divergence diff, zero-re-push invariant,
  full `run_matrix` all-pass, matrix case-name mirror, invalid-instance error,
  not-connected error.
- **MCP discovery:** `mcp_list_tools(server_id="liveshare-e2e")` → **status loaded,
  tool_count 7** (all seven tools). Activated via `reload_proxy_config()` then
  verified through the proxy (NOT `/mcp`). Direct FastMCP introspection also
  confirmed server name `liveshare-e2e` with the 7 tools.
- **JSON validity:** both proxy configs parse cleanly.
- **No new dependency:** transport is stdlib `urllib`; FastMCP already present.

## For WP6 — exact MCP drive sequence & shapes

```
e2e_connect(a={host,port}, b={host,port})     -> {status,"connected":bool, a:{session.info}, b:{session.info}}
open_canvas(path)                             -> {status, a:{opened,subscribed}, b:{opened,subscribed}}
edit(instance="a"|"b", path, change)          -> {status, applied:bool}
      change = {nodes?:[{id,x,y,width,height,type?,file?,...}],
                removeNodes?:[id],
                edges?:[{id,fromNode,toNode,...}],
                removeEdges?:[id]}
read_canvas(path)                             -> {status, a:{nodes,edges}, b:{nodes,edges}}
binding_stats(path)                           -> {status, a:counters, b:counters}
assert_converged(path)                        -> {status, converged:bool, diff?}
run_matrix(path?="e2e-matrix.canvas")         -> {status, cases:[{name,pass,diff?}], allPass:bool}
```
Typical WP6 flow: `e2e_connect` → `open_canvas` → `edit` (drive) →
`assert_converged` (single scenario) or `run_matrix` (full SPEC_04 sweep).

## RISKY flags

- **RISKY (low):** `mcp_active_config.json` is a generated runtime subset. I added
  the `liveshare-e2e` entry manually and triggered `reload_proxy_config()` to
  activate it; if the workflow-config extension regenerates the active config from
  master toggle state, the entry persists only if `liveshare-e2e` is toggled on
  (it is present in the master `mcp_proxy_config.json` as `alwaysOn:false`).
- **NOT RISKY:** The beside-server test validates tool logic against a stub, so
  green pytest proves the client/compare/matrix logic but NOT real WP4/relay
  convergence — that is exercised by WP6's live two-instance run, by design
  (US5 AC6 forbids a live-Obsidian dependency in the unit test).
