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
// `fileop.inject` (below) must probe the mute map and the vault under the SAME
// spelling `FileOpsManager` derives from a wire path, and these two are its
// single definers. Re-spelling them here would let the probe and the mechanism
// drift apart silently — a probe that reads a path the plugin never wrote is
// indistinguishable from a refusal. Both specifiers are on the frozen import
// allow-list WP49 AC4 / WP72 AC4 pinned, so nothing is widened to admit them.
import { normalizePath, toLocalPath } from "../utils";

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

/**
 * WP80 — structural mirror of `ManifestPublishDecision` in `../types`, for the
 * same reason and with the same guarantee as the mirror above: `../types` is not
 * on the frozen import allow-list (WP49 AC4 / WP72 AC4), and `buildPluginHost`
 * receives the real `LiveSharePlugin`, so `tsc` checks the real
 * `ManifestManager.publishManifest` return type against this shape at that call
 * site. Divergence is a compile error, not a silent drift.
 */
interface ManifestPublishDecision {
  published: boolean;
  purged: boolean;
  verdict: string;
  reason: string;
  entries: number;
  deleted: string[];
  unaccounted: string[];
}

/**
 * WP86 — structural mirror of `ManifestChangeDisposition` in `../types`, for the
 * same reason and with the same guarantee as the two mirrors above: `../types`
 * is not on the frozen import allow-list, and `buildPluginHost` receives the
 * real `LiveSharePlugin`, so `tsc` checks the real
 * `getLastManifestChangeDisposition` return type against this shape at that call
 * site.
 */
interface ManifestChangeDispositionLike {
  pass: number;
  added: string[];
  removed: string[];
  updated: string[];
  removals: { path: string; verdict: string; reason: string }[];
  renames: { oldPath: string; newPath: string; verdict: string; reason: string }[];
  renamed: string[];
  delegated: string[];
  destroyed: string[];
  reconcile: StaleReconcileDecision | null;
  aborted: boolean;
  error: string;
}

/**
 * WP86 — what the one additive read-only command returns. A single "last" slot
 * cannot audit a queued route: several passes can run between two reads, so the
 * pass that refused would routinely be overwritten before anybody saw it.
 */
interface ManifestChangeReport {
  latest: ManifestChangeDispositionLike | null;
  recent: ManifestChangeDispositionLike[];
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

// --- WP37 (C37 AC6) — structural mirror of the typing instrument's contract --
//
// Deliberately NOT imported, for exactly the reason `StaleReconcileDecision`
// above is not: WP49 AC4 / WP72 AC4 froze this module's static import allow-list
// to five specifiers, and spending that guard to save a type declaration would
// weaken a landed acceptance criterion to fit new code. WP37 holds no §7 licence
// of any class, so the allow-list is respected rather than amended.
//
// NOTE for whoever edits this file next: those three tests scan this SOURCE with a
// plain regex, so a comment that merely *quotes* an import statement counts as an
// import. Do not write one here.
//
// Nothing is lost by mirroring. `buildPluginHost` reaches the real driver through
// a DYNAMIC `import()` — which introduces no bare specifier and no new
// dependency — and hands its result back through these declarations, so the
// compiler structurally checks the real `driveCanvasNodeEdit` return type against
// this shape at that call site. If the two ever diverge, `tsc` fails.
// (Single definer: `testing/canvas-node-editor.ts`.)

// --- WP38 (C38 AC6) — structural mirrors of the undo registry's two readings -
//
// Same reason, same guarantee as every mirror above: the allow-list this module
// is held to is frozen and is respected rather than amended. The one thing this
// file reaches in the undo module is the COMMAND IDS, and it reaches them
// through a DYNAMIC call so that no specifier is introduced — an id spelt by
// hand here would silently stop matching the registered command, and the
// empty-stack answer would look identical to a command that does not exist.
// (Single definer: `canvas/canvas-undo.ts`.)

export interface CanvasUndoReportShape {
  available: boolean;
  path: string | null;
  reason: string | null;
  undoDepth: number;
  redoDepth: number;
  trackedOrigins: string[];
  captureTimeoutMs: number;
  scope: string[];
  managers: number;
}

export interface CanvasUndoOutcomeShape {
  seq: number;
  path: string | null;
  available: boolean;
  reason: string | null;
  kind: "undo" | "redo";
  popped: boolean;
  changed: boolean;
  undoDepthBefore: number;
  undoDepthAfter: number;
  redoDepthBefore: number;
  redoDepthAfter: number;
}

export interface CanvasNodeEditRequest {
  path: string;
  nodeId: string;
  text?: string;
  /** WP36 — insert at this character offset of line 0 instead of at the end. */
  at?: number;
  blur?: boolean;
  open?: boolean;
}

export interface CanvasNodeEditResult {
  ok: boolean;
  error?: string;
  reason?: string;
  path: string;
  nodeId: string;
  canvasOpen: boolean;
  opened: boolean;
  nodeFound: boolean;
  liveNodeIds: string[];
  editingStarted: boolean;
  editingReported: boolean | null;
  surface: string;
  focusTaken: boolean;
  textBefore: string | null;
  textAfter: string | null;
  /** `"editor" | "dom" | "model" | "none"` — which surface the text was read from. */
  textSource: string;
  /** MEASURED by comparing two reads of the live surface — never a literal. */
  applied: boolean;
  inserted: string;
  blurred: boolean;
  probe: {
    hasStartEditing: boolean;
    hasNodeEl: boolean;
    hasChild: boolean;
    editorMembers: string[];
    contenteditableFound: boolean;
  };
}

// ---------------------------------------------------------------------------
// `fileop.inject` — the INBOUND file-op seam, so a peer-shaped op can be put
// through the admission gate that actually guards it.
//
// WHY IT EXISTS. WP68 has two halves. The outbound half (`onFileRename` refuses
// to emit a rename touching the sidecar directory) is demonstrable, because a
// local rename is something a rig can cause. The inbound half — the gate in
// `registerControlHandlers` that refuses a REMOTE rename whose endpoints
// straddle the sidecar boundary — was reported NOT DEMONSTRATED, for the plain
// reason that nothing could deliver a raw `FileOp` to this instance. That half
// is the security-relevant one: what it stops is a peer-reachable write into
// this Electron process's own `.obsidian/**`.
//
// WHAT IT IS NOT. It is not `canvas.simulateEdit`. That command reaches past
// every gate straight into the `Y.Doc` and answers with a hardcoded
// `applied: true`, so a suite built on it establishes nothing; it is on the
// rig's permanent do-not-use list and this file does not call it. The two
// properties that keep this command off that list:
//
//   ENTRY. The frame is handed to the LIVE CONTROL SOCKET as a `message` event.
//   Everything downstream of `WebSocket.onmessage` then runs unaltered: the
//   inbound suppression check, `JSON.parse`, the encrypted-payload branch, the
//   handler-table lookup, and the `file-op` handler that carries the WP68 gate.
//   Not one of those steps is reproduced here, and the gate is not consulted,
//   named or mirrored anywhere in this module.
//
//   ANSWER. Every field below is either a reading taken from real state or
//   arithmetic over two such readings. There is no field whose value says the
//   injection succeeded. `delivered` reports that a seam was found and invoked;
//   whether the op was ADMITTED is answered by `mutedAfterDispatch` (did
//   `applyRemoteOp` take a path mute?) and by `mutated` (did the bytes at either
//   endpoint change?), both measured. A refusal and an admission produce
//   different values for those, which is the whole point — and the answer is
//   returned in the response rather than written to the debug log, because
//   S65/S71 put that log's flush at ~0.5 s normally and 60 s under a host clamp,
//   which makes a log line unusable as an oracle.
// ---------------------------------------------------------------------------

/** One endpoint of an injected op, read at the vault and at the mute map. */
export interface FileOpEndpointObservation {
  /** The path exactly as the injected op spells it (the wire form). */
  path: string;
  /** The same path through the plugin's own converters — what the vault sees. */
  localPath: string;
  exists: boolean;
  /** Lowercase hex sha256 over the raw bytes; `""` when the file is absent. */
  sha256: string;
  /** Byte length on disk; `0` when the file is absent. */
  size: number;
  /** `FileOpsManager.isPathMuted` at the instant of this reading. */
  muted: boolean;
}

/** What `fileop.inject` measured around one delivery. */
export interface FileOpInjectResult {
  /** A seam was found AND invoked. False carries a `reason`; never assumed. */
  delivered: boolean;
  /** Why nothing was delivered, or `null` when it was. */
  reason: string | null;
  /** Which seam carried the frame, or `null` when none was reachable. */
  entry: "control-socket.dispatchEvent" | "control-socket.onmessage" | null;
  /** Byte length of the JSON frame handed to that seam. */
  frameBytes: number;
  /** The op's endpoints, in the order the op spells them. */
  paths: string[];
  /** The window the `after` reading covers, in ms. */
  settleMs: number;
  /** Mute samples taken across that window, per endpoint. */
  samples: number;
  before: FileOpEndpointObservation[];
  after: FileOpEndpointObservation[];
  /**
   * MEASURED: a path mute was observed on at least one endpoint at some sample
   * in the window. `applyRemoteOpInner` takes the mute before it touches the
   * vault, so this tells two indistinguishable-looking runs apart — one in which
   * the gate refused, and one in which the op was applied and changed nothing.
   *
   * NOTE for whoever edits this file next: three landed tests scan this SOURCE
   * with a plain regex for a specifier, so prose of the shape `x` + quoted text
   * counts as an import and reddens them. Do not write one here. That is why the
   * two sentences above are phrased as they are.
   */
  mutedAfterDispatch: boolean;
  /** MEASURED: endpoints whose existence, size or digest changed. */
  changed: string[];
  /** MEASURED: `changed` is non-empty. */
  mutated: boolean;
  /**
   * The production per-link report at the moment of injection, when the host
   * exposes one. A suppressed link swallows the frame before any handler runs,
   * and that must not read as a refusal by the gate.
   */
  link: unknown;
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
    // WP88 — NOTHING IS ADDED HERE, AND THE REASON IS RECORDED.
    //
    // AC4 needs "this peer still holds its identity" answered as a PRESENCE
    // rather than as a credential value, and the obvious place was three more
    // optional fields beside `vaultId`. That was implemented, measured, and
    // REVERTED: `session.info`'s field set is pinned EXHAUSTIVELY by three
    // landed assertions — `wp46/test_session_info_identity_fields_visible`,
    // `t3/wp44/test_tp11_resolveport_precedence_visible` and
    // `e2e-control.test.ts` — so "additive" is not additive here. Optional on
    // the INTERFACE does not mean invisible in the RESPONSE.
    //
    // WP88 holds no §7 licence of any class, so the assertions stand and the
    // criterion is served by `session.severance` instead, which is a new
    // command and pins nothing. See `severanceReport`.
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
  // --- WP37 (C37 AC6) — the typing instrument -------------------------------
  // Optional on the *interface*, exactly like `canvasFile` / `clearFlags` above,
  // so every hand-rolled fake host in the existing tests stays valid and
  // `routeCommand` turns an absent method into a structured 400 rather than a
  // crash. ADDITIVE ONLY: no command above changes shape or behaviour.
  //
  // It is deliberately NOT `simulateEdit`'s shape. `simulateEdit` writes the
  // `Y.Doc` and returns a hardcoded `applied: true`; this one writes neither the
  // doc nor the file, and every field of its result — `applied` included — is
  // read back from the live editing surface after the attempt.
  typeInNode?(req: CanvasNodeEditRequest): Promise<CanvasNodeEditResult>;
  /**
   * WP36 (C36 AC1) — what the DOC holds under `text` / `label`, per record, plus
   * the capture's own per-write receipts. Optional on the same precedent.
   * Read-only, and it carries shapes, lengths and counts — never the text.
   */
  textShape?(path: string): unknown;
  /**
   * WP87 (C87 AC1) — the editing signal + deferral queue + writer state for one
   * canvas path, read without moving any of them. Optional on the interface for
   * the same reason as every capability above.
   */
  canvasEditingSignal?(path: string): unknown;
  /**
   * WP38 (C38 AC6) — invoke the REGISTERED undo/redo command on a live
   * instance and report what was measured around it. Optional on the interface
   * for the same reason as every capability above.
   */
  canvasUndo?(req: { redo?: boolean }): Promise<unknown>;
  reconcileStale?(): Promise<StaleReconcileDecision>;
  // --- WP80 -----------------------------------------------------------------
  // `publishManifest` used to return the hardcoded `{ published: true }` — the
  // `canvas.simulateEdit` `applied: true` mistake wearing a different name,
  // because the real method returned `void` and there was nothing to report. It
  // now returns the real decision, unaltered, and the two refusal cases (not
  // host / no manifest connected) come back as a STRUCTURED decision with a
  // stated reason rather than a success or a thrown 400 a driver could mistake
  // for a crash.
  publishManifest?(): Promise<ManifestPublishDecision>;
  /**
   * ADDITIVE (AC5). Read-only: the decision the most recent REAL publication
   * produced, whoever triggered it — session start, resume, promotion, or the
   * new-peer republish. This is the only instrument that can observe the four
   * purge call sites SEPARATELY, because none of them is reachable from the rig
   * without also re-triggering it.
   */
  lastPublishDecision?(): ManifestPublishDecision | null;
  /**
   * WP86 (AC6). ADDITIVE, READ-ONLY. The disposition the most recent
   * manifest-CHANGE pass produced — per vanished key, what was refused, what was
   * delegated to the gated reconcile, what was actually destroyed, and whether
   * the pass aborted. It triggers nothing: the route runs on a `Y.Map` observer,
   * so there is no way to re-ask it, and a rig that re-computed the answer would
   * only prove that the rig agrees with itself.
   */
  lastManifestChange?(): ManifestChangeReport | null;
  /**
   * ADDITIVE (AC3/AC4). The REAL `plugin.promoteToHost` / `plugin.demoteToGuest`,
   * invoked — not a copy and not a re-implementation of their rules. They are
   * the single implementations of the two role transitions (`join-response`,
   * `host-transfer-complete` and `demoteToGuest` all route through them), so
   * driving them from the rig exercises the production path with the server's
   * verdict delivery replaced, and nothing else.
   */
  promoteToHost?(): Promise<{ role: string | null; publish: ManifestPublishDecision | null }>;
  demoteToGuest?(): Promise<{ role: string | null }>;
  /**
   * WP81 AC1 — DEFERRED BY WP81, LANDED HERE.
   *
   * WP81 was barred from editing this file because WP37 owned it that batch, so
   * its one additive `routeCommand` case was written out in
   * `ImplementationReport_WP81.md` §7 and left unlanded. WP80 touches this file,
   * so it lands it — the body is WP81's, unchanged in substance, on the same
   * optional-host-method precedent as `canvasFile`.
   *
   * Returns the sink's OWN state ("is the log working, and where is it?"),
   * never an echo of settings, and carries no `data.json` value but the resolved
   * log path.
   */
  sinkState?(): unknown;
  /**
   * WP82 (AC2). ADDITIVE, READ-ONLY. Per-link state — socket existence, the
   * LIVE `readyState` read at call time, the peer's own belief about that link
   * as a SEPARATE field, reconnect attempts and the ceiling, whether the retry
   * chain has ended, the last state change, the offline-queue depth and the
   * definer's verdict.
   *
   * Optional on the interface, on the `vaultId` / `canvasFile` precedent, so
   * roughly two dozen hand-rolled fake hosts carrying `controlConnected` stay
   * valid and `npm run build` does not break repo-wide.
   *
   * Deliberately NOT two more names for `muxConnected` / `controlConnected`:
   * those are exactly the values the WP82 defect corrupted, and a "per-link
   * report" derived from them would have reported an OPEN socket as
   * disconnected — the same defect wearing a new field name.
   */
  linkReport?(): unknown;
  /**
   * WP82 (AC3). ADDITIVE. Breaks ONE NAMED LINK (`control` | `mux`) in ONE
   * NAMED SHAPE (`close` | `silence`), and its counterpart puts it back.
   *
   * This is emphatically not `canvas.simulateEdit`'s shape: nothing here
   * returns a hardcoded literal, and the `readyState` before and after are read
   * from the live socket on both sides of the act.
   */
  breakLink?(link: string, shape: string): unknown;
  restoreLink?(link: string): unknown;
  /**
   * WP88 (AC3/AC4). ADDITIVE. Invokes the PRODUCTION re-arm — the same method
   * the `rearm-session` command and the settings button call. It is emphatically
   * NOT `restoreLink`: that one also lifts the rig's own traffic suppression,
   * which no user affordance may do, and a live row driven through it would be
   * measuring the instrument rather than the product.
   *
   * Optional on the interface, on the `vaultId` / `linkReport` precedent, so
   * every hand-rolled fake host in the existing tests stays valid.
   */
  rearmSharing?(): Promise<unknown>;
  /**
   * ADDITIVE. Deliver a raw `FileOp` to the inbound seam a peer's frame enters
   * through, and report what was measured around it. Optional on the interface,
   * on the `canvasFile` / `linkReport` precedent, so every hand-rolled fake host
   * in the existing tests stays valid; `routeCommand` turns an absent method
   * into a structured 400 rather than a crash.
   *
   * See the block comment above `FileOpInjectResult` for why this is not
   * `canvas.simulateEdit` wearing a new name.
   */
  injectFileOp?(req: {
    op: Record<string, unknown>;
    settleMs?: number;
  }): Promise<FileOpInjectResult>;
  /**
   * WP88 (AC3/AC4). ADDITIVE, READ-ONLY. Why this peer stopped sharing and
   * whether it kept its identity.
   *
   * PRESENCE ONLY, by criterion: every credential key is reported as a boolean.
   * No value, no length that could be a fingerprint, no digest — this WP's
   * subject IS those keys, so the discipline is absolute.
   */
  severanceReport?(): unknown;
  /**
   * WP93 (C93 AC4), carried in by WP95 — the mute-release accounting, EXPOSED.
   *
   * `FileOpsManager.getMuteReleaseStats()` has existed since WP93 and no command
   * reached it, so WP93 AC4's counter had no live reader and its `MUTE OVERRUN:`
   * line only appeared when an overrun actually happened. A validator could
   * therefore not distinguish a genuine zero from a missing instrument at all.
   * (That sentence is deliberately not phrased with the two states quoted either
   * side of the word that precedes a module specifier: WP44/WP49/WP72's import
   * allow-list census is a REGEX over this file's text, not a parse of its AST,
   * so an ordinary English sentence of that shape is read as an import and reds
   * three work packages. Measured, not guessed — it did.) An observable a live
   * validator cannot read is not an observable, and this is the reader.
   */
  muteReleaseStats?(): unknown;
  /** WP95 (AC5) — the protected-path refusal ledger, on the same reasoning. */
  protectedPathRefusals?(): unknown;
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
      // --- WP80, all three ADDITIVE ------------------------------------------
      case "manifest.lastPublish": {
        if (typeof host.lastPublishDecision !== "function") {
          throw new Error("manifest.lastPublish unavailable on this host");
        }
        return ok(host.lastPublishDecision());
      }
      // --- WP86, ADDITIVE and READ-ONLY --------------------------------------
      case "manifest.lastChange": {
        if (typeof host.lastManifestChange !== "function") {
          throw new Error("manifest.lastChange unavailable on this host");
        }
        return ok(host.lastManifestChange());
      }
      case "session.promoteToHost": {
        if (typeof host.promoteToHost !== "function") {
          throw new Error("session.promoteToHost unavailable on this host");
        }
        return ok(await host.promoteToHost());
      }
      case "session.demoteToGuest": {
        if (typeof host.demoteToGuest !== "function") {
          throw new Error("session.demoteToGuest unavailable on this host");
        }
        return ok(await host.demoteToGuest());
      }
      // --- WP81 AC1, deferred by WP81 and landed by WP80 ---------------------
      case "plugin.sinkState": {
        if (typeof host.sinkState !== "function") {
          throw new Error("plugin.sinkState unavailable on this host");
        }
        return ok(host.sinkState());
      }
      // --- WP82, ADDITIVE ----------------------------------------------------
      // Three cases and three optional host methods, on the `canvas.file` /
      // `plugin.sinkState` precedent. No command above changes shape or
      // behaviour, `session.info`'s legacy quartet is byte-unchanged, and
      // `canvas.simulateEdit` is neither called, extended nor repaired.
      case "link.report": {
        if (typeof host.linkReport !== "function") {
          throw new Error("link.report unavailable on this host");
        }
        return ok(host.linkReport());
      }
      // The break. BOTH arguments are validated HERE, at the command boundary,
      // before the host — and therefore before any socket — is reached, so a
      // refused call cannot half-break anything (I11 REFUSAL NEVER DESTROYS).
      // A link that exists in the protocol but has no socket object on this
      // instance is refused by the host under its own named reason, which is
      // the third vacuity risk AC3 names by hand.
      case "link.break": {
        const link = requireString(args, "link");
        if (link !== "control" && link !== "mux") {
          throw new Error(`refused: unknown link '${link}' — expected 'control' or 'mux'`);
        }
        const shape = requireString(args, "shape");
        if (shape !== "close" && shape !== "silence") {
          throw new Error(`refused: unknown break shape '${shape}' — expected 'close' or 'silence'`);
        }
        if (typeof host.breakLink !== "function") {
          throw new Error("link.break unavailable on this host");
        }
        return ok(host.breakLink(link, shape));
      }
      case "link.restore": {
        const link = requireString(args, "link");
        if (link !== "control" && link !== "mux") {
          throw new Error(`refused: unknown link '${link}' — expected 'control' or 'mux'`);
        }
        if (typeof host.restoreLink !== "function") {
          throw new Error("link.restore unavailable on this host");
        }
        return ok(host.restoreLink(link));
      }
      // --- WP88, ADDITIVE ----------------------------------------------------
      // Two cases and two optional host methods, on the WP82 precedent above.
      // No command above changes shape or behaviour, `session.info`'s legacy
      // quartet is byte-unchanged, and `canvas.simulateEdit` is neither called,
      // extended nor repaired.
      case "session.rearm": {
        if (typeof host.rearmSharing !== "function") {
          throw new Error("session.rearm unavailable on this host");
        }
        return ok(await host.rearmSharing());
      }
      case "session.severance": {
        if (typeof host.severanceReport !== "function") {
          throw new Error("session.severance unavailable on this host");
        }
        return ok(host.severanceReport());
      }
      // --- WP93 AC4 / WP95 AC5, ADDITIVE --------------------------------------
      //
      // Two cases and two optional host methods, on the `session.severance`
      // precedent directly above. Nothing above changes shape or behaviour.
      //
      // Both take NO arguments, deliberately. A counter that accepts a path
      // would be a second way to ask the predicate, and a live validator that
      // could ask it per-path would be reading the rig's answer rather than the
      // product's. These report what the PRODUCT has already refused.
      case "fileop.muteStats": {
        if (typeof host.muteReleaseStats !== "function") {
          throw new Error("fileop.muteStats unavailable on this host");
        }
        return ok(host.muteReleaseStats());
      }
      case "fileop.protectedRefusals": {
        if (typeof host.protectedPathRefusals !== "function") {
          throw new Error("fileop.protectedRefusals unavailable on this host");
        }
        return ok(host.protectedPathRefusals());
      }
      // --- `fileop.inject`, ADDITIVE ------------------------------------------
      //
      // ONE case and one optional host method, on the `link.break` /
      // `session.rearm` precedent. Nothing above changes shape or behaviour, and
      // `canvas.simulateEdit` is neither called, extended nor repaired.
      //
      // BOTH arguments are validated HERE, at the command boundary, before the
      // host — and therefore before any socket — is reached, so a malformed op
      // never becomes a frame (I11 REFUSAL NEVER DESTROYS). `op.type` is
      // required because every downstream branch dispatches on it: an op without
      // one would be dropped by the handler for a reason that has nothing to do
      // with the gate under test, and the run would read that as a refusal.
      //
      // The response is `ok:true` for "the injection ran and here is what it
      // measured", including a run in which nothing was delivered — the caller
      // reads that off `delivered` / `reason`, which is a shape a scenario can
      // assert on, rather than an HTTP code it has to parse out of a string.
      case "fileop.inject": {
        const rawOp = args.op;
        if (rawOp === null || typeof rawOp !== "object" || Array.isArray(rawOp)) {
          throw new Error("missing or invalid arg: 'op' must be a JSON object");
        }
        const op = rawOp as Record<string, unknown>;
        if (typeof op.type !== "string" || op.type.length === 0) {
          throw new Error("invalid arg: 'op.type' must be a non-empty string");
        }
        if (
          args.settleMs !== undefined &&
          (typeof args.settleMs !== "number" ||
            !Number.isFinite(args.settleMs) ||
            args.settleMs < 0)
        ) {
          throw new Error("invalid arg: 'settleMs' must be a finite number >= 0 when present");
        }
        if (typeof host.injectFileOp !== "function") {
          throw new Error("fileop.inject unavailable on this host");
        }
        return ok(
          await host.injectFileOp({ op, settleMs: args.settleMs as number | undefined }),
        );
      }
      // --- WP37 (C37 AC6) — the typing instrument ---------------------------
      //
      // ADDITIVE. A new `case` and a new optional host method, on the
      // `canvas.file` / `canvas.clearFlags` precedent. No command above changes
      // shape or behaviour, and `canvas.simulateEdit` is neither extended,
      // repaired nor called from here.
      //
      // The response is `ok:true` for "the instrument ran and here is what it
      // measured" — including a run in which nothing was applied, which the
      // caller reads off `applied` / `focusTaken` / `textAfter`. The two
      // conditions the caller can create on purpose (the node does not exist,
      // the canvas is not open) come back as `ok:true` with `result.ok === false`
      // and a named `error`, so a scenario can assert the FAILURE SHAPE rather
      // than an HTTP code. That is deliberate: a structured failure the driver
      // can read is worth more than a 400 it has to parse out of a string.
      case "canvas.typeInNode": {
        if (typeof host.typeInNode !== "function") {
          throw new Error("canvas.typeInNode unavailable on this host");
        }
        const path = requireString(args, "path");
        const nodeId = requireString(args, "nodeId");
        if (args.text !== undefined && typeof args.text !== "string") {
          throw new Error("invalid arg: 'text' must be a string when present");
        }
        // WP36 (W3 revision): the caret offset. Refused at the boundary when it
        // is not a finite number, rather than silently treated as "append" —
        // an ignored position would let a scenario believe it typed inside a
        // word when it appended, which is exactly C36 AC3's vacuity trap.
        if (
          args.at !== undefined &&
          (typeof args.at !== "number" || !Number.isFinite(args.at))
        ) {
          throw new Error("invalid arg: 'at' must be a finite number when present");
        }
        return ok(
          await host.typeInNode({
            path,
            nodeId,
            text: args.text as string | undefined,
            at: args.at as number | undefined,
            blur: args.blur === true,
            open: args.open === true,
          }),
        );
      }
      // --- WP36 (C36 AC1) — THE DOC-LEVEL WITNESS, ADDITIVE and READ-ONLY ----
      //
      // `canvas.state` and `canvas.file` are both JSON-serialised, so both pass
      // a nested `Y.Text` through `Y.Text.prototype.toJSON` and report the same
      // string a plain-string field would report. Neither can tell a migrated
      // field from a flattened one, which is why AC1 says a string read-back
      // alone does not satisfy it. This reads the `Y.Map` itself and reports
      // SHAPES, LENGTHS and the per-write receipts — never the text.
      case "canvas.textShape": {
        if (typeof host.textShape !== "function") {
          throw new Error("canvas.textShape unavailable on this host");
        }
        return ok(host.textShape(requireString(args, "path")));
      }
      // --- WP87 (C87 AC1) — THE ATTRIBUTION READER, ADDITIVE and READ-ONLY ---
      //
      // ONE case, one optional host method, on the `canvas.textShape` /
      // `canvas.file` precedent. No command above changes shape or behaviour and
      // `canvas.simulateEdit` is neither extended, repaired nor called.
      //
      // Why the rig needs it at all: AC1 must record what the editing signal
      // answers ON THE PEER WHOSE EDITOR IS BEING DESTROYED, at that instant. No
      // existing command can say — `canvas.typeInNode` reports Obsidian's
      // `node.isEditing`, not this plugin's `getEditingNodeId()`, and those are
      // exactly the two that route R-B says disagree. This reports the plugin's
      // side WITHOUT sweeping it (see `describeEditingSignal`), so the reader
      // cannot manufacture the blur it is looking for.
      case "canvas.editingSignal": {
        if (typeof host.canvasEditingSignal !== "function") {
          throw new Error("canvas.editingSignal unavailable on this host");
        }
        return ok(host.canvasEditingSignal(requireString(args, "path")));
      }
      // --- WP38 (C38 AC6) — THE UNDO INSTRUMENT, ADDITIVE --------------------
      //
      // ONE case and one optional host method, on the `canvas.textShape` /
      // `canvas.editingSignal` precedent. Nothing above changes shape or
      // behaviour, and `canvas.simulateEdit` is neither extended, repaired nor
      // called from here.
      //
      // It takes NO path. The registered command decides for itself which
      // canvas is in context, and a path argument would let this instrument
      // report the depths of a manager the command never touched — a reading
      // that looks like an answer and is about a different board.
      //
      // What it returns is a DIFFERENCE between two readings taken from the
      // production undo registry, around a real `executeCommandById`. There is
      // no success field in it that is not arithmetic over those two readings,
      // which is the whole point: `canvas.simulateEdit` returns a hardcoded
      // `applied: true` and that class has produced multiple false greens in
      // this run. The empty-stack call is the discriminator — it is the one
      // invocation whose honest answer is "nothing happened", and a literal
      // cannot produce it.
      case "canvas.undo": {
        if (typeof host.canvasUndo !== "function") {
          throw new Error("canvas.undo unavailable on this host");
        }
        if (args.redo !== undefined && typeof args.redo !== "boolean") {
          throw new Error("invalid arg: 'redo' must be a boolean when present");
        }
        return ok(await host.canvasUndo({ redo: args.redo === true }));
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
 * `fileop.inject`'s default settle window and its sampling period.
 *
 * The window is what the `after` reading covers and it is REPORTED in the
 * result, so a caller always knows which interval an answer is about rather than
 * having to assume one. It is not a quiescence promise and is not called one:
 * `sync.waitQuiescent` watches canvas doc traffic, which a file-op does not
 * produce, so there is nothing here for it to answer about.
 */
const DEFAULT_FILEOP_SETTLE_MS = 250;
const FILEOP_SAMPLE_MS = 10;

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
    /**
     * WP88 (AC4) — declared so PRESENCE can be answered. Read only through
     * `Boolean(...)`; the value never leaves this process and never reaches a
     * response, a log, a fixture or a report.
     */
    token?: string;
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
    publishManifest(options?: { purge?: boolean }): Promise<ManifestPublishDecision>;
    /** WP80 — the decision the last REAL publication produced. */
    getLastPublishDecision?(): ManifestPublishDecision | null;
  };
  remoteUsers?: Map<string, { userId: string; isHost?: boolean }>;
  cleanupStaleFiles?: () => Promise<StaleReconcileDecision>;
  /** WP86 — the manifest-change route's own dispositions, read-only. */
  getLastManifestChangeDisposition?: () => ManifestChangeReport;
  /** WP80 — the real role transitions, for AC3/AC4. */
  promoteToHost?: (reason?: string) => Promise<void>;
  demoteToGuest?: () => Promise<void>;
  /** WP81 AC1 — the debug sink's own state, read from the logger, not from settings. */
  logger?: { getSinkState?: () => unknown };
  /**
   * WP82 (AC2/AC3) — the real per-link report and the real break seam, invoked.
   * All three are optional so every hand-rolled fake plugin in the existing
   * tests stays structurally valid. The definer, the socket reads and the break
   * itself live in production modules; nothing is re-implemented here, which is
   * the `canvas.simulateEdit` mistake this project already paid for once.
   */
  linkReport?: () => Record<string, unknown>;
  e2eBreakLink?: (link: "control" | "mux", shape: "close" | "silence") => Record<string, unknown>;
  e2eRestoreLink?: (link: "control" | "mux") => Record<string, unknown>;
  /**
   * The control channel, held as `unknown` for exactly the reason
   * `app.workspace` and `vault.adapter` below are: the live socket it owns is a
   * private field, so declaring any shape for it here would make the real
   * `LiveSharePlugin` stop satisfying this interface and `main.ts` would not
   * compile. It is narrowed through one guarded resolver
   * (`resolveInboundControlSocket`) and every access is validated.
   *
   * READ ONLY, and only to reach the seam a peer's frame arrives at. Nothing in
   * this module sends on it, closes it, reconnects it or reads a credential
   * from it.
   */
  controlChannel?: unknown;
  /**
   * The file-op manager's mute predicate. Typed properly — unlike
   * `controlChannel` — because it is a public method whose shape the real
   * `FileOpsManager` already satisfies. READ ONLY: `isPathMuted` takes nothing
   * and changes nothing, and it is the one observable that tells an inbound
   * refusal apart from an op that was applied and changed nothing, because
   * `applyRemoteOpInner` takes the mute before it touches the vault.
   */
  /**
   * WP95 / WP93 AC4 — the two READ-ONLY counters beside the mute predicate.
   *
   * Optional so every hand-rolled fake plugin in the existing tests stays
   * structurally valid.
   *
   * SPELLED OUT STRUCTURALLY rather than imported as `MuteReleaseStats` /
   * `ProtectedPathRefusals`, and that is a constraint rather than a preference:
   * WP49 AC4 and WP72 AC4 freeze this file's import specifier set, and adding
   * two `import type` lines reds both — a type-only import is erased by the
   * compiler but not by a regex over the source. The agreement is still
   * `tsc`-checked and nothing is cast: `buildPluginHost(this)` in `main.ts`
   * passes the REAL `LiveSharePlugin`, so these shapes are checked structurally
   * against what `FileOpsManager` actually returns, and a field that changed
   * name or type there is a compile error at that call site.
   *
   * Both are counts and CLASSES only — an arm name, a protected root, a path
   * class. Neither carries a path or a byte, which is what makes them safe to
   * render in a live run's output over a vault holding real credentials.
   */
  fileOpsManager?: {
    isPathMuted(path: string): boolean;
    getMuteReleaseStats?(): {
      releasedByEvent: number;
      releasedByCeiling: number;
      overruns: number;
      worstOverrunMs: number;
      overrunsByClass: Record<string, number>;
      pending: number;
    };
    getProtectedPathRefusals?(): {
      total: number;
      byArm: Record<string, number>;
      byRoot: Record<string, number>;
    };
  };
  /**
   * WP87 (C87 AC1) — the attribution read, invoked on the plugin that owns the
   * adapter, the deferral queue and the writer maps. Optional so every
   * hand-rolled fake plugin in the existing tests stays structurally valid.
   */
  canvasEditingSignal?: (path: string) => Record<string, unknown>;
  /**
   * WP38 (C38 AC6) — the undo registry's own read and its own receipt, both
   * invoked on the plugin that owns them. Optional so every hand-rolled fake
   * plugin in the existing tests stays structurally valid.
   *
   * Typed against the structural mirrors below for the same reason
   * `StaleReconcileDecision` is: this module's static allow-list is frozen and
   * may not be widened. `buildPluginHost` receives the real `LiveSharePlugin`,
   * so `tsc` checks the real return types against these shapes at that call
   * site — divergence is a compile error, not silent drift.
   */
  canvasUndoReport?: (path?: string | null) => CanvasUndoReportShape;
  canvasUndoLastOutcome?: () => CanvasUndoOutcomeShape | null;
  /** WP88 (AC3/AC4) — the PRODUCTION re-arm and the severance, both invoked. */
  rearmSharing?: () => Promise<Record<string, unknown>>;
  severanceReport?: () => Record<string, unknown>;
  saveSettings?: () => Promise<void> | void;
  // --- WP46 identity sources (all optional; every one degrades, none is guessed) ---
  /** Obsidian's `App`. `appId` is the stable per-vault identity; the adapter knows the path. */
  app?: {
    appId?: string;
    /**
     * WP37 (AC6) — Obsidian's `Workspace`. Held as `unknown` for the same reason
     * `vault.adapter` below is: typing it would make the real `LiveSharePlugin`
     * stop satisfying this interface. It is narrowed through one guarded
     * resolver (`resolveCanvasEditorDeps`) and every access is validated.
     */
    workspace?: unknown;
    /**
     * WP38 (AC6) — Obsidian's command registry. Held as `unknown` for the same
     * reason `workspace` is: typing it would make the real `LiveSharePlugin`
     * stop satisfying this interface. Narrowed through one guarded resolver
     * (`resolveCommandRegistry`) and every access is validated.
     */
    commands?: unknown;
    vault?: {
      getName?(): string;
      /** WP37 (AC6) — resolve a `.canvas` path to a file so a leaf can open it. */
      getAbstractFileByPath?(path: string): unknown;
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
    // WP36 (C36 AC1) — optional, so every existing hand-rolled `canvasSync`
    // double in the test suite stays structurally valid.
    getTextShape?(path: string): unknown;
    getTextWriteReceipts?(path?: string): unknown[];
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

// --- `fileop.inject` — resolving the inbound seam and reading the endpoints --
//
// Everything in this block is a READ or a narrowing. Nothing here decides
// whether an op is admissible, and nothing here re-states the WP68 predicate:
// the gate lives in `sync/control-handlers.ts` and is reached only by handing a
// frame to the socket, exactly as the relay does.

/**
 * The subset of a live `WebSocket` the injection needs. `dispatchEvent` is the
 * platform's own delivery path and is preferred; `onmessage` is the documented
 * fallback for a socket object that has no event target (a test double).
 */
interface InboundSocketSeam {
  dispatchEvent?: (event: unknown) => boolean;
  onmessage?: ((event: { data: unknown }) => void) | null;
}

/**
 * The live control socket, or `null` when this instance has none.
 *
 * `null` is a defined answer and it is reported as a named refusal rather than
 * worked around: a peer's frame cannot arrive on a link that does not exist, so
 * an injection with no socket has not exercised the gate and must not be able
 * to look as though it did.
 */
function resolveInboundControlSocket(plugin: E2EPluginLike): InboundSocketSeam | null {
  const channel = plugin.controlChannel;
  if (!channel || typeof channel !== "object") return null;
  const socket = (channel as { ws?: unknown }).ws;
  if (!socket || typeof socket !== "object") return null;
  return socket as InboundSocketSeam;
}

/** `MessageEvent` when the runtime has one (Electron renderer, Node ≥ 18). */
function resolveMessageEventCtor():
  | (new (type: string, init: { data: unknown }) => unknown)
  | null {
  const ctor = (globalThis as { MessageEvent?: unknown }).MessageEvent;
  return typeof ctor === "function"
    ? (ctor as new (type: string, init: { data: unknown }) => unknown)
    : null;
}

/** The endpoints an op names, in the order the wire protocol spells them. */
function fileOpEndpoints(op: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["path", "oldPath", "newPath"]) {
    const value = op[key];
    if (typeof value === "string" && value.length > 0) out.push(value);
  }
  return out;
}

/**
 * One endpoint's reading. The digest is over the raw bytes and the CONTENT IS
 * NEVER RETURNED: this command can be pointed at any path a peer could name,
 * including `.obsidian/**`, where the plugin's own `data.json` holds live
 * credentials. A digest answers "did these bytes change" without carrying one
 * of them.
 *
 * Missing adapter, missing manager and unreadable file are all defined answers,
 * never throws: a reading that fails must not abort the injection it was taken
 * around, or a refusal and a crash would look the same.
 */
async function observeFileOpEndpoint(
  plugin: E2EPluginLike,
  adapter: CanvasFileAdapterLike | null,
  path: string,
): Promise<FileOpEndpointObservation> {
  const localPath = toLocalPath(normalizePath(path));
  let exists = false;
  let sha256 = "";
  let size = 0;
  if (adapter) {
    try {
      exists = await adapter.exists(localPath);
      if (exists) {
        const bytes = await readCanvasBytes(adapter, localPath);
        sha256 = createHash("sha256").update(bytes).digest("hex");
        size = bytes.byteLength;
      }
    } catch {
      // An unreadable endpoint stays at its defined empty reading; `exists`
      // keeps whatever the adapter did answer.
    }
  }
  return { path, localPath, exists, sha256, size, muted: isEndpointMuted(plugin, path) };
}

/** `FileOpsManager.isPathMuted` for one endpoint; `false` when no manager. */
function isEndpointMuted(plugin: E2EPluginLike, path: string): boolean {
  const manager = plugin.fileOpsManager;
  if (!manager || typeof manager.isPathMuted !== "function") return false;
  try {
    return manager.isPathMuted(toLocalPath(normalizePath(path)));
  } catch {
    return false;
  }
}

/** Did an endpoint's existence, size or digest change between two readings? */
function endpointChanged(
  before: FileOpEndpointObservation,
  after: FileOpEndpointObservation,
): boolean {
  return (
    before.exists !== after.exists ||
    before.size !== after.size ||
    before.sha256 !== after.sha256
  );
}

// --- WP37 (C37 AC6) — resolving the typing instrument's world ---------------
//
// Every member below is READ from Obsidian's own runtime and validated before
// use. Nothing here writes: no vault write, no adapter write, no `Y.Doc`
// transaction, no `requestSave`. The only mutation this whole path can cause is
// the one a keystroke causes — characters in an open editor.

/** Views of the canvas leaves Obsidian currently has open, in workspace order. */
function resolveCanvasViews(plugin: E2EPluginLike): Array<{ canvas?: unknown; file?: { path?: unknown } }> {
  const workspace = plugin.app?.workspace as
    | { getLeavesOfType?: (t: string) => unknown[] }
    | undefined;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") return [];
  let leaves: unknown[];
  try {
    leaves = workspace.getLeavesOfType("canvas") ?? [];
  } catch {
    return [];
  }
  const views: Array<{ canvas?: unknown; file?: { path?: unknown } }> = [];
  for (const leaf of Array.isArray(leaves) ? leaves : []) {
    const view = (leaf as { view?: unknown } | null)?.view;
    if (view && typeof view === "object") {
      views.push(view as { canvas?: unknown; file?: { path?: unknown } });
    }
  }
  return views;
}

/** Open `path` in a workspace leaf. Returns whether a leaf was actually opened. */
async function openCanvasLeaf(plugin: E2EPluginLike, path: string): Promise<boolean> {
  const workspace = plugin.app?.workspace as
    | { getLeaf?: (newLeaf?: boolean) => unknown }
    | undefined;
  const vault = plugin.app?.vault;
  if (!workspace || typeof workspace.getLeaf !== "function") return false;
  if (!vault || typeof vault.getAbstractFileByPath !== "function") return false;
  const file = vault.getAbstractFileByPath(path);
  if (!file) return false;
  const leaf = workspace.getLeaf(false) as { openFile?: (f: unknown) => Promise<void> } | null;
  if (!leaf || typeof leaf.openFile !== "function") return false;
  await leaf.openFile(file);
  return true;
}

/** `document` when there is a DOM (the Electron renderer), else `null`. */
function resolveDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}

/**
 * WP38 (C38 AC6) — Obsidian's command registry, narrowed once and validated.
 * `null` means "this host has no command registry", which is a refusal the
 * instrument reports rather than a condition it works around.
 */
function resolveCommandRegistry(plugin: E2EPluginLike): {
  executeCommandById(id: string): boolean;
  ids(): string[];
} | null {
  const raw = plugin.app?.commands as
    | {
        executeCommandById?: (id: string) => boolean;
        listCommands?: () => Array<{ id?: unknown }>;
        commands?: Record<string, unknown>;
      }
    | undefined;
  if (!raw || typeof raw.executeCommandById !== "function") return null;
  const execute = raw.executeCommandById.bind(raw);
  return {
    executeCommandById: (id) => execute(id) === true,
    ids: () => {
      // Two sources, because Obsidian's registry is private and untyped (I5 —
      // degrade, never break). `listCommands()` reports what is CURRENTLY
      // available (it consults `checkCallback`), so it can legitimately be
      // empty for a disabled command; `commands` is the raw registration map
      // and is the one that answers "was it registered at all".
      const out: string[] = [];
      try {
        if (raw.commands && typeof raw.commands === "object") {
          for (const id of Object.keys(raw.commands)) out.push(id);
        }
      } catch {
        /* private surface — a failure to enumerate is not a failure to invoke */
      }
      try {
        if (out.length === 0 && typeof raw.listCommands === "function") {
          for (const c of raw.listCommands() ?? []) {
            if (typeof c?.id === "string") out.push(c.id);
          }
        }
      } catch {
        /* as above */
      }
      return out;
    },
  };
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
        // WP88 adds nothing here — see the interface comment above.
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
    // WP80 — THE REAL METHOD, INVOKED, AND ITS ANSWER RETURNED UNALTERED.
    //
    // What used to be here was `await mm.publishManifest({purge:true}); return
    // {published:true}` — a literal, because the real method returned `void`.
    // It could not report whether the publication purged, what it deleted, or
    // why it was allowed to, and it would have reported success for a
    // publication that silently did nothing.
    //
    // The two refusal cases below are still structured refusals with a stated
    // reason rather than a thrown 400, and they now carry the same shape as a
    // success so a driver reads one field in every branch.
    async publishManifest(): Promise<ManifestPublishDecision> {
      const mm = plugin.manifestManager;
      if (!mm) {
        return {
          published: false,
          purged: false,
          verdict: "nothing-to-publish",
          reason: "no manifest manager on this host",
          entries: 0,
          deleted: [],
          unaccounted: [],
        };
      }
      if (plugin.settings.role !== "host") {
        return {
          published: false,
          purged: false,
          verdict: "additive",
          reason: "this peer is not the host; only a host publishes a manifest",
          entries: 0,
          deleted: [],
          unaccounted: [],
        };
      }
      return mm.publishManifest({ purge: true });
    },

    // WP80 (AC5, additive). Read-only, and the only way to observe what the
    // four production call sites decided without re-triggering them.
    lastPublishDecision() {
      const mm = plugin.manifestManager;
      if (!mm || typeof mm.getLastPublishDecision !== "function") return null;
      return mm.getLastPublishDecision();
    },

    // WP86 (AC6, additive). Read-only. The disposition is produced by the
    // PRODUCTION handler and stored on the plugin; nothing is composed here, and
    // nothing is triggered by asking.
    lastManifestChange() {
      if (typeof plugin.getLastManifestChangeDisposition !== "function") return null;
      return plugin.getLastManifestChangeDisposition();
    },

    // WP80 (AC3/AC4, additive). The real role transitions. `promoteToHost`
    // publishes internally, so the decision that promotion produced is read back
    // from the manifest manager rather than composed here.
    async promoteToHost() {
      if (typeof plugin.promoteToHost !== "function") {
        throw new Error("session.promoteToHost unavailable: no promotion on this host");
      }
      await plugin.promoteToHost("e2e control: promotion driven by the test rig");
      const mm = plugin.manifestManager;
      const publish =
        mm && typeof mm.getLastPublishDecision === "function" ? mm.getLastPublishDecision() : null;
      return { role: plugin.settings.role ?? null, publish };
    },

    async demoteToGuest() {
      if (typeof plugin.demoteToGuest !== "function") {
        throw new Error("session.demoteToGuest unavailable: no demotion on this host");
      }
      await plugin.demoteToGuest();
      return { role: plugin.settings.role ?? null };
    },

    // --- WP82 (AC2/AC3) — the link instruments -----------------------------
    //
    // Each one calls the REAL production method and returns its answer
    // verbatim. Nothing is composed, defaulted or hardcoded here: the
    // `readyState` values come from the live sockets via
    // `ControlChannel.getLinkSnapshot` / `SyncManager.getLinkSnapshot`, and the
    // verdict comes from the one pure definer.
    linkReport() {
      if (typeof plugin.linkReport !== "function") {
        throw new Error("link.report unavailable: no link report on this host");
      }
      return plugin.linkReport();
    },

    // The break seam's only call site outside tests. `testing/` is
    // dead-code-eliminated from the production bundle by `__LS_E2E__`, so this
    // is what keeps the seam unreachable in a production build.
    breakLink(link: string, shape: string) {
      if (typeof plugin.e2eBreakLink !== "function") {
        throw new Error("link.break unavailable: no break seam on this host");
      }
      return plugin.e2eBreakLink(link as "control" | "mux", shape as "close" | "silence");
    },

    restoreLink(link: string) {
      if (typeof plugin.e2eRestoreLink !== "function") {
        throw new Error("link.restore unavailable: no break seam on this host");
      }
      return plugin.e2eRestoreLink(link as "control" | "mux");
    },

    // --- WP88 (AC3/AC4) ----------------------------------------------------
    // The REAL production method, invoked. This is the exact call the
    // `rearm-session` command and the settings button make, which is the whole
    // point: a live row driven through `link.restore` would be exercising the
    // rig's own restore half and would prove nothing about a user's way back.
    async rearmSharing() {
      if (typeof plugin.rearmSharing !== "function") {
        throw new Error("session.rearm unavailable: no re-arm on this host");
      }
      return await plugin.rearmSharing();
    },

    severanceReport() {
      if (typeof plugin.severanceReport !== "function") {
        throw new Error("session.severance unavailable: no severance report on this host");
      }
      return plugin.severanceReport();
    },

    // --- WP93 AC4 / WP95 AC5 — the two counters, given a reader -------------
    //
    // READ-ONLY and INVOKED ON THE REAL MANAGER. Neither method computes,
    // derives or reconstructs a statistic: each forwards one production call and
    // returns what it answered. A rig that recomputed the number would be an
    // oracle over itself, which is the failure both of these counters exist to
    // avoid being.
    muteReleaseStats() {
      const manager = plugin.fileOpsManager;
      if (!manager || typeof manager.getMuteReleaseStats !== "function") {
        throw new Error(
          "fileop.muteStats unavailable: this instance's file-op manager exposes no " +
            "mute-release accounting",
        );
      }
      return manager.getMuteReleaseStats();
    },

    protectedPathRefusals() {
      const manager = plugin.fileOpsManager;
      if (!manager || typeof manager.getProtectedPathRefusals !== "function") {
        throw new Error(
          "fileop.protectedRefusals unavailable: this instance's file-op manager exposes no " +
            "protected-path refusal ledger",
        );
      }
      return manager.getProtectedPathRefusals();
    },

    // --- `fileop.inject` — the inbound seam --------------------------------
    //
    // NOTE WHAT IS NOT IN THIS METHOD: no `vault`, no `fileManager`, no
    // `applyRemoteOp`, no `isSharedPath`, no `isSidecarPath`, no copy of the
    // WP68 predicate and no branch on `op.type`. It cannot apply, refuse or
    // classify an op even by accident. The only thing it does to the plugin is
    // hand one JSON frame to the socket and then READ — which is the structural
    // half of "the guard under test is the one that actually runs".
    //
    // The mute is SAMPLED across the settle window rather than read once,
    // because the window is a race the reader would otherwise have to win:
    // `applyRemoteOp` takes the mute a few microtasks after the handler returns
    // and the arming release drops it again later, so a single reading could
    // miss a mute that was genuinely taken and report an applied op as refused.
    // A latch over the window can only fail in the safe direction.
    async injectFileOp(req): Promise<FileOpInjectResult> {
      const settleMs =
        typeof req.settleMs === "number" && Number.isFinite(req.settleMs) && req.settleMs >= 0
          ? req.settleMs
          : DEFAULT_FILEOP_SETTLE_MS;
      const paths = fileOpEndpoints(req.op);
      const adapter = resolveCanvasFileAdapter(plugin);
      const link = typeof plugin.linkReport === "function" ? plugin.linkReport() : null;

      const before: FileOpEndpointObservation[] = [];
      for (const path of paths) before.push(await observeFileOpEndpoint(plugin, adapter, path));

      const frame = JSON.stringify({ type: "file-op", op: req.op });
      const frameBytes = Buffer.byteLength(frame, "utf8");
      const base = {
        frameBytes,
        paths,
        settleMs,
        before,
        link,
      };
      const undelivered = (reason: string): FileOpInjectResult => ({
        ...base,
        delivered: false,
        reason,
        entry: null,
        samples: 0,
        after: before,
        mutedAfterDispatch: false,
        changed: [],
        mutated: false,
      });

      const socket = resolveInboundControlSocket(plugin);
      if (!socket) {
        return undelivered(
          "no live control socket on this instance: a peer's frame cannot arrive " +
            "on a link that does not exist, so nothing was injected",
        );
      }
      // A socket with no message handler would swallow the frame silently and
      // the run would read that as the gate refusing. Refused instead, named.
      if (typeof socket.onmessage !== "function") {
        return undelivered(
          "the control socket carries no message handler, so a delivered frame " +
            "would reach nothing; the inbound path is not armed",
        );
      }

      const MessageEventCtor = resolveMessageEventCtor();
      let entry: FileOpInjectResult["entry"];
      try {
        if (typeof socket.dispatchEvent === "function" && MessageEventCtor !== null) {
          socket.dispatchEvent(new MessageEventCtor("message", { data: frame }));
          entry = "control-socket.dispatchEvent";
        } else {
          socket.onmessage({ data: frame });
          entry = "control-socket.onmessage";
        }
      } catch (err) {
        return undelivered(
          `the inbound seam threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Sample the mute across the window, latching per endpoint.
      const muteLatch = paths.map(() => false);
      let samples = 0;
      const deadline = Date.now() + settleMs;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, FILEOP_SAMPLE_MS));
        samples += 1;
        paths.forEach((path, i) => {
          if (isEndpointMuted(plugin, path)) muteLatch[i] = true;
        });
        if (Date.now() >= deadline) break;
      }

      const after: FileOpEndpointObservation[] = [];
      for (const path of paths) after.push(await observeFileOpEndpoint(plugin, adapter, path));
      const changed = paths.filter((_, i) => endpointChanged(before[i], after[i]));

      return {
        ...base,
        delivered: true,
        reason: null,
        entry,
        samples,
        after,
        mutedAfterDispatch: muteLatch.some(Boolean),
        changed,
        mutated: changed.length > 0,
      };
    },

    // WP81 AC1 (deferred by WP81, landed by WP80). The logger's own accessor,
    // invoked — not a re-derivation of the sink's state from settings, which is
    // precisely the confusion the sink state exists to end.
    sinkState() {
      const logger = plugin.logger;
      if (!logger || typeof logger.getSinkState !== "function") {
        throw new Error("plugin.sinkState unavailable: no debug logger on this host");
      }
      return logger.getSinkState();
    },

    // --- WP37 (C37 AC6) — the typing instrument ----------------------------
    //
    // The driver lives in `testing/canvas-node-editor.ts` and is reached through
    // a DYNAMIC import: a static one would add a sixth specifier to the
    // allow-list WP49/WP72 froze, and WP37 may not amend a landed assertion.
    // `import()` adds no specifier and no dependency, and the compiler still
    // checks the driver's real return type against the `CanvasNodeEditResult`
    // declared above at this very call site.
    //
    // NOTE what is NOT here: no `getCanvasDocHandle`, no `doc.transact`, no
    // vault write, no `requestSave`. This method cannot reach the doc or the
    // file even by accident, which is the structural half of AC6.
    async typeInNode(req) {
      const mod = await import("./canvas-node-editor");
      return mod.driveCanvasNodeEdit(
        {
          canvasViews: () => resolveCanvasViews(plugin),
          openCanvas: (path) => openCanvasLeaf(plugin, path),
          document: () => resolveDocument(),
          wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        },
        req,
      );
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

    // WP36 (C36 AC1). Reads through `CanvasSync`, which owns the doc; this file
    // holds no knowledge of the record shape and no `Y.Text` check of its own,
    // so the witness and the mechanism cannot drift apart.
    textShape(path) {
      const cs = plugin.canvasSync;
      if (!cs || typeof cs.getTextShape !== "function") {
        return { available: false, path, subscribed: false, fields: [], receipts: [] };
      }
      const shape = cs.getTextShape(path);
      // (see below for WP87's reader — it is wired next to this one)
      // Scoped to THIS path. The ring is per-client, so an unscoped read would
      // report another board's captures and turn a per-field count into a
      // session count — a witness that cannot answer the question it was asked.
      const receipts =
        typeof cs.getTextWriteReceipts === "function" ? cs.getTextWriteReceipts(path) : [];
      return { available: true, ...(shape ?? { path, subscribed: false, fields: [] }), receipts };
    },

    // WP87 (C87 AC1). Reads through the plugin, which owns the adapter, the
    // deferral queue and the writer maps; this file holds no copy of any of
    // them, so the instrument and the mechanism cannot drift apart.
    canvasEditingSignal(path) {
      if (typeof plugin.canvasEditingSignal !== "function") {
        return { available: false, path };
      }
      return { available: true, ...(plugin.canvasEditingSignal(path) as object) };
    },

    // --- WP38 (C38 AC6) — the undo instrument -----------------------------
    //
    // It INVOKES the registered Obsidian command. It does not reach the
    // `Y.Doc`, does not construct a `Y.UndoManager`, does not touch a stack and
    // does not decide anything: note what is NOT in this method — no
    // `getCanvasDocHandle`, no `doc.transact`, no `UndoManager`, no vault
    // write. It cannot undo anything even by accident, which is the structural
    // half of the criterion.
    //
    // The command IDS are read from the module that registers them, through a
    // DYNAMIC call that introduces no specifier — see the mirrors above. The
    // full id is then MEASURED against the registry rather than assembled from
    // a guessed manifest id, and it is reported, so a run can see which command
    // was actually invoked.
    //
    // Every number below is a reading of the production registry taken either
    // side of that invocation. `popped` is their difference. There is no
    // constant in the response that says something happened.
    async canvasUndo(req) {
      const mod = await import("../canvas/canvas-undo");
      const kind = req.redo === true ? "redo" : "undo";
      const suffix = req.redo === true ? mod.CANVAS_REDO_COMMAND_ID : mod.CANVAS_UNDO_COMMAND_ID;
      const registry = resolveCommandRegistry(plugin);
      const read = (): CanvasUndoReportShape | null =>
        typeof plugin.canvasUndoReport === "function" ? plugin.canvasUndoReport() : null;

      if (registry === null) {
        return {
          ok: false,
          kind,
          reason: "no command registry on this host",
          commandId: null,
          invoked: false,
          report: read(),
        };
      }
      const ids = registry.ids();
      const commandId = ids.find((id) => id === suffix || id.endsWith(`:${suffix}`)) ?? null;
      if (commandId === null) {
        return {
          ok: false,
          kind,
          reason: `no registered command matching '${suffix}' (${ids.length} registered)`,
          commandId: null,
          invoked: false,
          report: read(),
        };
      }

      const before = read();
      const invoked = registry.executeCommandById(commandId);
      const after = read();
      const outcome =
        typeof plugin.canvasUndoLastOutcome === "function" ? plugin.canvasUndoLastOutcome() : null;

      const undoDepthBefore = before?.undoDepth ?? 0;
      const undoDepthAfter = after?.undoDepth ?? 0;
      const redoDepthBefore = before?.redoDepth ?? 0;
      const redoDepthAfter = after?.redoDepth ?? 0;
      const depthBefore = kind === "undo" ? undoDepthBefore : redoDepthBefore;
      const depthAfter = kind === "undo" ? undoDepthAfter : redoDepthAfter;

      return {
        ok: true,
        kind,
        reason: before?.reason ?? null,
        available: before?.available === true,
        commandId,
        invoked,
        path: after?.path ?? before?.path ?? null,
        undoDepthBefore,
        undoDepthAfter,
        redoDepthBefore,
        redoDepthAfter,
        // The measured answer to "was a step actually popped?".
        popped: depthAfter < depthBefore,
        trackedOrigins: before?.trackedOrigins ?? [],
        captureTimeoutMs: before?.captureTimeoutMs ?? 0,
        scope: before?.scope ?? [],
        managers: before?.managers ?? 0,
        // The mechanism's OWN receipt, carrying its own sequence number so a
        // stale reading cannot masquerade as a fresh one. A second, independent
        // witness for the same invocation — if `popped` and `outcome.popped`
        // ever disagree, one of the two is lying and the run can see it.
        outcome,
      };
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
