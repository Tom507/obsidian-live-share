# Implementation Report — WP6: Two-Instance Launcher + Usage Doc

> Batch B leaf (depends on WP4 control server + WP5 MCP, both DONE).
> Reads: BUILD_SPEC §9 WP6 + §6.3 + §5 A2 + §7 + §10; USER_STORIES US6 + US7.

## Status: DONE (AC3 + AC6 verified LIVE headlessly)

## Summary

Created a launcher that boots **two lightweight plugin hosts** (A + B) on distinct
`127.0.0.1` control ports against **one** local relay room, plus the usage doc.
The launcher form is a **Python wrapper** (`tools/launch_liveshare_e2e.py`) driving
a small **TypeScript harness/entry** that REUSES the `wp5/harness.ts` real-relay +
real-`SyncManager` pattern and the WP4 control server verbatim (BUILD_SPEC §5 A2,
US6 AC2). The wrapper bundles the TS entry with the plugin's existing `esbuild`
devDependency and runs it with `node` — **no new dependency**.

Both control ports answer `session.info` with the **same non-empty `roomId`** and
`connected:true`, and a stop **frees both ports** — verified live in this
environment via (a) a vitest harness suite and (b) the real bundled launcher process.

## Files

**Created:**
- `plugin/src/__tests__/e2e/two-host-harness.ts` — `bootTwoHosts()`: boots relay
  (in-process via `startRelay`/`createApp(noopPersistence)`, or external via
  `externalRelayPort`), one room, two hosts. Each host = `newClient(...)`
  (real `SyncManager`) wrapped in an `E2EPluginLike` + a lightweight `canvasSync`
  (subscribe/isSubscribed/getCanvasSnapshot/getCanvasDocHandle over the sync docs)
  + `buildPluginHost` + `createControlServer` (WP4). Reuses wp5 helpers directly.
- `plugin/src/__tests__/e2e/launch-entry.ts` — long-lived entry: parses env knobs,
  boots, prints both ports + `roomId` + the MCP drive sequence, `SIGINT`/`SIGTERM`
  → `boot.close()` → `process.exit`.
- `plugin/src/__tests__/e2e/two-host.test.ts` — vitest verification (4 tests):
  distinct bound ports; **same `roomId` (AC3)**; requested-ports variant;
  **clean shutdown frees both ports (AC6)**.
- `tools/launch_liveshare_e2e.py` — the launcher wrapper (project-local `tools/`;
  see decision note). esbuild-bundles the entry, runs it via node, guarantees the
  node child is torn down on any wrapper exit (AC6).
- `workflowArtifacts/e2e-infra/E2E_USAGE.md` — usage doc (launch command, ports,
  full MCP call sequence, same-room verification, clean stop).

**Touched:** none of the production surface. No `main.ts`, no `plugin/src/canvas/*`,
no relay/`server/` source, no protected infra. `plugin/package.json` unchanged.

## Launcher form decision (PLAN allowed .ps1 OR .py)

Chosen: **Python wrapper + TypeScript boot logic**. The relay + `SyncManager` +
control server are all TS; the only clean cross-package runner on Windows is
esbuild (already the plugin's build tool; handles `.js`→`.ts`, the `obsidian`
alias, and native/dynamic-require deps). The Python wrapper is preferred over
PowerShell per the workspace `run_python` rule. It:
- aliases `obsidian` → the existing vitest mock (`src/__mocks__/obsidian.ts`), the
  same alias `vitest.config.ts` uses (the sync client pulls `obsidian` via
  `src/utils.ts`);
- keeps the server's native/dynamic-require deps (`express`, `cors`,
  `express-rate-limit`, `jsonwebtoken`, `level`, `ws`, `nanoid`) **external**, emits
  the bundle inside `server/node_modules/.cache/` so those resolve from
  `server/node_modules`, and bundles the pure-JS deps (yjs/lib0/y-protocols/minimatch)
  inline;
- runs a tiny **shim** that dynamic-imports the bundle so the bundled server's
  `isMain` bootstrap (`argv[1] === import.meta.url`) stays false — otherwise it
  would spin up a stray second relay on `:3000` with a `level` DB.

**Placement note:** the project has no `tools/` dir and WP5's MCP correctly lives in
the **workspace** `tools/MCPserver/` (MCP-proxy requirement). The WP6 launcher has
no such requirement, is project-scoped, and bundles project TS — so it lives in a
new **project-local** `tools/` (honors the spec's literal `tools/launch_liveshare_e2e.*`
path, uses repo-relative resolution, keeps it beside the code it boots).

## Verification — LIVE vs deferred (BUILD_SPEC §7, US6 DoD)

**Verified LIVE in this environment:**
- **AC1/AC2** — two lightweight hosts boot over one relay via the reused wp5
  `createApp`/`SyncManager` pattern, on distinct control ports.
- **AC3 (same room)** — both control ports answer `session.info` with the SAME
  non-empty `roomId` and `connected:true`, `role` host/guest. Evidence (real
  bundled launcher run): host A `e2e-a`/host + host B `e2e-b`/guest,
  `roomId=fdae08f8-614e-44e7-86c3-9efd9354fabe` on BOTH, both `connected:true`.
  Re-confirmed through the Python wrapper (e.g. `roomId=9f74061e-…` on ports
  40020/40021).
- **AC6 (clean shutdown)** — after stop, both control ports return
  connection-refused (FREED). Verified for direct-node terminate, console-Ctrl-C
  (process-group signal), and the wrapper's own teardown path.
- **US7 AC1** — `npm run build` clean; `grep` of `main.js` for
  `e2e-control|LIVESHARE_E2E|two-host|launch-entry|e2eControlPort` = **0**.
- **US7 AC3** — full plugin suite **507 passed / 0 failed (29 files)**; the 4 new
  WP6 tests are additive, no regression.

**Deferred to a manual/agent run (documented, not blocking):**
- **AC5 end-to-end via MCP** — the doc gives the exact
  `e2e_connect → open_canvas → edit → assert_converged/run_matrix` sequence. The
  control surface is verified live; driving it *through the WP5 MCP tools against a
  live launcher* is a manual/agent step (needs the two live ports + the MCP
  session). Not run here.
- Real full-Obsidian two-instance run (T3) — out of scope by spec.

## Gate results (BUILD_SPEC §7)

| Gate | Result |
|---|---|
| `plugin` `npm run build` (tsc + esbuild prod) | PASS (exit 0) |
| `main.js` grep for e2e/launcher identifiers | 0 (clean) — US7 AC1 |
| `plugin` `npx vitest run` (full) | 507 passed / 0 failed, 29 files |
| WP6 harness suite (`two-host.test.ts`) | 4 passed (AC1/AC2/AC3/AC6) |
| Live launcher boot + `session.info` same-room | PASS (both connected, same roomId) |
| Live launcher stop frees both ports | PASS |
| New production dependency | none (package.json unchanged) |
| Protected infra touched | none |

## RISKY flags

- **AC5 (MCP-driven E2E) is RISKY / deferred:** verified only at the control-surface
  and harness level, not through a live `liveshare-e2e` MCP drive against the running
  launcher. Manual steps are in `E2E_USAGE.md` §3.
- **Binding counters read zero** in the lightweight host (no real `CanvasBinding`
  wired — same WP4 caveat). `canvas.simulateEdit`/MCP `edit` drives edits directly
  into the shared canvas `Y.Doc`, which is what `run_matrix`/`assert_converged`
  exercise; `binding_stats` will not reflect capture/apply until a real binding is
  wired by the redesign. Documented, not a WP6 defect.
- The launcher's default is an **in-process** relay (guarantees one shared room +
  clean shutdown). External-relay mode (`--relay-port`) is implemented but only the
  in-process path was exercised live here.

## Handover summary (for §9 WP6)

Launcher `tools/launch_liveshare_e2e.py` (+ TS harness/entry under
`plugin/src/__tests__/e2e/`) boots two lightweight hosts (ports default 39421/39422)
on one relay room; prints ports + roomId; Ctrl-C frees both ports. AC3 + AC6 proven
live; AC5 MCP-drive documented for a manual run. No production footprint; suite green.
