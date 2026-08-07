# Implementation Report — WP4: In-plugin E2E control server

> Worker 3 Coder artifact. Batch B root (no dependencies). Native sub-agent,
> built-in tools only. Companion to `BUILD_SPEC_CanvasE2EInfra.md` §9 WP4 / §6.1
> and `USER_STORIES.md` US4 + US7.

## Status

**DONE.** All WP4 acceptance criteria met. Quality gates green.

## Files

| File | Action | Purpose |
|---|---|---|
| `plugin/src/testing/e2e-control.ts` | **create** | Flag-gated localhost `http` control server + pure command router + SSE `/events` + plugin-host adapter + bootstrap. |
| `plugin/src/__tests__/e2e-control.test.ts` | **create** | 22 unit tests: command routing + structured errors + host adapter, NO live socket. |
| `plugin/src/canvas/canvas-binding.ts` | **edit (no-op-unless-flag)** | Added zero-cost instrumentation seam (`setCanvasBindingInstrument` + 4 counter sites). |
| `plugin/src/main.ts` | **edit (guarded dynamic import only)** | `__LS_E2E__`-gated `import("./testing/e2e-control")`; `testControlHandle` field; `onunload` close. |
| `plugin/esbuild.config.mjs` | **edit (define only)** | `define: { __LS_E2E__: prod ? "false" : "true" }` so the branch folds to dead code in production. |

No `plugin/package.json` change — transport is Node built-in `http` (US4 AC6 / US7 AC2). No new dependency of any kind.

## Quality gate results (run from `plugin/`)

- `npm run build` (`tsc -noEmit -skipLibCheck && esbuild production`): **PASS** (exit 0).
- Bundle grep of emitted `main.js`:
  - `e2e-control` → **ABSENT** (0)
  - `LIVESHARE_E2E` → **ABSENT** (0)
  - `e2eControlPort` → **ABSENT** (0)
  - (`setCanvasBindingInstrument` also 0 — `canvas-binding.ts` is not imported by `main.ts`, so the instrumentation adds literally zero production footprint.)
- `npm test` (`vitest run`): **PASS** — **26 files / 487 tests, 0 fail** (baseline 453 + WP1–WP3 harness additions + WP4's 22). Server suite untouched.

### Bundle note (RISKY: low)

The production build is intentionally **not minified** (existing project config). esbuild folds `__LS_E2E__`→`false` and drops the dynamic `import()` (module tree-shaken — all its code absent), but leaves a benign dead husk:

```js
if (false) {
  void null.then((m) => { this.testControlHandle = m.maybeStartE2EControlServer(this); })...
}
```

This never executes and contains **none** of the three gate-forbidden identifiers, so the gate passes as specified and decision-5's "module tree-shaken from `main.js`" holds. Enabling `minifySyntax` in the prod build would remove the husk entirely but alters the whole shipped bundle, so it was **not** done (minimal-footprint choice). Flagged for W2/W4 awareness.

## Acceptance criteria trace

- **US4 AC1/AC2** — module exists (`plugin/src/testing/e2e-control.ts`), binds `127.0.0.1` only, listens only when a port flag is set, dynamic-imported behind `__LS_E2E__`, tree-shaken from prod `main.js` (build + grep verified). ✅
- **US4 AC3** — all seven commands return well-formed JSON (tested via `routeCommand` + `buildPluginHost`). ✅
- **US4 AC4** — `GET /events` SSE stream; server emits `canvas.edit` after a successful `canvas.simulateEdit`, and `binding.*` events from the instrumentation hook → ≥1 event after an edit. ✅
- **US4 AC5** — unknown cmd / malformed body / bad args / throwing host method → structured `400 {ok:false,error}`; router never throws (tested). ✅
- **US4 AC6 / US7 AC2** — no `package.json` dependency change. ✅
- **US7 AC1** — prod `main.js` clean of the gated identifiers (grep). ✅

## HTTP protocol — authoritative shape for WP5 (MCP client)

**Base URL:** `http://127.0.0.1:<port>` where `<port>` is `process.env.LIVESHARE_E2E` (numeric → that port; truthy-non-numeric → ephemeral) or the hidden `e2eControlPort` setting (number or numeric string). If neither is set the server never listens.

### `POST /command`
- Request headers: `Content-Type: application/json` (body read raw regardless).
- Request body: `{ "cmd": string, "args"?: object }`.
- Success: **HTTP 200**, body `{ "ok": true, "result": <object> }`.
- Failure (unknown cmd, malformed body, invalid/missing arg, command error): **HTTP 400**, body `{ "ok": false, "error": <string> }`.
- Other paths/methods: **404** `{ "ok": false, "error": "not found: <METHOD> <URL>" }`.
- Body > 1 MB: **400** `{ "ok": false, "error": "request body too large" }`.
- Empty body is parsed as `{}` (→ 400 "cmd must be a string").

**Commands** (exact `cmd` strings, `args` shapes, and `result` shapes):

| `cmd` | `args` | `result` (on `ok:true`) |
|---|---|---|
| `session.info` | — | `{ clientId: string, role: "host"\|"guest"\|null, roomId: string, connected: boolean }` |
| `canvas.open` | `{ path: string }` | `{ opened: boolean, subscribed: boolean }` |
| `canvas.state` | `{ path: string }` | `{ nodes: object[], edges: object[] }` (shared-doc snapshot, dangling edges pruned; `{nodes:[],edges:[]}` if no snapshot) |
| `canvas.binding` | `{ path: string }` | `{ applyRemote: number, captureLocal: number, rePush: number, originUpdates: number }` |
| `canvas.simulateEdit` | `{ path: string, change: object }` | `{ applied: boolean }` |
| `canvas.setFlag` | `{ name: string, value: any }` | `{ set: boolean }` |
| `sync.waitQuiescent` | `{ timeoutMs?: number }` (default 2000) | `{ quiescent: boolean }` |

`path` is required and must be a non-empty string for every `canvas.*` command; omission → 400.

**`canvas.simulateEdit` `change` payload** (all fields optional, applied in one local Yjs transaction on the canvas doc → propagates over the relay to the peer instance):
```json
{
  "nodes":       [ { "id": "n1", "x": 10, "y": 20, "width": 100, "height": 50, "type": "text", "text": "..." } ],
  "removeNodes": [ "n2" ],
  "edges":       [ { "id": "e1", "fromNode": "n1", "toNode": "n3" } ],
  "removeEdges": [ "e2" ]
}
```
Node/edge upserts are minimal-diff (set changed keys, delete absent keys). Each entry must carry a string `id`. Requires `canvas.open` first (else 400 `"canvas not open: <path>"`).

### `GET /events` (SSE)
- Response: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- On connect: a `: connected` comment line.
- Each event: one SSE `data:` frame with JSON `{ "type": string, "path": string, "payload": any }`.
- Emitted:
  - `type: "canvas.edit"` after each successful `canvas.simulateEdit` (`path` = edited path, `payload` = `{applied:true}`).
  - `type: "binding.applyRemote" | "binding.captureLocal" | "binding.rePush" | "binding.originUpdate"` when a wired `CanvasBinding` fires (`payload` = full counters snapshot). `path` is `""` for binding events (the module-level instrument is not path-scoped).
- WP5 needs at least one `canvas.edit` event after driving an edit → satisfies US4 AC4 without depending on a live `CanvasBinding`.

### Binding counters caveat (for WP5/W4)

`main.ts` does **not** wire `CanvasBinding` today (production canvas sync flows through `CanvasSync`, per BUILD_SPEC §5 impedance note). The instrumentation infra is complete and zero-cost, but in a live plugin instance the `canvas.binding` counters read **all zeros** until the redesign wires `CanvasBinding` into the plugin. This is a well-formed response and expected; it is **not** a WP4 defect. `canvas.simulateEdit` drives edits directly into the shared canvas `Y.Doc` (a genuine local transaction that propagates over the relay), which is the capture path available headlessly — so WP5's `edit → read_canvas → assert_converged` loop works regardless.

## Escalation / gaps

None. No spec ambiguity blocked implementation; no missing dependency. The two flagged items (unminified dead husk in bundle; zero binding counters until `CanvasBinding` is wired) are documented, bounded, and non-blocking.
