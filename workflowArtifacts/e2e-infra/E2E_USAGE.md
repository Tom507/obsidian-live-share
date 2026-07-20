# liveshare-e2e — Two-Instance E2E Usage (WP6)

> How to boot two lightweight plugin hosts against one local relay and drive a
> real canvas-convergence session from the `liveshare-e2e` MCP.
>
> Companion to `BUILD_SPEC_CanvasE2EInfra.md` §6.3 / §9 WP6 and `USER_STORIES.md` US6.
> Scope: the **lightweight plugin host** model (BUILD_SPEC §5 A2) — NOT two full
> Obsidian instances. Real full-Obsidian orchestration is T3 and out of scope.

---

## What the launcher does

`tools/launch_liveshare_e2e.py` boots, in **one** node process:

- ONE local relay — the real `server/` relay, in-process via
  `createApp(noopPersistence)` + `server.listen(0)` (the exact `wp5/harness.ts`
  pattern), **or** an already-running local relay if you pass `--relay-port`.
- ONE relay **room** (so both hosts share the same `roomId`).
- TWO lightweight plugin hosts, each = a real `SyncManager` client (plugin/src/sync)
  subscribed to that room + a real flag-gated WP4 control server
  (`plugin/src/testing/e2e-control.ts`) bound to `127.0.0.1` on a distinct port:
  - **Host A** — `clientId=e2e-a`, `role=host`, default control port **39421**
  - **Host B** — `clientId=e2e-b`, `role=guest`, default control port **39422**

It prints both control ports + the shared `roomId`, then stays alive until Ctrl-C,
at which point it shuts both hosts + the relay down cleanly (frees both ports).

No production dependency is added: the launcher bundles the TypeScript entry with
the plugin's existing `esbuild` devDependency and runs it with `node`.

---

## Prerequisites

- `node` on PATH (built/tested on Node 24; `--target=node18`).
- `plugin/node_modules` installed (`cd plugin && npm install`) — provides `esbuild`.
- `server/node_modules` installed (`cd server && npm install`) — the relay + its
  native deps (`express`, `level`, `ws`, …) resolve from here at runtime.

---

## 1. Launch

From anywhere (paths resolve relative to the repo):

```bash
python <repo>/tools/launch_liveshare_e2e.py
```

Options:

| Flag | Default | Meaning |
|---|---|---|
| `--port-a N` | `39421` | Host A control port |
| `--port-b N` | `39422` | Host B control port |
| `--relay-port N` | *(in-process)* | Connect both hosts to an EXISTING local relay on this port (a `server/` dev instance / dockerized `server/`) instead of booting one in-process |
| `--room-name S` | auto | Relay room name (cosmetic) |
| `--skip-build` | off | Reuse the previously built bundle |

Environment equivalents (CLI wins): `LIVESHARE_E2E_PORT_A`, `LIVESHARE_E2E_PORT_B`,
`LIVESHARE_RELAY_PORT`, `LIVESHARE_ROOM_NAME`.

> **Windows (workspace rule):** run this in a real console via the `visible-console`
> MCP `run_python` so a console **Ctrl-C** reaches node and triggers its graceful
> shutdown. Do NOT background it with the Bash tool.
>
> ```text
> visible-console -> run_python(
>   script="<repo>/tools/launch_liveshare_e2e.py",
>   title="liveshare-e2e launcher", layout="simple")
> ```

On startup you will see:

```text
=== liveshare-e2e two-host launcher (WP6) =============================
  relay          : in-process (127.0.0.1:<ephemeral>)
  room id        : <uuid>
  host A control : http://127.0.0.1:39421   (clientId=e2e-a, role=host)
  host B control : http://127.0.0.1:39422   (clientId=e2e-b, role=guest)
  ...
```

---

## 2. Verify both hosts joined the SAME relay room (US6 AC3)

Query `session.info` on each control port and compare `roomId`:

```bash
curl -s -X POST http://127.0.0.1:39421/command -H "Content-Type: application/json" -d "{\"cmd\":\"session.info\"}"
curl -s -X POST http://127.0.0.1:39422/command -H "Content-Type: application/json" -d "{\"cmd\":\"session.info\"}"
```

Each returns `{"ok":true,"result":{"clientId","role","roomId","connected"}}`. AC3 holds
when both `roomId` values are non-empty and **equal** (and `connected:true`).

---

## 3. Drive the session from the `liveshare-e2e` MCP (WP5)

Point the MCP at the two control ports, then run the convergence flow:

```text
liveshare-e2e -> e2e_connect(a={host:"127.0.0.1", port:39421},
                             b={host:"127.0.0.1", port:39422})
liveshare-e2e -> open_canvas(path="board.canvas")
liveshare-e2e -> edit(instance="a", path="board.canvas",
                      change={nodes:[{id:"n1", x:0, y:0, width:200, height:120, text:"hello"}]})
liveshare-e2e -> assert_converged(path="board.canvas")     # { converged: bool, diff? }
# or run the whole SPEC_04 matrix over the two live instances:
liveshare-e2e -> run_matrix(path="board.canvas")           # { cases:[{name,pass}], allPass }
```

Read back raw snapshots at any point with
`read_canvas(path)` → `{ a:{nodes,edges}, b:{nodes,edges} }`, and binding
instrumentation with `binding_stats(path)` → `{ a:counters, b:counters }`.

> The MCP is registered under proxy key `liveshare-e2e`. Verify its tools with
> `mcp__tools__mcp_list_tools(server_id="liveshare-e2e")` — never the `/mcp` command.

---

## 4. Stop cleanly (US6 AC6)

Press **Ctrl-C** in the launcher console. The launcher shuts both control servers
+ the relay down and frees both control ports (no orphaned processes/ports). If the
wrapper is killed by a supervisor instead, its `finally`/SIGTERM handler still tears
the node child down.

Confirm ports are free:

```bash
# On Windows:
netstat -ano | findstr ":39421 :39422"   # -> no rows once stopped
```

---

## Notes / limitations

- **Lightweight host, not real Obsidian.** Hosts mount the real sync client +
  control server over the real relay WS; they do NOT load Obsidian's private Canvas
  API. `canvas.binding` counters read zero unless a real `CanvasBinding` is wired
  (same caveat as WP4); `canvas.simulateEdit` drives edits directly into the shared
  canvas `Y.Doc`, which is exactly what the MCP `edit` tool exercises.
- **In-process relay is the default** (guarantees one shared room + one-command UX +
  clean shutdown). Use `--relay-port` to target a separately-run local `server/`.
- The launcher touches only local processes/ports + the local relay — it never
  deploys to or modifies protected infrastructure (US6 AC4).
