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
// B71 (`S192`) — THE PAINT PLANE'S TRANSFORM, AND WHY IT IS IMPORTED RATHER THAN
// RE-DERIVED. To turn a card's `getBoundingClientRect()` back into canvas
// coordinates the rig needs the EXACT inverse of the transform Obsidian renders
// with — `(client - wrapperOrigin - halfSize) / scale + viewport`, where `scale`
// is the LINEAR factor (`canvas.scale`, i.e. `2 ** canvas.zoom`) and NOT
// `canvas.zoom` itself. Getting that wrong does not fail loudly: it produces a
// plausible-looking number that is wrong by a factor of the zoom, i.e. a paint
// plane that cries divergence on a board that is fine, which is the exact
// uselessness this package is supposed to avoid.
//
// `clientToCanvasManual` and `viewportScale` are the PRODUCTION definers of that
// arithmetic — the same two functions `canvas-adapter.ts` uses to place the
// presence overlay over a real card, and the ones `__tests__/canvas-adapter.test.ts`
// already covers. Re-deriving them here would make the rig a SECOND definer of
// the plugin's own screen transform: `S158`'s family, and precisely what the
// frozen import allow-list exists to force a decision about rather than prevent.
//
// Cost, stated: `canvas/canvas-adapter.ts` has NO imports of its own (verified —
// zero `import` lines in the file), so this pulls in no package dependency, no
// transport, and no Obsidian type. Both are pure functions over numbers.
//
// The specifier was added to BOTH frozen allow-lists, which must stay in step:
// `wp49/test_tp12_…` and `wp72/test_tp4_…` (ledger entries A-71-1 / A-71-2).
import { clientToCanvasManual, viewportScale } from "../canvas/canvas-adapter";
import { setCanvasBindingInstrument } from "../canvas/canvas-binding";
// B68 §7 AMENDMENT (`S188`, ledger entries A-68-1 / A-68-2). `wouldHaveReverted`
// — the single boolean that settles H1 — needs "does a LOWER-id peer also hold
// this node on this path?", which is `holdersOf`, exported and pure from
// `canvas/canvas-presence.ts:118-130`. The alternative was five lines of
// re-implementation inside the rig, i.e. a SECOND DEFINER of the predicate the
// whole diagnosis turns on; this project has been burned by exactly that class
// (`S158`, and WP87's rule 10). Same shape and same reasoning as WP123's
// A-123-4/A-123-5 for `../files/canvas-sync`: a pure exported function, no new
// package dependency, no new transport, and it REMOVES a duplicate rule rather
// than adding one.
//
// `holdersOf` ONLY. Nothing here modifies `canvas-presence.ts`, which carries a
// whole-file byte + SHA-256 pin (`v2/wp21/test_tp04…:77-78`) — the two sweeps
// this package instruments are intercepted by patching the INSTANCE, so R1 and
// the pin are untouched.
//
// The specifier was added to BOTH frozen allow-lists, which must stay in step:
// `wp49/test_tp12_…:46-59` and `wp72/test_tp4_…:33-46`. (WP123 found that
// WP122's report had missed `wp49` entirely; do not repeat that.)
import { holdersOf } from "../canvas/canvas-presence";
// WP123 — THE ONE PARSER. The records clause of the convergence oracle reads a
// `.canvas` with THE PRODUCTION READER and no other. A rig that parses `.canvas`
// differently from the plugin is `S158`'s family in a new place: it would be
// scoring a board nobody ships. `parseCanvasReport` rather than `parseCanvas`
// because `parseCanvas` DEGRADES TO EMPTY RECORDS AND NEVER THROWS
// (`files/canvas-sync.ts:684`), so "parse both sides, compare records" reads
// EQUAL for two files neither of which could be read — the exact vacuous green
// this clause exists to make impossible. `degraded` is a judgement input here,
// not a footnote. `decodeCanvasDataToFlat` is production's own inverse of the
// register codec, so the `x`/`y`/`width`/`height` this file compares are the
// file's own vocabulary and are not re-expanded by hand.
//
// This specifier was added to the frozen import allow-list under a §7 amendment
// (WP49 AC4 / WP72 AC4). The freeze forbids a dependency arriving WITHOUT
// deliberation; it is not a ban on production imports — `../canvas/canvas-binding`
// below has been on the list since WP49.
import { decodeCanvasDataToFlat, parseCanvasReport } from "../files/canvas-sync";
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
  /** S115 — the HOST's shared root the candidate set was scoped to; `null` on a refusal. */
  scope: string | null;
  /** S116 — the machine-readable rule that produced this answer. */
  rule: string;
  /** S116 — candidates withheld because they pre-date this guest's join. */
  withheldPreExisting: number;
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
 *
 * ⚠ WP123 — DO NOT CONFUSE THIS WITH RECORD AGREEMENT, AND DO NOT "FIX" IT.
 * This is a BYTE test, deliberately, and it is LEFT ALONE: `evaluateCanvasConvergence`
 * is byte-unchanged by WP49's contract and `v2/wp116/…:248` pins it. What it
 * therefore cannot answer is *"do these two peers hold the same BOARD?"* — three
 * stable byte spellings of one identical `.canvas` were measured live on this
 * build at 235 / 296 / 218 bytes, and this function reads `false` for all three
 * pairs. It has been given a RECORD-LEVEL SIBLING rather than a normaliser:
 * {@link evaluateRecordAgreement}, reported as `peersAgreeOnRecords` and `null`
 * whenever nobody stated a records expectation.
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
 * The AGREEMENT verdict over both projections of both instances (AC2 / D17).
 *
 * ⚠ S158 — THIS FUNCTION ANSWERS *"DID THE TWO PEERS END UP THE SAME?"*, WHICH
 * IS NOT THE SAME QUESTION AS *"IS THE STATE RIGHT?"* and never was. It has no
 * reference point outside the peers, so *"everyone has the right bytes"* and
 * *"everyone lost the same bytes"* are the same reading to it. This project
 * supplied its own counter-example: under `S119` all three clients agreed
 * perfectly on `e3b0c442…` — the digest of the empty string — while every `.md`
 * in the share was being truncated to nothing. This function scores that run
 * `converged: true`.
 *
 * IT IS KEPT, NOT DELETED, AND ITS BEHAVIOUR IS BYTE-UNCHANGED. Agreement is a
 * real and separately useful question (*"did this reach B at all?"*), and a rig
 * that can no longer ask a question it used to ask is a regression of a
 * different kind. What changed is that it is no longer the only thing on offer
 * and no longer the thing called "convergence" without qualification:
 *
 *   ├── `evaluateCanvasConvergence` / {@link evaluatePeerAgreement} — ARRIVAL.
 *   │      Peer-to-peer only. `converged` here means AGREED.
 *   └── {@link judgeConvergence} — CORRECTNESS. Judges the agreed bytes against
 *          {@link ExpectedContent}, a reference point recorded OUTSIDE the peers,
 *          and reports `AGREED_ON_WRONG_BYTES` for exactly the `S119` shape.
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

// ---------------------------------------------------------------------------
// S158 — AN ORACLE WITH A REFERENCE POINT OUTSIDE THE PEERS.
//
// Everything below is pure: no clock, no adapter, no doc, no filesystem.
//
// THE DEFECT THIS CLOSES. Every `converged` verdict this rig can produce came
// from comparing peers to each other. An agreement oracle cannot distinguish
// convergence from a SHARED LOSS, because it holds nothing to compare the
// agreed value against. `S119` is the counter-example this project generated
// itself: three clients in perfect agreement on the digest of the empty string
// while every `.md` in the share was destroyed — a textbook pass.
//
// THE FIX IS A SECOND INPUT, NOT A CLEVERER COMPARISON. No amount of care
// applied to the peers' readings can recover information that is not in them.
// `judgeConvergence` therefore takes {@link ExpectedContent}: a statement of
// WHAT THE BYTES ARE SUPPOSED TO BE, plus a mandatory `origin` naming where that
// statement came from. The precedent is in this tree already — WP23's
// `intent-trace` family (`__tests__/harness/fuzz/oracle.ts`) is the same move
// for the headless fuzzer, and its header carries the same sentence:
// AGREEMENT BETWEEN REPLICAS IS NECESSARY BUT NOT SUFFICIENT.
//
// FOUR VERDICTS, AND `CONVERGED` IS THE ONLY GREEN ONE. There is deliberately no
// path to `converged: true` that does not pass an expectation, which is the
// structural half of the repair: the weak reading is not merely discouraged, it
// is unreachable through this function.
//
// S155'S RULE IS OBEYED. `clauses` carries ONE ROW PER CLAUSE IN EVERY BRANCH,
// including the do-nothing one: a clause the caller did not state is reported as
// `stated:false, satisfied:null`, never omitted. A ledger in which "not asked"
// and "asked and passed" look the same is the defect S155 names, and this file
// is the last place to add another.
//
// WP123 / `S178`, CLOSING `S174` — AND A BOARD IS JUDGED BY ITS RECORDS.
//
// Every clause above scores a file on its BYTES. That is right for a `.md` and
// wrong for a `.canvas`: three stable byte spellings of one identical board were
// measured live on this build (235 / 296 / 218 B — the author's, the plugin's
// canonical and Obsidian's own), so a byte clause is RED for boards that are in
// sync and GREEN for boards that are not. `contains` is not an escape either —
// `"x": 111` is not `"x":111`.
//
// So `ExpectedContent` gained ONE more clause, `records`, and it is the only one
// here that reads the file as a document rather than as bytes:
//
//   ├── it parses with THE PRODUCTION PARSER (`parseCanvasReport`), never a
//   │      second `.canvas` reader living in the rig
//   ├── it compares ONLY THE NAMED FIELDS of the NAMED nodes — whole-record
//   │      equality would make an extra or renamed key a divergence, which is
//   │      the byte oracle one level up
//   ├── it REFUSES a board it could not read. `parseCanvas` degrades to empty
//   │      records and never throws, so the naive "parse both sides, compare"
//   │      answers EQUAL for two files neither of which could be read. That is
//   │      the one failure this clause exists to make impossible, and
//   │      {@link readCanvasRecords} branches on `readable` before anything else
//   └── `peersAgree` KEEPS ITS MEANING (bytes) and has been given a sibling,
//          `peersAgreeOnRecords`, which is `null` whenever nobody asked.
// ---------------------------------------------------------------------------

/** sha256 of zero bytes. `S119`'s signature, and a full digest like any other. */
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * The four outcomes. `AGREED_ON_WRONG_BYTES` is the one that did not exist
 * before: the peers are in perfect agreement AND the agreed state is wrong.
 */
export const CONVERGENCE_VERDICT = {
  /** The peers agree AND the agreed bytes satisfy every stated clause. */
  CONVERGED: "converged",
  /** The peers do not agree. Nothing is claimed about which of them is right. */
  DIVERGED: "diverged",
  /** THE `S119` CLASS. Perfect agreement on a state the expectation forbids. */
  AGREED_ON_WRONG_BYTES: "agreed-on-wrong-bytes",
  /**
   * The oracle refuses to answer. Fewer than two peers, no `origin`, or an
   * expectation that states nothing. **This is never green** — a question that
   * could not be asked must not be recorded as a pass.
   */
  UNJUDGEABLE: "unjudgeable",
} as const;

export type ConvergenceVerdict =
  (typeof CONVERGENCE_VERDICT)[keyof typeof CONVERGENCE_VERDICT];

/**
 * WHAT THE BYTES ARE SUPPOSED TO BE — the reference point, and the whole of the
 * repair. Every field is optional EXCEPT `origin`, and an expectation that
 * states no clause at all is `UNJUDGEABLE` rather than satisfied.
 *
 * `origin` is mandatory and must be non-empty because the one way to defeat this
 * oracle is to derive the expectation from a peer, and the cheapest defence
 * against that is to make the caller write down where the expectation came from.
 * It is a discipline, not a proof — see the residual in the WP116 report.
 */
export interface ExpectedContent {
  /**
   * REQUIRED, non-empty. Where this expectation came from, in the caller's own
   * words: the gesture that was issued, the census taken before the round, the
   * fixture that was planted. Never a read of a peer under test.
   */
  origin: string;
  /** Whether the file is supposed to be there at all. */
  exists?: boolean;
  /** The exact digest the bytes are supposed to have. */
  sha256?: string;
  /** Every one of these substrings must appear in the content. */
  contains?: string[];
  /**
   * The file is supposed to hold at least this many bytes. The cheapest clause
   * to record before a round (`stat` the file) and the one that catches a
   * truncation without needing to know the exact bytes.
   */
  atLeastBytes?: number;
  /**
   * WP123 — THE RECORDS THE BOARD IS SUPPOSED TO HOLD. The only clause here that
   * is not about bytes, and the reason it exists: every clause above scores a
   * `.canvas` on its SPELLING, and one board has three stable spellings on this
   * build. A byte clause is therefore RED for boards that are in sync and GREEN
   * for boards that are not (`S174`/`S177`), and `contains` is no escape —
   * `"x": 111` is not `"x":111`.
   */
  records?: ExpectedRecords;
}

/**
 * WP123 — the geometry of ONE named node, in the file's own vocabulary.
 *
 * Every field except `id` is optional and ONLY THE STATED ONES ARE COMPARED.
 * That is deliberate and it is not laziness: whole-record equality would make
 * any extra, renamed or reordered key a divergence, which is the byte oracle one
 * level up. (`recordSignature` above is that shape — it hashes every key of the
 * record — and it is not reused here for exactly this reason.)
 */
export interface ExpectedNodeRecord {
  /** The node id, as it appears in the `.canvas`. Required, non-empty. */
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * WP123 — a statement about the board's RECORDS, judged with the production
 * parser. An expectation naming no node judges nothing and is refused rather
 * than silently satisfied.
 */
export interface ExpectedRecords {
  nodes: ExpectedNodeRecord[];
}

/** The node fields a records expectation may name. Compared only when stated. */
export const RECORD_FIELDS = ["x", "y", "width", "height"] as const;
export type RecordField = (typeof RECORD_FIELDS)[number];

/** One peer's reading, carrying the peer's name so a verdict can name it. */
export interface PeerFileObservation {
  /** Which instance this reading came from — `"a"`, `"b"`, a vault id. */
  peer: string;
  file: CanvasFileResult;
}

/** One clause's outcome. Present in EVERY branch, stated or not (S155). */
export interface ConvergenceClause {
  clause: string;
  /** Did the caller state this clause? `emptiness-must-be-asserted` always did. */
  stated: boolean;
  /** `null` exactly when `stated` is false. */
  satisfied: boolean | null;
  /** Always populated, in every branch. */
  detail: string;
}

export interface ConvergenceJudgement {
  verdict: ConvergenceVerdict;
  /** `true` for `CONVERGED` and for nothing else. */
  converged: boolean;
  /**
   * The peer-to-peer question, kept separate and still answerable (A3). BYTES —
   * see {@link sameFileObservation}. Two peers holding one board in two
   * spellings read `false` here and `true` in `peersAgreeOnRecords`.
   */
  peersAgree: boolean;
  /**
   * WP123 — the same question asked of the RECORDS the expectation named.
   * `null` exactly when no usable records expectation was stated, so "nobody
   * asked" never reads as "asked and agreed" (S155).
   */
  peersAgreeOnRecords: boolean | null;
  /**
   * `null` when the expectation could not be applied at all. Never conflated
   * with `false`.
   */
  matchesExpectation: boolean | null;
  peers: string[];
  /** Where the caller said the expectation came from. Echoed back verbatim. */
  expectationOrigin: string;
  /** One row per clause, always, including the ones nobody stated. */
  clauses: ConvergenceClause[];
  /** The clause names that were stated AND violated. Empty is not a pass. */
  violations: string[];
  /** Always populated, in every branch. */
  reason: string;
}

/**
 * ARRIVAL, kept expressible on purpose (A3). Do the peers hold the same bytes?
 * Says nothing whatsoever about whether those bytes are right.
 */
export function evaluatePeerAgreement(peers: PeerFileObservation[]): {
  agree: boolean;
  peers: string[];
  disagreeing: string[];
} {
  const names = peers.map((p) => p.peer);
  if (peers.length < 2) return { agree: peers.length === 1, peers: names, disagreeing: [] };
  const reference = peers[0];
  const disagreeing = peers
    .slice(1)
    .filter((p) => !sameFileObservation(reference.file, p.file))
    .map((p) => p.peer);
  return { agree: disagreeing.length === 0, peers: names, disagreeing };
}

/** Is this reading an existing file holding zero bytes? */
function isEmptyContent(file: CanvasFileResult): boolean {
  return (
    file.exists === true &&
    (file.size === 0 || file.sha256 === EMPTY_SHA256 || file.content === "")
  );
}

// ---------------------------------------------------------------------------
// WP123 — THE RECORD READING. `S178`, closing `S174`.
//
// THE ONE THING THIS BLOCK MUST NEVER DO is report a match for a board it did
// not read. `parseCanvas` degrades to empty records and does not throw, so the
// naive composition — parse both sides, compare — answers EQUAL for two files
// NEITHER OF WHICH COULD BE READ, and every green built on it is worthless.
// `readCanvasRecords` therefore returns `readable` as its FIRST field and every
// consumer below branches on it before it looks at a record.
//
// THREE WAYS A READING IS NOT A READING, and they are separated because they
// fail for different reasons (WP94's distinction, reused rather than re-derived):
//
//   ├── `content: null`    — nothing came back from the peer at all
//   ├── `degraded: true`   — `JSON.parse` threw; the records are empty because
//   │                         the bytes were unreadable, not because the board is
//   └── `hasNodesKey:false`— well-formed JSON carrying NO `nodes` array. Not
//          degraded, and still not a board: an absent key is indistinguishable,
//          downstream, from a board whose every node was deleted.
// ---------------------------------------------------------------------------

/** One peer's `.canvas`, read with the production parser — or the reason it was not. */
export interface CanvasRecordReading {
  /** FALSE means NOTHING BELOW WAS EXAMINED. Never skip this field. */
  readable: boolean;
  /** Always populated, in every branch — why it is or is not readable. */
  reason: string;
  /** Flat, file-vocabulary node records by id. Empty whenever `readable` is false. */
  nodes: Record<string, Record<string, unknown>>;
  /** The node ids, sorted, so an id-set comparison is order-independent. */
  ids: string[];
}

/**
 * Read one peer's `.canvas` into records, with the production parser and the
 * production decode bridge — never a second parser living in the rig.
 */
export function readCanvasRecords(file: CanvasFileResult): CanvasRecordReading {
  const unreadable = (reason: string): CanvasRecordReading => ({
    readable: false,
    reason,
    nodes: {},
    ids: [],
  });
  const content = file?.content;
  if (typeof content !== "string") {
    return unreadable(
      "no content was read back from this peer, so its records were never examined; " +
        "an absence that could not be read is not an empty board",
    );
  }
  const report = parseCanvasReport(content);
  if (report.degraded) {
    return unreadable(
      "the bytes did not parse as JSON, so `parseCanvas` DEGRADED to empty records rather " +
        "than throwing; the board was not examined and nothing may be concluded from the empty",
    );
  }
  if (!report.hasNodesKey) {
    return unreadable(
      "the bytes parsed but the document carries no `nodes` ARRAY, so an absent key and a " +
        "board whose every node was deleted are the same reading here and neither is judgeable",
    );
  }
  const nodes = decodeCanvasDataToFlat(report.data).nodes;
  const ids = Object.keys(nodes).sort();
  return {
    readable: true,
    reason: `the board parsed and carries ${ids.length} node record(s)`,
    nodes,
    ids,
  };
}

/** A records expectation, validated — or the reason it cannot be applied. */
interface ExpectedRecordsShape {
  ok: boolean;
  reason: string;
  nodes: ExpectedNodeRecord[];
  /** `"n1.x"`, `"n1.y"`, … — exactly what this expectation asked to be compared. */
  fields: string[];
}

/**
 * Validate a caller's records expectation. A MALFORMED EXPECTATION IS A FAILURE,
 * NEVER A SILENT "NOT STATED": a caller who asked a question the oracle could not
 * read must not get the same answer as a caller who asked nothing.
 */
function readExpectedRecords(raw: unknown): ExpectedRecordsShape {
  const bad = (reason: string): ExpectedRecordsShape => ({ ok: false, reason, nodes: [], fields: [] });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return bad("`records` must be an object of the form { nodes: [{ id, x?, y?, width?, height? }] }");
  }
  const rawNodes = (raw as { nodes?: unknown }).nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return bad(
      "`records.nodes` names no node, and an expectation that names nothing judges nothing — " +
        "a satisfied comparison of empty against empty is the failure this clause exists to prevent",
    );
  }
  const nodes: ExpectedNodeRecord[] = [];
  const fields: string[] = [];
  for (let i = 0; i < rawNodes.length; i++) {
    const entry = rawNodes[i];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return bad(`\`records.nodes[${i}]\` is not an object`);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || row.id.length === 0) {
      return bad(`\`records.nodes[${i}]\` has no non-empty string \`id\``);
    }
    const node: ExpectedNodeRecord = { id: row.id };
    let named = 0;
    for (const field of RECORD_FIELDS) {
      const value = row[field];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return bad(`\`records.nodes[${i}].${field}\` is not a finite number`);
      }
      node[field] = value;
      fields.push(`${row.id}.${field}`);
      named++;
    }
    if (named === 0) {
      return bad(
        `\`records.nodes[${i}]\` names node '${row.id}' and no field of it, so it states ` +
          `nothing that could be compared (one of ${RECORD_FIELDS.join(", ")})`,
      );
    }
    nodes.push(node);
  }
  return { ok: true, reason: `${nodes.length} node(s), ${fields.length} named field(s)`, nodes, fields };
}

/**
 * Compare the STATED fields of the STATED nodes against one peer's reading.
 * Returns one human-readable mismatch per field, naming the id AND the field —
 * an id-set comparison passes every geometry defect this project has.
 */
function compareExpectedRecords(
  expectedNodes: readonly ExpectedNodeRecord[],
  observed: Record<string, Record<string, unknown>>,
): string[] {
  const mismatches: string[] = [];
  for (const node of expectedNodes) {
    const record = observed[node.id];
    if (record === undefined) {
      mismatches.push(`node '${node.id}' is ABSENT from the board`);
      continue;
    }
    for (const field of RECORD_FIELDS) {
      const want = node[field];
      if (want === undefined) continue;
      const got = record[field];
      if (got !== want) {
        mismatches.push(`${node.id}.${field}: expected ${want}, observed ${String(got)}`);
      }
    }
  }
  return mismatches;
}

/** The record-level answer to the peer-to-peer question. `peersAgreeOnRecords`. */
export interface RecordAgreement {
  agree: boolean;
  /** Peers that do not hold what the first peer holds, or could not be read. */
  disagreeing: string[];
  /** Always populated — what was compared, or why it could not be. */
  detail: string;
}

/**
 * WP123 — {@link sameFileObservation}'s RECORD-LEVEL SIBLING, and the reason A3
 * is expressible at all: three byte spellings of one board must be ONE verdict.
 *
 * What is compared, and nothing else: the node ID SET, and the FIELDS THE
 * EXPECTATION NAMED. Whole-record equality is not used — an extra or renamed key
 * would then read as divergence, which is the byte oracle one level up.
 *
 * A peer whose reading is NOT READABLE never agrees. Two unreadable peers are the
 * naive composition's vacuous green, and it is refused here rather than reported.
 */
export function evaluateRecordAgreement(
  peers: PeerFileObservation[],
  expectedNodes: readonly ExpectedNodeRecord[],
): RecordAgreement {
  const readings = peers.map((p) => ({ peer: p?.peer ?? "<unnamed>", file: p?.file, read: readCanvasRecords(p?.file) }));
  const unreadable = readings.filter((r) => !r.read.readable);
  if (unreadable.length > 0) {
    return {
      agree: false,
      disagreeing: unreadable.map((r) => r.peer),
      detail:
        `record agreement is NOT CLAIMED: ${unreadable.map((r) => r.peer).join(", ")} could not be ` +
        `read — ${unreadable[0].read.reason}`,
    };
  }
  if (readings.length < 2) {
    return {
      agree: false,
      disagreeing: [],
      detail:
        `record agreement is a statement about two or more peers and ${readings.length} reading(s) ` +
        "were supplied",
    };
  }
  const reference = readings[0];
  const disagreeing: string[] = [];
  const notes: string[] = [];
  for (const other of readings.slice(1)) {
    const differences: string[] = [];
    if (other.read.ids.join("|") !== reference.read.ids.join("|")) {
      differences.push(
        `node id set [${other.read.ids.join(", ")}] != [${reference.read.ids.join(", ")}]`,
      );
    }
    for (const node of expectedNodes) {
      const mine = other.read.nodes[node.id];
      const theirs = reference.read.nodes[node.id];
      for (const field of RECORD_FIELDS) {
        if (node[field] === undefined) continue;
        const a = mine?.[field];
        const b = theirs?.[field];
        if (a !== b) differences.push(`${node.id}.${field}: ${String(a)} != ${String(b)}`);
      }
    }
    if (differences.length > 0) {
      disagreeing.push(other.peer);
      notes.push(`${other.peer} — ${differences.join("; ")}`);
    }
  }
  return {
    agree: disagreeing.length === 0,
    disagreeing,
    detail:
      disagreeing.length === 0
        ? `all ${readings.length} peers hold the same node id set and the same value for every ` +
          "named field, whatever spelling each of them wrote it in"
        : `record divergence against ${reference.peer}: ${notes.join(" | ")}`,
  };
}

/**
 * CORRECTNESS FOR ONE READING, against the external reference point. Exported
 * because arrival and correctness are different questions and a single-peer
 * correctness check is a legitimate one — `judgeConvergence` is this plus
 * agreement, not a different rule.
 *
 * Returns one row per clause in every branch (S155), never a bare boolean.
 */
export function judgeFileAgainstExpectation(
  file: CanvasFileResult,
  expected: ExpectedContent,
): ConvergenceClause[] {
  const clauses: ConvergenceClause[] = [];

  // 1. exists
  if (typeof expected.exists === "boolean") {
    const satisfied = file.exists === expected.exists;
    clauses.push({
      clause: "exists",
      stated: true,
      satisfied,
      detail: `expected exists=${expected.exists}, observed exists=${file.exists}`,
    });
  } else {
    clauses.push({
      clause: "exists",
      stated: false,
      satisfied: null,
      detail: "the expectation says nothing about whether the file should be there",
    });
  }

  // 2. sha256
  if (typeof expected.sha256 === "string" && expected.sha256.length > 0) {
    const satisfied = file.sha256 === expected.sha256;
    clauses.push({
      clause: "sha256",
      stated: true,
      satisfied,
      detail: `expected sha256=${expected.sha256}, observed sha256=${file.sha256 || "<none>"}`,
    });
  } else {
    clauses.push({
      clause: "sha256",
      stated: false,
      satisfied: null,
      detail: "the expectation states no exact digest",
    });
  }

  // 3. contains
  if (Array.isArray(expected.contains) && expected.contains.length > 0) {
    const content = file.content;
    const missing =
      content === null ? [...expected.contains] : expected.contains.filter((m) => !content.includes(m));
    clauses.push({
      clause: "contains",
      stated: true,
      satisfied: missing.length === 0,
      detail:
        content === null
          ? `no content was read back, so all ${expected.contains.length} marker(s) are missing`
          : missing.length === 0
            ? `all ${expected.contains.length} marker(s) present`
            : `missing marker(s): ${missing.join(", ")}`,
    });
  } else {
    clauses.push({
      clause: "contains",
      stated: false,
      satisfied: null,
      detail: "the expectation names no markers that must survive",
    });
  }

  // 4. atLeastBytes
  if (typeof expected.atLeastBytes === "number" && Number.isFinite(expected.atLeastBytes)) {
    const satisfied = file.size >= expected.atLeastBytes;
    clauses.push({
      clause: "atLeastBytes",
      stated: true,
      satisfied,
      detail: `expected at least ${expected.atLeastBytes} byte(s), observed ${file.size}`,
    });
  } else {
    clauses.push({
      clause: "atLeastBytes",
      stated: false,
      satisfied: null,
      detail: "the expectation states no floor on the size",
    });
  }

  // 5. WP123 — THE RECORDS CLAUSE. The only clause here that is not about bytes.
  //
  // Three refusals before a single comparison happens, and each of them is a
  // FAILURE rather than a silence:
  //   ├── the expectation is malformed          → stated, NOT satisfied
  //   ├── the reading could not be examined     → stated, NOT satisfied
  //   └── otherwise compare the NAMED fields    → and say what was compared
  //
  // "Not satisfied" and not "unstated" on purpose: a caller who asked a question
  // this clause could not read must never get the answer of a caller who asked
  // nothing at all (S155).
  const rawRecords = expected.records;
  if (rawRecords === undefined || rawRecords === null) {
    clauses.push({
      clause: "records",
      stated: false,
      satisfied: null,
      detail: "the expectation names no node whose records the board must hold",
    });
  } else {
    const shape = readExpectedRecords(rawRecords);
    if (!shape.ok) {
      clauses.push({
        clause: "records",
        stated: true,
        satisfied: false,
        detail: `the records expectation CANNOT BE APPLIED: ${shape.reason}`,
      });
    } else {
      const read = readCanvasRecords(file);
      if (!read.readable) {
        clauses.push({
          clause: "records",
          stated: true,
          satisfied: false,
          detail:
            `the records were NOT EXAMINED, so ${shape.fields.length} named field(s) are ` +
            `unjudged and none of them is satisfied — ${read.reason}`,
        });
      } else {
        const mismatches = compareExpectedRecords(shape.nodes, read.nodes);
        clauses.push({
          clause: "records",
          stated: true,
          satisfied: mismatches.length === 0,
          detail:
            mismatches.length === 0
              ? `compared ${shape.fields.join(", ")} against the board's ${read.ids.length} ` +
                "record(s) and every named field holds"
              : `record mismatch (compared ${shape.fields.join(", ")}): ${mismatches.join("; ")}`,
        });
      }
    }
  }

  // 6. THE STRUCTURAL CLAUSE — EMPTINESS MUST BE ASSERTED, NEVER INFERRED.
  //
  // This one is ALWAYS stated, because the caller does not get to leave it out.
  // `S119` truncated files to nothing and every peer agreed on the result; a
  // lazy expectation (`exists: true` and nothing else) would have passed that
  // run under clauses 1–4 alone. So an existing file holding zero bytes is a
  // FAILURE unless the expectation says in so many words that it should be
  // empty — `sha256: EMPTY_SHA256`, or `atLeastBytes: 0`.
  //
  // The cost is one explicit clause on the rare legitimately-empty file. The
  // alternative cost is the one this project already paid.
  const emptinessAsserted =
    expected.sha256 === EMPTY_SHA256 || expected.atLeastBytes === 0;
  const observedEmpty = isEmptyContent(file);
  clauses.push({
    clause: "emptiness-must-be-asserted",
    stated: true,
    satisfied: !observedEmpty || emptinessAsserted,
    detail: !observedEmpty
      ? "the file is not empty, so the clause is inert"
      : emptinessAsserted
        ? "the file is empty and the expectation says it should be"
        : "the file exists and holds ZERO BYTES while the expectation never says it should — " +
          "this is the S119 signature, and an emptiness nobody asked for is not convergence",
  });

  return clauses;
}

/**
 * THE ORACLE. Agreement AND correctness, reported separately and never
 * conflated.
 *
 *   ├── fewer than two peers / no `origin` / no clause  → `UNJUDGEABLE`
 *   ├── peers disagree                                  → `DIVERGED`
 *   ├── peers agree, every stated clause satisfied      → `CONVERGED`
 *   └── peers agree, some stated clause violated        → `AGREED_ON_WRONG_BYTES`
 *
 * The `S119` acceptance case lands on the last line: three peers agreeing on
 * `e3b0c442…` for a file that held 49 bytes is a FAILURE here, and was a pass
 * under every oracle this rig had before.
 *
 * WP123 — WHICH AGREEMENT THE FIRST LINE MEANS. "Peers agree" is BYTES unless
 * the caller stated a usable `records` expectation, in which case it is RECORDS:
 * the caller has then said in so many words that this board is to be judged by
 * its records, and one board has three stable spellings on this build. Both
 * facts are always reported — `peersAgree` (bytes) and `peersAgreeOnRecords`
 * (`null` when nobody asked) — and `reason` names the one that decided. No
 * pre-WP123 caller states `records`, so for every one of them the verdict is
 * computed from exactly the value it was computed from before.
 */
export function judgeConvergence(
  peers: PeerFileObservation[],
  expected: ExpectedContent,
): ConvergenceJudgement {
  const observations = Array.isArray(peers) ? peers : [];
  const names = observations.map((p) => p?.peer ?? "<unnamed>");
  const origin =
    expected && typeof expected.origin === "string" ? expected.origin.trim() : "";
  const safeExpectation: ExpectedContent = expected ?? { origin: "" };

  // The clause ledger is computed FIRST and in every branch, so an unjudgeable
  // or diverged run still shows what was asked. S155: no silent branch.
  const reference = observations[0]?.file;
  const clauses = reference
    ? judgeFileAgainstExpectation(reference, safeExpectation)
    : [
        "exists",
        "sha256",
        "contains",
        "atLeastBytes",
        // WP123 — the records row is in the DO-NOTHING branch too. A branch that
        // does nothing must not read the same as a branch that never ran (S155).
        "records",
        "emptiness-must-be-asserted",
      ].map((clause) => ({
        clause,
        stated: false,
        satisfied: null,
        detail: "no peer reading was supplied, so nothing could be judged",
      }));

  const agreement = evaluatePeerAgreement(observations);
  const violations = clauses.filter((c) => c.satisfied === false).map((c) => c.clause);
  const statedClauses = clauses.filter((c) => c.stated && c.clause !== "emptiness-must-be-asserted");

  // WP123 — THE RECORD-LEVEL AGREEMENT, AND THE ONE THING IT CHANGES.
  //
  // `peersAgree` stays BYTES and keeps its meaning exactly. What changes is
  // WHICH agreement the VERDICT is computed from, and only when the caller
  // states a usable records expectation: they have then said in so many words
  // that this board is to be judged by its records, and `S174`/`S177` measured
  // three stable byte spellings of one identical board on this build — scoring
  // that round on bytes is RED for a board that is in sync. No pre-WP123 caller
  // states `records`, so `recordAgreement` is `null` for every one of them and
  // the verdict is computed from exactly the value it was computed from before.
  const recordShape =
    safeExpectation.records === undefined || safeExpectation.records === null
      ? null
      : readExpectedRecords(safeExpectation.records);
  const recordAgreement =
    recordShape?.ok === true ? evaluateRecordAgreement(observations, recordShape.nodes) : null;
  const peersAgreeOnRecords = recordAgreement === null ? null : recordAgreement.agree;
  const agreeForVerdict = recordAgreement === null ? agreement.agree : recordAgreement.agree;
  const disagreementReason =
    recordAgreement === null
      ? `peer(s) ${agreement.disagreeing.join(", ")} do not hold what ${names[0]} holds; ` +
        "no claim is made here about which of them is right"
      : `the peers do not hold the same RECORDS — ${recordAgreement.detail}. (Byte agreement, ` +
        `reported separately, is ${agreement.agree}: one board has several spellings and neither ` +
        "reading substitutes for the other)";

  const unjudgeable = (reason: string): ConvergenceJudgement => ({
    verdict: CONVERGENCE_VERDICT.UNJUDGEABLE,
    converged: false,
    peersAgree: agreement.agree,
    peersAgreeOnRecords,
    matchesExpectation: null,
    peers: names,
    expectationOrigin: origin,
    clauses,
    violations,
    reason,
  });

  if (observations.length < 2) {
    return unjudgeable(
      `convergence is a statement about two or more peers and ${observations.length} reading(s) ` +
        "were supplied; use judgeFileAgainstExpectation for a single peer's correctness",
    );
  }
  if (origin.length === 0) {
    return unjudgeable(
      "the expectation states no origin; an oracle whose reference point has no stated " +
        "provenance cannot be told apart from one that read its expectation back off a peer",
    );
  }
  if (statedClauses.length === 0) {
    return unjudgeable(
      "the expectation states no clause about the bytes, so there is nothing outside the peers " +
        "to compare them against — which is precisely the oracle S158 names",
    );
  }

  if (!agreeForVerdict) {
    return {
      verdict: CONVERGENCE_VERDICT.DIVERGED,
      converged: false,
      peersAgree: agreement.agree,
      peersAgreeOnRecords,
      matchesExpectation: violations.length === 0,
      peers: names,
      expectationOrigin: origin,
      clauses,
      violations,
      reason: disagreementReason,
    };
  }

  const agreedOn = recordAgreement === null ? "bytes" : "records";

  if (violations.length > 0) {
    return {
      verdict: CONVERGENCE_VERDICT.AGREED_ON_WRONG_BYTES,
      converged: false,
      peersAgree: agreement.agree,
      peersAgreeOnRecords,
      matchesExpectation: false,
      peers: names,
      expectationOrigin: origin,
      clauses,
      violations,
      reason:
        `all ${names.length} peers agree on the ${agreedOn}, and the agreed state violates ` +
        `${violations.join(", ")} against the expectation stated by '${origin}'. Agreement is ` +
        "evidence of agreement, not correctness: everyone having the right bytes and everyone " +
        "having lost the same bytes read identically to a peer-to-peer oracle",
    };
  }

  return {
    verdict: CONVERGENCE_VERDICT.CONVERGED,
    converged: true,
    peersAgree: agreement.agree,
    peersAgreeOnRecords,
    matchesExpectation: true,
    peers: names,
    expectationOrigin: origin,
    clauses,
    violations,
    reason:
      `all ${names.length} peers agree on the ${agreedOn}, and the agreed state satisfies every ` +
      `clause of the expectation stated by '${origin}'`,
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
  /**
   * B68 (`S188`) — the canvas-disjoint diagnostic: the three-plane census, the
   * ledgers and the unattributed delta, behind ONE command with an `op`
   * argument. Optional on the interface for the same reason as every capability
   * above, so every hand-rolled fake host in the existing tests stays valid and
   * `routeCommand` turns an absent method into a structured 400.
   */
  canvasDiag?(req: { op: string; path?: string; label?: string }): Promise<unknown>;
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
  /** S120 AC2 — mute-dropped user gestures, by kind. */
  muteDrops?(): unknown;
  /** S124 — refused escaping renames. */
  escapingRenameRefusals?(): unknown;
  /** S119 AC5 — refused empty writes, by arm. */
  emptyWriteRefusals?(): unknown;
  /** S125 AC10 — conflict copies written, by arm. */
  conflictCopies?(): unknown;
  /** S141 — the PUBLISH floor's ledger: what this peer refused to SAY about a file. */
  attestationDecisions?(): unknown;
  /** S142 — writes declined because the editor owns that file's disk copy. */
  singleWriterDeclines?(): unknown;
  /**
   * S143/S144/S157 — the give-up ledger over `subscribe()`, `syncFromManifest()`
   * and `ensureFolder()`. Every branch counted, successes included.
   */
  pathOutcomes?(): unknown;
  /** S143 — the CURRENT paths a re-arm would re-drive, and why each was abandoned. */
  abandonedSubscribes?(): unknown;
  /** S123 AC5 — the last canvas mirror pass's per-path verdicts. */
  canvasMirror?(): unknown;
  /** S129 AC5 — paths this peer refused to bind to an unproven-empty document. */
  collabBindRefusals?(): unknown;
  /** S134 AC3 — binds that FAILED, as distinct from binds this peer refused. */
  collabBindFailures?(): unknown;
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
      // --- S158 — the convergence oracle, over the SAME envelope -------------
      //
      // PURE, AND IT TOUCHES NO HOST METHOD AT ALL: the readings arrive in the
      // request. That is deliberate. The live rounds are driven from Python, and
      // the alternative — a second implementation of the rule on the driver side
      // — is how a rig ends up with two oracles that disagree. One rule, one
      // implementation, pinned by the unit tests in `v2/wp116/`, reachable by
      // whatever drives the round.
      //
      // It reads nothing and writes nothing, so it is safe on any host,
      // including the hand-rolled fakes: there is no `host.` call below.
      case "convergence.judge": {
        const rawPeers = args.peers;
        if (!Array.isArray(rawPeers)) {
          throw new Error("invalid arg: 'peers' must be an array of {peer, file} readings");
        }
        const rawExpected = args.expected;
        if (rawExpected === null || typeof rawExpected !== "object" || Array.isArray(rawExpected)) {
          throw new Error("invalid arg: 'expected' must be an object with at least an 'origin'");
        }
        const peers: PeerFileObservation[] = rawPeers.map((entry, i) => {
          if (entry === null || typeof entry !== "object") {
            throw new Error(`invalid arg: peers[${i}] must be an object`);
          }
          const row = entry as { peer?: unknown; file?: unknown };
          const file = row.file;
          if (file === null || typeof file !== "object") {
            throw new Error(`invalid arg: peers[${i}].file must be a canvas.file reading`);
          }
          const f = file as Partial<CanvasFileResult>;
          return {
            peer: typeof row.peer === "string" && row.peer.length > 0 ? row.peer : `#${i}`,
            file: {
              exists: f.exists === true,
              sha256: typeof f.sha256 === "string" ? f.sha256 : "",
              size: typeof f.size === "number" ? f.size : 0,
              content: typeof f.content === "string" ? f.content : null,
            },
          };
        });
        return ok(judgeConvergence(peers, rawExpected as ExpectedContent));
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
      // S120 AC2 — user gestures the mute swallowed, by kind.
      case "fileop.muteDrops": {
        if (typeof host.muteDrops !== "function") {
          throw new Error("fileop.muteDrops unavailable on this host");
        }
        return ok(host.muteDrops());
      }
      // S124 — remote renames refused for leaving the shared tree.
      case "fileop.escapingRenames": {
        if (typeof host.escapingRenameRefusals !== "function") {
          throw new Error("fileop.escapingRenames unavailable on this host");
        }
        return ok(host.escapingRenameRefusals());
      }
      case "fileop.protectedRefusals": {
        if (typeof host.protectedPathRefusals !== "function") {
          throw new Error("fileop.protectedRefusals unavailable on this host");
        }
        return ok(host.protectedPathRefusals());
      }
      // S119 AC5 — refused empty writes. Same shape and same reason as the
      // protected-path ledger beside it: a refusal leaves no other trace.
      // S129 AC5 — notes this peer refused to bind because the shared document
      // had not arrived. Invisible otherwise: the buffer is simply unchanged.
      case "collab.bindRefusals": {
        if (typeof host.collabBindRefusals !== "function") {
          throw new Error("collab.bindRefusals unavailable on this host");
        }
        return ok(host.collabBindRefusals());
      }
      // S134 AC3 — a bind that FAILED (waitForSync rejected), as distinct from
      // one this peer refused. Read-only, additive, and the only thing that
      // makes "the editor is not bound to this note" observable at all.
      case "collab.bindFailures": {
        if (typeof host.collabBindFailures !== "function") {
          throw new Error("collab.bindFailures unavailable on this host");
        }
        return ok(host.collabBindFailures());
      }
      // S123 AC5 — WHY a canvas did or did not materialise on THIS peer, per
      // path. The report already existed and was discarded at the call site;
      // W4 spent two rounds unable to see past "timed out at 45 s".
      case "canvas.mirror": {
        if (typeof host.canvasMirror !== "function") {
          throw new Error("canvas.mirror unavailable on this host");
        }
        return ok(host.canvasMirror());
      }
      // S125 AC10 — local versions preserved before a host overwrite.
      case "sync.conflictCopies": {
        if (typeof host.conflictCopies !== "function") {
          throw new Error("sync.conflictCopies unavailable on this host");
        }
        return ok(host.conflictCopies());
      }
      case "sync.emptyWriteRefusals": {
        if (typeof host.emptyWriteRefusals !== "function") {
          throw new Error("sync.emptyWriteRefusals unavailable on this host");
        }
        return ok(host.emptyWriteRefusals());
      }
      // S141 — what this peer refused to PUBLISH, as distinct from what it
      // refused to write. The empty-write floor above protects this peer's own
      // disk; this one protects everybody else's.
      case "sync.attestationDecisions": {
        if (typeof host.attestationDecisions !== "function") {
          throw new Error("sync.attestationDecisions unavailable on this host");
        }
        return ok(host.attestationDecisions());
      }
      // S142 — writes declined because the editor owns that file's disk copy.
      case "sync.singleWriterDeclines": {
        if (typeof host.singleWriterDeclines !== "function") {
          throw new Error("sync.singleWriterDeclines unavailable on this host");
        }
        return ok(host.singleWriterDeclines());
      }
      // S143/S144/S157 — the three arms that fail by SURVIVING. Every branch
      // increments, so a zero cell means "this arm did not run for that path"
      // and never "it ran and declined" (`S155`).
      case "sync.pathOutcomes": {
        if (typeof host.pathOutcomes !== "function") {
          throw new Error("sync.pathOutcomes unavailable on this host");
        }
        return ok(host.pathOutcomes());
      }
      case "sync.abandonedSubscribes": {
        if (typeof host.abandonedSubscribes !== "function") {
          throw new Error("sync.abandonedSubscribes unavailable on this host");
        }
        return ok(host.abandonedSubscribes());
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
      // --- B68 (`S188`) — THE CANVAS-DISJOINT DIAGNOSTIC, ADDITIVE -----------
      //
      // ONE case and one optional host method, on the `canvas.editingSignal` /
      // `canvas.undo` precedent. No command above changes shape or behaviour and
      // `canvas.simulateEdit` is neither extended, repaired nor called.
      //
      // The `op` argument is what keeps this ONE command rather than eight:
      // `census` / `arm` / `mark` / `dump` / `awareness` / `clear`. Unknown ops
      // are refused HERE-adjacent (in the host, which owns the vocabulary) as a
      // structured 400, never silently treated as a no-op.
      case "canvas.diag": {
        if (typeof host.canvasDiag !== "function") {
          throw new Error("canvas.diag unavailable on this host");
        }
        return ok(
          await host.canvasDiag({
            op: requireString(args, "op"),
            path: args.path === undefined ? undefined : requireString(args, "path"),
            label: args.label === undefined ? undefined : requireString(args, "label"),
          }),
        );
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
    /**
     * S115 — the HOST's shared root, as this peer resolved it. Optional so the
     * hand-rolled fakes in the existing tests stay structurally valid.
     */
    getHostSharedScope?():
      | { known: true; root: string }
      | { known: false; root: null; reason: string };
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
  /** S119 AC5 — the empty-write refusal ledger. Optional, like every capability here. */
  getEmptyWriteRefusals?: () => { total: number; byArm: Record<string, number> };
  /** S125 AC10 / S148 — the conflict-copy ledger, `discarded` included. */
  getConflictCopies?: () => {
    total: number;
    byArm: Record<string, number>;
    failed: number;
    discarded: number;
  };
  /**
   * S141 — the attestation ledger. Every branch counted, both publishing ones
   * included, so a zero can never be read as "the floor was never reached".
   */
  getAttestationDecisions?: () => {
    total: number;
    publishedNotEmpty: number;
    publishedVerifiedEmpty: number;
    refusedContradicted: number;
    refusedUnverifiable: number;
  };
  /** S142 — the single-writer decline ledger, by `subscribe()` arm. */
  getSingleWriterDeclines?: () => { total: number; byArm: Record<string, number> };
  /**
   * S143/S144/S157 — the give-up ledger. Three arms that fail by SURVIVING:
   * `subscribe()`, `syncFromManifest()` and `ensureFolder()`. Every branch
   * increments, successes included, so a zero cell means "did not run".
   */
  getPathOutcomes?: () => {
    total: number;
    byArm: Record<string, number>;
    byDisposition: Record<string, number>;
  };
  /** S143 — the CURRENT set of paths a re-arm would re-drive, and why each was abandoned. */
  getAbandonedSubscribes?: () => Record<string, string>;
  /** S123 AC5 — the last canvas mirror report, or null if no pass has run. */
  getLastCanvasMirrorReport?: () => unknown;
  /** S129 AC5 — the collab bind refusal ledger. */
  getCollabBindRefusals?: () => { total: number; paths: string[] };
  getCollabBindFailures?: () => { total: number; paths: string[] };
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
    /** S120 AC2 — mute-dropped user gestures, by kind. */
    getMuteDrops?(): { total: number; byKind: Record<string, number> };
    /** S124 — remote renames refused for leaving the shared tree. */
    getEscapingRenameRefusals?(): number;
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
   * B68 (`S188`) — the canvas-disjoint diagnostic's ONE accessor onto the live
   * surfaces. Optional so every hand-rolled fake plugin in the existing tests
   * stays structurally valid, and so a bundle built from a tree that predates
   * this package answers `view: unavailable` with a stated reason instead of
   * crashing (§4.2: the ABSENCE is a reading).
   *
   * `adapter` and `presence` are held as `unknown` for exactly the reason
   * `app.workspace` and `controlChannel` above are: their real types live in
   * `../canvas/*`, which is not on this module's frozen import allow-list. Both
   * are narrowed through one guarded resolver (`narrowDiagAdapter`) and every
   * access is validated. The narrowed adapter view deliberately declares
   * NEITHER `isBusy` NOR `getEditingNodeId`, so no instrument in this file can
   * reach the two members whose reading fires WP37's blur drain.
   */
  canvasDiagTargets?: (
    rawPath?: string,
  ) => Array<{ path: string; adapter: unknown; presence: unknown }>;
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
    /**
     * B68 — `awareness` is declared OPTIONAL beside the doc. The real
     * `DocHandle` (`sync/sync.ts:96-100`) has carried it all along; this module
     * simply never asked. Optional, so every hand-rolled `canvasSync` double in
     * the existing suite that returns a bare `{ doc }` stays structurally
     * valid, and the diagnostic reports `awareness: "unavailable"` rather than
     * throwing when it is absent (R7 — an empty reading and a missing
     * instrument must never look alike).
     */
    getCanvasDocHandle(path: string): {
      doc: Y.Doc;
      awareness?: {
        clientID: number;
        getStates(): Map<number, Record<string, unknown>>;
      };
    } | null;
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

// ===========================================================================
// B68 (`S188`) — THE CANVAS-DISJOINT DIAGNOSTIC.
//
// The owner's symptom: "each click I do on client 1 moves the nodes on client 2
// around … it is already disjointed after the first real click", and the error
// GROWS per click. Nothing in the product could answer "who moved this node".
// This is that instrument, built to `DIAGNOSTIC_SPEC_CanvasDisjoint.md`.
//
// ONE MECHANISM, and it is deliberately not a framework:
//
//   ┌── VIEW  ← Obsidian's live canvas   (adapter.getNodeGeometry)
//   ├── DOC   ← the shared Y.Doc          (canvasSync.getCanvasSnapshot)
//   └── FILE  ← the .canvas on disk       (parseCanvasReport → decodeCanvasDataToFlat)
//
// Everything here is either a CENSUS (all three planes for all nodes, taken on
// `arm` / `dump` / `census`) or a LEDGER ROW (one mutation with its cause,
// appended to a single ring buffer). Exposure is one command, `canvas.diag`,
// with an `op` argument.
//
// THE RULES THIS BLOCK IS HELD TO, all measured rather than stylistic:
//
//   R1 `canvas/canvas-presence.ts` is byte + SHA-256 pinned
//      (`v2/wp21/test_tp04…:77-78`). NOTHING here edits it. The two sweeps this
//      package needs are called as `this.x()` from that file's own awareness
//      listener, and `this.`-dispatch resolves an own property before the
//      prototype — so patching the INSTANCE intercepts both with zero
//      production-source change.
//   R2 `isBusy()` and `getEditingNodeId()` are NEVER called from here. Both run
//      the staleness sweep and can fire WP37's blur drain, i.e. the instrument
//      would cause the thing it measures. `narrowDiagAdapter` does not even
//      DECLARE them, so this is structural rather than remembered.
//   R3 No instrument writes any canvas surface: no `setData`, no
//      `moveAndResize`, no vault write, no `doc.transact`, no
//      `awareness.setLocalState`. (`v2/wp87/test_tp01_surface_route_census`
//      derives the sink set from the tree and enforces this for free.)
//   R5 A canvas is never scored on bytes. Records, always. Bytes appear as a
//      `label` beside the file plane and never as a verdict.
//   R6 Every counter increments on every branch, do-nothing included: a sweep
//      that DECLINED must be distinguishable from one that never ran (`S155`).
//   R7 If a dump can be lost, the dump says so (`S186`): ring eviction count,
//      armed/not-armed, per-plane availability with a stated reason, and the
//      patched-vs-mounted path gap are all surfaced. An empty reading and a
//      missing instrument never look alike.
//
// EVERY HOOK PROBES BEFORE IT PATCHES (§4.2). `expireIdleInferredLocks` and the
// private `lockMeta` map do not exist on a pre-WP120 bundle; their absence is
// recorded as `present: false` / `"unreadable"` and is itself the reading that
// proves which build a peer is on.
// ===========================================================================

/**
 * Bumped when a dump's SHAPE changes. Its absence means "no diag on this peer".
 *
 * `2` — B71 (`S192`) added the fourth plane, `paint`. A dump with
 * `diagProto: 1` has three planes and CANNOT answer a paint question; the
 * driver must say so rather than render three planes as if that were the whole
 * reading.
 */
const CANVAS_DIAG_PROTO = 3;

/** Per-plane node cap. The owner's board is 11; 500 is the honesty ceiling (R7). */
const CANVAS_DIAG_MAX_NODES = 500;

interface DiagGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One plane of one census. `available: false` ALWAYS carries a `reason` — a
 * plane that could not be read must never render as an empty board (R7).
 */
interface DiagPlaneCensus {
  available: boolean;
  reason: string;
  count: number;
  truncated: boolean;
  nodes: Record<string, DiagGeometry>;
  /** File plane only: `parseCanvasReport`'s own degraded verdict. `null` elsewhere. */
  degraded: boolean | null;
  /** File plane only: size + sha256 as a LABEL beside the records, never a verdict (R5). */
  label: Record<string, unknown> | null;
}

interface DiagCensus {
  path: string;
  at: number;
  /**
   * B71 (`S192`) — THE PAINT PLANE, and the reason it exists.
   *
   * `view`, `doc` and `file` are three readings of ONE MODEL: `view` is
   * `canvas.nodes.get(id).x/.y`, `doc` is the same record in the Y.Doc, `file`
   * is the same record on disk. They agree with each other by construction
   * whenever the sync is working — which is exactly what B70's drag measured,
   * on eleven nodes and three peers, WHILE THE OWNER'S SCREEN WAS DISJOINT.
   *
   * `paint` is the pixels: the node's own DOM element. It is the only plane in
   * this census that can disagree with the other three, and therefore the only
   * one that can see the symptom the owner is actually reporting.
   */
  paint: DiagPlaneCensus;
  view: DiagPlaneCensus;
  doc: DiagPlaneCensus;
  file: DiagPlaneCensus;
  /**
   * B72 (WP3) — the repaint sweep's own counters, so a reader can tell a board
   * that was never damaged from a board the sweep quietly repaired. `available:
   * false` with a stated reason whenever the peer's bundle has no sweep — the
   * one thing this must never do is report zero repairs because it could not
   * ask.
   */
  repaint: DiagRepaintReport;
}

/** B72 — the sweep's counters, or the reason there are none. Never a zero for "unknown". */
interface DiagRepaintReport {
  available: boolean;
  reason: string;
  counters: Record<string, unknown> | null;
}

function diagPlaneUnavailable(reason: string): DiagPlaneCensus {
  return {
    available: false,
    reason,
    count: 0,
    truncated: false,
    nodes: {},
    degraded: null,
    label: null,
  };
}

function diagErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The four geometry numbers of a record, or `null` when the record cannot carry them. */
function diagGeometryOf(record: unknown): DiagGeometry | null {
  if (record === null || typeof record !== "object") return null;
  const r = record as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  if (
    typeof r.x !== "number" ||
    typeof r.y !== "number" ||
    typeof r.width !== "number" ||
    typeof r.height !== "number"
  ) {
    return null;
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * Assemble a plane from an id→record iteration, capped and honest about it.
 * `read` returns `null` for a record that carries no usable geometry; the id is
 * then simply absent, which the cross-peer table renders as a blank cell.
 */
function diagPlaneFrom(
  ids: string[],
  read: (id: string) => DiagGeometry | null,
): DiagPlaneCensus {
  const sorted = [...ids].sort();
  const truncated = sorted.length > CANVAS_DIAG_MAX_NODES;
  const nodes: Record<string, DiagGeometry> = {};
  for (const id of sorted.slice(0, CANVAS_DIAG_MAX_NODES)) {
    const geo = read(id);
    if (geo) nodes[id] = geo;
  }
  return {
    available: true,
    reason: "",
    count: sorted.length,
    truncated,
    nodes,
    degraded: null,
    label: null,
  };
}

/**
 * The READ-ONLY view of `CanvasAdapter` this diagnostic is allowed to hold.
 *
 * `isBusy` and `getEditingNodeId` are ABSENT BY CONSTRUCTION (R2) — not omitted
 * by convention. Everything declared here is a pure member read or a
 * subscriber registration:
 *   ├── `isAvailable()`     — `canvas-adapter.ts:925`, three `typeof` tests
 *   ├── `getLiveNodeIds()`  — `:989`, iterates `canvas.nodes.keys()`
 *   ├── `getNodeGeometry()` — `:1001`, four property reads
 *   ├── `getViewport()`     — `:949`, reads `canvas.x/y/zoom`
 *   ├── `getNodeEl()`       — `:984`, ONE property read (`node.nodeEl`). B71.
 *   ├── `getOverlayHost()`  — `:946`, `canvas.wrapperEl ?? canvas.canvasEl`. B71.
 *   └── `onViewportChange()`— `:1209`, adds a callback to an existing set
 * The two sinks are declared only so they can be WRAPPED; nothing in this file
 * calls either of them directly.
 *
 * B71 — `getNodeEl` and `getOverlayHost` are both OPTIONAL here on purpose. A
 * peer running an older bundle simply does not have them, and the paint plane
 * must then say *which member was missing*, never render an empty board.
 */
interface DiagAdapterLike {
  isAvailable(): boolean;
  getLiveNodeIds(): Set<string>;
  getNodeGeometry(nodeId: string): DiagGeometry | null;
  getViewport?(): { x: number; y: number; zoom: number; scale?: number } | null;
  /** B71 — the card's DOM element. A pure `node.nodeEl` read; writes nothing. */
  getNodeEl?(nodeId: string): unknown | null;
  /** B71 — `canvas.wrapperEl`, the fixed screen-space container. Pure read. */
  getOverlayHost?(): unknown | null;
  /**
   * B72 (WP3) — the repaint sweep's counters. READ-ONLY BY CONSTRUCTION: the
   * narrow `DiagAdapterLike` view names `describeRepaintSweep` and does NOT name
   * `sweepRepaint` or `repaintNode`, so an instrument cannot drive the sweep it
   * is measuring even by mistake (the same R2 argument that keeps `isBusy` off
   * this interface). Optional, so a peer on an older bundle says the plane is
   * absent rather than reading nothing.
   */
  describeRepaintSweep?(): Record<string, unknown>;
  onViewportChange?(cb: () => void): () => void;
}

interface DiagTarget {
  path: string;
  adapter: DiagAdapterLike | null;
  /**
   * The same adapter object as an indexable record. This is the ONLY handle the
   * patch installer writes through, and it is separate from `adapter` on
   * purpose: the narrow view is what instruments READ with, and it cannot name
   * the two sinks at all, so an instrument cannot call one by accident.
   */
  adapterRaw: Record<string, unknown> | null;
  /** The `CanvasPresence` instance, held opaque; narrowed at each patch site. */
  presence: Record<string, unknown> | null;
  /** Why the adapter could not be narrowed, when it could not be. */
  adapterReason: string;
}

/**
 * Patch ONE method on ONE live instance, and hand back the undo.
 *
 * This is the shape the production adapter already uses to own Obsidian's
 * private canvas (`canvas-adapter.ts:828-842`): keep the original in a closure,
 * install a wrapper as an OWN property, restore on teardown. `this.`-dispatch
 * resolves an own property before the prototype, so this intercepts a class
 * method — `CanvasPresence.reconcileClaims`, called as `this.reconcileClaims()`
 * from that file's own awareness listener — WITHOUT touching the byte-pinned
 * source (R1).
 *
 * PROBE BEFORE PATCH (§4.2): a member that is not a function on this build
 * yields `null`, and the caller records that absence as a reading rather than
 * crashing on it. `expireIdleInferredLocks` genuinely does not exist pre-WP120,
 * and its absence is how a dump proves which bundle it is on.
 *
 * The undo refuses to act if somebody re-patched on top of us — clobbering a
 * later wrapper would be worse than leaving ours in place.
 */
function diagPatch(
  host: Record<string, unknown>,
  name: string,
  make: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
): (() => void) | null {
  const existing = host[name];
  if (typeof existing !== "function") return null;
  const original = existing as (...args: unknown[]) => unknown;
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(host, name);
  const wrapper = make(original);
  host[name] = wrapper;
  return () => {
    if (host[name] !== wrapper) return;
    if (hadOwnProperty) host[name] = original;
    else delete host[name];
  };
}

/** Narrow an opaque adapter to the read-only view above, or refuse. Never guesses. */
function narrowDiagAdapter(value: unknown): DiagAdapterLike | null {
  if (value === null || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (typeof c.isAvailable !== "function") return null;
  if (typeof c.getLiveNodeIds !== "function") return null;
  if (typeof c.getNodeGeometry !== "function") return null;
  return value as DiagAdapterLike;
}

/**
 * The mounted boards this peer can be asked about. An empty array, on a plugin
 * that HAS the accessor, means "no canvas view is mounted" — a different fact
 * than "this build has no accessor", and the two are reported separately.
 *
 * (That sentence is deliberately not phrased with the two states quoted either
 * side of the word that precedes a module specifier: the WP49/WP72 import
 * allow-list census is a REGEX over this file's text, not a parse of its AST,
 * so an ordinary English sentence of that shape is read as an import and reds
 * two work packages. Measured, not guessed — it did.)
 */
function resolveDiagTargetsResult(
  plugin: E2EPluginLike,
  rawPath?: string,
): { targets: DiagTarget[]; accessorError: string | null } {
  if (typeof plugin.canvasDiagTargets !== "function") {
    return { targets: [], accessorError: null };
  }
  let raw: unknown;
  try {
    // ── B70 (`S190`) — THE INVOCATION IS THE WHOLE BUG, AND IT IS A RECEIVER ──
    //
    // This used to read `const accessor = plugin.canvasDiagTargets;` followed by
    // `accessor(rawPath)`. `canvasDiagTargets` is a PROTOTYPE METHOD on
    // `LiveSharePlugin` (`main.ts:3659`) whose body is nothing but
    // `this.canvasAdapters` / `this.canvasPresences`. Detaching it drops the
    // receiver; the bundle esbuild ships is `"use strict"`, so `this` is
    // `undefined` and the first line of the loop threw
    // `TypeError: Cannot read properties of undefined (reading 'canvasAdapters')`
    // on EVERY call. The bare `catch` below then returned `[]`, and the VIEW
    // plane rendered that as "no canvas view is mounted" — for three peers with
    // eleven live nodes each. MEASURED, not reasoned: at one instant,
    // `canvas.editingSignal` (which calls `plugin.canvasEditingSignal(path)` in
    // METHOD form, `:5113`) reported `hasAdapter: true` and eleven
    // `liveNodeIds`, while `canvas.diag` reported `mountedPaths: []`. Same map,
    // same process, same millisecond — only the call shape differed.
    //
    // The call is now method-form, which is the shape every other accessor in
    // this file already uses (`plugin.canvasEditingSignal(path)`,
    // `plugin.canvasUndoReport()`, `cs.getCanvasSnapshot(path)`). It is not
    // `.bind()` and not `.call()` on purpose: keeping a detached handle around
    // is what made the defect possible, so the handle is gone rather than
    // repaired.
    raw = plugin.canvasDiagTargets(rawPath);
  } catch (err) {
    // R7 — the OTHER half of this defect. A throw and an unmounted board are
    // different facts and must never render alike; the old bare `catch` erased
    // that distinction and is why a one-line receiver bug survived a whole
    // measurement session looking like an honest "nothing is open".
    return { targets: [], accessorError: `canvasDiagTargets threw: ${diagErrorText(err)}` };
  }
  if (!Array.isArray(raw)) {
    return {
      targets: [],
      accessorError: `canvasDiagTargets returned ${raw === null ? "null" : typeof raw}, not an array`,
    };
  }
  const out: DiagTarget[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as { path?: unknown; adapter?: unknown; presence?: unknown };
    if (typeof row.path !== "string" || row.path.length === 0) continue;
    const adapter = narrowDiagAdapter(row.adapter);
    out.push({
      path: row.path,
      adapter,
      adapterRaw:
        row.adapter !== null && typeof row.adapter === "object"
          ? (row.adapter as Record<string, unknown>)
          : null,
      presence:
        row.presence !== null && typeof row.presence === "object"
          ? (row.presence as Record<string, unknown>)
          : null,
      adapterReason:
        adapter === null
          ? "the mounted target exposes no adapter with isAvailable/getLiveNodeIds/getNodeGeometry"
          : "",
    });
  }
  return { targets: out, accessorError: null };
}

/**
 * The mounted-board list alone, for the call sites that have no way to render a
 * refusal. Every site that CAN report one uses `resolveDiagTargetsResult`.
 */
function resolveDiagTargets(plugin: E2EPluginLike, rawPath?: string): DiagTarget[] {
  return resolveDiagTargetsResult(plugin, rawPath).targets;
}

/**
 * I1 — the VIEW plane. Three pure reads and nothing else: no method that
 * sweeps (R2), no transaction, no awareness write, no disk write.
 */
function diagViewCensus(plugin: E2EPluginLike, path: string): DiagPlaneCensus {
  if (typeof plugin.canvasDiagTargets !== "function") {
    return diagPlaneUnavailable(
      "this build exposes no canvasDiagTargets accessor (pre-B68 bundle)",
    );
  }
  const { targets, accessorError } = resolveDiagTargetsResult(plugin, path);
  // B70 — the refusal is reported as the refusal it is. An accessor that FAILED
  // and a peer with no board open are the two facts R7 exists to keep apart,
  // and until this line existed the first one wore the second one's words.
  if (accessorError !== null) return diagPlaneUnavailable(accessorError);
  if (targets.length === 0) {
    return diagPlaneUnavailable("no canvas view is mounted for this path on this peer");
  }
  const target = targets[0];
  if (!target.adapter) return diagPlaneUnavailable(target.adapterReason);
  try {
    if (target.adapter.isAvailable() !== true) {
      return diagPlaneUnavailable("the adapter reports the private canvas API unavailable");
    }
    const ids = [...target.adapter.getLiveNodeIds()];
    const adapter = target.adapter;
    return diagPlaneFrom(ids, (id) => adapter.getNodeGeometry(id));
  } catch (err) {
    return diagPlaneUnavailable(`view read threw: ${diagErrorText(err)}`);
  }
}

// ===========================================================================
// B71 (`S192`) — THE PAINT PLANE. WHAT IS ON THE SCREEN, NOT WHAT THE MODEL SAYS.
//
// THE FINDING THAT MADE THIS NECESSARY. `view`, `doc` and `file` are three
// readings of ONE MODEL. `diagViewCensus` calls `adapter.getNodeGeometry(id)`,
// which is four property reads off `canvas.nodes.get(id)` — the canvas node
// OBJECT. `doc` is that record in the Y.Doc and `file` is that record on disk.
// So when the sync is working the three agree BY CONSTRUCTION, and B70's drag
// measured exactly that: eleven nodes, three peers, all three planes identical,
// twice, the second time while the owner's screen was visibly disjointed. The
// instrument could not see the symptom because it was never pointed at it.
//
// The pixels come from a fourth thing: the node's `nodeEl`, which Obsidian
// positions in its own render step. `model → element` is a step this census had
// no reading of at all, so a defect that advances the model and never repaints
// the element is INVISIBLE to `view`/`doc`/`file` and unmistakable here.
//
// THREE READINGS PER NODE, AND THEY ARE NOT REDUNDANT — each fails differently:
//
//   ├── `styleTransform` — `nodeEl.style.transform` parsed for its `translate`,
//   │   plus `style.width` / `style.height`. This is the INSTRUCTION Obsidian
//   │   wrote onto the element. Exact, integral, and directly comparable to the
//   │   model's four numbers. Blind to anything that overrides it.
//   ├── `computed`       — `getComputedStyle(nodeEl).transform`, i.e. the matrix
//   │   the browser actually resolved. Sees a class or stylesheet rule that
//   │   overrode the inline style; the inline reading cannot.
//   └── `rect`           — `getBoundingClientRect()` de-transformed back into
//       canvas space with the PRODUCTION inverse (`clientToCanvasManual` +
//       `viewportScale`). This is the only one measured in real laid-out pixels,
//       so it is the only one that can catch a card sitting under a STALE
//       ANCESTOR TRANSFORM, a `display:none`, or a detached element — cases
//       where both style readings look perfect and nothing is where it claims.
//
// THE VERDICT IS SPLIT ON PURPOSE, and this is the part that keeps the plane
// from crying wolf:
//   * `styleVerdict` compares all four numbers EXACTLY (±0.01) with the model,
//     because both come from the same instruction path and any difference is
//     real.
//   * `rectVerdict` compares POSITION ONLY, with a tolerance of one device pixel
//     divided by the live scale. Size is deliberately excluded: a border,
//     padding or `box-sizing` difference would offset every card's rect width by
//     a constant, and a plane that reports eleven divergences on a healthy board
//     is exactly as useless as one that reports none on a broken one. The size
//     numbers are still REPORTED (`rect.width`/`rect.height`); they just do not
//     drive a verdict.
//
// R7 IS THE HARD CONSTRAINT HERE. Obsidian's canvas is private and undocumented
// and every reach below can legitimately fail. Not one of them returns a zero,
// an empty object, or a geometry that reads like "this node did not move":
//   * a node whose element cannot be read is ABSENT from `nodes` (a blank cell)
//     and carries its own `reason` in the detail map;
//   * if NO node could be read, the whole plane goes UNAVAILABLE with the reason,
//     rather than rendering as an empty board;
//   * a missing adapter member is named — `getNodeEl` and `getOverlayHost` are
//     optional in `DiagAdapterLike` precisely so an older bundle says which one
//     it lacks instead of silently reading nothing.
//
// R3 — NOTHING HERE WRITES. Every call is a property read, a `getComputedStyle`,
// or a `getBoundingClientRect`. Disclosed observation effect, since it is not
// nothing: `getBoundingClientRect` forces a synchronous layout, so pending STYLE
// changes are laid out at that moment. It cannot run Obsidian's render step and
// cannot move a card, but a reader should know the instrument touches the layout
// clock. It does not call `isBusy`/`getEditingNodeId` (R2) and does not exist on
// `DiagAdapterLike` to do so.
// ===========================================================================

/** Style/model agreement tolerance. Both sides are written from the same numbers. */
const DIAG_PAINT_EXACT_TOL = 0.01;

/** One paint reading of one node, in CANVAS coordinates. */
interface DiagPaintReading {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ===========================================================================
// B72 (`S195`) — WP1. A REFUSAL MUST NOT WEAR A MEASUREMENT'S CLOTHES.
//
// B71 shipped the plane above with one hole, and the very first live census
// fell into it. Obsidian VIRTUALIZES its canvas: `Canvas.virtualize()` detaches
// the `nodeEl` of every node outside the viewport (`nodeEl.detach()`), and
// re-attaches at most ten per frame as they come back into view. A DETACHED
// element:
//
//   ├── has NO inline `transform` if it was never rendered (`attach()` appends
//   │   the card without positioning it; only `render()` writes the transform);
//   ├── returns `""` from `getComputedStyle(...)` — there is no computed style
//   │   for an element outside the document; and
//   └── returns `{left:0, top:0, width:0, height:0}` from
//       `getBoundingClientRect()` — the browser's way of saying "this has no box".
//
// The plane took that third one at face value, de-transformed client `(0,0)`
// into canvas space, and reported a COORDINATE. Client `(0,0)` maps to exactly
// ONE canvas point per viewport — which is why the b72 census showed every
// "divergent" node on a peer at the SAME rect, and why the count tracked the
// zoom level (further in ⇒ fewer cards on screen ⇒ more detached). Seventeen
// "divergences" across three peers, and all seventeen were cards that are simply
// not on screen. That is `S190`'s trap in a new place: the instrument rendered
// a refusal as a reading.
//
// The fix is the same shape as `S190`'s: the rect reading REFUSES for a detached
// element and for a zero-area box, with a stated reason, and the node lands in
// its own category instead of in `divergentNodes`. Four categories now, and the
// difference between the second and the other three is the entire point:
//
//   ├── attached + painted + agrees      → fine
//   ├── attached + painted + DISAGREES   → THE REAL DEFECT (`S193`)
//   ├── detached                         → virtualized off screen; not divergent
//   └── attached + never painted         → `attach()` without `render()`; its own
//                                          category, because it is a real state
//                                          worth seeing but it is not a wrong
//                                          COORDINATE — there is no coordinate.
// ===========================================================================

/** Where the card element is, as the DOM itself reports it. Never inferred. */
type DiagPaintAttachment = "attached" | "detached" | "unknown";

/** Everything the paint plane knows about one node, including why it knows less. */
interface DiagPaintDetail {
  source: "style" | "computed" | "rect" | "none";
  model: DiagGeometry | null;
  styleTransform: DiagPaintReading | null;
  styleReason: string;
  computed: DiagPaintReading | null;
  computedReason: string;
  rect: DiagPaintReading | null;
  rectReason: string;
  connected: boolean | null;
  /**
   * B72 — `connected` restated as the three answers that exist, so a reader
   * never has to know that `null` means "the element did not tell us".
   */
  attachment: DiagPaintAttachment;
  /**
   * B72 — has Obsidian's `render()` EVER written a position onto this card?
   * Read from the inline transform, which `render()` is the only writer of.
   * `false` with `attachment === "attached"` is `S193`'s `attach()`-without-
   * `render()` state, and it is NOT a divergent coordinate: there is no
   * coordinate at all.
   */
  everPainted: boolean;
  className: string;
  styleVerdict: "agree" | "DIVERGENT" | "unreadable";
  rectVerdict: "agree" | "DIVERGENT" | "unreadable";
  verdict: "agree" | "DIVERGENT" | "detached" | "unpainted" | "unreadable";
  /** The signed model→paint offset, when both sides were readable. */
  offset: Record<string, number> | null;
  reason: string;
}

/**
 * Parse a CSS transform into its translation, in the element's own coordinate
 * space. Handles the three spellings that reach us: the inline `translate(…px,
 * …px)` Obsidian writes, and the `matrix(...)` / `matrix3d(...)` that
 * `getComputedStyle` always returns. Anything else — including `none` — is
 * `null`, never `{x: 0, y: 0}`: a transform this function cannot read is not a
 * card at the origin.
 */
function diagParseTransformTranslate(text: unknown): { x: number; y: number } | null {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (s.length === 0 || s === "none") return null;
  const num = (v: string | undefined): number => Number.parseFloat((v ?? "").trim());
  const m3 = /^matrix3d\(([^)]*)\)/.exec(s);
  if (m3) {
    const parts = m3[1].split(",");
    if (parts.length >= 14) {
      const x = num(parts[12]);
      const y = num(parts[13]);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    return null;
  }
  const m = /^matrix\(([^)]*)\)/.exec(s);
  if (m) {
    const parts = m[1].split(",");
    if (parts.length >= 6) {
      const x = num(parts[4]);
      const y = num(parts[5]);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    return null;
  }
  const t = /translate(?:3d)?\(\s*(-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)(?:px)?\s*,\s*(-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)(?:px)?/i.exec(
    s,
  );
  if (t) {
    const x = Number.parseFloat(t[1]);
    const y = Number.parseFloat(t[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return null;
}

/** A CSS length in px, or `null`. `""`, `auto` and `%` are all "cannot say". */
function diagParsePx(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const m = /^(-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)px$/i.exec(value.trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** The private DOM shape this plane reaches into. Every member re-checked at use. */
interface DiagElementLike {
  isConnected?: unknown;
  className?: unknown;
  style?: { transform?: unknown; width?: unknown; height?: unknown };
  getBoundingClientRect?: () => unknown;
  closest?: (selector: string) => unknown;
  ownerDocument?: {
    defaultView?: { getComputedStyle?: (el: unknown) => unknown } | null;
  } | null;
}

function diagAsElement(value: unknown): DiagElementLike | null {
  if (value === null || typeof value !== "object") return null;
  return value as DiagElementLike;
}

/** `getBoundingClientRect()`, validated. A rect with a non-finite number is `null`. */
function diagReadRect(
  el: DiagElementLike,
): { left: number; top: number; width: number; height: number } | null {
  if (typeof el.getBoundingClientRect !== "function") return null;
  const raw = el.getBoundingClientRect();
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as { left?: unknown; top?: unknown; width?: unknown; height?: unknown };
  if (
    typeof r.left !== "number" ||
    typeof r.top !== "number" ||
    typeof r.width !== "number" ||
    typeof r.height !== "number" ||
    !Number.isFinite(r.left) ||
    !Number.isFinite(r.top) ||
    !Number.isFinite(r.width) ||
    !Number.isFinite(r.height)
  ) {
    return null;
  }
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** `getComputedStyle(el)` via the element's OWN document — never a global. */
function diagComputedStyle(el: DiagElementLike): Record<string, unknown> | null {
  const view = el.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return null;
  const cs = view.getComputedStyle(el);
  if (cs === null || typeof cs !== "object") return null;
  return cs as Record<string, unknown>;
}

/** Class name as a string, whatever the private shape stores it as (SVG uses an object). */
function diagClassName(el: DiagElementLike): string {
  const raw = el.className;
  if (typeof raw === "string") return raw;
  const baseVal = (raw as { baseVal?: unknown } | null | undefined)?.baseVal;
  return typeof baseVal === "string" ? baseVal : "";
}

/**
 * I1/B71 — the PAINT plane for one path.
 *
 * The whole point is that this is the ONLY plane not read off the canvas node
 * object, so a `model advanced, element did not` defect appears here and nowhere
 * else. `available: false` always carries the member or condition that stopped
 * it, and a plane on which no single node could be read refuses rather than
 * rendering eleven blank cells as a converged board (R7).
 */
function diagPaintCensus(plugin: E2EPluginLike, path: string): DiagPlaneCensus {
  if (typeof plugin.canvasDiagTargets !== "function") {
    return diagPlaneUnavailable(
      "this build exposes no canvasDiagTargets accessor (pre-B68 bundle)",
    );
  }
  const { targets, accessorError } = resolveDiagTargetsResult(plugin, path);
  if (accessorError !== null) return diagPlaneUnavailable(accessorError);
  if (targets.length === 0) {
    return diagPlaneUnavailable("no canvas view is mounted for this path on this peer");
  }
  const target = targets[0];
  if (!target.adapter) return diagPlaneUnavailable(target.adapterReason);
  const adapter = target.adapter;
  try {
    if (adapter.isAvailable() !== true) {
      return diagPlaneUnavailable("the adapter reports the private canvas API unavailable");
    }
    if (typeof adapter.getNodeEl !== "function") {
      return diagPlaneUnavailable(
        "this bundle's adapter exposes no getNodeEl — the paint plane needs the card element and will not guess one from the model",
      );
    }
    const getNodeEl = adapter.getNodeEl.bind(adapter);
    const ids = [...adapter.getLiveNodeIds()].sort();
    const truncated = ids.length > CANVAS_DIAG_MAX_NODES;
    const capped = ids.slice(0, CANVAS_DIAG_MAX_NODES);

    // The viewport and the wrapper are needed for the RECT reading only. Their
    // absence downgrades that one reading and is stated per node; it never takes
    // the plane down, because the style readings are still perfectly valid.
    const vpRaw = typeof adapter.getViewport === "function" ? adapter.getViewport() : null;
    const vp =
      vpRaw && typeof vpRaw.x === "number" && typeof vpRaw.y === "number" &&
      typeof vpRaw.zoom === "number"
        ? vpRaw
        : null;
    const scale = vp ? viewportScale(vp) : Number.NaN;
    const scaleUsable = Number.isFinite(scale) && scale !== 0;
    let wrapperEl: DiagElementLike | null = null;
    let wrapperHow = "not resolved";
    if (typeof adapter.getOverlayHost === "function") {
      wrapperEl = diagAsElement(adapter.getOverlayHost());
      wrapperHow = wrapperEl ? "adapter.getOverlayHost()" : "adapter.getOverlayHost() returned null";
    } else {
      wrapperHow = "this bundle's adapter exposes no getOverlayHost";
    }
    const wrapperRect = wrapperEl ? diagReadRect(wrapperEl) : null;
    // The rect reading's tolerance, in CANVAS units: one device pixel of layout
    // rounding, divided by the live scale, plus the exact-comparison epsilon.
    const rectTol = scaleUsable ? 1 / Math.abs(scale) + DIAG_PAINT_EXACT_TOL : DIAG_PAINT_EXACT_TOL;

    const nodes: Record<string, DiagGeometry> = {};
    const detail: Record<string, DiagPaintDetail> = {};
    const divergent: string[] = [];
    const unreadable: string[] = [];
    // B72 (`S195`) — the two categories that used to be counted as divergences.
    const detached: string[] = [];
    const unpainted: string[] = [];
    const sourceCounts: Record<string, number> = { style: 0, computed: 0, rect: 0, none: 0 };

    for (const id of capped) {
      const model = safeNodeGeometry(adapter, id);
      let el: DiagElementLike | null = null;
      let elReason = "";
      try {
        el = diagAsElement(getNodeEl(id));
        if (!el) elReason = "getNodeEl returned null — this node has no card element";
      } catch (err) {
        elReason = `getNodeEl threw: ${diagErrorText(err)}`;
      }

      let styleTransform: DiagPaintReading | null = null;
      let styleReason = elReason || "";
      let computed: DiagPaintReading | null = null;
      let computedReason = elReason || "";
      let rect: DiagPaintReading | null = null;
      let rectReason = elReason || "";
      let connected: boolean | null = null;
      let className = "";
      // B72 — "did a translate parse at all", tracked SEPARATELY from
      // `styleTransform`. `styleTransform` is refused when the translate was
      // readable but width/height were not, and folding those two together would
      // report a perfectly painted card as never painted.
      let styleTranslateSeen = false;

      if (el) {
        connected = typeof el.isConnected === "boolean" ? el.isConnected : null;
        className = diagClassName(el);

        // ---- reading 1: the inline instruction --------------------------------
        try {
          const t = diagParseTransformTranslate(el.style?.transform);
          const w = diagParsePx(el.style?.width);
          const h = diagParsePx(el.style?.height);
          if (t) styleTranslateSeen = true;
          if (!t) {
            styleReason =
              "nodeEl.style.transform carries no readable translate (empty, 'none', or a spelling this parser does not know)";
          } else if (w === null || h === null) {
            // The position is readable and the size is not. Reported as a REFUSAL
            // rather than as a position with two invented numbers: a `0x0` card
            // would be indistinguishable from a real collapse.
            styleReason = `nodeEl.style.width/height are not px lengths (width='${String(el.style?.width)}' height='${String(el.style?.height)}'); translate was readable at (${t.x},${t.y})`;
          } else {
            styleTransform = { x: t.x, y: t.y, width: w, height: h };
            styleReason = "";
          }
        } catch (err) {
          styleReason = `inline style read threw: ${diagErrorText(err)}`;
        }

        // ---- reading 2: what the browser actually resolved --------------------
        try {
          const cs = diagComputedStyle(el);
          if (!cs) {
            computedReason =
              "no ownerDocument.defaultView.getComputedStyle on this element (non-DOM host?)";
          } else {
            const t = diagParseTransformTranslate(cs.transform);
            const w = diagParsePx(cs.width);
            const h = diagParsePx(cs.height);
            if (!t) {
              computedReason = `getComputedStyle(...).transform is '${String(cs.transform)}' — no readable translate`;
            } else {
              computed = {
                x: t.x,
                y: t.y,
                width: w ?? Number.NaN,
                height: h ?? Number.NaN,
              };
              computedReason = "";
            }
          }
        } catch (err) {
          computedReason = `getComputedStyle read threw: ${diagErrorText(err)}`;
        }

        // ---- reading 3: real laid-out pixels, de-transformed ------------------
        try {
          if (connected === false) {
            // B72 (`S195`) — THE REFUSAL THAT USED TO BE A COORDINATE. A detached
            // element has no box: `getBoundingClientRect()` answers
            // `{0,0,0,0}` for every one of them, and de-transforming client
            // (0,0) yields one canvas point per viewport — so every detached
            // card "diverges" to the SAME place. That is not where the card is;
            // it is the arithmetic image of "there is no card on screen".
            rectReason =
              "nodeEl.isConnected === false — Obsidian's virtualize() has detached this card (it is outside the viewport). A detached element's getBoundingClientRect() is (0,0,0,0), which is a REFUSAL, not a position";
          } else if (!vp) {
            rectReason = "no live viewport (adapter.getViewport unavailable or malformed)";
          } else if (!scaleUsable) {
            rectReason = `viewport scale is unusable (${String(scale)})`;
          } else if (!wrapperRect) {
            rectReason = `no wrapper rect: ${wrapperHow}`;
          } else {
            const r = diagReadRect(el);
            if (!r) {
              rectReason = "getBoundingClientRect unavailable or returned a non-finite rect";
            } else if (r.width === 0 && r.height === 0) {
              // B72 — the same refusal for the case `isConnected` could not see:
              // an element that IS in the document but has no box (`display:none`,
              // never laid out, inside a hidden ancestor). Zero area means the
              // browser placed nothing; its `left`/`top` are not a position. This
              // is a SEPARATE arm from the detach one on purpose — an attached
              // card with no box is a real anomaly and its reason says so, rather
              // than being folded into "detached, nothing to see".
              rectReason = `getBoundingClientRect returned a ZERO-AREA box at (${r.left},${r.top}) — the element is in the document (isConnected=${String(connected)}) but has no laid-out box, so its left/top are not a position`;
            } else {
              const p = clientToCanvasManual(r.left, r.top, vp, {
                left: wrapperRect.left,
                top: wrapperRect.top,
                width: wrapperRect.width,
                height: wrapperRect.height,
              });
              if (!p) {
                rectReason = "clientToCanvasManual refused (degenerate scale)";
              } else {
                rect = {
                  x: p.x,
                  y: p.y,
                  width: r.width / scale,
                  height: r.height / scale,
                };
                rectReason = "";
              }
            }
          }
        } catch (err) {
          rectReason = `rect read threw: ${diagErrorText(err)}`;
        }
      }

      // ---- verdicts ---------------------------------------------------------
      const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
      let styleVerdict: "agree" | "DIVERGENT" | "unreadable" = "unreadable";
      if (model && styleTransform) {
        styleVerdict =
          near(styleTransform.x, model.x, DIAG_PAINT_EXACT_TOL) &&
          near(styleTransform.y, model.y, DIAG_PAINT_EXACT_TOL) &&
          near(styleTransform.width, model.width, DIAG_PAINT_EXACT_TOL) &&
          near(styleTransform.height, model.height, DIAG_PAINT_EXACT_TOL)
            ? "agree"
            : "DIVERGENT";
      }
      let rectVerdict: "agree" | "DIVERGENT" | "unreadable" = "unreadable";
      if (model && rect) {
        // POSITION ONLY, and the comment above says why size is excluded.
        rectVerdict =
          near(rect.x, model.x, rectTol) && near(rect.y, model.y, rectTol)
            ? "agree"
            : "DIVERGENT";
      }
      // B72 (`S195`) — the three facts the categories are cut on, each read from
      // the DOM and none of them inferred from a coordinate.
      const attachment: DiagPaintAttachment =
        connected === true ? "attached" : connected === false ? "detached" : "unknown";
      // `render()` is the ONLY writer of a card's inline transform (Obsidian's
      // `CanvasNode.prototype.render`, quoted in B71 §1.2), so a readable inline
      // translate is proof it ran at least once and its absence is proof it did
      // not. The computed reading is accepted as a second witness because a
      // stylesheet could in principle carry it; it is not accepted for a detached
      // element, where `getComputedStyle` returns "" for everything.
      const everPainted = styleTranslateSeen || (attachment !== "detached" && computed !== null);

      // THE PRECEDENCE, AND IT IS THE WHOLE OF WP1. `detached` and `unpainted`
      // are checked BEFORE any comparison, because in both states there is no
      // painted position to compare — and a category is the honest answer where
      // a verdict would be a fabrication.
      const verdict: DiagPaintDetail["verdict"] =
        el === null
          ? "unreadable"
          : attachment === "detached"
            ? "detached"
            : !everPainted
              ? "unpainted"
              : styleVerdict === "DIVERGENT" || rectVerdict === "DIVERGENT"
                ? "DIVERGENT"
                : styleVerdict === "agree" || rectVerdict === "agree"
                  ? "agree"
                  : "unreadable";

      const primary = styleTransform ?? computed ?? rect;
      const source: DiagPaintDetail["source"] = styleTransform
        ? "style"
        : computed
          ? "computed"
          : rect
            ? "rect"
            : "none";
      sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;

      // B72 — EXACTLY ONE bucket per node, chosen by the verdict and never by a
      // coordinate. `divergent` now holds only what the phrase claims: cards that
      // are on screen, have been painted, and are painted in the wrong place.
      let reason = "";
      if (verdict === "detached") {
        reason = `DETACHED — Obsidian's virtualize() has removed this card from the document because it is outside the viewport. Nothing is painted for it, so there is nothing that can diverge${
          styleTranslateSeen
            ? "; its last inline transform is still readable and is reported above"
            : "; it has never been rendered, so it carries no inline transform either"
        }`;
        detached.push(id);
      } else if (verdict === "unpainted") {
        reason =
          "NEVER PAINTED — the card is in the document but carries no transform Obsidian's render() could have written. This is attach()-without-render() (`S193`): a real state, and not a wrong coordinate — there is no coordinate";
        unpainted.push(id);
      } else if (!primary) {
        reason =
          elReason ||
          `no readable paint geometry: style(${styleReason}) computed(${computedReason}) rect(${rectReason})`;
        unreadable.push(id);
      } else if (!model) {
        reason = "the model side is unreadable, so no divergence verdict is possible";
      }
      if (verdict === "DIVERGENT") divergent.push(id);

      if (primary) {
        nodes[id] = {
          x: primary.x,
          y: primary.y,
          width: primary.width,
          height: primary.height,
        };
      }
      detail[id] = {
        source,
        model,
        styleTransform,
        styleReason,
        computed,
        computedReason,
        rect,
        rectReason,
        connected,
        attachment,
        everPainted,
        className,
        styleVerdict,
        rectVerdict,
        verdict,
        offset:
          model && primary
            ? {
                dx: primary.x - model.x,
                dy: primary.y - model.y,
                dw: primary.width - model.width,
                dh: primary.height - model.height,
              }
            : null,
        reason,
      };
    }

    // R7 — the refusal that matters most. Eleven live nodes and not one readable
    // element is NOT an empty board; it is an instrument that could not read.
    //
    // B72 — the condition is now `unreadable`, not "nothing published". A board
    // scrolled entirely away is legitimately all-detached and publishes no
    // coordinates, and that is an ANSWER ("every card is off screen"), not a
    // failure to read. Taking the plane down for it would have replaced one
    // wrong reading with a different wrong reading.
    if (capped.length > 0 && unreadable.length === capped.length) {
      const sample = detail[capped[0]]?.reason ?? "no reason recorded";
      return diagPlaneUnavailable(
        `no card element could be read for any of ${capped.length} live nodes — first reason: ${sample}`,
      );
    }

    return {
      available: true,
      reason: "",
      count: ids.length,
      truncated,
      nodes,
      degraded: null,
      // The paint plane's LABEL (the field the file plane uses for size+sha) is
      // this plane's whole audit trail: what it measured with, what disagreed,
      // and what it could not read. Never a verdict on its own.
      label: {
        plane: "paint",
        primarySource: "nodeEl.style.transform (falls back to computed, then rect)",
        viewport: vp ? { x: vp.x, y: vp.y, zoom: vp.zoom, scale } : null,
        wrapper: wrapperRect
          ? { how: wrapperHow, className: wrapperEl ? diagClassName(wrapperEl) : "", ...wrapperRect }
          : { how: wrapperHow },
        rectToleranceCanvasUnits: rectTol,
        exactTolerance: DIAG_PAINT_EXACT_TOL,
        sourceCounts,
        divergentNodes: divergent,
        divergentCount: divergent.length,
        // B72 (`S195`) — the two categories that are NOT divergences, reported
        // separately so a reader can never add them back in by accident. The
        // b72-postreload census read 3/6/8 "divergences" on A/B/C; every one of
        // them lands here, and `divergentCount` on that same data is 0/0/0.
        detachedNodes: detached,
        detachedCount: detached.length,
        unpaintedNodes: unpainted,
        unpaintedCount: unpainted.length,
        attachedCount: Object.values(detail).filter((d) => d.attachment === "attached").length,
        unreadableNodes: unreadable,
        nodesDetail: detail,
      },
    };
  } catch (err) {
    return diagPlaneUnavailable(`paint read threw: ${diagErrorText(err)}`);
  }
}

/**
 * I1 — the DOC plane, from `canvasSync.getCanvasSnapshot` (a pure read:
 * `buildCanvasData` over three maps, no transaction opened).
 *
 * `null` means "not subscribed on this peer, or the shared node map is empty".
 * It is reported as UNAVAILABLE and never as an empty board — those two are the
 * whole difference between "the doc lost the board" and "we never asked".
 */
function diagDocCensus(plugin: E2EPluginLike, path: string): DiagPlaneCensus {
  const cs = plugin.canvasSync;
  if (!cs) return diagPlaneUnavailable("this instance exposes no canvasSync");
  let snapshot: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null;
  try {
    snapshot = cs.getCanvasSnapshot(path);
  } catch (err) {
    return diagPlaneUnavailable(`getCanvasSnapshot threw: ${diagErrorText(err)}`);
  }
  if (!snapshot) {
    return diagPlaneUnavailable(
      "getCanvasSnapshot returned null: not subscribed on this peer, or the shared node map is empty",
    );
  }
  const byId = new Map<string, unknown>();
  for (const record of snapshot.nodes) {
    if (record && typeof record.id === "string") byId.set(record.id, record);
  }
  return diagPlaneFrom([...byId.keys()], (id) => diagGeometryOf(byId.get(id)));
}

/**
 * I1 — the FILE plane, through THE PRODUCTION PARSER and no other (`S158`).
 * `parseCanvasReport` rather than `parseCanvas` because the latter degrades to
 * empty records and never throws, so "parse and compare" would read EQUAL for
 * two files neither of which could be read. `degraded` is a judgement input.
 *
 * It reads bytes the plugin did not author and writes nothing.
 */
async function diagFileCensus(plugin: E2EPluginLike, path: string): Promise<DiagPlaneCensus> {
  const adapter = resolveCanvasFileAdapter(plugin);
  if (!adapter) return diagPlaneUnavailable("this instance exposes no read-only file adapter");
  try {
    if (!(await adapter.exists(path))) {
      return diagPlaneUnavailable("no .canvas file exists at this path");
    }
    const bytes = await readCanvasBytes(adapter, path);
    const report = parseCanvasReport(bytes.toString("utf8"));
    const flat = decodeCanvasDataToFlat(report.data);
    const plane = diagPlaneFrom(Object.keys(flat.nodes), (id) => diagGeometryOf(flat.nodes[id]));
    plane.degraded = report.degraded;
    // R5 — a LABEL, never a verdict. `data.json` is never read, hashed or named.
    plane.label = {
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      hasNodesKey: report.hasNodesKey,
      hasEdgesKey: report.hasEdgesKey,
    };
    return plane;
  } catch (err) {
    return diagPlaneUnavailable(`file read/parse threw: ${diagErrorText(err)}`);
  }
}

/**
 * The awareness behind one canvas path. `null` — with the reason left to the
 * caller's note — rather than a fabricated empty state map, because "no peer
 * holds this node" and "we could not ask" are the two readings H1 turns on.
 *
 * This is the doc handle's OWN awareness, the very object `mountCanvasPresence`
 * hands to `CanvasPresence` (`main.ts:3921`), so the instrument and the
 * mechanism cannot be looking at different wires.
 */
function resolveDiagAwareness(
  plugin: E2EPluginLike,
  path: string,
): { clientID: number; getStates(): Map<number, Record<string, unknown>> } | null {
  const cs = plugin.canvasSync;
  if (!cs) return null;
  try {
    const handle = cs.getCanvasDocHandle(path);
    const awareness = handle?.awareness;
    if (!awareness || typeof awareness.getStates !== "function") return null;
    if (typeof awareness.clientID !== "number") return null;
    return awareness;
  } catch {
    return null;
  }
}

/** One pure geometry read that cannot throw into a wrapper (R2-safe by type). */
function safeNodeGeometry(adapter: DiagAdapterLike, nodeId: string): DiagGeometry | null {
  try {
    return adapter.getNodeGeometry(nodeId);
  } catch {
    return null;
  }
}

/**
 * I6 — THE AWARENESS SNAPSHOT. A pure read of the wire.
 *
 * It supplies `holders` / `winner` context for I3 and I4, gives the claim leak's
 * LIVE count per peer, and lets the reader prove the phantom `(typing)` pill:
 * `resolveCursors` sets `typing: cs.nodeId !== null` (`canvas-presence.ts:192`),
 * so a peer whose `nodeId` is non-null while it holds no gesture claim is
 * rendering a pill about nothing.
 *
 * `epoch` is surfaced per lock entry because `S187` says it is in the wire shape
 * and was never implemented — so `epoch: undefined` on every entry is itself the
 * confirmation, and it can only be confirmed by looking.
 *
 * THE SNAPSHOT IS NEVER WRITTEN BACK, and no field is added to the wire. That is
 * the constraint which forbids the obvious alternative design of broadcasting a
 * diagnostic field: WP27 AC3 pins the awareness state's six keys, and a
 * diagnostic on the wire would perturb exactly the mechanism under
 * investigation. Every cross-peer correlation is done OUT OF BAND, in Python,
 * from three independent dumps.
 *
 * R4 — nothing here reads, names or hashes `data.json`. `identity.name` and the
 * lock colours are values this peer already broadcasts to every other peer.
 */
function diagAwarenessSnapshot(plugin: E2EPluginLike, path: string): Record<string, unknown> {
  const awareness = resolveDiagAwareness(plugin, path);
  if (!awareness) {
    return {
      available: false,
      reason: `no awareness handle for '${path}' on this peer (not subscribed, or the doc handle carries none)`,
    };
  }
  let states: Map<number, Record<string, unknown>>;
  try {
    states = awareness.getStates();
  } catch (err) {
    return { available: false, reason: `getStates threw: ${diagErrorText(err)}` };
  }
  const peers: Array<Record<string, unknown>> = [];
  for (const [clientId, raw] of states) {
    const state = (raw ?? {}) as {
      canvasPath?: unknown;
      nodeId?: unknown;
      x?: unknown;
      y?: unknown;
      lockedNodes?: unknown;
      identity?: { name?: unknown; color?: unknown };
    };
    const lockedRaw = state.lockedNodes;
    const lockedNodes: Record<string, unknown> = {};
    const epochs: Record<string, unknown> = {};
    if (lockedRaw !== null && typeof lockedRaw === "object") {
      for (const [nodeId, entry] of Object.entries(lockedRaw as Record<string, unknown>)) {
        const e = (entry ?? {}) as { color?: unknown; name?: unknown; epoch?: unknown };
        lockedNodes[nodeId] = { color: e.color ?? null, name: e.name ?? null };
        epochs[nodeId] = e.epoch === undefined ? "undefined" : e.epoch;
      }
    }
    peers.push({
      clientId,
      isMe: clientId === awareness.clientID,
      canvasPath: typeof state.canvasPath === "string" ? state.canvasPath : null,
      onThisPath: state.canvasPath === path,
      nodeId: typeof state.nodeId === "string" ? state.nodeId : null,
      x: typeof state.x === "number" ? state.x : null,
      y: typeof state.y === "number" ? state.y : null,
      lockCount: Object.keys(lockedNodes).length,
      lockedNodes,
      epochs,
      identityName: typeof state.identity?.name === "string" ? state.identity.name : null,
      // `resolveCursors` renders a peer as typing on exactly this condition.
      rendersTypingPill: typeof state.nodeId === "string",
    });
  }
  // The local claim provenance, through the same cast I3/I4 use. `"unreadable"`
  // rather than `{}` when the private map is absent (R7).
  let lockMeta: unknown = "unreadable";
  const target = resolveDiagTargets(plugin, path)[0];
  const rawMeta = target?.presence?.lockMeta;
  if (rawMeta instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of rawMeta as Map<unknown, unknown>) out[String(key)] = value;
    lockMeta = out;
  }
  return {
    available: true,
    path,
    myClientId: awareness.clientID,
    peerCount: peers.length,
    peersOnThisPath: peers.filter((p) => p.onThisPath === true).length,
    peers: peers.sort((a, b) => Number(a.clientId) - Number(b.clientId)),
    lockMeta,
  };
}

/**
 * I1 — all FOUR planes for one path, taken on demand.
 *
 * `paint` is taken FIRST and deliberately: it is the only plane read off the
 * DOM, and taking it before the doc read and the (async) file read keeps the
 * smallest possible window between "what the model said" and "what was on the
 * screen when we asked". The three model planes cannot move relative to each
 * other in that window; the screen can.
 */
async function diagCensus(plugin: E2EPluginLike, path: string): Promise<DiagCensus> {
  return {
    path,
    at: Date.now(),
    paint: diagPaintCensus(plugin, path),
    view: diagViewCensus(plugin, path),
    doc: diagDocCensus(plugin, path),
    file: await diagFileCensus(plugin, path),
    repaint: diagRepaintReport(plugin, path),
  };
}

/**
 * B72 (WP3) — the sweep's counters for one path, and R7 all the way down.
 *
 * Every failure names itself and NONE of them returns a zeroed counter block:
 * "the sweep has repaired nothing" and "this peer cannot tell us what the sweep
 * did" are the whole difference between a fix that is working and a fix that is
 * not installed, and the b71/b70 sessions each lost hours to exactly that
 * confusion wearing an honest answer's words.
 */
function diagRepaintReport(plugin: E2EPluginLike, path: string): DiagRepaintReport {
  const none = (reason: string): DiagRepaintReport => ({ available: false, reason, counters: null });
  if (typeof plugin.canvasDiagTargets !== "function") {
    return none("this build exposes no canvasDiagTargets accessor (pre-B68 bundle)");
  }
  const { targets, accessorError } = resolveDiagTargetsResult(plugin, path);
  if (accessorError !== null) return none(accessorError);
  if (targets.length === 0) return none("no canvas view is mounted for this path on this peer");
  const adapter = targets[0].adapter;
  if (!adapter) return none(targets[0].adapterReason);
  if (typeof adapter.describeRepaintSweep !== "function") {
    return none(
      "this bundle's adapter exposes no describeRepaintSweep — it is pre-B72 and has NO repaint sweep at all; nothing here is repairing anything",
    );
  }
  try {
    const counters = adapter.describeRepaintSweep();
    if (counters === null || typeof counters !== "object") {
      return none(`describeRepaintSweep returned ${typeof counters}, not a counter record`);
    }
    return { available: true, reason: "", counters: { ...counters } };
  } catch (err) {
    return none(`describeRepaintSweep threw: ${diagErrorText(err)}`);
  }
}

/**
 * One ledger row. `t` and `kind` are the two fields every row carries; the rest
 * is the instrument's own vocabulary, rendered by `tools/e2e/canvas_diag.py`.
 */
type DiagRow = Record<string, unknown> & { t: number; kind: string };

/**
 * Ring capacity. Bounded on purpose: a diagnostic that OOMs a live vault is
 * worse than no diagnostic. Eviction is COUNTED and surfaced as `dropped`, so a
 * truncated ring can never be mistaken for a quiet one (R7).
 */
const CANVAS_DIAG_RING_CAPACITY = 4000;

/**
 * A transaction origin, rendered. Named symbols report their `.description`;
 * everything else is passed through verbatim, because an origin this package
 * does not recognise is a finding rather than a rendering problem — and `null`
 * with `local === true` is the loudest of them.
 */
function diagRenderOrigin(origin: unknown): string {
  if (origin === null || origin === undefined) return "null";
  if (typeof origin === "symbol") return origin.description ?? origin.toString();
  if (typeof origin === "string") return origin;
  if (typeof origin === "object") {
    const described = (origin as { description?: unknown }).description;
    if (typeof described === "string") return described;
    const ctor = (origin as { constructor?: { name?: unknown } }).constructor;
    if (ctor && typeof ctor.name === "string") return `[${ctor.name}]`;
  }
  return String(origin);
}

/** True when two geometry readings differ in any of the four numbers. */
function diagGeoDiffers(a: DiagGeometry | undefined, b: DiagGeometry | undefined): boolean {
  if (!a || !b) return a !== b;
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
}

/**
 * B71 — the same test with a tolerance, for the PAINT plane only. The paint
 * plane's primary reading is `nodeEl.style.transform`, which is exact, so this
 * changes nothing for it; it exists for the fallback case where a node's only
 * readable geometry came from `getBoundingClientRect`, whose de-transformed
 * value carries sub-pixel layout rounding. `0.01` canvas units is far below any
 * real move and far above that noise floor.
 */
function diagGeoDiffersTol(
  a: DiagGeometry | undefined,
  b: DiagGeometry | undefined,
  tol: number,
): boolean {
  if (!a || !b) return a !== b;
  return (
    Math.abs(a.x - b.x) > tol ||
    Math.abs(a.y - b.y) > tol ||
    Math.abs(a.width - b.width) > tol ||
    Math.abs(a.height - b.height) > tol
  );
}

interface DiagDeltaRow {
  plane: "paint" | "view" | "doc" | "file";
  nodeId: string;
  from: DiagGeometry | null;
  to: DiagGeometry | null;
  note: string;
}

/**
 * I8 — THE UNATTRIBUTED DELTA. The honest catch-all, and the row to read first.
 *
 * `census(dump) − census(arm)`, minus every move a ledger row explains. What is
 * left over is a move this plugin's own instruments cannot account for:
 *
 *   ├── B71: an unattributed PAINT delta ⇒ a card whose PIXELS moved. Read it
 *   │   against the VIEW row for the same node, because the pair is the whole
 *   │   diagnosis: `view` moved and `paint` did not ⇒ the model advanced and
 *   │   the element was never repainted (the `H9` shape). `paint` moved and
 *   │   `view` did not ⇒ something moved the element behind the model's back.
 *   │   Both moved ⇒ an ordinary, correctly rendered change.
 *   ├── an unattributed VIEW delta ⇒ something moved a card that neither of the
 *   │   product's two view-geometry sinks moved — Obsidian itself, the user, or
 *   │   a route nobody has enumerated. That last one is the most important
 *   │   possible result of this whole package.
 *   ├── an unattributed DOC delta ⇒ the transaction ledger dropped a row, or the
 *   │   write came through a path the ledger is not watching.
 *   └── an unattributed FILE delta ⇒ a disk write that no doc change preceded.
 *       A file delta that a doc delta DOES explain is an ordinary flush and is
 *       attributed as such rather than shouted about.
 *
 * The attribution rule is deliberately generous — ANY ledger row naming the node
 * on that plane counts. A generous rule makes `UNATTRIBUTED` mean something: a
 * row that survives it is one no instrument in this package saw at all.
 */
function diagUnattributed(
  armCensus: DiagCensus | null,
  dumpCensus: DiagCensus,
  ring: readonly DiagRow[],
): { unattributed: DiagDeltaRow[]; attributed: DiagDeltaRow[] } {
  const unattributed: DiagDeltaRow[] = [];
  const attributed: DiagDeltaRow[] = [];
  if (!armCensus) return { unattributed, attributed };

  /** The last ledger row that names `nodeId` on `plane`, as a short label. */
  const explain = (plane: "paint" | "view" | "doc" | "file", nodeId: string): string | null => {
    let label: string | null = null;
    for (const row of ring) {
      // B71 — PAINT is attributed by the VIEW ledger on purpose. The product's
      // two view-geometry sinks (`applyNodeGeometry` → `moveAndResize`, and
      // `reloadCanvasData` → `setData`) are the only routes that are SUPPOSED to
      // repaint a card, so a paint move one of them explains is ordinary. A
      // paint move neither explains is the interesting one, and it survives as
      // UNATTRIBUTED exactly as a view move would.
      if (plane === "view" || plane === "paint") {
        if (row.kind === "applyGeom" && row.nodeId === nodeId) {
          label = `applyGeom outcome=${String(row.outcome)} cause=${String(row.cause)}`;
        } else if (row.kind === "setData" && Array.isArray(row.moved)) {
          const hit = (row.moved as Array<{ nodeId?: unknown }>).some((m) => m?.nodeId === nodeId);
          if (hit) label = `setData cause=${String(row.cause)}`;
        }
      } else if (plane === "doc") {
        if (row.kind === "ytxn" && Array.isArray(row.changed)) {
          const hit = (row.changed as Array<{ nodeId?: unknown }>).some(
            (c) => c?.nodeId === nodeId,
          );
          if (hit) label = `ytxn origin=${String(row.origin)} local=${String(row.local)}`;
        }
      }
    }
    return label;
  };

  const docMoved = new Set<string>();
  for (const planeName of ["paint", "view", "doc", "file"] as const) {
    const before = armCensus[planeName];
    const after = dumpCensus[planeName];
    if (before.available !== true || after.available !== true) continue;
    const ids = new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)]);
    for (const nodeId of [...ids].sort()) {
      const from = before.nodes[nodeId];
      const to = after.nodes[nodeId];
      if (
        planeName === "paint"
          ? !diagGeoDiffersTol(from, to, DIAG_PAINT_EXACT_TOL)
          : !diagGeoDiffers(from, to)
      ) {
        continue;
      }
      if (planeName === "doc") docMoved.add(nodeId);
      const row: DiagDeltaRow = {
        plane: planeName,
        nodeId,
        from: from ?? null,
        to: to ?? null,
        note: from === undefined ? "APPEARED" : to === undefined ? "VANISHED" : "",
      };
      // The FILE plane's own attribution: a doc change that preceded it IS the
      // explanation (`CanvasPersistence` wrote what the doc said), and there is
      // no per-write disk ledger in this build to name it more precisely.
      const label =
        planeName === "file"
          ? docMoved.has(nodeId)
            ? "flush — the doc moved this node in the same window"
            : null
          : explain(planeName, nodeId);
      if (label === null) unattributed.push(row);
      else attributed.push({ ...row, note: `${row.note} ${label}`.trim() });
    }
  }
  return { unattributed, attributed };
}

/** The request shape `canvas.diag` validates at the command boundary. */
interface CanvasDiagRequest {
  op: string;
  path?: string;
  label?: string;
}

export interface CanvasDiagnostic {
  run(req: CanvasDiagRequest): Promise<unknown>;
}

/**
 * The diagnostic, over one live plugin. One ring buffer, one arm census, one
 * set of removers — held in this closure so they die with the host and cannot
 * outlive the instance that owns the surfaces they wrap.
 *
 * Constructing it INSTALLS NOTHING. Every hook is installed by `op:"arm"` and
 * removed by `op:"clear"`.
 */
function createCanvasDiagnostic(plugin: E2EPluginLike): CanvasDiagnostic {
  let armed = false;
  let armedAt = 0;
  let armedPath: string | null = null;
  let armCensus: DiagCensus | null = null;
  const ring: DiagRow[] = [];
  let dropped = 0;
  /** Paths whose live surfaces this arm actually wrapped. Compared against `mountedPaths`. */
  let patchedPaths: string[] = [];
  /** Undo functions for every patch and every listener this arm installed. */
  let removers: Array<{ what: "patch" | "listener"; undo: () => void }> = [];
  /** Refusals, absences and re-arms. Never silent — R7. */
  let notes: string[] = [];
  /**
   * THE CAUSE FLAG — one variable, not a framework.
   *
   * `onRevert` → `main.ts:3990 revertCanvasNode` → `:4036 applyCanvasNodeRevert`
   * → `:4105 applyNodeGeometry` is fully SYNCHRONOUS inside
   * `presence.reconcileClaims()`. So I3's wrapper sets this before calling the
   * original and restores it in a `finally`, and any view-sink call that sees it
   * set was made by a revert. A call with it clear is the ordinary remote path
   * (`main.ts:2521 setOnRemoteCanvasUpdate` → `:3024 reconcileLiveCanvas`) or
   * the one-shot mount reconcile (`main.ts:3890`, `{initial:true}`), and those
   * two are separated by timestamp — `mount-initial` fires once per open.
   *
   * `causeResolved` on the row records WHICH of those two facts produced the
   * label, so a default is never mistaken for a measurement (`S155`'s shape).
   */
  let causeNow: string | null = null;

  /** Which paths this build can see mounted, for the arm/dump gap report (R7). */
  const mountedPaths = (): string[] => resolveDiagTargets(plugin).map((t) => t.path).sort();

  const push = (row: DiagRow): void => {
    ring.push(row);
    while (ring.length > CANVAS_DIAG_RING_CAPACITY) {
      ring.shift();
      dropped++;
    }
  };

  /** The current view geometry of every live node, capped. Pure reads only (R2). */
  const viewSnapshot = (adapter: DiagAdapterLike): Record<string, DiagGeometry> => {
    const out: Record<string, DiagGeometry> = {};
    let seen = 0;
    for (const id of adapter.getLiveNodeIds()) {
      if (seen++ >= CANVAS_DIAG_MAX_NODES) break;
      const geo = adapter.getNodeGeometry(id);
      if (geo) out[id] = geo;
    }
    return out;
  };

  /**
   * I2 — THE VIEW-WRITE LEDGER. Every mutation this plugin makes to the live
   * view's geometry, with before → after and a CAUSE.
   *
   * The two members wrapped below are the COMPLETE set of view-geometry sinks in
   * the product. That is not an assumption: it is what
   * `v2/wp87/test_tp01_surface_route_census.test.ts:210-214` derives from the
   * tree and asserts (`canvas-adapter.ts#applyNodeGeometry` and
   * `#reloadCanvasData`, both `GUARDED-BY-CALLER`).
   *
   * OBSERVER EFFECT IS THIS PACKAGE'S FAILURE MODE, and these two wrappers sit
   * directly in the product's view-write path on the owner's LIVE vaults. So,
   * by construction and in this order:
   *   1. the pre-reading is a pure `getNodeGeometry` inside its own `try/catch`;
   *   2. the ORIGINAL is called in its own statement and its result is returned
   *      verbatim;
   *   3. every remaining diagnostic read is inside a second `try/catch`.
   * With that shape the failure mode is a MISSING LEDGER ROW, never a missing
   * apply — verbatim the pattern `canvas-adapter.ts:828-836` already uses.
   */
  const installViewWriteLedger = (target: DiagTarget): number => {
    const host = target.adapterRaw;
    const adapter = target.adapter;
    if (!host || !adapter) {
      notes.push(`I2 view-write ledger NOT installed on '${target.path}': ${target.adapterReason}`);
      return 0;
    }
    const path = target.path;
    let installed = 0;

    const undoApply = diagPatch(host, "applyNodeGeometry", (original) =>
      function (this: unknown, ...args: unknown[]): unknown {
        const nodeId = typeof args[0] === "string" ? args[0] : "";
        let before: DiagGeometry | null = null;
        try {
          before = nodeId.length > 0 ? adapter.getNodeGeometry(nodeId) : null;
        } catch {
          before = null;
        }
        const result = original.apply(this, args);
        try {
          push({
            t: Date.now(),
            kind: "applyGeom",
            path,
            nodeId,
            from: before,
            to: diagGeometryOf(args[1]),
            outcome: typeof result === "string" ? result : String(result),
            cause: causeNow ?? "remote-apply",
            causeResolved: causeNow !== null,
          });
        } catch {
          /* diagnostics must never break canvas interaction */
        }
        return result;
      },
    );
    if (undoApply) {
      removers.push({ what: "patch", undo: undoApply });
      installed++;
    } else {
      notes.push(`I2: '${path}' exposes no applyNodeGeometry to wrap`);
    }

    // THE WHOLE-BOARD BLAST RADIUS, and it is still reachable on the ORDINARY
    // remote path: `main.ts:3231-3235` escalates a per-node geometry pass to a
    // full `setData` the moment a node WITH EDGES actually moves. WP119 removed
    // the revert's escalation; it did not remove this one. On a board where most
    // cards have arrows, one moved card re-lays-out everything — which is the
    // owner's symptom verbatim. This row's `moved` list is what catches it, and
    // it is expected to be the loudest row in a broken dump.
    const undoReload = diagPatch(host, "reloadCanvasData", (original) =>
      function (this: unknown, ...args: unknown[]): unknown {
        let beforeAll: Record<string, DiagGeometry> = {};
        let beforeRead = true;
        try {
          beforeAll = viewSnapshot(adapter);
        } catch {
          beforeRead = false;
        }
        const result = original.apply(this, args);
        try {
          const afterAll = viewSnapshot(adapter);
          const moved: Array<{
            nodeId: string;
            from: DiagGeometry | null;
            to: DiagGeometry | null;
          }> = [];
          for (const id of new Set([...Object.keys(beforeAll), ...Object.keys(afterAll)])) {
            if (!diagGeoDiffers(beforeAll[id], afterAll[id])) continue;
            moved.push({ nodeId: id, from: beforeAll[id] ?? null, to: afterAll[id] ?? null });
          }
          const payload = args[0] as { nodes?: unknown; edges?: unknown } | null | undefined;
          push({
            t: Date.now(),
            kind: "setData",
            path,
            ok: result === true,
            nodeCount: Array.isArray(payload?.nodes) ? payload.nodes.length : null,
            edgeCount: Array.isArray(payload?.edges) ? payload.edges.length : null,
            // R7 — a `moved: []` produced by a FAILED pre-reading must not read
            // as "nothing moved". It says which it is.
            beforeRead,
            moved: moved.sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
            movedCount: moved.length,
            cause: causeNow ?? "remote-apply",
            causeResolved: causeNow !== null,
          });
        } catch {
          /* diagnostics must never break canvas interaction */
        }
        return result;
      },
    );
    if (undoReload) {
      removers.push({ what: "patch", undo: undoReload });
      installed++;
    } else {
      notes.push(`I2: '${path}' exposes no reloadCanvasData to wrap`);
    }
    return installed;
  };

  /**
   * I5 — THE Y TRANSACTION-ORIGIN LEDGER. The doc plane's "who moved it".
   *
   * One listener, no patch, and the highest yield per line in this package: it
   * settles H3 and H6 outright, and it is the ONE instrument that can see H9 —
   * the only shape that produces ACCUMULATION rather than a single jump.
   *
   * Origins are already a first-class named vocabulary in this codebase, eight
   * symbols carrying `.description`: `canvas-capture-origin`,
   * `canvas-capture-migration-origin`, `canvas-binding-origin`,
   * `canvas-epoch-adopt-origin`, `canvas-migration-origin`,
   * `canvas-import-seed-origin`, `canvas-seed-origin`, `sidecar-load-origin`.
   * Anything unrecognised is passed through verbatim — a `null` origin with
   * `local === true` is itself a finding.
   *
   * ⚠ WHAT TO LOOK FOR AND STOP ON: a `canvas-capture-origin` transaction with
   * `local: true`, for a node the local user never touched, arriving right after
   * an I2 row for that same node. That is the corrective view-write re-entering
   * capture and being broadcast as this peer's own edit. `reconcileLiveCanvas`
   * guards against exactly this with `mutePathEvents` (`main.ts:3176` — "so the
   * reconcile never loops back into a sync"); `applyCanvasNodeRevert` does NOT
   * (`main.ts:4095`, and it says so explicitly). One such row is sufficient on
   * its own to explain error that GROWS per click.
   *
   * A row is emitted for EVERY transaction, geometry change or none (R6). That
   * is what answers H6 as a straight yes/no: does a selection produce a doc
   * transaction at all?
   *
   * It reads the doc through `diagDocCensus`, i.e. through `getCanvasSnapshot`,
   * the SAME production read the census uses. A second decoder inside the rig
   * would be `S158`'s family in a new place: the shared node records are not
   * plain `{x,y}` maps, they are expanded by `toCanonicalFileRecord`, so a
   * hand-rolled reader here would silently report a different board.
   */
  const installYTransactionLedger = (path: string): number => {
    const cs = plugin.canvasSync;
    if (!cs) {
      notes.push("I5 y-transaction ledger NOT installed: this instance exposes no canvasSync");
      return 0;
    }
    let handle: { doc: Y.Doc } | null = null;
    try {
      handle = cs.getCanvasDocHandle(path);
    } catch {
      handle = null;
    }
    if (!handle?.doc) {
      notes.push(
        `I5 y-transaction ledger NOT installed: no shared canvas doc handle for '${path}' on this peer (not subscribed?)`,
      );
      return 0;
    }
    const doc = handle.doc;
    const lastSeen = new Map<string, DiagGeometry>();
    const readAll = (): Map<string, DiagGeometry> => {
      const out = new Map<string, DiagGeometry>();
      const plane = diagDocCensus(plugin, path);
      if (plane.available !== true) return out;
      for (const [id, geo] of Object.entries(plane.nodes)) out.set(id, geo);
      return out;
    };
    try {
      for (const [id, geo] of readAll()) lastSeen.set(id, geo);
    } catch {
      notes.push(`I5: the baseline doc reading for '${path}' failed; the first row's deltas are against an empty board`);
    }
    const listener = (tr: Y.Transaction): void => {
      try {
        const current = readAll();
        const changed: Array<{
          nodeId: string;
          from: DiagGeometry | null;
          to: DiagGeometry | null;
        }> = [];
        for (const id of new Set([...lastSeen.keys(), ...current.keys()])) {
          const from = lastSeen.get(id);
          const to = current.get(id);
          if (!diagGeoDiffers(from, to)) continue;
          changed.push({ nodeId: id, from: from ?? null, to: to ?? null });
        }
        lastSeen.clear();
        for (const [id, geo] of current) lastSeen.set(id, geo);
        push({
          t: Date.now(),
          kind: "ytxn",
          path,
          origin: diagRenderOrigin((tr as { origin?: unknown }).origin),
          local: tr.local === true,
          changed: changed.sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
          changedCount: changed.length,
          docClientId: doc.clientID,
        });
      } catch {
        /* diagnostics must never break canvas interaction */
      }
    };
    doc.on("afterTransaction", listener);
    removers.push({ what: "listener", undo: () => doc.off("afterTransaction", listener) });
    return 1;
  };

  /**
   * I3 + I4 — THE REVERT-DECISION AND EXPIRY LEDGERS.
   *
   * Both are INSTANCE patches on the live `CanvasPresence`. `canvas-presence.ts`
   * is byte + SHA-256 pinned and is not touched: its awareness listener calls
   * `this.expireIdleInferredLocks()` (`:367`) and `this.reconcileClaims()`
   * (`:370`), and `this.`-dispatch resolves an own property before the
   * prototype, so an own-property wrapper intercepts both (R1).
   *
   * WHAT THEY MEASURE, and why both call sites emit a row EVERY time (R6,
   * `S155`): a sweep that DECLINED must be distinguishable from one that never
   * ran. `revertedCount: 0` and "no reconcile row at all" are different bugs.
   *
   * `wouldHaveReverted` (I4) is the discriminator for H1: "had this claim
   * survived to `reconcileClaims()` two lines later, would the loser-revert have
   * fired on it?" — evaluated BEFORE the original runs, because after it the
   * claim is gone. If a click produces `expired: […]` with
   * `wouldHaveReverted: true`, WP120's reordering is provably eating reverts
   * that used to fire. If `expired: []` on every click, H1 is dead.
   *
   * NOTE H1's own arithmetic before building on it: `INFERRED_LOCK_IDLE_MS` is
   * 15 000 ms, so a claim only expires after 15 s idle. H1 therefore REQUIRES
   * claims that are already stale. That is a condition, not a given, and this
   * ledger measures it rather than assuming it.
   *
   * `docPos` is read BEFORE the original, from `getCanvasSnapshot`, because that
   * is exactly what `revertCanvasNode` will read (`main.ts:3999`) — so the row
   * records the value the revert is about to aim AT, not one taken after.
   *
   * It emits NO awareness state. It must never call `presence.refresh()` or
   * `emitLocalState()`, and it does not: every read below is `getStates()`, a
   * `hasOwnProperty` test, or a private-map read through a cast.
   */
  const installPresenceLedgers = (target: DiagTarget): number => {
    const presence = target.presence;
    const path = target.path;
    if (!presence) {
      notes.push(
        `I3/I4 presence ledgers NOT installed on '${path}': no CanvasPresence instance is mounted`,
      );
      return 0;
    }
    const awareness = resolveDiagAwareness(plugin, path);
    if (!awareness) {
      notes.push(
        `I3/I4 on '${path}': no awareness handle — holders, winner and wouldHaveReverted will read "unreadable"`,
      );
    }

    // TypeScript `private` is compile-time only. A cast here is honest: this is
    // a diagnostic, and the alternative — inferring the claim set from
    // `isLockedByMe` over the LIVE node ids — misses a claim on a node that is
    // not in the view, which is precisely the leak's known shape (claims held on
    // deleted cards). An absent field reports "unreadable", never `{}` (R7).
    const readLockedNodes = (): string[] | "unreadable" => {
      const raw = presence.lockedNodes;
      if (raw === null || typeof raw !== "object") return "unreadable";
      return Object.keys(raw as Record<string, unknown>).sort();
    };
    const readLockMeta = (): Record<string, unknown> | "unreadable" => {
      const raw = presence.lockMeta;
      if (!(raw instanceof Map)) return "unreadable";
      const out: Record<string, unknown> = {};
      for (const [key, value] of raw as Map<unknown, unknown>) out[String(key)] = value;
      return out;
    };
    const states = (): Map<number, Record<string, unknown>> | null => {
      try {
        return awareness ? awareness.getStates() : null;
      } catch {
        return null;
      }
    };
    const docPositions = (): Record<string, DiagGeometry> => {
      const plane = diagDocCensus(plugin, path);
      return plane.available === true ? plane.nodes : {};
    };
    /** Per-node tiebreak facts, taken from awareness BEFORE the original runs. */
    const tiebreak = (
      nodeIds: string[],
      snapshot: Map<number, Record<string, unknown>> | null,
      myId: number | null,
    ): Record<string, Record<string, unknown>> => {
      const out: Record<string, Record<string, unknown>> = {};
      const doc = docPositions();
      for (const nodeId of nodeIds) {
        if (snapshot === null || myId === null) {
          out[nodeId] = {
            holders: "unreadable",
            winner: null,
            lower: null,
            wouldHaveReverted: null,
            docPos: doc[nodeId] ?? null,
            viewPos: target.adapter ? safeNodeGeometry(target.adapter, nodeId) : null,
          };
          continue;
        }
        // THE PRODUCTION PREDICATE, not a copy of it (§7 amendment A-68-1/2).
        const holders = holdersOf(path, nodeId, snapshot);
        const lower = holders.some((id) => id !== myId && id < myId);
        out[nodeId] = {
          holders,
          winner: holders.length > 0 ? Math.min(...holders) : null,
          lower,
          wouldHaveReverted: lower,
          docPos: doc[nodeId] ?? null,
          viewPos: target.adapter ? safeNodeGeometry(target.adapter, nodeId) : null,
        };
      }
      return out;
    };

    let installed = 0;

    // --- I3: reconcileClaims ------------------------------------------------
    const undoReconcile = diagPatch(presence, "reconcileClaims", (original) =>
      function (this: unknown, ...args: unknown[]): unknown {
        const t = Date.now();
        let candidates: string[] | "unreadable" = "unreadable";
        let perNode: Record<string, Record<string, unknown>> = {};
        let myId: number | null = null;
        try {
          myId = awareness ? awareness.clientID : null;
          candidates = readLockedNodes();
          perNode = tiebreak(candidates === "unreadable" ? [] : candidates, states(), myId);
        } catch {
          /* a failed pre-reading leaves the row honest about it below */
        }
        // The cause flag. `onRevert` → `revertCanvasNode` → `applyCanvasNodeRevert`
        // → `applyNodeGeometry` is fully synchronous inside this call, so any I2
        // row produced while this is set was produced BY a revert.
        const previousCause = causeNow;
        causeNow = "revert";
        let result: unknown;
        try {
          result = original.apply(this, args);
        } finally {
          causeNow = previousCause;
        }
        try {
          const reverted = Array.isArray(result) ? (result as string[]) : [];
          const considered = candidates === "unreadable" ? [] : candidates;
          push({
            t,
            kind: "reconcile",
            path,
            entered: true,
            myClientId: myId,
            candidates,
            perNode: considered.map((nodeId) => ({
              nodeId,
              ...(perNode[nodeId] ?? {}),
              reverted: reverted.includes(nodeId),
            })),
            reverted,
            // R6 — BOTH counters, ALWAYS, even at zero.
            revertedCount: reverted.length,
            declinedCount: Math.max(0, considered.length - reverted.length),
            heldAfter: readLockedNodes(),
          });
        } catch {
          /* diagnostics must never break canvas interaction */
        }
        return result;
      },
    );
    if (undoReconcile) {
      removers.push({ what: "patch", undo: undoReconcile });
      installed++;
    } else {
      notes.push(`I3: '${path}' presence exposes no reconcileClaims to wrap`);
    }

    // --- I4: expireIdleInferredLocks ---------------------------------------
    // §4.2 — this member DOES NOT EXIST on a pre-WP120 bundle. Its absence is
    // recorded as a reading (`present: false` in the probe row below), not
    // crashed on and not silently omitted: it is how a dump proves which build
    // the peer it came from is running.
    const undoExpire = diagPatch(presence, "expireIdleInferredLocks", (original) =>
      function (this: unknown, ...args: unknown[]): unknown {
        const t = Date.now();
        let heldBefore: string[] | "unreadable" = "unreadable";
        let perNode: Record<string, Record<string, unknown>> = {};
        let metaBefore: Record<string, unknown> | "unreadable" = "unreadable";
        let myId: number | null = null;
        try {
          myId = awareness ? awareness.clientID : null;
          heldBefore = readLockedNodes();
          metaBefore = readLockMeta();
          // Evaluated BEFORE the original: after it, the claim this counterfactual
          // is about no longer exists.
          perNode = tiebreak(heldBefore === "unreadable" ? [] : heldBefore, states(), myId);
        } catch {
          /* as above */
        }
        const result = original.apply(this, args);
        try {
          const expired = Array.isArray(result) ? (result as string[]) : [];
          push({
            t,
            kind: "expire",
            path,
            entered: true,
            present: true,
            myClientId: myId,
            heldBefore,
            lockMetaBefore: metaBefore,
            expired,
            heldAfter: readLockedNodes(),
            perExpired: expired.map((nodeId) => ({ nodeId, ...(perNode[nodeId] ?? {}) })),
            // R6 — a zero row is still a row. An expire sweep that expired
            // nothing is a DIFFERENT fact from a sweep that never ran, and only
            // one of them refutes H1.
            expiredCount: expired.length,
            heldBeforeCount: heldBefore === "unreadable" ? null : heldBefore.length,
          });
        } catch {
          /* diagnostics must never break canvas interaction */
        }
        return result;
      },
    );
    if (undoExpire) {
      removers.push({ what: "patch", undo: undoExpire });
      installed++;
    }

    // THE PROBE ROW. Every member presence and every private-map readability,
    // recorded at arm time. `expireSweepPresent: false` is a pre-WP120 bundle
    // and is the deploy detector for the §4.2 A/B — the absence is the reading.
    push({
      t: Date.now(),
      kind: "probe",
      path,
      hasPresence: true,
      hasAwareness: awareness !== null,
      myClientId: awareness ? awareness.clientID : null,
      reconcileSweepPresent: undoReconcile !== null,
      expireSweepPresent: undoExpire !== null,
      lockedNodesReadable: readLockedNodes() !== "unreadable",
      lockMetaReadable: readLockMeta() !== "unreadable",
      lockedNodesAtArm: readLockedNodes(),
      lockMetaAtArm: readLockMeta(),
      viewSinksPatched: patchedPaths.includes(path),
    });
    if (undoExpire === null) {
      notes.push(
        `I4 on '${path}': expireIdleInferredLocks is ABSENT on this build (pre-WP120). That is a READING, not a failure — H1 cannot even be posed on this peer.`,
      );
    }
    return installed;
  };

  /**
   * I7 — THE VIEWPORT LEDGER. `{x, y, zoom}` on every viewport change.
   *
   * Registering adds one callback to a subscriber set the product already fans
   * out to; the callback calls `getViewport()` (`canvas-adapter.ts:949`, pure)
   * and pushes a row. It calls `refresh()` on nothing and touches no node.
   *
   * It exists for H5, and H5 is already very narrow: `refresh()`
   * (`canvas-presence.ts:596-631`) renders cursors and calls `applyRings`, which
   * only toggles a CSS class, sets a custom property and appends/removes a
   * `<div>` inside the card element — there is NO node-geometry write anywhere
   * on that path. So the only shape H5 can still produce is a view-plane move
   * with a viewport row within ~200 ms and NO I2 row, i.e. Obsidian's own layout
   * perturbed by the overlay child. I8 plus this ledger will show it if it
   * happens; rank it last.
   *
   * `zoom` is `log2(scale)`, clamped to [-4, 1] — logarithmic, never a
   * multiplier. It is reported raw and is not converted here.
   */
  const installViewportLedger = (target: DiagTarget): number => {
    const adapter = target.adapter;
    if (!adapter || typeof adapter.onViewportChange !== "function") {
      notes.push(`I7 viewport ledger NOT installed on '${target.path}': no onViewportChange`);
      return 0;
    }
    const path = target.path;
    const read = (): unknown => {
      try {
        return adapter.getViewport?.() ?? null;
      } catch {
        return null;
      }
    };
    let dispose: (() => void) | null = null;
    try {
      dispose = adapter.onViewportChange(() => {
        try {
          push({ t: Date.now(), kind: "viewport", path, viewport: read() });
        } catch {
          /* diagnostics must never break canvas interaction */
        }
      });
    } catch {
      notes.push(`I7 on '${path}': onViewportChange refused the subscription`);
      return 0;
    }
    if (typeof dispose !== "function") return 0;
    const undo = dispose;
    removers.push({ what: "listener", undo });
    // The baseline, so the first change row has something to be a change FROM.
    push({ t: Date.now(), kind: "viewport", path, viewport: read(), baseline: true });
    return 1;
  };

  /**
   * Install every hook for `path`. Each installer probes before it patches
   * (§4.2): an absent member is recorded as a note, never crashed on, because
   * the absence is itself the reading that names which bundle a peer is on.
   */
  const install = (path: string): void => {
    const { targets, accessorError } = resolveDiagTargetsResult(plugin, path);
    // B70 — same R7 split as `diagViewCensus`. This note is what a live session
    // reads first, and for the whole B68 run it said "nothing is open" about
    // three peers that each had eleven live nodes.
    if (accessorError !== null) {
      notes.push(
        `the mounted-board accessor FAILED on this peer, so nothing could be hooked and the VIEW plane will read unavailable — ${accessorError}`,
      );
      return;
    }
    if (targets.length === 0) {
      notes.push(
        `no canvas view is mounted for '${path}' on this peer: nothing to hook, and the VIEW plane will read unavailable`,
      );
      return;
    }
    for (const target of targets) {
      patchedPaths.push(target.path);
      installViewWriteLedger(target);
      installPresenceLedgers(target);
      installViewportLedger(target);
    }
    installYTransactionLedger(path);
  };

  const uninstall = (): { patchesRemoved: number; listenersRemoved: number } => {
    let patchesRemoved = 0;
    let listenersRemoved = 0;
    for (const remover of removers) {
      try {
        remover.undo();
        if (remover.what === "patch") patchesRemoved++;
        else listenersRemoved++;
      } catch {
        /* a remover that throws must not strand the rest — diagnostics never break the vault */
      }
    }
    removers = [];
    patchedPaths = [];
    return { patchesRemoved, listenersRemoved };
  };

  return {
    async run(req: CanvasDiagRequest): Promise<unknown> {
      switch (req.op) {
        // Pure. Takes no baseline, installs nothing, and is safe on any peer at
        // any time — including one that was never armed.
        case "census": {
          if (!req.path) throw new Error("canvas.diag op 'census' requires a 'path'");
          return {
            diagProto: CANVAS_DIAG_PROTO,
            armed,
            census: await diagCensus(plugin, req.path),
            awareness: diagAwarenessSnapshot(plugin, req.path),
            mountedPaths: mountedPaths(),
          };
        }
        // I6 on its own, for a peer that only needs the wire read.
        case "awareness": {
          if (!req.path) throw new Error("canvas.diag op 'awareness' requires a 'path'");
          return {
            diagProto: CANVAS_DIAG_PROTO,
            armed,
            awareness: diagAwarenessSnapshot(plugin, req.path),
            mountedPaths: mountedPaths(),
          };
        }
        // ARM. Takes the baseline census and installs every hook. Re-arming
        // DESTROYS the previous baseline, so it says so loudly rather than
        // quietly resetting the thing a running session is measuring against.
        case "arm": {
          if (!req.path) throw new Error("canvas.diag op 'arm' requires a 'path'");
          const reArmed = armed;
          if (armed) uninstall();
          ring.length = 0;
          dropped = 0;
          notes = [];
          if (reArmed) {
            notes.push(
              "RE-ARMED: the previous arm census and ring were discarded. Between gestures use op:'mark', not a second arm.",
            );
          }
          armed = true;
          armedAt = Date.now();
          armedPath = req.path;
          install(req.path);
          armCensus = await diagCensus(plugin, req.path);
          return {
            diagProto: CANVAS_DIAG_PROTO,
            armed: true,
            reArmed,
            armedAt,
            path: req.path,
            patchedPaths: [...patchedPaths].sort(),
            mountedPaths: mountedPaths(),
            ringCapacity: CANVAS_DIAG_RING_CAPACITY,
            census: armCensus,
            awareness: diagAwarenessSnapshot(plugin, req.path),
            notes: [...notes],
          };
        }
        // MARK. A labelled fence in the ring: this is what makes "which click did
        // what" readable WITHOUT re-arming, and re-arming would destroy the I8
        // baseline.
        case "mark": {
          if (!armed) throw new Error("canvas.diag op 'mark': not armed");
          push({ t: Date.now(), kind: "mark", label: req.label ?? "" });
          return {
            diagProto: CANVAS_DIAG_PROTO,
            armed,
            marked: req.label ?? "",
            eventCount: ring.length,
            dropped,
          };
        }
        // DUMP. Does NOT clear the ring — §3.1 step 6 depends on that.
        case "dump": {
          if (!armed) {
            return {
              diagProto: CANVAS_DIAG_PROTO,
              armed: false,
              reason:
                "not armed: there is no baseline census to diff against, so no delta on this peer is evidence",
              mountedPaths: mountedPaths(),
            };
          }
          const path = req.path ?? armedPath;
          if (!path) throw new Error("canvas.diag op 'dump' requires a 'path'");
          const census = await diagCensus(plugin, path);
          const delta = diagUnattributed(
            path === armedPath ? armCensus : null,
            census,
            ring,
          );
          const dumpNotes = [...notes];
          if (path !== armedPath) {
            dumpNotes.push(
              `dumped path '${path}' is not the armed path '${armedPath}': the arm baseline does not apply and the delta tables are EMPTY BY REFUSAL, not by agreement`,
            );
          }
          const gap = mountedPaths().filter((p) => !patchedPaths.includes(p));
          if (gap.length > 0) {
            dumpNotes.push(`mounted but NOT patched by this arm: ${gap.join(", ")}`);
          }
          return {
            diagProto: CANVAS_DIAG_PROTO,
            armed: true,
            path,
            armedPath,
            armedAt,
            dumpedAt: Date.now(),
            patchedPaths: [...patchedPaths].sort(),
            mountedPaths: mountedPaths(),
            ringCapacity: CANVAS_DIAG_RING_CAPACITY,
            eventCount: ring.length,
            dropped,
            events: [...ring],
            armCensus,
            census,
            awareness: diagAwarenessSnapshot(plugin, path),
            unattributed: delta.unattributed,
            attributed: delta.attributed,
            notes: dumpNotes,
          };
        }
        // TEARDOWN. Always run this before the owner keeps using the vault.
        case "clear": {
          const removed = uninstall();
          armed = false;
          armedPath = null;
          armCensus = null;
          ring.length = 0;
          dropped = 0;
          notes = [];
          return {
            diagProto: CANVAS_DIAG_PROTO,
            armed: false,
            patchesRemoved: removed.patchesRemoved,
            listenersRemoved: removed.listenersRemoved,
          };
        }
        default:
          throw new Error(`canvas.diag: unknown op '${req.op}'`);
      }
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
  // B68 (`S188`) — one diagnostic per host. Constructing it INSTALLS NOTHING:
  // every hook is installed by `op:"arm"` and removed by `op:"clear"`, so a
  // plugin that never receives a `canvas.diag` command carries no wrapper, no
  // listener and no ring buffer state at all.
  const canvasDiagnostic = createCanvasDiagnostic(plugin);

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
        // S115 — the fourth fact the deletion decision now turns on, readable
        // WITHOUT running the destructive operation to find out. `null` only if
        // this host predates the capability entirely.
        hostSharedScope: mm.getHostSharedScope?.() ?? null,
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

    collabBindRefusals() {
      if (typeof plugin.getCollabBindRefusals !== "function") {
        throw new Error("collab.bindRefusals unavailable: this instance exposes no bind ledger");
      }
      return plugin.getCollabBindRefusals();
    },

    // S134 AC3 — the OTHER ledger: activations that ended in the `waitForSync`
    // timeout, where the compartment went empty and `collabBoundFile` used to go
    // on claiming the file was bound. Separate from the refusals above on S132's
    // ground — a counter dominated by an expected class cannot report the class
    // that still loses collaboration.
    collabBindFailures() {
      if (typeof plugin.getCollabBindFailures !== "function") {
        throw new Error("collab.bindFailures unavailable: this instance exposes no bind ledger");
      }
      return plugin.getCollabBindFailures();
    },

    canvasMirror() {
      if (typeof plugin.getLastCanvasMirrorReport !== "function") {
        throw new Error("canvas.mirror unavailable: this instance exposes no mirror report");
      }
      return plugin.getLastCanvasMirrorReport() ?? { role: null, considered: 0, entries: [] };
    },

    conflictCopies() {
      if (typeof plugin.getConflictCopies !== "function") {
        throw new Error(
          "sync.conflictCopies unavailable: this instance exposes no conflict-copy ledger",
        );
      }
      return plugin.getConflictCopies();
    },

    emptyWriteRefusals() {
      if (typeof plugin.getEmptyWriteRefusals !== "function") {
        throw new Error(
          "sync.emptyWriteRefusals unavailable: this instance exposes no empty-write ledger",
        );
      }
      return plugin.getEmptyWriteRefusals();
    },

    attestationDecisions() {
      if (typeof plugin.getAttestationDecisions !== "function") {
        throw new Error(
          "sync.attestationDecisions unavailable: this instance exposes no attestation ledger",
        );
      }
      return plugin.getAttestationDecisions();
    },

    singleWriterDeclines() {
      if (typeof plugin.getSingleWriterDeclines !== "function") {
        throw new Error(
          "sync.singleWriterDeclines unavailable: this instance exposes no single-writer ledger",
        );
      }
      return plugin.getSingleWriterDeclines();
    },

    pathOutcomes() {
      if (typeof plugin.getPathOutcomes !== "function") {
        throw new Error("sync.pathOutcomes unavailable: this instance exposes no give-up ledger");
      }
      return plugin.getPathOutcomes();
    },

    abandonedSubscribes() {
      if (typeof plugin.getAbandonedSubscribes !== "function") {
        throw new Error(
          "sync.abandonedSubscribes unavailable: this instance exposes no abandoned-subscribe set",
        );
      }
      return plugin.getAbandonedSubscribes();
    },

    muteDrops() {
      const manager = plugin.fileOpsManager;
      if (!manager || typeof manager.getMuteDrops !== "function") {
        throw new Error("fileop.muteDrops unavailable: no mute-drop ledger on this instance");
      }
      return manager.getMuteDrops();
    },

    escapingRenameRefusals() {
      const manager = plugin.fileOpsManager;
      if (!manager || typeof manager.getEscapingRenameRefusals !== "function") {
        throw new Error("fileop.escapingRenames unavailable: no ledger on this instance");
      }
      return { refused: manager.getEscapingRenameRefusals() };
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

    // B68 (`S188`) — the canvas-disjoint diagnostic. One object per host, held
    // in this closure, so its ring buffer and its patches die with the instance
    // whose surfaces they wrap.
    async canvasDiag(req) {
      return canvasDiagnostic.run(req);
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
