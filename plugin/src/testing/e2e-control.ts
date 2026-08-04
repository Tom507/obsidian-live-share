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

import { createHash } from "node:crypto";
import type * as http from "node:http";
import { createServer } from "node:http";
import * as Y from "yjs";
import { setCanvasBindingInstrument } from "../canvas/canvas-binding";

/**
 * D2 — structural mirror of `StaleReconcileDecision` in `../types`.
 *
 * Deliberately NOT imported. `../types` is not on the frozen import allow-list
 * this module is held to (WP49 AC4 / WP72 AC4), and widening that list to admit
 * a convenience import would spend a guard that exists for a reason. Nothing is
 * lost by mirroring: `maybeStartE2EControlServer` passes the real
 * `LiveSharePlugin` into `buildPluginHost(plugin: E2EPluginLike)`, so the real
 * `cleanupStaleFiles` return type is structurally checked against this shape by
 * the compiler at that call site. If the two ever diverge, `tsc` fails — the
 * duplication is verified, not hoped for.
 */
interface StaleReconcileDecision {
  ran: boolean;
  reason: string;
  candidates: number;
  trashed: string[];
}

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
/**
 * WP46 — build marker appended to `pluginBuild` in `session.info`.
 *
 * It exists so a rig can tell an e2e-capable build from a production build by
 * looking at the answer rather than at the port: a production `main.js` has this
 * whole module tree-shaken out, so nothing can ever report the marker.
 * Tests import this constant; they never hardcode the literal.
 */
export const E2E_BUILD_MARKER = "e2e";

// ---------------------------------------------------------------------------
// WP47 — scratch artefacts (T3_SharedContract §5). These three constants are the
// TS side of the pin; `tools/obsidian_e2e/constants.py` holds the Python side and
// the two must stay byte-identical. Tests import them; nothing hardcodes the
// literals.
// ---------------------------------------------------------------------------

/** Vault-relative, rig-owned folder. The rig owns this FOLDER, never a name. */
export const SCRATCH_FOLDER = "_e2e-rig";
export const SCRATCH_PREFIX = "e2e-scratch-";
export const SCRATCH_EXT = ".canvas";
/** Empty canvas document written when `scratch.create` is given no `content`. */
export const DEFAULT_SCRATCH_CONTENT = '{"nodes":[],"edges":[]}';

/**
 * Is `path` a rig-owned scratch artefact — exactly one level inside the rig folder?
 *
 * This is the confinement predicate for AC1 and it is deliberately narrow, because
 * everything it accepts is something the control surface is willing to write to or
 * delete. It requires `<SCRATCH_FOLDER>/<SCRATCH_PREFIX><id><SCRATCH_EXT>` with a
 * non-empty id. Root-level and other-folder look-alikes, nested paths, `..`
 * traversals, absolute paths, backslash separators, the plugin dir, a missing prefix
 * and a wrong extension are all refused — so a pre-existing note can never be reached
 * through this surface, whatever the driver asks for.
 */
export function isScratchPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("\\") || path.includes("\0")) return false;

  const parts = path.split("/");
  if (parts.length !== 2) return false; // one level deep; kills "/x/y" and "a/b/c"

  const [folder, name] = parts;
  if (folder !== SCRATCH_FOLDER) return false;
  if (name === "" || name === "." || name === "..") return false;
  if (!name.startsWith(SCRATCH_PREFIX) || !name.endsWith(SCRATCH_EXT)) return false;

  const runId = name.slice(SCRATCH_PREFIX.length, name.length - SCRATCH_EXT.length);
  return runId.length > 0;
}

/**
 * The subset of Obsidian's `DataAdapter` the scratch commands need. Declared
 * structurally so the real `app.vault.adapter` satisfies it as-is and the unit tests
 * can pass an in-memory fake with no filesystem at all.
 */
export interface ScratchAdapterLike {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// WP49 — file-level convergence oracle (T3_SharedContract §6.1 + §7, D17).
//
// On the lightweight host the doc IS the system, so a doc-level comparison is a
// complete oracle. On a real instance the doc, the rendered view and the
// `.canvas` file are three projections and only the last one is durable: two
// vaults can hold an identical shared doc while their writers put different
// bytes on disk. A run in that state has NOT converged, and it must say so
// under a named reason rather than passing.
//
// Everything in this block is pure: no clock, no adapter, no doc.
// ---------------------------------------------------------------------------

/**
 * The D17 defect class, mirrored verbatim over the contract §7 enum. The Python
 * side holds the same literal in `tools/obsidian_e2e/constants.py`; the two must
 * stay byte-identical. Tests import this constant instead of hardcoding it.
 */
export const DOC_CONVERGED_FILE_DIVERGED = "DOC_CONVERGED_FILE_DIVERGED";

/**
 * Result of the `canvas.file` read-back. `content` is `null` — never `""` — when
 * the file is absent: that is the only thing distinguishing a missing file from
 * an empty one, and an oracle that blurs the two is worse than none.
 */
export interface CanvasFileResult {
  exists: boolean;
  /** Lowercase hex sha256 over the raw bytes; `""` when the file is absent. */
  sha256: string;
  /** Byte length on disk; `0` when the file is absent. */
  size: number;
  content: string | null;
}

/** One instance's two projections of the same canvas: the doc and the file. */
export interface CanvasObservation {
  doc: {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
  file: CanvasFileResult;
}

/** Verdict of `evaluateCanvasConvergence`. `reason` is `null` unless D17 applies. */
export interface CanvasConvergenceVerdict {
  converged: boolean;
  docConverged: boolean;
  fileConverged: boolean;
  reason: string | null;
}

/**
 * Order-independent signature of one flat canvas record: key order is a
 * serialisation detail and must not change a verdict, so the keys are sorted.
 */
function recordSignature(record: Record<string, unknown>): string {
  const keys = Object.keys(record).sort();
  return JSON.stringify(keys.map((k) => [k, record[k] ?? null]));
}

/**
 * Id-keyed, array-order-independent comparison — the same shape as `_compare` in
 * the MCP driver. A record without a string `id` falls back to its position, so
 * an unidentifiable record can never silently match a different one.
 */
function sameRecordSet(
  a: Record<string, unknown>[],
  b: Record<string, unknown>[],
): boolean {
  const index = (records: Record<string, unknown>[]): Map<string, string> => {
    const out = new Map<string, string>();
    records.forEach((record, i) => {
      const id = typeof record.id === "string" ? record.id : `#${i}`;
      out.set(id, recordSignature(record));
    });
    return out;
  };
  const left = index(a);
  const right = index(b);
  if (left.size !== right.size) return false;
  for (const [id, signature] of left) {
    if (right.get(id) !== signature) return false;
  }
  return true;
}

/**
 * Byte-level agreement of what the two writers produced. Nothing is normalised
 * here — normalisation is exactly what would hide the divergence this oracle
 * exists to catch (charter §2 non-goal), so digest, size and content must all
 * agree, and an existing file never matches an absent one.
 */
function sameFileObservation(a: CanvasFileResult, b: CanvasFileResult): boolean {
  return (
    a.exists === b.exists &&
    a.sha256 === b.sha256 &&
    a.size === b.size &&
    a.content === b.content
  );
}

/**
 * The convergence verdict over both projections of both instances (AC2 / D17).
 *
 * - both agree  → `converged:true`, `reason:null`
 * - docs agree, files do not → `converged:false`, `reason:DOC_CONVERGED_FILE_DIVERGED`
 *   (the D17 class: precisely the run a doc-only oracle would have passed)
 * - docs disagree → `converged:false`, `reason:null` — the doc oracle already
 *   catches it, so the named reason stays reserved for the case it cannot see.
 */
export function evaluateCanvasConvergence(
  a: CanvasObservation,
  b: CanvasObservation,
): CanvasConvergenceVerdict {
  const docConverged =
    sameRecordSet(a.doc.nodes, b.doc.nodes) && sameRecordSet(a.doc.edges, b.doc.edges);
  const fileConverged = sameFileObservation(a.file, b.file);
  return {
    converged: docConverged && fileConverged,
    docConverged,
    fileConverged,
    reason: docConverged && !fileConverged ? DOC_CONVERGED_FILE_DIVERGED : null,
  };
}

/**
 * The read-only subset of Obsidian's `DataAdapter` the `canvas.file` read-back
 * needs. Declared structurally, and deliberately WITHOUT a single mutating
 * member: the oracle cannot write through this type even by accident, which is
 * the type-level half of AC3. `readBinary` is preferred because it is exact;
 * `read` is accepted for adapters that only offer text.
 */
export interface CanvasFileAdapterLike {
  exists(path: string): Promise<boolean>;
  readBinary?(path: string): Promise<ArrayBuffer>;
  read?(path: string): Promise<string>;
}

export interface E2EControlHost {
  sessionInfo(): {
    clientId: string;
    role: string | null;
    roomId: string;
    connected: boolean;
    // WP46 (T3_SharedContract §6.2) — instance identity. Optional on the *interface*
    // so that pre-WP46 fake hosts in existing tests stay valid; `buildPluginHost`
    // below always populates all five. The four fields above are untouched.
    vaultId?: string;
    vaultName?: string;
    vaultPath?: string | null;
    pluginBuild?: string;
    canvasSurface?: boolean;
  };
  canvasOpen(path: string): Promise<{ opened: boolean; subscribed: boolean }>;
  canvasState(
    path: string,
  ): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  bindingCounters(path: string): BindingCounters;
  simulateEdit(path: string, change: unknown): Promise<{ applied: boolean }>;
  setFlag(name: string, value: unknown): { set: boolean };
  // WP72 (C72 AC2) — the reversal half of `setFlag`. An in-memory settings
  // override the control channel applied is session-scoped AND reversible
  // *through the protocol*, so a scenario can put an instance into a state and
  // then put it back without the rig touching `data.json`. Optional on the
  // *interface* for the same reason as `scratchCreate`/`canvasFile` above: the
  // hand-rolled fake hosts in the pre-WP72 tests stay valid, and `routeCommand`
  // turns an absent method into a structured 400 rather than a crash.
  clearFlags?(): { restored: string[]; cleared: string[] };
  // WP72 (C72 AC3) — read-only classification of a flag name: the identifier of
  // the state a value set under this name would reach, or `null` when nothing
  // consults it. Pure: it stores nothing, mutates nothing and must never be the
  // place a flag is applied. `undefined` (method absent) means "this host cannot
  // classify", and `routeCommand` then answers exactly as it did before WP72 —
  // which is what keeps every hand-rolled fake host in the existing tests valid.
  flagConsumer?(name: string): string | null;
  waitQuiescent(timeoutMs: number): Promise<{ quiescent: boolean }>;
  // WP47 (T3_SharedContract §6.1) — the scratch half of the surface. Optional on the
  // *interface* so pre-WP47 fake hosts in existing tests stay valid; `buildPluginHost`
  // below always provides both. `routeCommand` treats an absent method as a structured
  // 400, never as a crash.
  scratchCreate?(path: string, content?: string): Promise<{ created: boolean; path: string }>;
  scratchRemove?(path: string): Promise<{ removed: boolean }>;
  // WP49 (T3_SharedContract §6.1) — the file-level read-back. Optional on the
  // *interface* for the same reason as the two above: the hand-rolled fake hosts in
  // the pre-WP49 tests stay valid. `buildPluginHost` always provides it, and
  // `routeCommand` turns an absent method into a structured 400 rather than a crash.
  canvasFile?(path: string): Promise<CanvasFileResult>;
  // --- D2 data-loss chain --------------------------------------------------
  // The instrument the data-loss reproduction is driven with. `reconcileStale`
  // calls the REAL `LiveSharePlugin.cleanupStaleFiles()` — the same method
  // `resumeSession` calls, not a copy and not a simulation — and returns its
  // decision verbatim. That is the whole point: a rig command that re-implements
  // the logic it is testing proves only that the rig agrees with itself, which
  // is the `canvas.simulateEdit` mistake this project already paid for once.
  manifestInfo?(): {
    size: number;
    paths: string[];
    publication: { hostId: string; seq: number; publishedAt: number } | null;
    freshPublication: boolean;
    hostPeers: string[];
  };
  reconcileStale?(): Promise<StaleReconcileDecision>;
  publishManifest?(): Promise<{ published: boolean; reason?: string }>;
}

/**
 * WP47 — an `E2EControlHost` that definitely has the scratch commands. This is what
 * `buildPluginHost` returns, so a caller holding a real host can invoke
 * `scratchCreate` / `scratchRemove` directly without an optional-call dance, while the
 * base interface keeps them optional for the hand-rolled fake hosts in existing tests.
 */
export interface E2EScratchControlHost extends E2EControlHost {
  scratchCreate(path: string, content?: string): Promise<{ created: boolean; path: string }>;
  scratchRemove(path: string): Promise<{ removed: boolean }>;
}

/**
 * WP49 — the same narrowing one step further: a host that definitely has the file
 * read-back as well. This is what `buildPluginHost` now returns, so a caller holding
 * a real host calls `canvasFile` directly, while `E2EControlHost` (and therefore
 * every existing fake host) keeps it optional. Extending `E2EScratchControlHost`
 * rather than replacing it keeps WP47's contract intact: anything that accepted the
 * scratch host still accepts this one.
 */
export interface E2EFileControlHost extends E2EScratchControlHost {
  canvasFile(path: string): Promise<CanvasFileResult>;
  // WP72 — `buildPluginHost` always provides the reversal and the classifier, so
  // a caller holding a real host calls them directly; `E2EControlHost` keeps both
  // optional for the hand-rolled fake hosts.
  clearFlags(): { restored: string[]; cleared: string[] };
  flagConsumer(name: string): string | null;
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
 * WP47 — the `path` arg of a scratch command: a string, and a path the rig owns.
 * Throwing here means `routeCommand`'s catch turns it into a structured 400 with the
 * adapter never touched (AC1).
 */
function requireScratchPath(args: Record<string, unknown>): string {
  const path = requireString(args, "path");
  if (!isScratchPath(path)) {
    throw new Error(`refused: path is not inside '${SCRATCH_FOLDER}': ${path}`);
  }
  return path;
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
      // --- WP72 (C72 AC1) ----------------------------------------------------
      // `canvas.setFlag` has no persistence mode and never acquires one. A caller
      // that asks for persistence is refused HERE, at the command boundary, under
      // its own named reason — before the host is reached, so the refusal cannot
      // half-apply anything (I11 REFUSAL NEVER DESTROYS). This is deliberately a
      // refusal rather than a silently-ignored argument: an ignored `persist`
      // would let a caller believe the write happened.
      //
      // WP72 (C72 AC3) — the response distinguishes the three outcomes it used to
      // conflate. Before this WP the command answered `{set:true}` for ANY name
      // whatsoever, so a caller could not tell a flag that was applied from one
      // stashed where nothing reads it from one that does not exist — a control
      // surface that cannot fail.
      //
      //   applied  → `{set:true}`            (shape UNCHANGED — a name whose value
      //                                       reaches state the plugin consumes)
      //   inert    → `{set:false, disposition:"inert", …}`
      //   refused  → structured 400 `{ok:false, error:"refused: …"}`
      //
      // The classification comes from the host (`flagConsumer`), which is the only
      // thing that knows what consumes what. A host that cannot classify keeps its
      // pre-WP72 answer verbatim, which is why every hand-rolled fake host in the
      // existing tests is unaffected.
      //
      // **This is NOT C51 AC3.** That criterion is the *rejection rule* — "a flag
      // no path consults is rejected at the command boundary rather than silently
      // stored" — and it belongs to WP51. WP72 owns only the truthfulness of the
      // answer: the value is still stored exactly as before, and it is now
      // *reported* as inert instead of as success. When WP51 lands, names it
      // rejects move from the `inert` disposition into `refused`; nothing here has
      // to move for that to happen. Deciding here which names are rejected would
      // re-implement WP51's criterion, which this WP is forbidden to do.
      case "canvas.setFlag": {
        if (args.persist !== undefined) {
          return badRequest(
            "refused: persistence-requires-file-write — canvas.setFlag never writes " +
              "data.json for any name; the settings file is borrowed by the rig",
          );
        }
        const name = requireString(args, "name");
        const consumer =
          typeof host.flagConsumer === "function" ? host.flagConsumer(name) : undefined;
        const result = host.setFlag(name, args.value);
        if (consumer === undefined) return ok(result);
        if (consumer === null) {
          // I11 REFUSAL NEVER DESTROYS — the value was stored, nothing was undone
          // and nothing was overwritten. What changed is that the caller is told
          // the truth about where it went.
          return ok({
            set: false,
            disposition: "inert",
            consumer: null,
            reason:
              `no code path consults the flag '${name}'; it was stored in the ` +
              "host's runtime-flag map, which nothing reads",
          });
        }
        return ok(result);
      }
      // WP72 (C72 AC2) — the reversal. Restores every in-memory override this
      // session applied to the value the instance held before the first override,
      // and drops the runtime-flag stash. In-memory only: it must not write
      // `data.json` either, or the restore would be a second clobber.
      case "canvas.clearFlags": {
        if (typeof host.clearFlags !== "function") {
          throw new Error("canvas.clearFlags unavailable on this host");
        }
        return ok(host.clearFlags());
      }
      case "sync.waitQuiescent": {
        const t = args.timeoutMs;
        const timeoutMs = typeof t === "number" && t >= 0 ? t : 2000;
        return ok(await host.waitQuiescent(timeoutMs));
      }
      // --- WP47 (T3_SharedContract §6.1) ------------------------------------
      // Both commands validate the path BEFORE the host — and therefore before the
      // adapter — is reached, so a refused path never causes a single filesystem
      // call. The host validates again (see `buildPluginHost`): the confinement is
      // a property of the surface, not of one caller.
      case "scratch.create": {
        const path = requireScratchPath(args);
        const content = args.content;
        if (content !== undefined && typeof content !== "string") {
          throw new Error("invalid arg: 'content' must be a string when present");
        }
        if (typeof host.scratchCreate !== "function") {
          throw new Error("scratch.create unavailable on this host");
        }
        return ok(await host.scratchCreate(path, content));
      }
      case "scratch.remove": {
        const path = requireScratchPath(args);
        if (typeof host.scratchRemove !== "function") {
          throw new Error("scratch.remove unavailable on this host");
        }
        return ok(await host.scratchRemove(path));
      }
      // --- WP49 (T3_SharedContract §6.1) ------------------------------------
      // The file-level read-back rides the SAME envelope as every command above:
      // no second endpoint, no socket, no new dependency (AC4). A missing `path`
      // is the existing structured 400, exactly like `canvas.state`.
      case "canvas.file": {
        const path = requireString(args, "path");
        if (typeof host.canvasFile !== "function") {
          throw new Error("canvas.file unavailable on this host");
        }
        return ok(await host.canvasFile(path));
      }
      // --- D2 data-loss chain ------------------------------------------------
      case "manifest.info": {
        if (typeof host.manifestInfo !== "function") {
          throw new Error("manifest.info unavailable on this host");
        }
        return ok(host.manifestInfo());
      }
      case "session.reconcileStale": {
        if (typeof host.reconcileStale !== "function") {
          throw new Error("session.reconcileStale unavailable on this host");
        }
        return ok(await host.reconcileStale());
      }
      case "manifest.publish": {
        if (typeof host.publishManifest !== "function") {
          throw new Error("manifest.publish unavailable on this host");
        }
        return ok(await host.publishManifest());
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
    githubUserId?: string;
  };
  muxConnected?: boolean;
  controlConnected?: boolean;
  // --- D2 data-loss chain ---------------------------------------------------
  // All optional, like every capability above: a fake host in an existing unit
  // test must stay valid, and `buildPluginHost` guards each access so a host
  // without them answers a structured 400 rather than crashing.
  manifestManager?: {
    getEntries(): Map<string, unknown>;
    getPublication(): { hostId: string; seq: number; publishedAt: number } | null;
    hasFreshPublication(excludeUserId?: string): boolean;
    publishManifest(options?: { purge?: boolean }): Promise<void>;
  };
  remoteUsers?: Map<string, { userId: string; isHost?: boolean }>;
  cleanupStaleFiles?: () => Promise<StaleReconcileDecision>;
  saveSettings?: () => Promise<void> | void;
  // --- WP46 identity sources (all optional; every one degrades, none is guessed) ---
  /** Obsidian's `App`. `appId` is the stable per-vault identity; the adapter knows the path. */
  app?: {
    appId?: string;
    vault?: {
      getName?(): string;
      /**
       * Obsidian's `DataAdapter`. `getBasePath()` exists on the desktop
       * `FileSystemAdapter` but is NOT on the public `DataAdapter` type, so typing it
       * as `{ getBasePath?(): string }` here would stop the real `LiveSharePlugin`
       * from satisfying this interface at all (`main.ts` would not compile). It is
       * therefore held loosely and read through one guarded accessor below.
       */
      adapter?: unknown;
    };
  };
  /** The plugin manifest — only `version` is read, and only for `pluginBuild`. */
  manifest?: { version?: string };
  /** Explicit canvas-surface probe. When present it wins over the `canvasSync` heuristic. */
  hasCanvasSurface?: () => boolean;
  /**
   * WP47 — explicit scratch adapter. When absent, `resolveScratchAdapter` falls back to
   * `app.vault.adapter`, which structurally satisfies `ScratchAdapterLike` already, so
   * the production path needs no wiring in `main.ts`. `null` means "no adapter": every
   * scratch command then fails structurally rather than guessing a writer.
   */
  scratchAdapter?: ScratchAdapterLike | null;
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
 * `writeRecordMinimal` in canvas-binding.ts: set changed keys, and **touch nothing
 * else**.
 *
 * WP22 / C22 AC3. This helper is the rig's own copy of the production write shape,
 * and it used to sweep keys absent from `record` exactly as the binding did. Now
 * that the binding is upsert-only, the mirror has to be too — otherwise the rig
 * could still manufacture the removed R1 behaviour by hand, and a live E2E run of
 * the fixed code could still disconnect an edge through `canvas.simulateEdit`.
 *
 * The rig keeps its EXPLICIT removals: `simulateEdit`'s `removeNodes` /
 * `removeEdges` still delete whole entries. What is gone is deletion by omission.
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
}

// --- WP46 identity resolution (T3_SharedContract §6.2) -----------------------
// Every helper below is a READ. None mutates a setting, writes to a doc or calls
// `bump` — that is the TypeScript-side mirror of AC2's "no edit is issued".
// Each one degrades to a defined empty value; none throws and none guesses.

/** `f()` guarded against a missing hook and against a throwing host object. */
function safeCall<T>(fn: (() => T) | undefined): T | undefined {
  if (typeof fn !== "function") return undefined;
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** The value when it is a non-empty string, else `undefined`. */
function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Absolute vault path the adapter exposes, or `null` — never `""` (AC3 honesty). */
function resolveVaultPath(plugin: E2EPluginLike): string | null {
  // The one place the loosely-typed adapter is narrowed. `getBasePath` is a desktop-only
  // Obsidian API (I5: degrade, never break) — absent on mobile and absent from the
  // public type, so its absence is a defined answer (`null`), not an error.
  const adapter = plugin.app?.vault?.adapter as
    | { getBasePath?: () => unknown }
    | undefined;
  return nonEmptyString(safeCall(adapter?.getBasePath)) ?? null;
}

/** Stable vault identity: `app.appId`, else the absolute vault path, else `""`. */
function resolveVaultId(plugin: E2EPluginLike): string {
  return nonEmptyString(plugin.app?.appId) ?? resolveVaultPath(plugin) ?? "";
}

/** Vault basename as Obsidian knows it, else `""`. */
function resolveVaultName(plugin: E2EPluginLike): string {
  const name = safeCall(plugin.app?.vault?.getName);
  return typeof name === "string" ? name : "";
}

/** `<manifest version>+<build marker>`; always a non-empty string. */
function resolvePluginBuild(plugin: E2EPluginLike): string {
  return `${nonEmptyString(plugin.manifest?.version) ?? "0.0.0"}+${E2E_BUILD_MARKER}`;
}

/** Explicit hook wins; otherwise the presence of `canvasSync` is the surface signal. */
function resolveCanvasSurface(plugin: E2EPluginLike): boolean {
  const explicit = safeCall(plugin.hasCanvasSurface);
  return explicit === undefined ? Boolean(plugin.canvasSync) : Boolean(explicit);
}

// --- WP47 scratch adapter resolution ----------------------------------------
// Obsidian's `DataAdapter` already exposes `exists`/`mkdir`/`write`/`remove` with the
// shapes `ScratchAdapterLike` asks for, so the real `app.vault.adapter` IS a scratch
// adapter. Resolving it here rather than binding it in `main.ts` keeps the wiring
// inside the module that has tests (charter §7b item 1) and keeps `main.ts` untouched.
// An explicitly supplied `scratchAdapter` always wins, so tests inject a fake and
// `null` means "none" rather than "fall back".

/** Does `value` implement all four `ScratchAdapterLike` methods? */
function isScratchAdapter(value: unknown): value is ScratchAdapterLike {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.exists === "function" &&
    typeof candidate.mkdir === "function" &&
    typeof candidate.write === "function" &&
    typeof candidate.remove === "function"
  );
}

/** The scratch adapter for this plugin, or `null` when there is none. Never guesses. */
function resolveScratchAdapter(plugin: E2EPluginLike): ScratchAdapterLike | null {
  if (plugin.scratchAdapter !== undefined) return plugin.scratchAdapter;
  const vaultAdapter = plugin.app?.vault?.adapter;
  return isScratchAdapter(vaultAdapter) ? vaultAdapter : null;
}

// --- WP49 read-back adapter resolution --------------------------------------
// Obsidian's real `DataAdapter` already exposes `exists` and `readBinary`, so the
// production `app.vault.adapter` satisfies `CanvasFileAdapterLike` structurally and
// no wiring is needed in `main.ts`. It is narrowed to the READ-ONLY view above, so
// no code path below can reach a mutator (AC3).

/** Can `value` answer the two read questions the oracle asks? */
function isCanvasFileAdapter(value: unknown): value is CanvasFileAdapterLike {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.exists !== "function") return false;
  return typeof candidate.readBinary === "function" || typeof candidate.read === "function";
}

/** The read-only file adapter for this plugin, or `null`. Never guesses a reader. */
function resolveCanvasFileAdapter(plugin: E2EPluginLike): CanvasFileAdapterLike | null {
  const vaultAdapter = plugin.app?.vault?.adapter;
  return isCanvasFileAdapter(vaultAdapter) ? vaultAdapter : null;
}

/**
 * The raw bytes of `path` — never a parsed, re-serialised or normalised form.
 * `readBinary` is exact and is preferred; the text reader is a documented fallback
 * and is decoded back to the same bytes. Nothing here opens the file for writing.
 */
async function readCanvasBytes(
  adapter: CanvasFileAdapterLike,
  path: string,
): Promise<Buffer> {
  if (typeof adapter.readBinary === "function") {
    return Buffer.from(new Uint8Array(await adapter.readBinary(path)));
  }
  if (typeof adapter.read === "function") {
    return Buffer.from(await adapter.read(path), "utf8");
  }
  throw new Error("file adapter exposes no reader");
}

/**
 * Build the concrete host over a live plugin. `emit` and `bump` feed the SSE
 * channel + quiescence tracking from binding instrumentation.
 */
export function buildPluginHost(
  plugin: E2EPluginLike,
  hooks: { counters: BindingCounters; bump: () => void },
): E2EFileControlHost {
  const runtimeFlags = new Map<string, unknown>();

  // WP72 (C72 AC2) — the session-scoped override journal. One entry per settings
  // key this control channel has overridden, holding the value the instance held
  // BEFORE the first override, so `clearFlags` restores the loaded value rather
  // than the previous override. It lives in this closure, so it dies with the
  // host: an override cannot survive the instance.
  //
  // Only keys that ALREADY EXIST on `plugin.settings` are ever journalled — a name
  // that is not a settings key goes to `runtimeFlags` and never reaches here — so
  // the restore is always an assignment and never a delete. Stated because the
  // alternative (a journal entry that also records "this key did not exist") would
  // carry a branch nothing can reach through the protocol, and an untestable
  // branch is an invitation to a test that cannot fail.
  const settingsOverrides = new Map<string, unknown>();

  const roleOf = (): "host" | "guest" =>
    plugin.settings.role === "host" ? "host" : "guest";

  let lastActivity = Date.now();
  const markActivity = () => {
    lastActivity = Date.now();
    hooks.bump();
  };

  // --- WP49 AC1: activity is observed at the doc, not at the command ---------
  // Before WP49 the only thing that could mark activity was a control-initiated
  // `canvas.simulateEdit`, so on a real instance `sync.waitQuiescent` answered
  // "quiescent" while relay deltas were still landing and while the user's hand
  // was still on the mouse. Subscribing to the shared doc moves the seam to where
  // the traffic actually is: EVERY update to a canvas this instance has open
  // marks activity, whatever its origin — relay, canvas view, or control channel.
  // Subscription is idempotent per doc (a canvas may be opened repeatedly) and is
  // itself an observation: it issues no transaction and writes nothing.
  const observedDocs = new WeakSet<Y.Doc>();
  const observeDoc = (doc: Y.Doc | null | undefined): void => {
    if (!doc || observedDocs.has(doc)) return;
    observedDocs.add(doc);
    doc.on("update", markActivity);
  };
  /** Observe the doc behind `path`, if the host exposes one. Never breaks the caller. */
  const observeCanvas = (path: string): void => {
    try {
      observeDoc(plugin.canvasSync?.getCanvasDocHandle(path)?.doc);
    } catch {
      /* an unavailable handle is not an error for the observer */
    }
  };

  return {
    sessionInfo() {
      return {
        // --- pre-WP46 quartet: names, defaults and semantics unchanged ---
        clientId: String(plugin.settings.clientId ?? ""),
        role: plugin.settings.role ?? null,
        roomId: String(plugin.settings.roomId ?? ""),
        connected: Boolean(plugin.muxConnected) && Boolean(plugin.controlConnected),
        // --- WP46 instance identity (T3_SharedContract §6.2) ---
        // Replaces "the port answered" with a positive statement of which vault,
        // which build and which surface is answering. Read-only, degrades, never
        // guesses: an unknown vault is `""` and an unknown path is `null`, so the
        // rig-side readiness check can refuse instead of inferring (AC3).
        vaultId: resolveVaultId(plugin),
        vaultName: resolveVaultName(plugin),
        vaultPath: resolveVaultPath(plugin),
        pluginBuild: resolvePluginBuild(plugin),
        canvasSurface: resolveCanvasSurface(plugin),
      };
    },

    // --- D2 data-loss chain ------------------------------------------------
    // Read-only. Reports the three facts the deletion decision turns on, so a
    // scenario can assert its PRECONDITION (the file really is absent from the
    // manifest) instead of assuming it and passing vacuously.
    manifestInfo() {
      const mm = plugin.manifestManager;
      if (!mm) throw new Error("manifest.info unavailable: no manifest manager on this host");
      const entries = mm.getEntries();
      const ownId = plugin.settings.githubUserId || plugin.settings.clientId || "";
      return {
        size: entries.size,
        paths: Array.from(entries.keys()),
        publication: mm.getPublication(),
        freshPublication: mm.hasFreshPublication(ownId),
        hostPeers: Array.from(plugin.remoteUsers?.values() ?? [])
          .filter((user) => user.isHost)
          .map((user) => user.userId),
      };
    },

    // The real method, invoked. Not a re-implementation of its rules.
    reconcileStale() {
      if (typeof plugin.cleanupStaleFiles !== "function") {
        throw new Error("session.reconcileStale unavailable: no reconcile on this host");
      }
      return plugin.cleanupStaleFiles();
    },

    // Lets a scenario ask a host to attest NOW, so the positive case (a live
    // host's assertion still deletes) can be driven deterministically instead of
    // waiting on whatever the session happens to do.
    async publishManifest() {
      if (plugin.settings.role !== "host") {
        return { published: false, reason: "this peer is not the host" };
      }
      const mm = plugin.manifestManager;
      if (!mm) return { published: false, reason: "no manifest manager on this host" };
      await mm.publishManifest({ purge: true });
      return { published: true };
    },

    async canvasOpen(path) {
      const cs = plugin.canvasSync;
      if (!cs) return { opened: false, subscribed: false };
      await cs.subscribe(path, roleOf());
      // From here on this canvas's traffic is visible to quiescence (AC1).
      observeCanvas(path);
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
      // A canvas can be edited through the control channel without ever having been
      // opened through `canvas.open`; observe it here too so the two entry points
      // agree on what "this instance's traffic" means.
      observeDoc(doc);
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
      // WP58: no explicit markActivity() here.
      //
      // Before WP49 this call WAS the activity seam, and it was correct. WP49
      // moved the seam onto the doc itself (`observeDoc` above, registered
      // BEFORE this transaction), so the `update` event raised by `doc.transact`
      // already marks activity for this very edit. Calling markActivity() again
      // counted one edit twice: `bump` fired 2x for a single simulateEdit,
      // deterministically.
      //
      // That is why C46 AC2's structural argument ("exactly one outbound request
      // site, one frozen payload") did not catch it — the second bump never came
      // from the probe or from a request at all. It came from this line, on the
      // edit path, once WP49 made it redundant.
      //
      // This removes a duplicate count; it does NOT make the seam origin-aware.
      // WP49 AC1 ("never inspects origin") is preserved exactly: every update to
      // an observed doc still marks activity, whatever its origin.
      return { applied: true };
    },

    // --- WP47 scratch commands (T3_SharedContract §6.1) ---------------------
    // The confinement check is repeated here on purpose: the router refuses first, but
    // the host must be unable to write outside the rig folder even when called
    // directly. Neither method ever touches a path it did not validate, and neither
    // adopts an existing file — `created:false` reports the collision instead.

    async scratchCreate(path, content) {
      if (!isScratchPath(path)) {
        throw new Error(`refused: path is not inside '${SCRATCH_FOLDER}': ${path}`);
      }
      if (content !== undefined && typeof content !== "string") {
        throw new Error("invalid arg: 'content' must be a string when present");
      }
      const adapter = resolveScratchAdapter(plugin);
      if (!adapter) throw new Error("scratch adapter unavailable on this plugin");

      // Never adopt and never overwrite: an existing file belongs to someone else.
      if (await adapter.exists(path)) return { created: false, path };

      if (!(await adapter.exists(SCRATCH_FOLDER))) await adapter.mkdir(SCRATCH_FOLDER);
      await adapter.write(path, content ?? DEFAULT_SCRATCH_CONTENT);
      return { created: true, path };
    },

    async scratchRemove(path) {
      if (!isScratchPath(path)) {
        throw new Error(`refused: path is not inside '${SCRATCH_FOLDER}': ${path}`);
      }
      const adapter = resolveScratchAdapter(plugin);
      if (!adapter) throw new Error("scratch adapter unavailable on this plugin");

      // Idempotent: teardown may well run twice, and the second call must be a
      // no-op success rather than an error or a second delete.
      if (!(await adapter.exists(path))) return { removed: false };
      await adapter.remove(path);
      return { removed: true };
    },

    // --- WP49 file read-back (T3_SharedContract §6.1) -----------------------
    // `CanvasPersistence` is the single CRDT→disk writer and this method must not
    // become a second one. It therefore: resolves a READ-ONLY adapter view, asks
    // whether the file is there, and — only if it is — reads its bytes. It never
    // writes, never creates the file or its folder, never touches `mtime`, and
    // never parses or re-serialises what it read. What it reports is exactly what
    // the plugin's own writer produced (AC3).
    //
    // An absent file is a defined answer, not an error: `{exists:false, sha256:"",
    // size:0, content:null}`. `content:null` is what tells a missing file apart
    // from an empty one, so it is never softened to `""`.
    async canvasFile(path) {
      const adapter = resolveCanvasFileAdapter(plugin);
      if (!adapter) throw new Error("file adapter unavailable on this plugin");

      if (!(await adapter.exists(path))) {
        return { exists: false, sha256: "", size: 0, content: null };
      }

      const bytes = await readCanvasBytes(adapter, path);
      return {
        exists: true,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
        content: bytes.toString("utf8"),
      };
    },

    // --- WP72 (C72 AC1 + AC2) ------------------------------------------------
    // This function used to call `plugin.saveSettings?.()` for any name that was
    // an existing settings key. `saveSettings` rewrites the whole of
    // `<vault>/.obsidian/plugins/live-share/data.json` FROM THE LIVE IN-MEMORY
    // COPY — and that file is *borrowed*: C70 AC1 captures it byte-exactly and
    // restores it verbatim, and C50 AC6 / C7 AC6 then compare it after teardown
    // against an independent sha256 baseline the rig did not produce, where a
    // mismatch fails the run on data safety. Every canvas-relevant key the gate
    // touches (`useCanvasBinding`, `showCanvasPresence`, `showCanvasCursors`,
    // `sharedFolder`, `roomId`, `serverUrl`) is an existing key, so the NATURAL
    // use of this command took that branch. One control command could therefore
    // destroy the borrow its own verdict is checked against, and the failure
    // would have read as a WP44 restore bug.
    //
    // The call is REMOVED, not guarded behind a `persist` option (AC1 says so in
    // as many words): a guard leaves the clobber one argument away and makes the
    // gate's data safety depend on every future caller remembering. There is now
    // no path from this command to any write of `data.json`, for any name — the
    // router refuses a caller that even asks (`canvas.setFlag` + `persist`).
    //
    // `plugin.saveSettings` stays on `E2EPluginLike`: it is the plugin's own
    // legitimate persistence API and the interface describes the plugin, not
    // this host's use of it. Nothing in `buildPluginHost` calls it.
    setFlag(name, value) {
      const settings = plugin.settings as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(settings, name)) {
        // AC2 — in-memory only, session-scoped, reversible. The prior value is
        // captured on the FIRST override of a key and never overwritten, so a
        // repeated `setFlag` cannot make the restore target a previous override
        // instead of the value the instance loaded.
        if (!settingsOverrides.has(name)) settingsOverrides.set(name, settings[name]);
        settings[name] = value;
      } else {
        runtimeFlags.set(name, value);
      }
      return { set: true };
    },

    // WP72 (C72 AC3) — what, if anything, consults a flag of this name.
    //
    // Read-only and total: it stores nothing and mutates nothing, so calling it
    // can never be the thing that applies a flag. An existing settings key is
    // consumed by the plugin itself, so it names `plugin.settings`. Everything
    // else lands in `runtimeFlags`, which — grep-verified against the current
    // tree — is written at exactly one site and READ BY NOTHING in `plugin/src`.
    // That is not an implementation detail to be papered over: it is why the old
    // `{set:true}` answer was a lie, and `null` is the honest report of it.
    //
    // WP51 owns the *rejection* rule (C51 AC3) and will introduce the register of
    // names that genuinely have readers; when it does, this function is where the
    // register is consulted and names with readers stop returning `null`.
    flagConsumer(name) {
      const settings = plugin.settings as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(settings, name)) return "plugin.settings";
      return null;
    },

    // WP72 (C72 AC2) — the reversal, in memory and through the protocol.
    //
    // Restores each overridden settings key to the value the instance held before
    // this control channel first touched it, and empties the runtime-flag stash.
    // Deliberately does NOT call `plugin.saveSettings()` either: writing the
    // restore to disk would be a second clobber of the borrowed file, and the
    // file the rig restores from is its own captured copy, not ours.
    //
    // Idempotent: a second call is an empty restore, not an error — teardown may
    // well run twice (the same discipline as `scratchRemove`).
    clearFlags() {
      const settings = plugin.settings as Record<string, unknown>;
      const restored: string[] = [];
      for (const [name, prior] of settingsOverrides) {
        settings[name] = prior;
        restored.push(name);
      }
      settingsOverrides.clear();
      const cleared = [...runtimeFlags.keys()];
      runtimeFlags.clear();
      return { restored, cleared };
    },

    async waitQuiescent(timeoutMs) {
      const quietWindowMs = 50;
      const pollMs = 20;
      const deadline = Date.now() + timeoutMs;
      // Deterministic settle: resolve once no canvas activity of ANY origin has
      // occurred for `quietWindowMs`, or `false` at the timeout. `timeoutMs` keeps
      // its meaning and its 2000 ms router default (T3_SharedContract §6).
      //
      // WP49 — the first check happens AFTER the first poll interval, never before
      // it. A wait is a question about the interval it covers, not about the instant
      // it was asked in: a caller that starts waiting and then sees deltas land for
      // the whole timeout must be told `false`, even though the instance happened to
      // be idle at the moment of the call. Answering out of the pre-call history is
      // how a wait ends up certifying a settle it never observed.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, pollMs));
        const idleFor = Date.now() - lastActivity;
        if (idleFor >= quietWindowMs) return { quiescent: true };
        if (Date.now() >= deadline) return { quiescent: false };
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
 *
 * D14 — why the real two-vault rig provisions the port through the *setting* and
 * never through `process.env` (WP44 AC1). Obsidian is single-instance: opening the
 * second vault does not start a second program, it adds another renderer window to
 * the SAME Obsidian process tree. Both windows therefore read one and the same
 * `process.env.LIVESHARE_E2E`, so an env-provisioned port hands both vault
 * instances the identical port — one control server wins the bind and the rig
 * drives one vault twice while believing it drove two, with a green-looking run.
 * `data.json` lives inside the vault, so the hidden `e2eControlPort` setting below
 * is the only channel that can carry a different value for role a and role b. The
 * rig-side provisioner is `tools/obsidian_e2e/ports.py`, which borrows that file
 * byte-exactly and restores it on every exit path.
 *
 * The precedence below is FROZEN (T3_SharedContract §4, WP44 AC4): numeric env →
 * loose `e2eControlPort` setting → truthy-non-numeric env → ephemeral 0 → `null`.
 * WP44 adds no branch, no dependency and no new precedence rule here — a vault with
 * no provisioned port still starts no control server at all. The env path stays
 * exactly as it is: it remains correct for the single-instance headless rig, where
 * each host is its own process.
 */
function resolvePort(plugin: E2EPluginLike): number | null {
  const env = process.env.LIVESHARE_E2E;
  if (env) {
    if (/^\d+$/.test(env)) return Number(env);
    // Truthy-but-non-numeric env: fall through to setting, else ephemeral.
  }
  // The per-vault provisioning site (D14, above): this is the one value that can
  // differ between two vault windows sharing a single Obsidian process.
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
