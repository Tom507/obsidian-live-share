// ===========================================================================
// WP4 — Flag-gated, localhost-only in-plugin E2E control server.
//
// PURPOSE (BUILD_SPEC §6.1, US4): expose a dependency-light HTTP surface so an
// external driver (the `liveshare-e2e` MCP server, WP5) can open canvases, read
// shared state, inject edits, read binding instrumentation counters, and await
// quiescence on a REAL running plugin instance.
//
// ZERO PRODUCTION FOOTPRINT (BUILD_SPEC §3 dec.5, US7):
//   - This module lives under `plugin/src/testing/` and is imported ONLY via a
//     flag-gated dynamic `import()` in `main.ts`. That import branch is guarded
//     by the build-time constant `__LS_E2E__`, folded to `false` in the
//     production esbuild build, so the whole branch — and therefore this entire
//     module — is dead-code-eliminated / tree-shaken out of the production
//     `main.js`. (Verify: `npm run build` then grep main.js for `e2e-control`.)
//   - Transport is the Node built-in `http` module: NO new production/dev
//     dependency (BUILD_SPEC §5 A1, US4 AC6).
//   - Binds `127.0.0.1` only and starts only when the flag is set (US4 AC1).
//
// The command router (`routeCommand` / `parseAndRoute`) is a pure function over
// an `E2EControlHost` and is unit-tested WITHOUT a live socket.
// ===========================================================================

import type * as http from "node:http";
import { createServer } from "node:http";
import * as Y from "yjs";
import { setCanvasBindingInstrument } from "../canvas/canvas-binding";

// ---------------------------------------------------------------------------
// Protocol types (mirror BUILD_SPEC §6.1). WP5 targets these shapes directly.
// ---------------------------------------------------------------------------

/** `POST /command` request body. */
export interface CommandRequest {
  cmd: string;
  args?: Record<string, unknown>;
}

/** `POST /command` response body. HTTP 200 for `ok:true`, HTTP 4xx for `ok:false`. */
export type CommandResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/** An async event pushed over `GET /events` (SSE). */
export interface E2EEvent {
  type: string;
  path: string;
  payload: unknown;
}

/** Binding instrumentation counters (BUILD_SPEC §4). */
export interface BindingCounters {
  applyRemote: number;
  captureLocal: number;
  rePush: number;
  originUpdates: number;
}

/**
 * The plugin-facing surface the control server drives. Kept intentionally
 * abstract so the router is testable with a fake host (no plugin, no socket).
 */
export interface E2EControlHost {
  sessionInfo(): {
    clientId: string;
    role: string | null;
    roomId: string;
    connected: boolean;
  };
  canvasOpen(path: string): Promise<{ opened: boolean; subscribed: boolean }>;
  canvasState(
    path: string,
  ): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  bindingCounters(path: string): BindingCounters;
  simulateEdit(path: string, change: unknown): Promise<{ applied: boolean }>;
  setFlag(name: string, value: unknown): { set: boolean };
  waitQuiescent(timeoutMs: number): Promise<{ quiescent: boolean }>;
}

// ---------------------------------------------------------------------------
// Pure command router — no I/O, unit-testable (US4 AC3 + AC5).
// ---------------------------------------------------------------------------

function ok(result: unknown): { status: number; body: CommandResult } {
  return { status: 200, body: { ok: true, result } };
}

function badRequest(error: string): { status: number; body: CommandResult } {
  return { status: 400, body: { ok: false, error } };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`missing or invalid string arg: '${key}'`);
  }
  return v;
}

/**
 * Route a parsed command request to the host. NEVER throws — every failure is a
 * structured `400 { ok:false, error }` (US4 AC5: never crash the canvas view).
 */
export async function routeCommand(
  host: E2EControlHost,
  req: unknown,
): Promise<{ status: number; body: CommandResult }> {
  if (req === null || typeof req !== "object" || Array.isArray(req)) {
    return badRequest("malformed body: expected a JSON object");
  }
  const cmd = (req as CommandRequest).cmd;
  if (typeof cmd !== "string") {
    return badRequest("malformed body: 'cmd' must be a string");
  }
  const rawArgs = (req as CommandRequest).args;
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null)) {
    return badRequest("malformed body: 'args' must be an object");
  }
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  try {
    switch (cmd) {
      case "session.info":
        return ok(host.sessionInfo());
      case "canvas.open":
        return ok(await host.canvasOpen(requireString(args, "path")));
      case "canvas.state":
        return ok(host.canvasState(requireString(args, "path")));
      case "canvas.binding":
        return ok(host.bindingCounters(requireString(args, "path")));
      case "canvas.simulateEdit":
        return ok(
          await host.simulateEdit(requireString(args, "path"), args.change),
        );
      case "canvas.setFlag":
        return ok(host.setFlag(requireString(args, "name"), args.value));
      case "sync.waitQuiescent": {
        const t = args.timeoutMs;
        const timeoutMs = typeof t === "number" && t >= 0 ? t : 2000;
        return ok(await host.waitQuiescent(timeoutMs));
      }
      default:
        return badRequest(`unknown cmd: ${cmd}`);
    }
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Parse a raw request body string and route it. Malformed JSON → structured 400.
 */
export async function parseAndRoute(
  host: E2EControlHost,
  rawBody: string,
): Promise<{ status: number; body: CommandResult }> {
  let parsed: unknown;
  try {
    parsed = rawBody.trim().length === 0 ? {} : JSON.parse(rawBody);
  } catch {
    return badRequest("malformed body: invalid JSON");
  }
  return routeCommand(host, parsed);
}

// ---------------------------------------------------------------------------
// HTTP server (localhost only) + SSE event channel.
// ---------------------------------------------------------------------------

export interface ControlServerHandle {
  /** The bound port (0 before `listen` resolves). */
  port(): number;
  /** Push an event to every connected SSE client (`GET /events`). */
  emit(event: E2EEvent): void;
  /** Stop listening and drop all SSE clients. */
  close(): void;
}

const MAX_BODY_BYTES = 1_000_000;

/**
 * Build (but do not yet listen on) the localhost HTTP control server.
 * `onListening` fires once bound. Bind host is always `127.0.0.1` (US4 AC1).
 */
export function createControlServer(
  host: E2EControlHost,
  opts: { port: number; onListening?: (port: number) => void } = { port: 0 },
): ControlServerHandle {
  const sseClients = new Set<http.ServerResponse>();

  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    // --- SSE async-event channel (US4 AC4) ---
    if (method === "GET" && url.startsWith("/events")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // --- Command endpoint ---
    if (method === "POST" && url.startsWith("/command")) {
      let size = 0;
      const chunks: Buffer[] = [];
      let aborted = false;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          aborted = true;
          writeJson(res, 400, { ok: false, error: "request body too large" });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (aborted) return;
        const rawBody = Buffer.concat(chunks).toString("utf8");
        // Any edit driven through the control surface produces an async event so
        // an /events subscriber sees ≥1 event after a canvas edit (US4 AC4).
        parseAndRoute(host, rawBody)
          .then((out) => {
            writeJson(res, out.status, out.body);
            maybeEmitForRequest(rawBody, out.body);
          })
          .catch((err) => {
            // Defensive: routeCommand is designed never to reject, but guard
            // anyway so a bug can never crash the plugin (US4 AC5).
            writeJson(res, 400, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      });
      return;
    }

    writeJson(res, 404, { ok: false, error: `not found: ${method} ${url}` });
  });

  function emit(event: E2EEvent): void {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(line);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function maybeEmitForRequest(rawBody: string, body: CommandResult): void {
    if (!body.ok) return;
    try {
      const parsed = JSON.parse(rawBody) as CommandRequest;
      if (parsed?.cmd === "canvas.simulateEdit") {
        const path =
          typeof parsed.args?.path === "string" ? parsed.args.path : "";
        emit({ type: "canvas.edit", path, payload: body.result });
      }
    } catch {
      /* non-JSON success bodies never happen; ignore */
    }
  }

  server.listen(opts.port, "127.0.0.1", () => {
    const addr = server.address();
    const bound = addr && typeof addr === "object" ? addr.port : opts.port;
    opts.onListening?.(bound);
  });

  return {
    port: () => {
      const addr = server.address();
      return addr && typeof addr === "object" ? addr.port : 0;
    },
    emit,
    close: () => {
      for (const client of sseClients) {
        try {
          client.end();
        } catch {
          /* ignore */
        }
      }
      sseClients.clear();
      server.close();
    },
  };
}

function writeJson(res: http.ServerResponse, status: number, body: CommandResult): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Plugin host adapter + flag-gated bootstrap.
// ---------------------------------------------------------------------------

type YMapOfMaps = Y.Map<Y.Map<unknown>>;

/** Minimal structural view of the plugin the host needs (avoids obsidian coupling). */
export interface E2EPluginLike {
  settings: {
    clientId?: string;
    roomId?: string;
    role?: string | null;
  };
  muxConnected?: boolean;
  controlConnected?: boolean;
  saveSettings?: () => Promise<void> | void;
  canvasSync?: {
    subscribe(path: string, role: "host" | "guest"): Promise<void>;
    isSubscribed(path: string): boolean;
    getCanvasSnapshot(
      path: string,
    ): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null;
    getCanvasDocHandle(path: string): { doc: Y.Doc } | null;
  } | null;
}

/**
 * Upsert a flat record into a `Y.Map<Y.Map>` collection, minimal-diff, mirroring
 * `writeRecordMinimal` in canvas-binding.ts: set changed keys, delete absent ones.
 */
function upsertRecord(map: YMapOfMaps, id: string, record: Record<string, unknown>): void {
  let ymap = map.get(id);
  if (!ymap) {
    ymap = new Y.Map<unknown>();
    map.set(id, ymap);
  }
  for (const [k, v] of Object.entries(record)) {
    if (ymap.get(k) !== v) ymap.set(k, v);
  }
  for (const k of [...ymap.keys()]) {
    if (!(k in record)) ymap.delete(k);
  }
}

/**
 * Build the concrete host over a live plugin. `emit` and `bump` feed the SSE
 * channel + quiescence tracking from binding instrumentation.
 */
export function buildPluginHost(
  plugin: E2EPluginLike,
  hooks: { counters: BindingCounters; bump: () => void },
): E2EControlHost {
  const runtimeFlags = new Map<string, unknown>();

  const roleOf = (): "host" | "guest" =>
    plugin.settings.role === "host" ? "host" : "guest";

  let lastActivity = Date.now();
  const markActivity = () => {
    lastActivity = Date.now();
    hooks.bump();
  };

  return {
    sessionInfo() {
      return {
        clientId: String(plugin.settings.clientId ?? ""),
        role: plugin.settings.role ?? null,
        roomId: String(plugin.settings.roomId ?? ""),
        connected: Boolean(plugin.muxConnected) && Boolean(plugin.controlConnected),
      };
    },

    async canvasOpen(path) {
      const cs = plugin.canvasSync;
      if (!cs) return { opened: false, subscribed: false };
      await cs.subscribe(path, roleOf());
      return { opened: true, subscribed: cs.isSubscribed(path) };
    },

    canvasState(path) {
      const snapshot = plugin.canvasSync?.getCanvasSnapshot(path);
      return snapshot ?? { nodes: [], edges: [] };
    },

    bindingCounters(_path) {
      return { ...hooks.counters };
    },

    async simulateEdit(path, change) {
      const cs = plugin.canvasSync;
      if (!cs) throw new Error("canvasSync unavailable");
      const handle = cs.getCanvasDocHandle(path);
      if (!handle) throw new Error(`canvas not open: ${path}`);
      const c = (change ?? {}) as {
        nodes?: Array<Record<string, unknown>>;
        removeNodes?: string[];
        edges?: Array<Record<string, unknown>>;
        removeEdges?: string[];
      };
      const doc = handle.doc;
      const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
      const edgesMap = doc.getMap<Y.Map<unknown>>("edges");
      doc.transact(() => {
        for (const node of c.nodes ?? []) {
          if (typeof node.id === "string") upsertRecord(nodesMap, node.id, node);
        }
        for (const id of c.removeNodes ?? []) nodesMap.delete(id);
        for (const edge of c.edges ?? []) {
          if (typeof edge.id === "string") upsertRecord(edgesMap, edge.id, edge);
        }
        for (const id of c.removeEdges ?? []) edgesMap.delete(id);
      });
      markActivity();
      return { applied: true };
    },

    setFlag(name, value) {
      // Apply to a known settings key when present; otherwise stash a runtime
      // flag other test hooks can read. Never touches unrelated settings.
      const settings = plugin.settings as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(settings, name)) {
        settings[name] = value;
        void plugin.saveSettings?.();
      } else {
        runtimeFlags.set(name, value);
      }
      return { set: true };
    },

    async waitQuiescent(timeoutMs) {
      const quietWindowMs = 50;
      const pollMs = 20;
      const deadline = Date.now() + timeoutMs;
      // Deterministic settle: resolve once no control-driven canvas activity has
      // occurred for `quietWindowMs`, or `false` at the timeout.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const idleFor = Date.now() - lastActivity;
        if (idleFor >= quietWindowMs) return { quiescent: true };
        if (Date.now() >= deadline) return { quiescent: false };
        await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}

/**
 * Read the control-server port from the flag surface (BUILD_SPEC §6.1):
 *   - `process.env.LIVESHARE_E2E` (numeric → that port; other truthy → ephemeral)
 *   - hidden `e2eControlPort` setting (NOT a typed setting, read loosely so the
 *     identifier never enters the typed production surface).
 * Returns `null` when neither flag is set → the server never listens (US4 AC1).
 */
function resolvePort(plugin: E2EPluginLike): number | null {
  const env = process.env.LIVESHARE_E2E;
  if (env) {
    if (/^\d+$/.test(env)) return Number(env);
    // Truthy-but-non-numeric env: fall through to setting, else ephemeral.
  }
  const setting = (plugin.settings as Record<string, unknown>).e2eControlPort;
  if (typeof setting === "number" && setting > 0) return setting;
  if (typeof setting === "string" && /^\d+$/.test(setting)) return Number(setting);
  if (env) return 0; // enabled via flag, no explicit port → ephemeral
  return null;
}

/**
 * Flag-gated bootstrap called from `main.ts` (only inside the `__LS_E2E__` dead-
 * code branch). Starts the localhost control server iff a port flag is set,
 * installs zero-cost binding instrumentation, and returns a handle whose
 * `close()` is safe to call unconditionally.
 */
export function maybeStartE2EControlServer(
  plugin: E2EPluginLike,
): { close(): void } {
  const port = resolvePort(plugin);
  if (port === null) {
    return { close: () => {} };
  }

  const counters: BindingCounters = {
    applyRemote: 0,
    captureLocal: 0,
    rePush: 0,
    originUpdates: 0,
  };

  let handle: ControlServerHandle | null = null;

  // Install the (otherwise no-op) binding instrument so `canvas.binding` counters
  // reflect real CanvasBinding activity and edits surface as SSE events. This is
  // the ONLY place the module-level hook is set → zero cost when the flag is off.
  setCanvasBindingInstrument((counter) => {
    if (counter === "originUpdate") counters.originUpdates++;
    else counters[counter]++;
    handle?.emit({ type: `binding.${counter}`, path: "", payload: { ...counters } });
  });

  const host = buildPluginHost(plugin, { counters, bump: () => {} });

  handle = createControlServer(host, {
    port,
    onListening: (bound) => {
      // eslint-disable-next-line no-console
      console.log(`[live-share-e2e] control server listening on 127.0.0.1:${bound}`);
    },
  });

  return {
    close: () => {
      setCanvasBindingInstrument(null);
      handle?.close();
      handle = null;
    },
  };
}
