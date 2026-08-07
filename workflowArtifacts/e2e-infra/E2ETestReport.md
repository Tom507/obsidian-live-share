# E2E Test Report — Canvas E2E Test Infrastructure (T1 + T2)

W4 run: 2026-07-20
Status: **VALIDATION_PASS**

Validated independently against `USER_STORIES.md` (US1–US7) + `BUILD_SPEC_CanvasE2EInfra.md`
§7/§9 ACs by exercising the built infrastructure and observing real behavior — not by
trusting implementation prose. The reconciled acceptance premise (US3 AC4 / §9 WP3: the
SPEC_04 matrix is a self-contained, all-green, additive model-layer regression gate) was
applied: matrix-green is validated as CORRECT by confirming the assertions are strict and
real, not by expecting reds.

---

## Quality Gates (BUILD_SPEC §7)

| Gate | Command | Result |
|---|---|---|
| Plugin typecheck + build | `npm run build` (plugin/) | **PASS** (exit 0; `tsc -noEmit -skipLibCheck && esbuild production`; main.js 581,812 B) |
| Production bundle clean (hard constraint) | grep `main.js` for `e2e-control` / `LIVESHARE_E2E` / `e2eControlPort` | **0 matches** — control-server module tree-shaken out (see below) |
| Full plugin vitest suite | `npm test` (plugin/) | **507 passed / 29 files / 0 fail** (baseline 453/24 → +54 additive, no regression) |
| Python MCP beside-server test | `.venv/Scripts/python.exe -m pytest tools/test_liveshare_e2e_mcp.py -v` | **10 passed** in 7.16s |
| MCP tool discovery | `mcp_list_tools(server_id="liveshare-e2e")` | **loaded, 7 tools** (schemas verified) |
| Server suite | untouched | no Batch touched `server/` source (US7 AC4) |

### Tree-shake grep — the hard constraint (US4 AC2 / US7 AC1)

`grep -E "e2e-control|LIVESHARE_E2E|e2eControlPort|createControlServer|buildPluginHost|routeCommand|text/event-stream" main.js` → **the entire control-server module body is absent.**
The only residual is a dead-code husk at `main.js:17511`:

```js
if (false) {
  void null.then((m) => {
    this.testControlHandle = m.maybeStartE2EControlServer(this);
  }).catch(...);
}
```

The `import("./testing/e2e-control")` is folded to `null` under `if (false)` (esbuild
`__LS_E2E__` define). No forbidden identifier (`e2e-control` / `LIVESHARE_E2E` /
`e2eControlPort`) is present; the module's runtime code (HTTP server, SSE, `127.0.0.1`
bind, router, host adapter) is fully eliminated. **Constraint satisfied.** (The husk is
the documented WP4-LOW non-minified artifact; the AC grep passes.)

---

## Test Level Results

### Smoke Tests (enabled) — one happy-path per user story

| US | Happy path exercised | Result |
|---|---|---|
| US1 | `harness/canvas-double.test.ts` builds a real `createCanvasAdapter` over the double; driver signals fire callbacks | PASS (12 tests) |
| US2 | `harness/two-peer.test.ts` drives a move A→B, asserts convergence + B rePush 0 | PASS (10 tests) |
| US3 | `canvas-matrix.test.ts` all six SPEC_04 cases | PASS (6 tests) |
| US4 | `e2e-control.test.ts` command routing + error handling (no live socket) | PASS (22 tests) |
| US5 | `mcp_list_tools(liveshare-e2e)` → 7 tools; pytest stub-drive | PASS (10 tests) |
| US6 | Launcher boots two hosts; `session.info` on both ports | PASS (live, below) |
| US7 | Build clean + suite green + no new dep | PASS (gates above) |

### Integration Tests (enabled) — component interaction surfaces

| Surface | Evidence | Result |
|---|---|---|
| Two-peer Yjs exchange (WP2) | `waitQuiescent` exchanges `encodeStateAsUpdate`/`applyUpdate` as genuine remote tx; `assertConverged` enforces model↔doc + model(A)↔model(B) | PASS |
| Capture-path fidelity (WP1↔WP2) | Local intent driven only through `InteractionDriver` signals (`setDragging`/`updateSelection`); bridge diffs on signal, never re-pushes remote applies | PASS |
| Control protocol (WP4) POST /command | Live `session.info`, `canvas.open`, `canvas.state`, `canvas.simulateEdit` all returned well-formed JSON | PASS |
| Control error path (WP4 AC5) | pytest `bogus.cmd` → `{ok:false, "unknown cmd"}` 400; `edit(instance="c")` → structured error | PASS |
| MCP → control HTTP (WP5) | pytest exercises all 7 tools against a stub WP4 endpoint incl. divergence diff + zero-re-push invariant | PASS |
| Launcher → relay room (WP6) | Both control ports report the SAME `roomId` live | PASS |

### Full E2E Tests (enabled) — live two-instance run over the real relay

Booted `tools/launch_liveshare_e2e.py` (in-process `server/` relay — no protected infra),
room `359229c8-c930-4bbd-b915-3ca4134105af`, host A :39421 (host), host B :39422 (guest).
Drove the documented `liveshare-e2e` MCP sequence — this closes the WP6-deferred
MCP-against-live-launcher step (HANDOVER HIGH-priority item):

| Step | Tool | Observed | AC |
|---|---|---|---|
| Connect | `e2e_connect` | `connected:true`; both `roomId` equal + non-empty; `connected:true` each | US6 AC3, US5 AC2 |
| Open | `open_canvas("board.canvas")` | both `{opened:true, subscribed:true}` | US4 AC3, US6 AC5 |
| Edit A | `edit(a, board.canvas, {nodes:[n1 …]})` | `{applied:true}` | US4 AC3, US5 AC2 |
| Read both | `read_canvas` | A and B both return the identical `n1` node (propagated over relay) | US5 AC3 |
| Assert | `assert_converged` | `{converged:true}` | US5 AC3, US6 |
| Matrix live | `run_matrix("matrix.canvas")` | **all 6 cases pass, allPass:true** (initial-sync, multi-edge-move, bidirectional-drag, add-node-edge, delete-node-edge, file-node) | US5 AC4 |
| Binding stats | `binding_stats` | zero counters — **expected/documented** (prod routes via `CanvasSync` not `CanvasBinding`; well-formed, not a defect) | WP4/WP5 LOW |
| Shutdown | `close_console` | no LISTENING socket remains on :39421/:39422 (only self-clearing TIME_WAIT) | US6 AC6 |

### Negative control — proof the matrix gate is not inert (HANDOVER W4 probe)

Per the HANDOVER instruction "confirm the six cases genuinely gate … do not treat green
as proof the assertions are inert", a temporary probe drove a real edit on A and asserted
convergence **without** settling:
- Pre-settle: `convergenceDiff` non-null and `assertConverged` **threw** (`/assertConverged failed/`) — divergence detected.
- Post-`waitQuiescent`: same assertion **passed**; B reflects (999,888), B rePush 0.
- A deliberately-wrong expected geometry (11,20 vs converged 10,20) **failed**.

The assertions discriminate converged from diverged state → the matrix all-green is real,
not trivially true. Probe file removed after observation (not delivered in the suite).

---

## Per-US Acceptance Criteria

| US | Verdict | Basis |
|---|---|---|
| US1 — CanvasDouble + interaction driver | **PASS** | `harness/canvas-double.test.ts` 12/12; driver API (`driveDrag/driveAddNode/driveEdge/driveDeleteNode`) exercised by matrix; adapter over double reports interaction callbacks |
| US2 — Two-peer convergence harness | **PASS** | `two-peer.ts` strict `assertConverged` (model↔doc + model↔model), deterministic `waitQuiescent`, real per-peer counters, zero-re-push; 10/10 + negative control |
| US3 — SPEC_04 matrix as tests | **PASS** | `canvas-matrix.test.ts` 6/6, no `.skip`/`.todo`, strict convergence + zero-re-push, all local intent via driver; reconciled all-green additive gate; assertions proven live |
| US4 — Flag-gated control server | **PASS** | 22/22 unit; tree-shaken from main.js; `127.0.0.1` bind; flag-gated (`resolvePort`→null); `node:http` only; structured 4xx errors; live commands well-formed |
| US5 — `liveshare-e2e` MCP server | **PASS** | 7 snake_case tools discoverable via `mcp_list_tools`; 10/10 pytest against stub; live drive incl. `run_matrix` allPass over two instances |
| US6 — Two-instance launcher + usage doc | **PASS** | Live: two hosts, same `roomId`, MCP drive converged, matrix all-pass, clean shutdown (no listener); `E2E_USAGE.md` documents launch + full MCP sequence; in-process relay only (no protected infra) |
| US7 — Zero prod footprint + green suite | **PASS** | main.js clean of gated ids; 507 pass (453 baseline +54 additive); matrix additive all-green; no new prod dep (`node:http`); `server/` untouched; `127.0.0.1` + flag gate |

---

## Issues Found

| Severity | WP | US | Description | AC | Suggested Fix |
|---|---|---|---|---|---|
| — | — | — | None. No CRITICAL or HIGH issues. | — | — |

Non-blocking observations (documented, not defects — no fix required):
- **WP4/WP5 LOW:** live `canvas.binding` / `binding_stats` counters read zero because production `main.ts` routes sync through `CanvasSync`, not `CanvasBinding`. Responses are well-formed; `edit → read_canvas → assert_converged` and `run_matrix` work regardless (edits drive the shared `Y.Doc` directly). The headless WP2 counters ARE exercised and correct. Fully within reconciled scope; the real-binding wiring is the future redesign + one-time human spike.
- **WP4 LOW:** non-minified prod build leaves a dead `if(false){…}` husk in main.js containing the symbol `maybeStartE2EControlServer` but none of the three AC-forbidden identifiers; the module body is fully eliminated. AC grep passes.

## Fix Requests

None — `VALIDATION_PASS`. (Fix-as-failing-test mode was on standby; no CRITICAL/HIGH issue arose, so no failing test is owed.)
