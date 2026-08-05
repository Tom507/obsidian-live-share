import { Notice, type Vault } from "obsidian";
import * as Y from "yjs";

import {
  type CanvasRecord,
  type CanvasRecordKind,
  canonicalizeRecord,
  roundCanvasGeometry,
} from "../canvas/canvas-canonical";
import {
  type OrdIdEntry,
  type OrdRng,
  allocateOrd,
  compareOrdId,
} from "../canvas/canvas-ord";
import {
  type IngestOrigin,
  type IngestReasonCode,
  validateEdgeIngest,
  validateNodeIngest,
} from "../canvas/canvas-ingest-schema";
import {
  type EndpointRegister,
  type EndpointSlot,
  type V2EdgeRecord,
  type V2Node,
  type V2RecordMap,
  ENDPOINT_FILE_KEYS,
  ENDPOINT_SLOTS,
  FROM_KEY,
  POS_KEY,
  SIZE_KEY,
  TO_KEY,
  V2_FIELD,
  decodeEndpointToFile,
  decodePos,
  decodeSize,
  encodeEndpointFromFile,
  encodePos,
  encodeSize,
  endpointEquals,
  isEndpointRegister,
  isPosRegister,
  isSizeRegister,
  posEquals,
  readEndpoint,
  readPosRegister,
  readSizeRegister,
  sizeEquals,
  writeEndpointRegister,
  writePosRegister,
  writeSizeRegister,
} from "../canvas/canvas-registers";
// WP28: the epoch rule. A VALUE import, and it does not close a cycle —
// `canvas-epoch.ts` is a near-pure core importing only `yjs` and
// `canvas-schema.ts` (charter §7.0), which is exactly why it lives in `canvas/`
// and takes its `.canvas` projection and its vault write by injection.
import {
  type EpochConflictEnv,
  type EpochConflictOutcome,
  readEpoch,
  resolveEpochConflict,
} from "../canvas/canvas-epoch";
import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
  isSchemaMajorMismatch,
} from "../canvas/canvas-schema";
import { guardTypeWrite } from "../canvas/canvas-type-guard";
import {
  type DeleteIntent,
  type FieldUpsertIntent,
  type IntentPlan,
  type ParsedSave,
  type ParsedSaveRecord,
  type ShadowFieldValue,
  type ShadowRecordKind,
  type SurfaceShadow,
  type SurfaceState,
  type TombstoneView,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordState,
  markRecordAbsent,
  planIntentDiff,
} from "../canvas/canvas-shadow";
// WP36: the THREE-WAY text merge. A VALUE import of a ZERO-import pure core, on
// the `canvas-seed-decision` / `reconcile-plan` precedent — it decides which ops
// a capture must emit into a nested `Y.Text`; this file emits them.
import {
  type TextMergeOp,
  type TextMergeResolution,
  planTextMerge,
} from "../canvas/canvas-text-merge";
import {
  type TombstoneMap,
  applyTombstoneOp,
  isTombstoneQuarantined,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../canvas/canvas-tombstone";
// WP38 (C38) — the undo SCOPE lives in its own headless module; this file holds
// the transaction it tags and the lifecycle the manager is bound to, and takes
// no decision about what is undoable.
import {
  CanvasUndoRegistry,
  captureConvertsCollabText,
  chooseCaptureOrigin,
} from "../canvas/canvas-undo";
import type { DocHandle, SyncManager } from "../sync/sync";
import {
  VAULT_EVENT_SETTLE_MS,
  ensureFolder,
  getFileByPath,
  isPathSafe,
  normalizePath,
  toCanonicalPath,
  toLocalPath,
} from "../utils";
// WP29: the seed decision's knowledge shape. A VALUE import of a ZERO-import
// pure core, so it cannot close a cycle with anything.
import { NOTHING_KNOWS_DOC, type SeedKnowledge } from "./canvas-seed-decision";
import type { SidecarIndex, SidecarStore } from "./canvas-sidecar";
// WP25: TYPE-only, deliberately. `canvas-sidecar-lifecycle` imports this module
// at runtime (for `createCanvasIdentityStore` and `DELETED_MAP_NAME`), so a
// value import here would close a cycle.
import type { SidecarLifecycle } from "./canvas-sidecar-lifecycle";
import type { FileOpsManager } from "./file-ops";
import type { ManifestManager } from "./manifest";

// ---------------------------------------------------------------------------
// WP27 / P2 — GUID DOC IDENTITY (C27). The doc-id surface, and the ONE
// constructor for it.
//
// The defect this closes is R5: a canvas doc used to be addressed by
// `__canvas__:<vault path>`, which makes the doc's IDENTITY a function of a
// value the user can change at any moment. Two consequences, both silent:
//
//   ├── a rename re-addressed the doc, so a mid-session rename produced a
//   │   SECOND, empty document and orphaned the one every peer was editing; and
//   └── a bare-path `getDoc(path)` could collide with a canvas doc and install a
//       raw `Y.Text` over a document `CanvasSync` owns structurally.
//
// After this WP the doc id is `__canvas__:<guid>`, the path is an ATTRIBUTE
// (`meta.path`, the manifest entry, the sidecar `index.json`), and a rename is a
// metadata update that touches neither the id nor the doc.
//
// Everything path-keyed STAYS path-keyed (AC3): the subscription registry, the
// doc-handle and snapshot lookups, the mute registry, `canvasOwned`, the
// persistence seams and — above all — the awareness field `canvasPath`. Re-keying
// any of them by guid would split every peer's presence into two disjoint rooms
// for the same canvas and open every advisory lock.
// ---------------------------------------------------------------------------

/**
 * The canvas doc-id namespace. Exported (Shared Ownership Contract §1) — WP25
 * and WP28 import it rather than re-spelling it.
 */
export const CANVAS_DOC_PREFIX = "__canvas__:";

/**
 * The ONE constructor for a canvas doc id. Nobody builds `` `${prefix}${x}` ``
 * by hand, in this module or any other.
 *
 * It THROWS for a non-string, empty or blank guid, and that refusal is the
 * point rather than defensive noise: an unresolved guid mapped to the bare
 * prefix would give EVERY canvas whose guid could not be resolved one shared
 * document — a strictly worse collision than the path-keyed one this WP removes,
 * and one that no convergence oracle could see (the two boards would converge
 * beautifully, into each other).
 */
export function canvasDocId(guid: string): string {
  if (typeof guid !== "string") {
    throw new TypeError(`canvasDocId: guid must be a string, got ${typeof guid}`);
  }
  if (guid.trim().length === 0) {
    throw new Error("canvasDocId: refusing to build a doc id from an empty guid");
  }
  return `${CANVAS_DOC_PREFIX}${guid}`;
}

/** WP27's initial epoch. WP28 owns every rule about what happens to it next. */
const INITIAL_CANVAS_EPOCH = 0;

function isUsableGuid(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Mint a fresh canvas guid: 32 lowercase hex characters, no separators.
 *
 * No new dependency — `crypto.getRandomValues` is present in Obsidian's Electron
 * renderer and in the test runner, and `crypto.subtle` is already relied on by
 * `manifest.ts`. The `Math.random` branch exists only so an exotic host cannot
 * turn a missing API into a thrown subscribe; it is not a security claim, and it
 * does not need to be — a canvas guid is a collision-avoidance token, not a
 * secret.
 *
 * Hex-only is deliberate: a guid must never be mistakable for a path, so it
 * carries no `/` and no extension.
 */
function mintCanvasGuid(): string {
  const bytes = new Uint8Array(16);
  const source = (globalThis as { crypto?: Crypto }).crypto;
  if (source?.getRandomValues) {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * The path <-> guid store. Async because `index.json` is a file.
 *
 * `guidForPath` answers `null` rather than minting: minting on a failed lookup
 * is exactly how a client ends up seeding a SECOND doc for a file a peer is
 * already editing, and neither doc can ever discover the other.
 */
export interface CanvasIdentityStore {
  guidForPath(path: string): Promise<string | null>;
  bind(guid: string, path: string): Promise<void>;
  unbind(path: string): Promise<void>;
}

/**
 * The production store: the manifest first (a peer published it this session),
 * then WP24's sidecar `index.json` (this client wrote it before the last
 * restart), which is `guid -> path` and is therefore scanned by VALUE.
 *
 * `bind` writes BOTH, and enforces the mapping's shape in both directions — one
 * guid names one path, one path is named by one guid — so a rename cannot leave
 * a second index row pointing at the file under its old name.
 *
 * `unbind` clears the manifest entry's guid at that path (through
 * `setCanvasGuid` with a blank guid, which is the one spelling this `Pick`
 * exposes) and drops every index row whose VALUE is that path.
 *
 * Both are idempotent: `ManifestManager.renameFile` re-keys the whole entry and
 * may well have moved the mapping before this runs.
 */
export function createCanvasIdentityStore(deps: {
  manifest: Pick<ManifestManager, "getCanvasGuid" | "setCanvasGuid"> | null;
  sidecar: Pick<SidecarStore, "readIndex" | "writeIndex"> | null;
}): CanvasIdentityStore {
  const { manifest, sidecar } = deps;

  return {
    async guidForPath(path: string): Promise<string | null> {
      const fromManifest = manifest?.getCanvasGuid(path) ?? null;
      if (isUsableGuid(fromManifest)) return fromManifest;
      if (!sidecar) return null;
      const index = await sidecar.readIndex();
      for (const [guid, mapped] of Object.entries(index)) {
        if (mapped === path && isUsableGuid(guid)) return guid;
      }
      return null;
    },

    async bind(guid: string, path: string): Promise<void> {
      if (!isUsableGuid(guid)) return;
      manifest?.setCanvasGuid(path, guid);
      if (!sidecar) return;
      const index = await sidecar.readIndex();
      const next: SidecarIndex = {};
      let changed = index[guid] !== path;
      for (const [existingGuid, existingPath] of Object.entries(index)) {
        // A path is named by exactly ONE guid. A stale row for this path under a
        // different guid is what a rename would otherwise leave behind, and it
        // would resolve peers to a doc nobody is editing.
        if (existingGuid !== guid && existingPath === path) {
          changed = true;
          continue;
        }
        next[existingGuid] = existingPath;
      }
      next[guid] = path;
      if (changed) await sidecar.writeIndex(next);
    },

    async unbind(path: string): Promise<void> {
      manifest?.setCanvasGuid(path, "");
      if (!sidecar) return;
      const index = await sidecar.readIndex();
      const next: SidecarIndex = {};
      let changed = false;
      for (const [existingGuid, existingPath] of Object.entries(index)) {
        if (existingPath === path) {
          changed = true;
          continue;
        }
        next[existingGuid] = existingPath;
      }
      if (changed) await sidecar.writeIndex(next);
    },
  };
}

// Bug L1: remote->disk write latency. Trailing debounce (short) plus a max-wait
// cap so a continuous stream of remote updates still flushes to disk regularly
// instead of the trailing timer resetting forever.
export const DEBOUNCE_MS = 200;
export const MAX_WAIT_MS = 500;

// Scatter fix (v0.5.6): geometry keys that define WHERE a card sits. Obsidian
// never removes these from a node that still exists — a live node losing x/y/w/h
// is always a transient/partial disk read, never a real user intent. The key-diff
// and full-merge paths therefore NEVER delete these keys, so a stray partial read
// can no longer strip a node's position out of the shared CRDT (→ scatter on all
// peers). They are still SET normally when a real new value is present.
export const GEOMETRY_KEYS = new Set(["x", "y", "width", "height"]);

// WP5 (US3 AC9): the wider STRUCTURAL key set the delete guards honour. Same
// reasoning as GEOMETRY_KEYS, one level up: a live record never legitimately
// loses one of these keys, and losing one is silently catastrophic rather than
// merely ugly.
//
// ├── `type`                → Obsidian's importData SKIPS any node whose type is
// │                           not file|text|link|group, so a type-less node and
// │                           every edge attached to it silently vanish on all
// │                           peers (the disk file still "looks" fine).
// ├── `fromNode` / `toNode` → importData creates an edge only when BOTH endpoints
// │                           exist; an edge that LOST the key entirely also slips
// │                           past buildCanvasData's dangling-edge guard (which
// │                           requires a string), so it reaches disk and then
// │                           disappears on every peer — "connections break".
// └── `fromSide` / `toSide` → the arrow's routing. Losing it makes Obsidian
//                             recompute + re-save its own routing, which then
//                             fights the sync as a fresh local edit.
//
// GEOMETRY_KEYS keeps its exact membership (US3 AC10) — it is exported and
// asserted elsewhere; this is a strict superset used only by the delete guards.
// Content keys (`text`, `color`, `label`, `file`, `url`) stay deletable: removing
// them is a real, reversible user intent.
export const PROTECTED_KEYS = new Set([
  ...GEOMETRY_KEYS,
  "type",
  "fromNode",
  "toNode",
  "fromSide",
  "toSide",
]);

// Minimal structural logger so CanvasSync can narrate the data path into the
// status console without importing the concrete DebugLogger (avoids a cycle).
export interface CanvasSyncLogger {
  debug(category: string, message: string): void;
  warn(category: string, message: string): void;
}

// ---------------------------------------------------------------------------
// WP16 / P1 — `parseCanvas` V2 and the conservative `ord` capture policy.
// ---------------------------------------------------------------------------
//
// The `.canvas` FILE keeps its shape forever: flat `x`/`y`/`width`/`height` on a
// node, flat `fromNode`/`fromSide`/`fromEnd` + `to*` on an edge, and record
// order carried by the two JSON arrays. The DOC does not: geometry is one atomic
// `pos` register and one atomic `size` register (WP9), an endpoint is one atomic
// `from` / `to` register (WP10), and order is DATA — every record carries an
// `ord` (WP13) rather than inheriting the container's iteration order.
//
// `parseCanvas` is the file→doc read boundary, so this is where the translation
// belongs. It now returns
//
//   ├── `nodes` → `Record<string, V2Node>`        (registers, WP9/WP10)
//   ├── `edges` → `Record<string, V2EdgeRecord>`  (registers, WP9/WP10)
//   └── `order` → the ids in exact FILE-ARRAY order, per id space
//
// The `order` observation exists because a `Record` cannot carry it: key
// iteration order is an accident of insertion, not a value, and the moment
// anything rebuilds the map the file's order is gone. AC1 makes it explicit —
// and `deriveOrdAssignments` below is the only thing allowed to turn that
// observation into `ord` writes.

/**
 * The ids of one parsed save, per id space, in exact `.canvas` array order.
 *
 * Only ids that actually made it into the record maps appear here: an entry the
 * reader dropped (no `id`) leaves neither a phantom id nor a gap (AC4).
 */
export interface RecordOrderObservation {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

export interface CanvasData {
  nodes: Record<string, V2Node>;
  edges: Record<string, V2EdgeRecord>;
  /** WP16 AC1: the file's array order, preserved rather than discarded. */
  order: RecordOrderObservation;
}

/**
 * The pre-V2, FILE-keyed record shape — flat `x`/`y`/`width`/`height` and flat
 * `fromNode`/`fromSide`/`to*`, exactly as `parseCanvas` used to return it.
 *
 * TEMPORARY P1 SEAM. It exists only so the write paths that still speak the flat
 * vocabulary (`applyCanvasToYMaps` on the host seed, `toParsedSave` on the local
 * capture, `CanvasPersistence.coldOpen`'s one-time file seed) keep seeing what
 * they see today while `parseCanvas` itself moves to the V2 registers. See
 * {@link decodeCanvasDataToFlat}.
 */
export interface FlatCanvasData {
  nodes: Record<string, Record<string, unknown>>;
  edges: Record<string, Record<string, unknown>>;
}

/**
 * Every `.canvas` file key an endpoint register consumes, derived from WP10's
 * own `ENDPOINT_FILE_KEYS` so the six literals are never re-spelt here (Shared
 * Ownership Contract §1).
 */
const ENDPOINT_FILE_KEY_SET: ReadonlySet<string> = new Set(
  ENDPOINT_SLOTS.flatMap((slot) => Object.values(ENDPOINT_FILE_KEYS[slot]) as string[]),
);

/**
 * File → doc for ONE node record.
 *
 * The flat geometry keys are replaced by the atomic registers IN PLACE — `pos`
 * takes `x`'s slot and `size` takes `width`'s — so the record's remaining key
 * order is untouched and {@link decodeCanvasDataToFlat} reproduces the original
 * file record verbatim.
 *
 * A register is built only from a WHOLE pair. A node carrying `x` without a
 * numeric `y` (a partial/transient disk read — the very case `GEOMETRY_KEYS`
 * exists to survive) keeps its flat keys rather than losing them to a
 * half-built register: absent geometry stays absent, present geometry stays
 * present, and nothing is silently dropped.
 */
function toV2Node(source: Record<string, unknown>): V2Node {
  const x = source.x;
  const y = source.y;
  const width = source.width;
  const height = source.height;
  const pos = typeof x === "number" && typeof y === "number" ? encodePos(x, y) : undefined;
  const size =
    typeof width === "number" && typeof height === "number" ? encodeSize(width, height) : undefined;

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (pos !== undefined && (key === "x" || key === "y")) {
      if (key === "x") record[POS_KEY] = pos;
      continue;
    }
    if (size !== undefined && (key === "width" || key === "height")) {
      if (key === "width") record[SIZE_KEY] = size;
      continue;
    }
    record[key] = value;
  }
  // Defensive: a file whose geometry keys appear in an unusual order (`y` before
  // `x`) must still get its registers, just not in the pretty slot.
  if (pos !== undefined && !(POS_KEY in record)) record[POS_KEY] = pos;
  if (size !== undefined && !(SIZE_KEY in record)) record[SIZE_KEY] = size;
  return record as unknown as V2Node;
}

/**
 * File → doc for ONE edge record. Same in-place substitution as
 * {@link toV2Node}: the whole `from` register replaces `fromNode`'s slot and
 * consumes `fromSide` / `fromEnd`, likewise for `to`.
 *
 * `encodeEndpointFromFile` (WP10) is the only decoder — a file that does not
 * carry a WHOLE endpoint yields `undefined`, and those flat keys are then kept
 * verbatim rather than dropped into a half-built register.
 */
function toV2Edge(source: Record<string, unknown>): V2EdgeRecord {
  const registers = new Map<EndpointSlot, EndpointRegister>();
  for (const slot of ENDPOINT_SLOTS) {
    const endpoint = encodeEndpointFromFile(slot, source);
    if (endpoint !== undefined) registers.set(slot, endpoint);
  }

  const record: Record<string, unknown> = {};
  const emitted = new Set<EndpointSlot>();
  for (const [key, value] of Object.entries(source)) {
    let consumedBy: EndpointSlot | undefined;
    if (ENDPOINT_FILE_KEY_SET.has(key)) {
      for (const [slot, keys] of Object.entries(ENDPOINT_FILE_KEYS) as [
        EndpointSlot,
        { node: string; side: string; end: string },
      ][]) {
        if (!registers.has(slot)) continue;
        if (key === keys.node || key === keys.side || key === keys.end) {
          consumedBy = slot;
          break;
        }
      }
    }
    if (consumedBy !== undefined) {
      if (!emitted.has(consumedBy)) {
        record[consumedBy] = registers.get(consumedBy);
        emitted.add(consumedBy);
      }
      continue;
    }
    record[key] = value;
  }
  for (const [slot, endpoint] of registers) {
    if (!emitted.has(slot)) record[slot] = endpoint;
  }
  return record as unknown as V2EdgeRecord;
}

export function parseCanvas(content: string): CanvasData {
  try {
    const parsed = JSON.parse(content);
    const nodes: Record<string, V2Node> = {};
    const edges: Record<string, V2EdgeRecord> = {};
    const nodeOrder: string[] = [];
    const edgeOrder: string[] = [];
    if (Array.isArray(parsed.nodes)) {
      for (const node of parsed.nodes) {
        // AC4: an entry without an `id` is dropped — from the record map AND
        // from the order observation. Unchanged truthiness check on purpose.
        if (node.id) {
          if (!Object.prototype.hasOwnProperty.call(nodes, node.id)) nodeOrder.push(node.id);
          nodes[node.id] = toV2Node(node);
        }
      }
    }
    if (Array.isArray(parsed.edges)) {
      for (const edge of parsed.edges) {
        if (edge.id) {
          if (!Object.prototype.hasOwnProperty.call(edges, edge.id)) edgeOrder.push(edge.id);
          edges[edge.id] = toV2Edge(edge);
        }
      }
    }
    return { nodes, edges, order: { nodes: nodeOrder, edges: edgeOrder } };
  } catch {
    // AC4: a JSON error yields EMPTY records rather than throwing. Preserved
    // byte for byte, now extended to the new `order` field.
    return { nodes: {}, edges: {}, order: { nodes: [], edges: [] } };
  }
}

/**
 * WP17 AC5 (part 2) — the file keys whose value the `.canvas` schema TYPES, and
 * for which `null` / `""` is therefore junk rather than a value.
 *
 * ├── the four geometry keys → required NUMBERS. They stay required and they
 * │                            stay numbers; this set does not make them
 * │                            optional, it only says a `null` / `""` sitting
 * │                            under one of them is not a coordinate.
 * └── the six endpoint keys  → `*Node` is a required non-empty string and
 *                              `*Side` / `*End` are optional strings. `null` and
 *                              `""` are the SAME absence WP10's
 *                              `isAbsentComponent` already refuses to store.
 *
 * Derived from `GEOMETRY_KEYS` and WP10's `ENDPOINT_FILE_KEYS` so the ten
 * literals are never re-spelt (Shared Ownership Contract §1).
 */
const TYPED_FILE_KEYS: ReadonlySet<string> = new Set([
  ...GEOMETRY_KEYS,
  ...ENDPOINT_FILE_KEY_SET,
]);

/**
 * WP17 AC5 (part 2): is this flat doc value JUNK that must not reach disk?
 *
 * The canonical step drops only `undefined` — every other value, `null` and
 * `""` included, passes through by identity. So a record holding a flat
 * `fromSide: null` (a hand-edited file seeded through the flat vocabulary, or a
 * V1 record whose flat keys the additive migration kept) would reach disk as
 * `"fromSide": null` AND override a valid register's expansion. Closing the
 * omission in the register codec alone does not close that path; this does.
 *
 * Dropping is deliberately narrower than "drop every null": only a key the
 * `.canvas` schema types is judged, so an unknown/future key keeps passing
 * through untouched (canonicalisation is a REORDERING — deleting a key nobody
 * here understands would delete user data on every peer).
 */
function isJunkFileValue(key: string, value: unknown): boolean {
  if (value !== null && value !== "") return false;
  return TYPED_FILE_KEYS.has(key);
}

/**
 * Doc → file for ONE record: every register is expanded back into the flat
 * `.canvas` keys it was built from, in the slot the register occupies, and every
 * other field is passed through untouched.
 */
function decodeV2RecordToFlat(
  record: V2Node | V2EdgeRecord | Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const source = record as unknown as Record<string, unknown>;

  // PASS 1 — every register, expanded through its OWNING codec.
  //
  // OWNERSHIP (WP17 AC5 part 3): the two-pass precedence below was found and
  // fixed in passing while WP18 was implemented; it is now OWNED by WP17 and
  // pinned by
  // `__tests__/v2/wp17/test_tp15_flat_over_register_precedence_is_insertion_order_independent_visible.test.ts`.
  // That test asserts INSERTION-ORDER INDEPENDENCE, not merely the resulting
  // value — a value-only assertion passes even with the bug, and cross-replica
  // byte equality (AC3) provably cannot see this class at all, because both
  // replicas converge on the SAME wrong value.
  //
  // WP18: the two passes exist because a P1 doc can legitimately hold BOTH
  // spellings of the same fact. `migrateV1ToV2` is deliberately additive — it
  // ADDS `pos` / `size` / `from` / `to` and keeps the flat V1 keys it
  // translated — while the capture path and every peer still on this build
  // write the FLAT keys. A single-pass expansion resolved that collision by
  // `Y.Map` INSERTION ORDER, which is not a rule at all: whichever spelling
  // happened to be written first silently decided the file, so a peer moving a
  // migrated card could see it snap back to the register's stale coordinate.
  //
  // The rule is now explicit and replica-independent: the flat key WINS,
  // because in P1 it is the vocabulary every live writer authors in, and a
  // register is only ever a translation of it. A record that carries only the
  // register (anything the V2 cold-open seed wrote) is unaffected — there is no
  // flat key to override it. When the write boundaries move to the registers
  // (WP22/WP39) the flat keys stop being written at all and the precedence
  // becomes moot rather than wrong.
  for (const [key, value] of Object.entries(source)) {
    if (key === POS_KEY && isPosRegister(value)) {
      Object.assign(flat, decodePos(value));
      continue;
    }
    if (key === SIZE_KEY && isSizeRegister(value)) {
      Object.assign(flat, decodeSize(value));
      continue;
    }
    if ((key === FROM_KEY || key === TO_KEY) && isEndpointRegister(value)) {
      Object.assign(flat, decodeEndpointToFile(key, value));
    }
  }

  // PASS 2 — every non-register key, verbatim, overriding a register expansion.
  //
  // WP17 AC5 (part 2): "verbatim" stops at JUNK. A `null` / `""` under a key the
  // file schema types is not a value the flat vocabulary may win with — it is
  // dropped here, so it neither reaches disk nor overrides the register that
  // still holds the real answer.
  for (const [key, value] of Object.entries(source)) {
    if (key === POS_KEY && isPosRegister(value)) continue;
    if (key === SIZE_KEY && isSizeRegister(value)) continue;
    if ((key === FROM_KEY || key === TO_KEY) && isEndpointRegister(value)) continue;
    if (isJunkFileValue(key, value)) continue;
    flat[key] = value;
  }
  return flat;
}

/**
 * THE TEMPORARY P1 DECODE BRIDGE (WP16 → retired when the write boundaries move
 * to registers, WP22/WP39 — deliberately NOT by WP18; see below).
 *
 * `parseCanvas` now emits V2 registers, but the WRITE paths downstream of it
 * still speak the flat file vocabulary and push what they are handed straight
 * into a `Y.Map`:
 *
 *   ├── `applyCanvasToYMaps` / `applyToYMap` — the host seed and
 *   │   `CanvasPersistence.coldOpen`'s one-time file seed
 *   └── `toParsedSave` / `toParsedRecords` — the local-modify capture, whose
 *       Surface-Shadow is keyed by flat FIELD names
 *
 * WP18 wired the ingest GATE into those boundaries and deliberately left their
 * VOCABULARY alone: §2/§4 of the WP18 charter never mention this bridge, and the
 * doc is brought to V2 by `migrateV1ToV2` running AFTER the seed rather than by
 * the seed pre-empting it. So this bridge still sits IMMEDIATELY after every
 * internal `parseCanvas` call — the registers are the parse OUTPUT while the
 * consumers keep seeing exactly the shape they see today. It is a pure inverse
 * of the codec — `decodePos`/`decodeSize`/`decodeEndpointToFile` (WP9/WP10),
 * never a hand-rolled re-expansion — and it deletes itself the day the write
 * boundaries themselves move to registers (WP22/WP39).
 */
export function decodeCanvasDataToFlat(data: CanvasData): FlatCanvasData {
  const nodes: Record<string, Record<string, unknown>> = {};
  const edges: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(data.nodes)) {
    nodes[id] = decodeV2RecordToFlat(node);
  }
  for (const [id, edge] of Object.entries(data.edges)) {
    edges[id] = decodeV2RecordToFlat(edge);
  }
  return { nodes, edges };
}

/**
 * Longest strictly-increasing subsequence, returned as INDICES into `values`.
 *
 * This is what makes AC3's "minimal" a computation rather than a hope: the
 * records whose positions form a longest increasing subsequence are already in
 * the right relative order and may keep their `ord`; everything else must move.
 * `n - |LIS|` is provably the smallest number of records that can be reassigned
 * to realise the observed permutation, so no cheaper answer exists.
 */
function longestIncreasingSubsequence(values: readonly number[]): number[] {
  const tails: number[] = [];
  const predecessor: number[] = new Array<number>(values.length).fill(-1);
  for (let index = 0; index < values.length; index++) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[tails[mid]] < values[index]) low = mid + 1;
      else high = mid;
    }
    if (low > 0) predecessor[index] = tails[low - 1];
    tails[low] = index;
  }
  const result: number[] = [];
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cursor >= 0) {
    result.push(cursor);
    cursor = predecessor[cursor];
  }
  return result.reverse();
}

/**
 * WP16 AC2/AC3 — THE CONSERVATIVE `ord` CAPTURE POLICY.
 *
 * Given what the doc currently holds (`previous`: every surviving record's
 * `(ord, id)`) and what the file now says the order is (`nextOrder`, the
 * observation `parseCanvas` produced), decide which records need a NEW `ord`.
 *
 * The returned map contains ONLY ids whose `ord` is new or reassigned. An id
 * absent from the map keeps its existing `ord` untouched — that is the whole
 * point: a re-parse of an unchanged document returns an EMPTY map, because
 * churn on an unchanged document is the failure AC2 exists to prevent.
 *
 * How "has the order demonstrably changed" is answered:
 *
 *   ├── the CURRENT order is recomputed from `previous` with WP13's
 *   │   `compareOrdId` — never `previous`'s array position, never `<` on raw
 *   │   strings, never `localeCompare`. `ord` ordering is WP13's and only
 *   │   WP13's (Shared Ownership Contract §1); if this file compared `ord`s by
 *   │   a different rule than WP17's serialiser, both suites would pass while
 *   │   replicas silently disagreed on file byte order.
 *   ├── ids in `nextOrder` with no previous `ord` are NEW — they are allocated,
 *   │   and they alone. Appending never touches an existing record (AC2).
 *   ├── ids in `previous` missing from `nextOrder` are gone; a deleted record
 *   │   needs no `ord`, and its absence is not evidence of a reorder.
 *   └── among the ids present in BOTH, the longest subsequence already in the
 *       right relative order keeps its `ord` and every other id is reassigned —
 *       the provably minimal reassignment for the observed change (AC3).
 *
 * Each reassigned/new `ord` is allocated strictly between its resolved
 * predecessor and the next id that KEPT its `ord`, so the resulting `(ord, id)`
 * total order reproduces `nextOrder` exactly. `rng` is WP13's injected
 * randomness seam, threaded through unchanged so a whole allocation sequence is
 * reproducible under a seeded generator.
 *
 * `ord` is doc-only. Nothing here ever writes it back to the `.canvas` file.
 */
export function deriveOrdAssignments(
  previous: readonly OrdIdEntry[],
  nextOrder: readonly string[],
  clientID: string,
  rng?: OrdRng,
): Map<string, string> {
  const assignments = new Map<string, string>();

  const previousOrds = new Map<string, string>();
  for (const entry of previous) {
    previousOrds.set(entry.id, entry.ord);
  }

  // The observed order, de-duplicated. `parseCanvas` already yields unique ids;
  // this only makes the function total for a hand-built argument.
  const observed: string[] = [];
  const seen = new Set<string>();
  for (const id of nextOrder) {
    if (seen.has(id)) continue;
    seen.add(id);
    observed.push(id);
  }

  // The records that exist in BOTH views — the only ones whose relative order
  // can have "demonstrably changed".
  const survivors: OrdIdEntry[] = [];
  for (const id of observed) {
    const ord = previousOrds.get(id);
    if (ord !== undefined) survivors.push({ id, ord });
  }

  // The CURRENT order, per WP13's canonical `(ord, id)` comparator.
  const canonicalIndex = new Map<string, number>();
  [...survivors].sort(compareOrdId).forEach((entry, index) => {
    canonicalIndex.set(entry.id, index);
  });

  // Survivors in OBSERVED order, expressed as their CURRENT positions. A
  // strictly increasing sequence means the relative order is unchanged.
  const positions = survivors.map((entry) => canonicalIndex.get(entry.id) as number);
  const keep = new Set<string>(
    longestIncreasingSubsequence(positions).map((index) => survivors[index].id),
  );

  // Resolve the final `ord` of every observed id, left to right. A kept id
  // resolves to its existing value; anything else is allocated strictly between
  // its already-resolved predecessor and the next id that keeps its `ord`
  // (undefined on either side = the head / the tail of the sequence).
  const resolved = new Map<string, string>();
  for (const id of keep) {
    resolved.set(id, previousOrds.get(id) as string);
  }
  for (let index = 0; index < observed.length; index++) {
    const id = observed[index];
    if (resolved.has(id)) continue;
    const before = index > 0 ? resolved.get(observed[index - 1]) : undefined;
    let after: string | undefined;
    for (let ahead = index + 1; ahead < observed.length; ahead++) {
      const kept = resolved.get(observed[ahead]);
      if (kept !== undefined) {
        after = kept;
        break;
      }
    }
    const ord = allocateOrd(before, after, clientID, rng);
    resolved.set(id, ord);
    assignments.set(id, ord);
  }

  return assignments;
}

// ---------------------------------------------------------------------------
// WP17 / P1 — THE CANONICAL SERIALIZER V2 (the doc→file projection).
// ---------------------------------------------------------------------------
//
// `buildCanvasData` is the one place the DOC becomes the FILE, so it is where
// the three V2 differences between the two worlds are undone, in this order:
//
//   ├── SUPPRESSION → a record the tombstone predicate suppresses is not
//   │                 emitted, and neither is an edge whose endpoint record is
//   │                 suppressed (AC2, the cascade).
//   ├── EXPANSION   → `pos`/`size` (WP9) and `from`/`to` (WP10) are decoded back
//   │                 into the flat file keys through the OWNING codecs, and
//   │                 `ord` (WP13) is dropped — it is doc-only and leaking it
//   │                 would put a key Obsidian does not expect into every real
//   │                 user's `.canvas` (AC1).
//   └── ORDER       → both arrays are sorted by `(ord, id)` using WP13's
//                     `compareOrdId` (AC1/AC3).
//
// WHY THE ARRAY NO LONGER GOES THROUGH `canonicalizeCanvasData`
// -------------------------------------------------------------------------
// WP3's `canonicalizeCanvasData` does two things: it canonicalises each record's
// KEY order, and it sorts the ARRAY by id — because in P0 `ord` did not exist
// and the id was the only order both peers provably shared. That array-level
// sort is now WRONG: routing an ord-sorted array through it silently re-sorts
// by id and discards the order entirely, with every suite still green. So WP17
// keeps the per-record half (`canonicalizeRecord`, applied below, with the
// record's kind) and owns the array order itself. `serializeCanonicalCanvas` is
// avoided for exactly the same reason — it calls `canonicalizeCanvasData`.
//
// The degenerate case is deliberate and load-bearing: a record with no `ord`
// (nothing has migrated it yet) contributes the empty string as its sort key, so
// a canvas where NO record carries an `ord` sorts purely by id — byte-identical
// to P0's output, which is what keeps the frozen WP3 suite green.

/** A record on its way to the file, with the `(ord, id)` key it sorts under. */
interface OrderedFileRecord {
  readonly entry: OrdIdEntry;
  /** Y.Map iteration index — a local-only tiebreak for two identical keys. */
  readonly index: number;
  readonly record: CanvasRecord;
}

/**
 * Is this id suppressed? THE question, asked through WP12's single predicate.
 *
 * Never an inline `entry?.on === true` and never a local `isDeleted` helper:
 * C12 AC2 requires reconcile (WP15), serialisation (this) and capture (WP19) to
 * share ONE predicate, "not three copies". No tombstone container at all (the
 * two-argument call sites) means nothing is suppressed — the pre-WP17
 * behaviour, unchanged.
 */
function isRecordSuppressed(deletedMap: TombstoneMap | undefined, id: string): boolean {
  if (deletedMap === undefined) return false;
  return isTombstoneSuppressed(readTombstoneEntry(deletedMap, id));
}

// ---------------------------------------------------------------------------
// WP36 / C36 — NESTED COLLABORATIVE TEXT for `text` and `label`.
// ---------------------------------------------------------------------------
//
// Card text and edge labels stop being whole-string LWW registers. The doc holds
// a nested `Y.Text` under those two keys, so two people editing the same card
// merge character-wise instead of one side's text vanishing.
//
// Three mechanisms make that safe, and each of them is a place the naive version
// goes wrong:
//
//   1. THE WRITE ROUTER (`applyIntentPlan`). `docValueEquals` has no `Y.Text`
//      arm — a string is never `===` a `Y.Text` — so the unmodified write at the
//      bottom of `applyIntentPlan` would `set()` a plain string over the
//      `Y.Text` on the FIRST capture after conversion, silently un-migrating the
//      record and discarding its history. The router takes the field to
//      {@link CanvasSync.writeCollabText} BEFORE the equality question is asked.
//      `docValueEquals` itself is deliberately NOT widened: it is a value
//      equality consumed by `upsertRecordFields` too, and teaching it that a
//      `Y.Text` "equals" a string would make real edits silently skip.
//   2. THE THREE-WAY MERGE (`canvas/canvas-text-merge.ts`). See that file.
//   3. THE PROJECTION RENDER (`toCanonicalFileRecord`). See there.
//
// The migration is LAZY and WRITE-TRIGGERED: the first capture that changes a
// card's text converts that one field, in ONE `set` of an ALREADY-POPULATED
// `Y.Text`. There is no bulk pass, no `delete`-then-`set`, and no empty
// `Y.Text` attached and filled afterwards — the key is populated at every
// observable instant, on every peer, so no reader ever sees a `text` node with
// no `text` and no refusal can compose into a deletion.

/** The two fields that carry user prose. Nodes have both; edges have `label`. */
function isCollabTextField(field: string): boolean {
  return field === V2_FIELD.text || field === V2_FIELD.label;
}

/**
 * Is this doc value a nested collaborative text?
 *
 * `instanceof Y.Text` and not a duck-type: this file already imports Yjs, and
 * the shape test that `isRichTextValue` has to use (it must stay pure) would
 * also accept a `Y.Map` or any plain object.
 */
function isYText(value: unknown): value is Y.Text {
  return value instanceof Y.Text;
}

/**
 * Doc value → the value a `.canvas` file / an Obsidian view / the Surface-Shadow
 * may hold. The ONLY transformation is `Y.Text` → its string; everything else is
 * passed through byte-identically, so no existing field changes shape.
 */
function renderDocValue(value: unknown): unknown {
  return isYText(value) ? value.toString() : value;
}

/**
 * C36 AC1's DOC-LEVEL WITNESS, emitted by the mechanism itself.
 *
 * A string read-back cannot satisfy AC1: the projected string is identical
 * whether the doc holds a `Y.Text` or a plain string, so an assertion over it is
 * green either way. This receipt reports what the capture actually did to the
 * DOC — whether the target was a `Y.Text`, whether this write performed the
 * conversion, and how many insert/delete ops were emitted. A capture reporting
 * `ops: 0, ytextAfter: false` for a card whose text changed has flattened the
 * field, however correct the resulting string is.
 *
 * NO USER TEXT APPEARS HERE — lengths and counts only (US6). The receipt is
 * readable over the E2E control channel, so it must not be able to carry vault
 * content out of the process.
 */
export interface TextWriteReceipt {
  readonly seq: number;
  /** The canonical `.canvas` path this write belonged to. */
  readonly path: string;
  readonly kind: ShadowRecordKind;
  readonly id: string;
  readonly field: string;
  /** What the doc held when the write began. */
  readonly targetBefore: "ytext" | "string" | "absent" | "other";
  /** Is the field a `Y.Text` now? AC1's "never replaced by a plain value". */
  readonly ytextAfter: boolean;
  /** Did this write perform the one-op lazy conversion? */
  readonly migrated: boolean;
  /** Insert/delete ops emitted into the `Y.Text`. */
  readonly ops: number;
  readonly resolution: TextMergeResolution;
  /** The counted context-anchoring fallback (design (a), charter §3). */
  readonly fallback: boolean;
  /** Did the Surface-Shadow supply a three-way base? */
  readonly baseObserved: boolean;
  readonly baseLength: number;
  readonly currentLength: number;
  readonly nextLength: number;
  readonly resultLength: number;
}

/** The last N receipts, so a live run can read them back without a log file. */
const TEXT_RECEIPT_RING = 200;

/** Apply a merge plan's ops to a `Y.Text`, in order. */
function applyTextOpsToYText(text: Y.Text, ops: readonly TextMergeOp[]): void {
  for (const op of ops) {
    if (op.kind === "delete") text.delete(op.index, op.length);
    else text.insert(op.index, op.text);
  }
}

/**
 * One CRDT record → one canonical FILE record, plus its `ord`.
 *
 * `ord` is read and then DROPPED (AC1 part 3): it is the only doc field with no
 * file counterpart at all. Every register is expanded through
 * {@link decodeV2RecordToFlat}, i.e. through WP9's `decodePos`/`decodeSize` and
 * WP10's `decodeEndpointToFile` — never a re-derived mapping — and everything
 * else is passed through untouched, so an unknown/future key still survives to
 * disk rather than being deleted on every peer.
 */
function toCanonicalFileRecord(
  source: Y.Map<unknown>,
  kind: CanvasRecordKind,
): { record: CanvasRecord; ord: string } {
  const raw: Record<string, unknown> = {};
  let ord = "";
  for (const [key, value] of source) {
    if (key === V2_FIELD.ord) {
      // A non-string `ord` is not an order this client can compare, so it reads
      // as "unordered" rather than being coerced into a plausible-looking key.
      if (typeof value === "string") ord = value;
      continue;
    }
    // WP36 (C36 AC4) — THE PROJECTION RENDER, and it is EXPLICIT ON PURPOSE.
    //
    // `buildCanvasData` has four consumers, not one: the disk bytes
    // (`serializeCanvas`), the OPEN Obsidian view (`reconcileLiveCanvas` ->
    // `adapter.reloadCanvasData`), `getCanvasSnapshot` (the E2E `canvas.state`
    // command) and `buildApplyReceipt` -> `advanceFromReceipt`, i.e. the
    // Surface-Shadow itself.
    //
    // `JSON.stringify` calls `Y.Text.prototype.toJSON`, so leaving the object in
    // `raw` would make TWO of those four right BY ACCIDENT — the two that are
    // JSON-serialised — while handing Obsidian a `text` that is not a string and
    // storing a non-`ShadowFieldValue` object in the shadow, whose next capture
    // would then diff against an object. Neither of those two is observable
    // through any JSON-shaped oracle, which is exactly why the render may not
    // rest on `JSON.stringify`.
    raw[key] = renderDocValue(value);
  }
  return { record: canonicalizeRecord(decodeV2RecordToFlat(raw), kind), ord };
}

/**
 * Sort by `(ord, id)` — WP13's comparator and nothing else (Shared Ownership
 * Contract §1). Never `<` on raw `ord` strings, never `localeCompare`: WP16
 * resolves order through the same `compareOrdId`, and if the two disagreed both
 * suites would pass while replicas silently produced different bytes.
 *
 * The Y.Map iteration index breaks a tie only when `(ord, id)` cannot — i.e.
 * for two records sharing an id, which `canonicalizeCanvasData` also resolved
 * by input order. It keeps the sort stable regardless of the engine's
 * implementation; it is never reached for well-formed state.
 */
function sortByOrdId(records: OrderedFileRecord[]): CanvasRecord[] {
  records.sort((a, b) => compareOrdId(a.entry, b.entry) || a.index - b.index);
  return records.map((held) => held.record);
}

// Build the Obsidian .canvas data object ({nodes:[], edges:[]}) from the CRDT.
// Shared by disk serialization AND live-view reconciliation so both see the exact
// same (suppressed- and dangling-edge-pruned) snapshot.
//
// `deletedMap` is OPTIONAL: the existing two-argument call sites keep their
// current no-suppression behaviour unchanged.
export function buildCanvasData(
  nodesMap: Y.Map<Y.Map<unknown>>,
  edgesMap: Y.Map<Y.Map<unknown>>,
  deletedMap?: TombstoneMap,
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  const nodes: OrderedFileRecord[] = [];
  const edges: OrderedFileRecord[] = [];

  // The nodes an edge may still attach to. A suppressed node is NOT removed
  // from `nodesMap` (that is the whole point of V2 tombstones — deletion is a
  // value, not an absence), so its key is still there and the old
  // `nodeIds.has(...)` guard alone would happily keep an edge pointing at an
  // invisible card. Folding suppression into the very set that guard reads
  // makes the AC2 cascade and the GAP-5 dangling prune ONE rule with one
  // answer, rather than two guards that can disagree.
  const visibleNodeIds = new Set<string>();
  for (const id of nodesMap.keys()) {
    if (!isRecordSuppressed(deletedMap, id)) visibleNodeIds.add(id);
  }

  let index = 0;
  for (const [id, nodeYMap] of nodesMap) {
    if (!visibleNodeIds.has(id)) continue;
    const { record, ord } = toCanonicalFileRecord(nodeYMap, "node");
    nodes.push({ entry: { ord, id: String(record.id ?? "") }, index: index++, record });
  }

  index = 0;
  for (const [id, edgeYMap] of edgesMap) {
    // AC2: an edge is a record too, so its own tombstone suppresses it.
    if (isRecordSuppressed(deletedMap, id)) continue;
    const { record, ord } = toCanonicalFileRecord(edgeYMap, "edge");
    // GAP-5 (US5 AC3) + AC2 cascade: never serialize an edge whose endpoint is
    // gone or suppressed. The endpoint ids are read AFTER expansion, so an edge
    // carrying the atomic `from`/`to` registers is guarded exactly like one
    // still carrying the flat keys. An edge with no endpoint STRING at all is
    // left alone here, unchanged from P0 — that case is the delete guards'.
    const from = record.fromNode;
    const to = record.toNode;
    if (typeof from === "string" && !visibleNodeIds.has(from)) continue;
    if (typeof to === "string" && !visibleNodeIds.has(to)) continue;
    edges.push({ entry: { ord, id: String(record.id ?? "") }, index: index++, record });
  }

  return { nodes: sortByOrdId(nodes), edges: sortByOrdId(edges) };
}

// The canonical `.canvas` document text. `buildCanvasData` has already produced
// the final record ORDER and the final per-record KEY order, so this is a plain
// stringify of that snapshot — deliberately NOT `serializeCanonicalCanvas`,
// whose id-only array sort would discard the `(ord, id)` order (see the WP17
// header above). The emitted text is unchanged in SHAPE: one top-level object,
// `nodes` before `edges`, tab-indented, no trailing newline.
export function serializeCanvas(
  nodesMap: Y.Map<Y.Map<unknown>>,
  edgesMap: Y.Map<Y.Map<unknown>>,
  deletedMap?: TombstoneMap,
): string {
  return JSON.stringify(buildCanvasData(nodesMap, edgesMap, deletedMap), null, "\t");
}

// ---------------------------------------------------------------------------
// WP19 / P1 — TOMBSTONE SEMANTICS WIRING (deletion is a VALUE, not an absence).
// ---------------------------------------------------------------------------
//
// WP12 built the tombstone map and its one merge rule; WP17 taught the
// serializer to honour it. What was still missing is the half that produces
// them: every DELETE in this file removed the record's key
// (`maps[kind].delete(id)`, `edgesMap.delete(edgeId)`), which destroys the
// record's `Y.Map` and with it every field value it held.
//
// Three consequences of a key removal, none of which a tombstone has:
//
//   ├── UNDO IS LOSSY — the field container is gone, so the best an undo can do
//   │      is re-create a husk from whatever the last local file happened to
//   │      say. A peer's concurrent edit to that record is simply gone (AC4).
//   ├── THE DELETE CANNOT MERGE — absence carries no author and no time, so a
//   │      delete concurrent with an edit converges by arrival order rather than
//   │      by a rule (AC1/AC2), and
//   └── THE CASCADE HAD TO DESTROY TOO — the node→edge cascade removed edge keys
//          for the same reason, so undoing a node delete could never bring its
//          arrows back (AC3).
//
// So every delete path here now writes `deleted[id] := {t, by, on:true}` through
// WP12's `applyTombstoneOp` and touches `nodes` / `edges` NOT AT ALL. What the
// user sees is unchanged, because `buildCanvasData` — the single doc→file/view
// projection — already suppresses a tombstoned record AND every edge whose
// endpoint node is suppressed. The cascade is therefore no longer an action at
// all: it is a consequence of the one suppression rule, which is why
// `pruneEdgesForDeletedNodes` is gone rather than rewritten (see the note at its
// old call site).

/** The doc container tombstones live in (BUILD_SPEC §4.3). Never written to the file. */
export const DELETED_MAP_NAME = "deleted";

/**
 * The capture path's read-only view over the doc's `deleted` container.
 *
 * The whole point of AC2 ("a local upsert does not resurrect a tombstoned id")
 * is that `planIntentDiff`'s rule 1 gets a view that reads the REAL container
 * rather than the P0 placeholder `{ isDeleted: () => false }`. The question is
 * asked through WP12's single predicate — never an inline `entry?.on` — because
 * C12 AC2 requires reconcile, serialisation and capture to share ONE rule.
 *
 * The `deleted` container is keyed by RECORD ID, exactly as `isRecordSuppressed`
 * (the serializer's reader) keys it, so the `kind` is not part of the key: two
 * readers disagreeing about the key shape would make a record suppressed on disk
 * and alive in the capture path.
 */
export function createDocTombstoneView(deletedMap: TombstoneMap): TombstoneView {
  return {
    isDeleted: (_kind: ShadowRecordKind, id: string) =>
      isTombstoneSuppressed(readTombstoneEntry(deletedMap, id)),
  };
}

/**
 * The next LAMPORT stamp for a tombstone op on this container.
 *
 * Logical, never a clock (WP12's purity contract exists precisely so no consumer
 * sneaks one in): one past the highest `t` this replica can currently see, so an
 * op issued after observing a peer's delete/undo strictly dominates it and the
 * `(t, by)` merge has a causal chain to follow instead of a coin flip. A
 * malformed stored entry contributes nothing — `readTombstoneEntry` reads it as
 * "no tombstone", and inventing a stamp from junk would let a hand-edited vault
 * push this replica's clock arbitrarily far forward.
 */
export function nextTombstoneTime(deletedMap: Y.Map<unknown>): number {
  let highest = 0;
  for (const id of deletedMap.keys()) {
    const entry = readTombstoneEntry(deletedMap, id);
    if (entry !== undefined && entry.t > highest) highest = entry.t;
  }
  return highest + 1;
}

// WP4 (D9): the semantic record compare that used to break the echo at
// `handleLocalModify` is GONE. V2's echo breaker is BYTE equality against
// `lastWrittenContent`, which only became sound once WP3 made this client's
// serialisation canonical. Nothing reconstructs plain records from the CRDT for
// comparison any more — the CRDT is deliberately not an input to the intent
// verdict (that is the defect the Surface-Shadow removes).

/** The two shadow id spaces, in a fixed order. */
const RECORD_KINDS: readonly ShadowRecordKind[] = ["node", "edge"];

/**
 * WP4: one parsed `.canvas` id-space, CAPTURE-ROUNDED (BUILD_SPEC §4.4).
 *
 * Geometry is rounded to whole pixels HERE — before anything else looks at the
 * records — so that sub-pixel noise can never be classified as intent and a
 * rounded value can never reach a peer as a delta that reads like a user edit.
 */
function toParsedRecords(records: Record<string, Record<string, unknown>>): ParsedSaveRecord[] {
  const out: ParsedSaveRecord[] = [];
  for (const [id, record] of Object.entries(records)) {
    out.push({ id, fields: roundCanvasGeometry(record) as Record<string, ShadowFieldValue> });
  }
  return out;
}

/**
 * The rounded `ParsedSave` the shadow-relative intent diff consumes.
 *
 * WP16: takes the FLAT shape (via the temporary decode bridge), not the V2
 * registers — the Surface-Shadow is keyed by flat field names and WP18 owns
 * moving it. See {@link decodeCanvasDataToFlat}.
 */
function toParsedSave(path: string, data: FlatCanvasData): ParsedSave {
  return {
    path,
    nodes: toParsedRecords(data.nodes),
    edges: toParsedRecords(data.edges),
  };
}

/** The save's records by id, per kind — the save's "intended" record. */
type SaveIndex = { [K in ShadowRecordKind]: Map<string, ParsedSaveRecord> };

/** What an intent plan ACTUALLY did, which is what may advance the shadow. */
interface AppliedIntent {
  /** Field upserts that reached the CRDT (a rejected record contributes none). */
  upserts: FieldUpsertIntent[];
  /** Record deletes that reached the CRDT. */
  deletes: DeleteIntent[];
  /** WP18 AC1: rejection signatures produced at the capture boundary. */
  rejected: string[];
  /** Node ids deleted here, for the GAP-5 edge cascade + telemetry. */
  deletedNodeIds: string[];
  /** Node ids created here (telemetry only). */
  created: string[];
  /** Existing node ids that took a write here (telemetry only). */
  changed: string[];
  /** WP36 AC1: one doc-level witness per captured `text`/`label` write. */
  textWrites: TextWriteReceipt[];
}

// ---------------------------------------------------------------------------
// WP18 / P1 — INGEST VALIDATION + CREATE-ONCE AT EVERY LOCAL WRITE BOUNDARY
// ---------------------------------------------------------------------------
//
// Three local boundaries propose records into the doc — the host seed
// (`CanvasSync.subscribe(path, "host")`), the cold-open seed
// (`CanvasPersistence.coldOpen()` → `seedRecordsIntoYMaps`) and the capture
// writer (`handleLocalModify` → `applyIntentPlan`, the `CAPTURE_NET` input).
// All three now ask the SAME question, in the SAME place, through WP14's
// validator, and all three obey its answer rather than re-deriving one.
//
//   ├── AC1 — a proposal that fails the schema never reaches the doc, and the
//   │         refusal is signed with the boundary and the reason.
//   ├── AC2 — a record is CREATED as one complete `Y.Map`, populated while it
//   │         is still detached and attached only afterwards, so a half-built
//   │         record is never observable and `set(id, new Y.Map())` is never
//   │         issued for an id the container already holds.
//   ├── AC3 — every write is an UPSERT. Nothing here deletes a doc key because
//   │         the incoming record failed to mention it (I7). The seed's
//   │         absent-key delete loop is retired; `PROTECTED_KEYS` survives as
//   │         defence in depth (Shared Ownership Contract §4) with unchanged
//   │         membership, and is simply no longer load-bearing.
//   └── AC4 — REMOTE deltas are never rejected. This module carries no remote
//             ingest path at all, and the local ones branch on
//             `verdict.reject`, never on the origin they passed in: WP14
//             computes the consequence ONCE (`origin === "local"`), and
//             re-deriving it at a call site is precisely the divergence bug
//             WP14 AC3 exists to catch (Shared Ownership Contract §2.3).
//
// Nothing here re-implements a rule it can import: validity is WP14's,
// write-once `type` is WP11's `guardTypeWrite`, the registers and their
// whole-value equality are WP9/WP10's. Register values are compared
// STRUCTURALLY — `encodePos` / `encodeSize` / `encodeEndpoint` freeze a NEW
// value on every call, so a reference compare would read a same-pixel
// restatement as fresh intent and push it to every peer (Shared Ownership
// Contract §3, the defect WP15 already had to fix once).

/** The local write boundaries this module gates, as they appear in a signature. */
export const INGEST_BOUNDARY = {
  /** `CanvasSync.subscribe(path, "host")` → `applyCanvasToYMaps`. */
  hostSeed: "host-seed",
  /** `CanvasPersistence.coldOpen()` → `seedRecordsIntoYMaps`. */
  coldOpenSeed: "cold-open-seed",
  /** `handleLocalModify` → `applyIntentPlan` (`CAPTURE_NET`). */
  capture: "capture-net",
} as const;

export type IngestBoundary = (typeof INGEST_BOUNDARY)[keyof typeof INGEST_BOUNDARY];

/** The two record id spaces, as the validator distinguishes them. */
export type IngestRecordKind = "node" | "edge";

/**
 * The rejection signature format WP18 owns (Shared Ownership Contract §1), in
 * `canvas-sync.ts`'s established `<NAME> signature: …` shape.
 *
 * It names the BOUNDARY and the REASON, which is exactly what AC1 asks a human
 * to be able to read. WP20's quarantine/release signatures stay distinct
 * strings; only the shape is shared.
 */
export function ingestRejectionSignature(
  boundary: IngestBoundary,
  kind: IngestRecordKind,
  id: string,
  reason: IngestReasonCode,
): string {
  return `INGEST REJECTED signature: boundary=${boundary} refused ${kind} ${id} (${reason})`;
}

/** What the ingest gate decided about one proposed record. */
export interface IngestAdmission {
  readonly admitted: boolean;
  /** Present only on a refusal — there is nothing to report otherwise. */
  readonly signature?: string;
  /**
   * WP63 (I11): the machine-readable half of the same refusal. The signature is
   * for a human; the WITHHOLD needs the reason as data, and re-parsing it out of
   * the sentence would be a second definition of the same fact.
   */
  readonly reason?: IngestReasonCode;
}

const ADMITTED: IngestAdmission = Object.freeze({ admitted: true });

/**
 * THE gate. Every local write boundary calls this and nothing else.
 *
 * Note what it does NOT do: it never asks "was this local?". It asks WP14 and
 * then reads `verdict.reject`. An invalid record whose verdict says `reject:
 * false` is ADMITTED — that is the remote case, and refusing it would make this
 * replica hold a state its peers do not (AC4). Quarantining such a record once
 * it is in the doc is WP20's, not this gate's.
 */
export function admitRecordIngest(
  record: V2RecordMap,
  kind: IngestRecordKind,
  id: string,
  origin: IngestOrigin,
  boundary: IngestBoundary,
): IngestAdmission {
  const verdict =
    kind === "node" ? validateNodeIngest(record, origin) : validateEdgeIngest(record, origin);
  if (verdict.valid) return ADMITTED;
  // Obey the verdict; never re-derive the consequence from `origin`.
  if (!verdict.reject) return ADMITTED;
  return Object.freeze({
    admitted: false,
    signature: ingestRejectionSignature(boundary, kind, id, verdict.reason),
    reason: verdict.reason,
  });
}

/** A plain object seen through WP9's structural record interface. */
function asRecordView(source: Record<string, unknown>): V2RecordMap {
  return {
    get: (key: string) => source[key],
    set: (key: string, value: unknown) => {
      source[key] = value;
    },
  };
}

/**
 * The record AS IT WILL EXIST once this local write has been applied, expressed
 * in the V2 doc vocabulary the validator speaks.
 *
 * Two things make this the right thing to validate rather than the raw
 * proposal:
 *
 *   ├── I7 (AC3). No local path deletes a key the proposal omitted, so the
 *   │   post-write record is exactly `doc ∪ proposal`. Validating the proposal
 *   │   alone would refuse a perfectly legal PARTIAL observation of a record
 *   │   the doc already holds in full.
 *   └── the file vocabulary is not the doc vocabulary. `toV2Node` / `toV2Edge`
 *       are the same translators `parseCanvas` uses, so a flat `x`/`y` pair and
 *       an atomic `pos` register are judged as the same fact — the validator
 *       decides on CONTENT, never on spelling. A record already in the V2
 *       vocabulary passes through them unchanged.
 */
function projectPostWriteRecord(
  existing: Y.Map<unknown> | undefined,
  proposal: Readonly<Record<string, unknown>>,
  kind: IngestRecordKind,
): V2RecordMap {
  const merged: Record<string, unknown> = {};
  if (existing) {
    for (const [key, value] of existing) merged[key] = value;
  }
  for (const [key, value] of Object.entries(proposal)) merged[key] = value;
  const translated = (kind === "node" ? toV2Node(merged) : toV2Edge(merged)) as unknown as Record<
    string,
    unknown
  >;
  return asRecordView(translated);
}

// ---------------------------------------------------------------------------
// WP63 / I11 — REFUSAL NEVER DESTROYS
// ---------------------------------------------------------------------------
//
// WP18 AC1 keeps an invalid LOCAL record out of the doc. That is correct and it
// stays. What was never owned by an AC is the COMPOSITION with the writer:
//
//   ├── the refused record never enters `nodesMap`/`edgesMap`,
//   ├── `serializeCanvas` is a PURE PROJECTION of those containers — a record is
//   │   absent because its id is not a key, there is no "drop invalid" pass, and
//   └── `CanvasPersistence` is the single writer (I3) and writes that projection
//       over the user's file.
//
// Composed: a refusal silently and permanently DELETES the user's record from a
// file this plugin did not create. I11 names the missing constraint — a refusal
// may withhold a write, it may never destroy one.
//
// This module owns the VOCABULARY of that withhold (the refusal as data, the
// per-path ledger, and the "is it valid now?" question the lift asks); the
// writer owns the decision, because the writer is the only place that knows both
// the refusal set and the impending write. Nothing here re-injects a refused
// record into the projection: that would break C17 AC3 (cross-replica byte
// equality) and stop the file being a deterministic projection of the doc, since
// only one replica ever saw those records.

/**
 * One record a LOCAL seed boundary refused, as data rather than as a sentence.
 *
 * `boundary` is carried so the lift re-asks the gate with the same boundary the
 * refusal came from, and so a signature can name where the loss would have
 * happened.
 */
export interface SeedRefusal {
  readonly boundary: IngestBoundary;
  readonly kind: IngestRecordKind;
  readonly id: string;
  readonly reason: IngestReasonCode;
}

/** `${kind}:${id}` — the two id spaces are separate (a node and an edge may share an id). */
function refusalKey(refusal: SeedRefusal): string {
  return `${refusal.kind}:${refusal.id}`;
}

/**
 * The refused set for ONE canvas path.
 *
 * Per path on purpose (AC2 / I5 DEGRADE): a withhold is a degraded persistence
 * state for one canvas, never a session-wide condition. It is also per SESSION —
 * the predicate is "did THIS session's seed refuse something for this path?", so
 * it is reset whenever the path's doc is re-seeded (`reset()`) and starts empty
 * whenever the owning persistence instance is rebuilt.
 */
export class SeedRefusalLedger {
  private readonly refused = new Map<string, SeedRefusal>();

  /** Record refusals from one seed pass. Idempotent per `${kind}:${id}`. */
  note(refusals: readonly SeedRefusal[]): void {
    for (const refusal of refusals) this.refused.set(refusalKey(refusal), refusal);
  }

  /** Forget everything — the path is being re-seeded, so the old verdicts are stale. */
  reset(): void {
    this.refused.clear();
  }

  get size(): number {
    return this.refused.size;
  }

  /** True while this path's write-back must stay suspended. */
  hasRefusals(): boolean {
    return this.refused.size > 0;
  }

  list(): readonly SeedRefusal[] {
    return [...this.refused.values()];
  }

  /** `node n-bad (MISSING_TYPE), edge e2 (MISSING_TO)` — AC1's "each refused id and its reason". */
  describe(): string {
    return this.list()
      .map((r) => `${r.kind} ${r.id} (${r.reason})`)
      .join(", ");
  }

  /**
   * Drop every refusal the predicate reports resolved (AC3). The caller runs
   * this on the SAME trigger as the write — never on a timer — so a withhold
   * that could lift cannot outlive the next write attempt.
   */
  prune(isResolved: (refusal: SeedRefusal) => boolean): void {
    for (const [key, refusal] of [...this.refused]) {
      if (isResolved(refusal)) this.refused.delete(key);
    }
  }
}

/**
 * Is a previously-refused record valid in the doc NOW? (WP63 AC3, the lift.)
 *
 * The two ways a refusal stops mattering both end here: a remote delta created
 * the record properly, or the user repaired their file and the capture net
 * ingested it. Both are simply "the doc holds this id and the gate admits it",
 * so one question covers them.
 *
 * It asks the SAME gate the refusal came from, on the record as the doc actually
 * holds it (empty proposal → `doc ∪ {}`), so the lift can never disagree with
 * the refusal about what "valid" means. A record still absent from the doc is
 * never resolved: absence is exactly the state the refusal describes.
 */
export function isSeedRefusalResolved(doc: Y.Doc, refusal: SeedRefusal): boolean {
  const container = doc.getMap<Y.Map<unknown>>(refusal.kind === "node" ? "nodes" : "edges");
  const existing = container.get(refusal.id);
  if (existing === undefined) return false;
  return admitRecordIngest(
    projectPostWriteRecord(existing, {}, refusal.kind),
    refusal.kind,
    refusal.id,
    "local",
    refusal.boundary,
  ).admitted;
}

/**
 * Is the doc already holding this exact value?
 *
 * STRUCTURAL for every register kind (Shared Ownership Contract §3). Yjs has no
 * value-equality short circuit, so a `set` of an identical value still emits a
 * real delta and echoes to every peer; and because `encodePos` freezes a NEW
 * array per call, a reference compare answers "different" for every same-pixel
 * restatement. Whole-value equality is asked of WP9/WP10's own predicates so
 * this file cannot drift from them.
 */
function docValueEquals(current: unknown, next: unknown): boolean {
  if (current === next) return true;
  if (isPosRegister(current) && isPosRegister(next)) return posEquals(current, next);
  if (isSizeRegister(current) && isSizeRegister(next)) return sizeEquals(current, next);
  if (isEndpointRegister(current) && isEndpointRegister(next)) return endpointEquals(current, next);
  return false;
}

/**
 * Upsert every field of `fields` into `record` — and delete nothing, ever (I7,
 * AC3).
 *
 * `type` is routed through WP11's write-once guard rather than being set like
 * any other key: it is the record's identity, Obsidian's `importData` DROPS a
 * node whose type it does not recognise (and every edge attached to it), and
 * the guard's `noop` branch is what keeps a re-stated same-value `type` off the
 * wire entirely. A refused `type` write is returned as a signature for the
 * caller to narrate; it is never thrown, because this sits on the save path.
 */
function upsertRecordFields(
  record: V2RecordMap,
  fields: Readonly<Record<string, unknown>>,
  id: string,
): string | undefined {
  let typeSignature: string | undefined;
  for (const [key, value] of Object.entries(fields)) {
    if (key === V2_FIELD.type) {
      const verdict = guardTypeWrite(record, id, value as string);
      if (verdict.kind === "rejected") typeSignature = verdict.signature;
      continue;
    }
    const current = record.get(key);
    // WP36 REPRESENTATION BLINDNESS — `docValueEquals` CANNOT answer this
    // question for a migrated `text` / `label`, and its silence is a write.
    //
    // `docValueEquals` asks "is the doc already holding this exact value?" so
    // that a restatement is not written again. A `Y.Text` is never `===` a
    // string and it is no register either, so once the field has migrated the
    // predicate answers `false` for a BYTE-IDENTICAL restatement — and the
    // `set` below then replaces the nested type with a plain string. The
    // record is silently UN-MIGRATED, its CRDT history is discarded, and the
    // projected `.canvas` is unchanged, so nothing anywhere goes red.
    //
    // The seed boundaries are exactly where that restatement arrives: both
    // `seedRecordsIntoYMaps` (cold open) and `applyCanvasToYMaps` (host seed)
    // re-seed the path from the local `.canvas`, whose `text` is the RENDERED
    // string of the very `Y.Text` this write would flatten.
    //
    // The comparison is therefore made through the same render the projection
    // uses. `docValueEquals` itself is deliberately left BYTE-UNCHANGED (C36
    // §7 clause 4): it is a value predicate shared with the capture path,
    // where teaching it that a `Y.Text` "equals" a string would make real
    // edits silently skip. This is a decision about THIS boundary's write.
    //
    // NOT CLOSED HERE, and carried up instead: a seed proposing a genuinely
    // DIFFERENT string over a `Y.Text` still flattens it. That is not a blind
    // check — the values really do differ — it is a routing question (skip,
    // merge, or write) that belongs with C36's write router.
    if (isYText(current) && typeof value === "string" && current.toString() === value) continue;
    if (docValueEquals(current, value)) continue;
    record.set(key, value);
  }
  return typeSignature;
}

/**
 * Keep an ALREADY-PRESENT atomic register in step with the flat file keys the
 * seed and capture boundaries still write.
 *
 * This exists because WP18 gives `migrateV1ToV2` a production call site. The
 * migration is additive: it ADDS `pos` / `size` / `from` / `to` to a record and
 * deliberately keeps the flat V1 keys. If a later flat write then moved `x`
 * without moving `pos`, the record would hold two disagreeing statements of the
 * same fact and the serializer's register expansion could hand the file the
 * STALE one — a card that snaps back after every drag. So a boundary that
 * writes the flat key updates the register alongside it.
 *
 * A register is never INTRODUCED here: a record that carries none stays purely
 * in the flat vocabulary, so the un-migrated doc shape is unchanged. Whole
 * values only, compared structurally — a half-present or non-numeric geometry
 * leaves the register alone rather than tearing it.
 */
function syncRegistersFromFlat(record: Y.Map<unknown>): void {
  const view = record as unknown as V2RecordMap;

  const pos = readPosRegister(view);
  if (pos !== undefined) {
    const x = record.get("x");
    const y = record.get("y");
    if (typeof x === "number" && typeof y === "number") {
      const next = encodePos(x, y);
      if (!posEquals(pos, next)) writePosRegister(view, next);
    }
  }

  const size = readSizeRegister(view);
  if (size !== undefined) {
    const width = record.get("width");
    const height = record.get("height");
    if (typeof width === "number" && typeof height === "number") {
      const next = encodeSize(width, height);
      if (!sizeEquals(size, next)) writeSizeRegister(view, next);
    }
  }

  for (const slot of ENDPOINT_SLOTS) {
    const current = readEndpoint(view, slot);
    if (current === undefined) continue;
    const fileKeys = ENDPOINT_FILE_KEYS[slot];
    const next = encodeEndpointFromFile(slot, {
      [fileKeys.node]: record.get(fileKeys.node),
      [fileKeys.side]: record.get(fileKeys.side),
      [fileKeys.end]: record.get(fileKeys.end),
    });
    if (next === undefined) continue;
    if (!endpointEquals(current, next)) writeEndpointRegister(view, slot, next);
  }
}

/**
 * Read an edge's endpoint node id whichever vocabulary the record is in.
 *
 * WP10's register is asked first and the flat file key is the fallback, so the
 * dangling-edge guards keep working on a doc that is half migrated — which, in
 * P1, every doc is.
 */
function readEndpointNodeId(record: Y.Map<unknown>, slot: EndpointSlot): string | undefined {
  const register = readEndpoint(record as unknown as V2RecordMap, slot);
  if (register !== undefined) return register.node;
  const flat = record.get(ENDPOINT_FILE_KEYS[slot].node);
  return typeof flat === "string" ? flat : undefined;
}

/**
 * Create-or-merge ONE record, the create-once way (AC2).
 *
 * A record that does not exist yet is built while it is still DETACHED and
 * attached in a single `set` once it is complete, so the first time any
 * observer or peer can see the id, it already carries the whole record. A
 * record that does exist is merged into IN PLACE — `set(id, new Y.Map())` over
 * a live id detaches the container and silently discards a peer's concurrent
 * edit to a different field of it.
 */
function writeRecordCreateOnce(
  container: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Readonly<Record<string, unknown>>,
  signatures: string[],
): void {
  const existing = container.get(id);
  if (existing) {
    const typeSignature = upsertRecordFields(existing, fields, id);
    if (typeSignature) signatures.push(typeSignature);
    syncRegistersFromFlat(existing);
    return;
  }
  const created = buildDetachedRecord(fields, id, signatures);
  container.set(id, created);
}

/**
 * Assemble a brand-new record and hand it back READY, in a single `set`.
 *
 * The draft is a plain object, not the `Y.Map` itself: a `Y.Map` that is not yet
 * attached to a document answers every read with `undefined` (and Yjs warns
 * about it), so the write-once `type` guard would be inspecting an empty
 * container rather than the record being assembled. Building the draft first
 * keeps the guard meaningful AND keeps the container's first appearance in the
 * doc complete (AC2).
 */
function buildDetachedRecord(
  fields: Readonly<Record<string, unknown>>,
  id: string,
  signatures: string[],
): Y.Map<unknown> {
  const draft: Record<string, unknown> = {};
  const typeSignature = upsertRecordFields(asRecordView(draft), fields, id);
  if (typeSignature) signatures.push(typeSignature);
  const created = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(draft)) created.set(key, value);
  return created;
}

/**
 * The COLD-OPEN seed writer (`CanvasPersistence.coldOpen`), in ONE transaction.
 *
 * VOCABULARY: it writes the FLAT `.canvas` file shape, exactly as it always
 * did — WP16's `decodeCanvasDataToFlat` bridge stays in front of it. Retiring
 * that bridge is NOT a WP18 acceptance criterion (charter §2/§4 never mention
 * it); it is a P1 scaffold whose removal belongs with the write boundaries'
 * move to registers (WP22/WP39), and forcing it here breaks every pre-V2 reader
 * of `x`/`y` for no AC gain.
 *
 * What makes that safe is the ORDERING at the call site: `coldOpen` seeds FIRST
 * and runs `migrateV1ToV2` AFTERWARDS, so the flat records this function writes
 * are translated by the migration in the same cold open rather than sitting
 * behind its one-shot `meta` guard forever.
 *
 * What this function DOES own is the gate (AC1), create-once (AC2) and
 * upsert-only (AC3) — the same three properties, through the same helpers, as
 * the host seed. Returns the rejection signatures for the caller to narrate;
 * it knows nothing about a logger.
 *
 * WP63: `refusalsOut`, when supplied, additionally collects each refusal AS DATA
 * so the caller can withhold the write-back for this path (I11). It is optional
 * because the signatures are the WP18 contract and no existing caller may be
 * forced to care; a caller that omits it gets exactly the old behaviour.
 */
export function seedRecordsIntoYMaps(
  doc: Y.Doc,
  data: FlatCanvasData,
  seedOrigin: symbol,
  refusalsOut?: SeedRefusal[],
): string[] {
  const signatures: string[] = [];
  doc.transact(() => {
    seedSpace(doc.getMap<Y.Map<unknown>>("nodes"), data.nodes, "node", signatures, refusalsOut);
    seedSpace(doc.getMap<Y.Map<unknown>>("edges"), data.edges, "edge", signatures, refusalsOut);
  }, seedOrigin);
  return signatures;
}

function seedSpace(
  container: Y.Map<Y.Map<unknown>>,
  records: Record<string, Record<string, unknown>>,
  kind: IngestRecordKind,
  signatures: string[],
  refusalsOut?: SeedRefusal[],
): void {
  for (const [id, source] of Object.entries(records)) {
    const admission = admitRecordIngest(
      projectPostWriteRecord(container.get(id), source, kind),
      kind,
      id,
      "local",
      INGEST_BOUNDARY.coldOpenSeed,
    );
    if (!admission.admitted) {
      signatures.push(admission.signature as string);
      refusalsOut?.push({
        boundary: INGEST_BOUNDARY.coldOpenSeed,
        kind,
        id,
        reason: admission.reason as IngestReasonCode,
      });
      continue;
    }
    writeRecordCreateOnce(container, id, source, signatures);
  }
}

/**
 * Merge one parsed record into its `Y.Map` — UPSERT ONLY (AC3 / I7).
 *
 * The absent-key delete loop this function used to run is RETIRED. It read a
 * key the incoming record failed to mention as an instruction to remove it,
 * which is precisely what I7 forbids: a `.canvas` read is a partial
 * OBSERVATION, and the `PROTECTED_KEYS` guard could only ever shrink the blast
 * radius of that misreading, never fix it. With no deletion left there is
 * nothing for the guard to guard, so the guard is gone from here — but the
 * CONSTANT stays exported with unchanged membership (Shared Ownership Contract
 * §4): it is defence in depth for WP20 and two live suites read it as a
 * constant.
 */
export function applyToYMap(ymap: Y.Map<unknown>, obj: Record<string, unknown>): void {
  upsertRecordFields(ymap, obj, String(obj[V2_FIELD.id] ?? ""));
  syncRegistersFromFlat(ymap);
}

// WP4: the three-way key diff (`base -> next` against `lastWrittenContent`) is
// GONE from the capture path. The unit of intent is the FIELD and the basis is
// the Surface-Shadow (`planIntentDiff`), so there is no `base` object left to
// diff against — and I7 forbids reading an omitted field as a removal at all.
// WP18 finished the job at the seed boundaries: no local write path deletes a
// doc key any more.

// ---------------------------------------------------------------------------
// WP20 / P1 — THE QUARANTINE AUDITOR: detection becomes CONVERGENT SELF-REPAIR
// ---------------------------------------------------------------------------
//
// `auditCanvasState` used to COUNT damage (`noGeo`, `noType`,
// `fileNodesWithoutFile`, `danglingEdges`) and narrate it. Counting is all a
// downstream filter can do, and it leaves the broken record in the doc, in the
// view and — via `CanvasPersistence`'s `serialize(doc)` — in the user's file,
// where Obsidian's `importData` meets an edge it cannot attach (A.2/16).
//
// WP18 keeps an invalid LOCAL proposal out of the doc; WP14 forbids refusing a
// remote one (`reject: false`), because a replica that refused a delta its peers
// accepted would DIVERGE. So a broken record can only ever arrive from a peer,
// and the answer to it has to be repair rather than refusal. That repair is a
// QUARANTINE: `deleted[id] := {t, by, on:true, q:true}` through WP12's one op.
//
//   ├── NOTHING IS DESTROYED. Only the `deleted` map is written; the record's
//   │      `Y.Map` keeps its identity and every field, which is the only reason
//   │      a later delta can still complete it (AC1 → AC2).
//   ├── THE LIFT IS THE POINT. A quarantine that never lifts is a delete with
//   │      extra steps. A record that passes the schema again and is CURRENTLY
//   │      quarantined is released with an ordinary `on:false` op (AC2).
//   ├── A USER DELETE IS NEVER LIFTED. `q` is what tells the two apart, and this
//   │      is the consumer WP12 built it for: an auditor that read "suppressed +
//   │      valid → release" would resurrect every card the user ever deleted, on
//   │      every peer, on every tick.
//   └── IDEMPOTENCE IS STRUCTURAL, not a de-dup cache. An action is planned ONLY
//          for a state transition that has not happened yet, so a settled doc
//          plans nothing and writes nothing. That matters far more than it looks:
//          `applyTombstoneOp` always `set`s, a `set` of an equal value is still a
//          CRDT delta on the wire, and the audit is driven by the doc observer —
//          so a re-write of an identical tombstone would wake every peer's audit,
//          which would re-write it back, forever (AC3).
//
// Validity is WP14's `validateNodeIngest` / `validateEdgeIngest` and nothing
// else — the same predicate the write boundaries ask, read through the same
// `projectPostWriteRecord` translation so a half-migrated record carrying flat
// geometry is judged on CONTENT rather than on spelling. Re-deriving "is this
// record whole?" here is how the auditor and the boundary would come to disagree,
// and a disagreement between them is a record that is quarantined on one replica
// and live on another.
//
// "ENDPOINT-LESS" MEANS `from.node` OR `to.node` ABSENT — NEVER "no side"
// (charter clarification 1, 2026-08-02). `fromSide`/`toSide` are optional in
// JSON Canvas, so a side-less endpoint is a COMPLETE endpoint and its edge is
// VALID. That reading is not restated here; it is `validateEdgeIngest`'s, via
// `hasBothEndpoints`, which is exactly why asking WP14 rather than re-deriving is
// what keeps the E1 data loss out of the auditor.

/** One state transition the auditor has decided to make for one record. */
type QuarantineAction =
  | {
      readonly op: "quarantine";
      readonly kind: IngestRecordKind;
      readonly id: string;
      readonly reason: IngestReasonCode;
    }
  | { readonly op: "release"; readonly kind: IngestRecordKind; readonly id: string };

/**
 * The signature raised when the auditor quarantines a record, in this file's
 * established `<NAME> signature: …` shape (WP18 owns the shape; AC4 requires the
 * STRINGS to be distinct).
 *
 * It names the record and the machine-readable reason, so an operator reading the
 * console knows both what was hidden and what would un-hide it.
 */
export function quarantineSignature(
  kind: IngestRecordKind,
  id: string,
  reason: IngestReasonCode,
): string {
  return `QUARANTINE RAISED signature: ${kind} ${id} hidden pending repair (${reason})`;
}

/**
 * The signature emitted when the auditor releases its own quarantine (AC4).
 *
 * Deliberately a DIFFERENT sentence, not the same one with a different id: two
 * transitions that differ only in which record they mention are one signature
 * reported twice, and an operator cannot tell a raise from a lift.
 */
export function quarantineReleaseSignature(kind: IngestRecordKind, id: string): string {
  return `QUARANTINE LIFTED signature: ${kind} ${id} revalidated, suppression cleared`;
}

/**
 * Plan one id space — the whole of the auditor's decision logic, and pure.
 *
 * Four states, and only two of them are work:
 *
 *   ├── invalid + not suppressed          → QUARANTINE
 *   ├── invalid + already suppressed      → nothing. Already quarantined is the
 *   │      fixed point (AC3); already user-deleted is not ours to re-label, and
 *   │      re-stamping it would take authorship of someone else's op.
 *   ├── valid   + quarantined (`q:true`)  → RELEASE (AC2)
 *   └── valid   + anything else           → nothing. A user delete stays deleted
 *          and a healthy record never gets an entry at all — an auditor that
 *          wrote `on:false` for every valid record would fill `deleted` with one
 *          entry per record and hand every peer a delta per audit tick.
 *
 * `origin` is `"remote"` because that is what these records provably are: WP18
 * refuses an invalid local proposal at the boundary, so anything invalid that is
 * IN the doc arrived as a peer's delta. The verdict's `reject` flag is never read
 * here — this is not an ingest boundary and nothing is being refused.
 */
function planQuarantineActions(
  container: Y.Map<Y.Map<unknown>>,
  kind: IngestRecordKind,
  deletedMap: TombstoneMap,
  out: QuarantineAction[],
): void {
  for (const [id, record] of container) {
    const view = projectPostWriteRecord(record, {}, kind);
    const verdict =
      kind === "node" ? validateNodeIngest(view, "remote") : validateEdgeIngest(view, "remote");
    const entry = readTombstoneEntry(deletedMap, id);
    if (verdict.valid) {
      if (isTombstoneQuarantined(entry)) out.push({ op: "release", kind, id });
      continue;
    }
    if (isTombstoneSuppressed(entry)) continue;
    out.push({ op: "quarantine", kind, id, reason: verdict.reason });
  }
}

/**
 * WP28 — `YYYY-MM-DD` in LOCAL time, the default for `EpochConflictEnv.today()`.
 *
 * Local, not UTC: the date in the archive's name is the date the user believes
 * it is, and a board archived at 23:30 must not be named with tomorrow's date in
 * the folder the user is looking at. `toISOString()` would do exactly that.
 */
function isoCalendarDate(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * WP29 (AC1): byte equality of two encoded state vectors.
 *
 * A Yjs state vector only ever grows, so "the bytes changed across this await"
 * and "this replica gained state across this await" are the same statement.
 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class CanvasSync {
  private vault: Vault;
  private syncManager: SyncManager;
  private fileOpsManager: FileOpsManager;
  private subscribedPaths = new Set<string>();
  // WP27: the injected path <-> guid seam. NULL means "no identity provider",
  // which is a real and supported state, not a bug — see `canvasDocIdFor`.
  private identityStore: CanvasIdentityStore | null = null;
  // WP25: the injected sidecar lifecycle. NULL means "no durable history for
  // this client", which is the pre-WP25 behaviour and a supported state — every
  // pre-WP25 caller constructs a `CanvasSync` without one.
  private sidecar: SidecarLifecycle | null = null;
  // WP27: the cached, SYNCHRONOUS view of the identity, canonical path -> guid.
  // Filled by a successful subscribe and re-keyed by `handleRename`. It is what
  // makes every path-keyed reader (AC3) able to reach a guid-addressed doc
  // without going async, and its ABSENCE for a path is what stops
  // `getCanvasDocHandle` conjuring a doc for a path nobody subscribed.
  private guidByPath = new Map<string, string>();
  // WP27 AC2: the observer and `afterTransaction` closures installed by
  // `subscribe` read the path through this cell instead of capturing it. A
  // rename that re-keys every map but leaves the closures bound to the old path
  // produces perfect metadata over a dead data path — the remote hook would fire
  // with the retired name and the audit would schedule under a key nothing reads.
  private observedPathRefs = new Map<string, { current: string }>();
  private observers = new Map<string, () => void>();
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Bug L1: timestamp of the first not-yet-flushed remote update per path, used
  // to enforce the max-wait cap on the trailing debounce.
  private writeFirstScheduled = new Map<string, number>();
  private recentDiskWrites = new Set<string>();
  // WP7: settle timers for writes performed by the EXTERNAL single writer
  // (`CanvasPersistence`), reported through `noteExternalDiskWrite`. Tracked so
  // teardown can cancel them, exactly like `writeTimers`.
  private externalWriteSettleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recentLocalEdits = new Set<string>();
  private lastWrittenContent = new Map<string, string>();
  // WP63 (I11): per-path refused set from the HOST seed, shared with that path's
  // `CanvasPersistence` so a refusal withholds the write-back instead of
  // deleting the record from the user's file.
  private seedRefusalLedgers = new Map<string, SeedRefusalLedger>();
  // WP29 (AC1): what THIS client learned about each subscribed doc, measured
  // during `subscribe` and read by the wiring layer when it attaches that path's
  // `CanvasPersistence`. Path-keyed because one `CanvasSync` serves every canvas
  // in the vault; a path that was never subscribed knows nothing.
  private seedKnowledgeByPath = new Map<string, SeedKnowledge>();
  // Bug G (client-side guard): predicate deciding whether local edits to a
  // canvas path may be pushed into the shared Y.Doc. Defaults to allow-all; the
  // owner of permission state (main.ts) injects the real predicate via
  // setCanWrite(). The argument is the CANONICAL path (toCanonicalPath).
  private canWrite: (path: string) => boolean;
  // WP3 diff-inferred fallback: notified the instant the local user first changes
  // a node's keys, so the presence layer can acquire the lock even when the
  // private Canvas API is absent. Null until wired.
  private onLocalNodeChange: ((path: string, nodeId: string) => void) | null = null;
  // Scatter fix (live-view reconciliation): fired whenever a REMOTE (non-local)
  // delta is integrated, carrying the full post-delta canvas data so main.ts can
  // patch the OPEN Obsidian canvas view (which ignores external file writes). Null
  // until wired. `path` is canonical.
  private onRemoteCanvasUpdate:
    | ((path: string, data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }) => void)
    | null = null;
  // WP4 (US5 AC1): per-path monotonic counter of remote (non-local) Yjs
  // transactions applied to the canvas doc. A whole-file disk flush snapshots
  // this; if it has advanced by write time, an in-flight remote delta arrived
  // after the snapshot and the flush must yield rather than clobber it. This is a
  // version/sequence gate, NOT a wall-clock debounce race.
  private remoteSeq = new Map<string, number>();
  private seqHandlers = new Map<string, () => void>();
  // Optional status-console logger for narrating the canvas data path (disk
  // writes, geometry/edge anomalies). Null until main.ts injects it.
  private logger: CanvasSyncLogger | null = null;
  // WP4 (C4): the per-FIELD Surface-Shadow that replaced `lastWrittenContent` as
  // the intent basis. Constructed with the instance so the capture path always
  // has one, even before any wiring runs.
  private shadow: SurfaceShadow = createSurfaceShadow();
  // WP36 (C36 AC1): the doc-level witness ring. In-memory only, bounded, no
  // user text — see {@link TextWriteReceipt}. It exists because AC1 cannot be
  // satisfied by any string read-back: the projected string is identical
  // whether the doc holds a `Y.Text` or a plain string.
  private textWriteReceipts: TextWriteReceipt[] = [];
  private textWriteSeq = 0;
  // WP4: what the surface can prove about the last apply, per canonical path.
  // P0's honest default is "closed, nothing handed over" — WP5 wires the real
  // Obsidian view state. Consulted at every handleLocalModify AND every
  // noteExternalDiskWrite.
  private surfaceStateProvider: (path: string) => SurfaceState = () => ({
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  });
  // WP4: the resurrect-block seam. WP19: `null` no longer means "nothing is
  // tombstoned" — it means "ask the DOC", i.e. the per-path `deleted` container
  // via {@link createDocTombstoneView}. The seam stays so a test (or a later WP)
  // can substitute a view, but leaving it unwired can no longer silently disable
  // the resurrect block: a doc with no tombstones answers `false` for every id
  // anyway, so the default behaviour is unchanged while a REAL delete is now
  // honoured without any wiring in `main.ts`.
  private tombstoneView: TombstoneView | null = null;
  // WP4 (BUILD_SPEC §8): the discrimination seam. `false` stops classifying the
  // save against the shadow — every observed field becomes intent, exactly the
  // pre-V2 behaviour. Test-only; there is no production caller.
  private shadowRebaseEnabled = true;
  // WP36 follow-up (B32) — THE PRE-WP36 CONTROL SEAM. `false` routes `text` and
  // `label` back through the plain register write at the bottom of
  // `applyIntentPlan`, i.e. the whole-string LWW behaviour WP36 replaced: no
  // `Y.Text` is ever constructed, no merge is ever planned, and a save's string
  // overwrites whatever the doc held.
  //
  // It exists because a MIGRATED ORACLE THAT CANNOT FAIL ON THE BEHAVIOUR IT
  // REPLACES HAS MIGRATED NOTHING. Every assertion this run re-oracled is paired
  // with a control that flips this seam and shows the new assertion RED — the
  // same instrument, in the same file, in the same run, as `setShadowRebaseEnabled`
  // (WP4) and as WP36's own "render removed" controls.
  //
  // Test-only; there is no production caller. Verified by a test that greps the
  // shipped sources for a second call site.
  private collabTextEnabled = true;
  // WP28: the two impure halves of `EpochConflictEnv`, defaulted to the real
  // world so the archive path needs no wiring to function. Replaceable through
  // `setEpochConflictHooks`.
  private epochNotify: (message: string) => void = (message) => {
    new Notice(message);
  };
  private epochToday: () => string = () => isoCalendarDate(new Date());

  constructor(
    vault: Vault,
    syncManager: SyncManager,
    fileOpsManager: FileOpsManager,
    canWrite?: (path: string) => boolean,
  ) {
    this.vault = vault;
    this.syncManager = syncManager;
    this.fileOpsManager = fileOpsManager;
    this.canWrite = canWrite ?? (() => true);
  }

  // WP38 (C38 AC1) — one registry per CLIENT, one `Y.UndoManager` per canvas
  // doc inside it, attached on subscribe and destroyed on unsubscribe/teardown.
  // Owned here because this class owns the doc lifecycle the manager's lifetime
  // is defined against; the SCOPE decision is `canvas/canvas-undo.ts`'s.
  private undoRegistry = new CanvasUndoRegistry();

  getUndoRegistry(): CanvasUndoRegistry {
    return this.undoRegistry;
  }

  /** Replace the registry — the clock seam C38 AC4 drives the capture-timeout
   * boundary through. Must be called before any `subscribe`, or the managers
   * the old registry holds are dropped without their docs being torn down. */
  setUndoRegistry(registry: CanvasUndoRegistry): void {
    this.undoRegistry.destroy();
    this.undoRegistry = registry;
  }

  // Bug G: inject/replace the client-side read-only guard after construction.
  // `path` is the canonical canvas path (toCanonicalPath(normalizePath(rawPath))).
  setCanWrite(predicate: (path: string) => boolean): void {
    this.canWrite = predicate;
  }

  // WP3: register the diff-inferred lock-acquisition hook.
  setOnLocalNodeChange(cb: (path: string, nodeId: string) => void): void {
    this.onLocalNodeChange = cb;
  }

  // Inject the status-console logger (optional; no-op until set).
  setLogger(logger: CanvasSyncLogger): void {
    this.logger = logger;
  }

  // WP4: the LIVE shadow instance (never a copy) — the capture path's basis, the
  // tests' primary state oracle, and what WP5 advances on a confirmed apply.
  getSurfaceShadow(): SurfaceShadow {
    return this.shadow;
  }

  // WP4 / C5 AC1: replace the instance so reconcile and capture provably share
  // ONE structure — there is no second, parallel shadow.
  setSurfaceShadow(shadow: SurfaceShadow): void {
    this.shadow = shadow;
  }

  // WP4: inject the surface-state seam (is the view open, which ids did the last
  // apply hand to it). `path` is the canonical canvas path.
  setSurfaceStateProvider(provider: (path: string) => SurfaceState): void {
    this.surfaceStateProvider = provider;
  }

  // WP4: inject the read-only view over the tombstone container (WP12).
  setTombstoneView(view: TombstoneView): void {
    this.tombstoneView = view;
  }

  // WP4 (BUILD_SPEC §8): disable the shadow rebase at its seam. Test-only.
  setShadowRebaseEnabled(enabled: boolean): void {
    this.shadowRebaseEnabled = enabled;
  }

  // WP36 follow-up (B32): disable the collaborative-text write at its router.
  // `false` reproduces the pre-WP36 whole-string LWW register exactly. Test-only.
  setCollabTextEnabled(enabled: boolean): void {
    this.collabTextEnabled = enabled;
  }

  // Register the live-view reconciliation hook (scatter fix). Called on every
  // integrated REMOTE delta with the full canvas data.
  setOnRemoteCanvasUpdate(
    cb: (path: string, data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }) => void,
  ): void {
    this.onRemoteCanvasUpdate = cb;
  }

  /**
   * WP27 — inject the path <-> guid store.
   *
   * Identity is a PROVIDED capability, exactly as sidecar I/O is (WP24's
   * `SidecarIO`). With a store injected, this instance addresses canvas docs by
   * guid, stamps `meta.guid` / `meta.path` / `meta.epoch`, and honours AC1's
   * mixed-version rule. With no store it has no identity provider and falls back
   * to the pre-WP27 addressing (see {@link canvasDocIdFor}) — it does not invent
   * an identity it cannot publish, because an identity no peer can resolve is
   * how a file ends up with two documents.
   */
  setIdentityStore(store: CanvasIdentityStore): void {
    this.identityStore = store;
  }

  /**
   * WP25 — inject the sidecar lifecycle (AC1/AC2).
   *
   * Durability is a PROVIDED capability, exactly as identity is. With a
   * lifecycle injected, `subscribe` replays this guid's history into the doc
   * BEFORE peer sync and captures every subsequent update; `unsubscribe`
   * detaches and flushes. With none, both are no-ops and the client behaves
   * exactly as it did before WP25.
   */
  setSidecarLifecycle(lifecycle: SidecarLifecycle | null): void {
    this.sidecar = lifecycle;
  }

  /**
   * WP28 — replace the two impure seams the epoch conflict archive needs.
   *
   * Both default to the real world (`new Notice(...)` and the system calendar
   * date), so nothing has to be wired for the archive to work; the setter exists
   * so a harness can drive the path without a live Obsidian surface and without
   * freezing time. `canvas-epoch.ts` itself never reads a clock and never
   * imports Obsidian — {@link EpochConflictEnv} is where both enter.
   */
  setEpochConflictHooks(hooks: { notify?: (message: string) => void; today?: () => string }): void {
    if (hooks.notify) this.epochNotify = hooks.notify;
    if (hooks.today) this.epochToday = hooks.today;
  }

  /** WP27 — cached, synchronous: the guid for a CANONICAL path, or `null`. */
  getCanvasGuid(rawPath: string): string | null {
    const path = toCanonicalPath(normalizePath(rawPath));
    return this.guidByPath.get(path) ?? null;
  }

  /**
   * The doc id for a path, or `null` when this client has no identity for it.
   *
   * `null` is a REFUSAL, and the create-on-demand behaviour of
   * `SyncManager.getDoc` is exactly why it has to be one: asking for an id is
   * enough to bring the document into existence, so "I do not know this path"
   * must never be answered with a plausible id.
   *
   * The `identityStore === null` branch is the transitional fallback: with no
   * identity provider the canonical PATH is used as the identity token, which
   * reproduces the pre-WP27 id byte for byte through the same single
   * constructor. It is not a second id format and no call site may special-case
   * it.
   */
  private canvasDocIdFor(path: string): string | null {
    const guid = this.guidByPath.get(path);
    if (guid !== undefined) return canvasDocId(guid);
    if (this.identityStore !== null) return null;
    if (path.trim().length === 0) return null;
    return canvasDocId(path);
  }

  // WP2: expose the canvas doc handle (incl. its own awareness channel) so the
  // presence layer can read/write canvas cursors + locks on getDoc().awareness.
  getCanvasDocHandle(rawPath: string): DocHandle | null {
    const path = toCanonicalPath(normalizePath(rawPath));
    const docId = this.canvasDocIdFor(path);
    if (!docId) return null;
    return this.syncManager.getDoc(docId);
  }

  // Initial-sync fix: expose the current CRDT snapshot (dangling-edge-pruned) so
  // main.ts can force a freshly-MOUNTED live view to match shared truth on the
  // very first sync (Obsidian's open canvas ignores external .canvas writes, and
  // the observer only fires on SUBSEQUENT remote deltas — never the seed). Returns
  // null when not subscribed, no doc, or the shared doc is still empty (nothing
  // authoritative to apply yet → keep the local view untouched).
  getCanvasSnapshot(
    rawPath: string,
  ): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (!this.subscribedPaths.has(path)) return null;
    const docId = this.canvasDocIdFor(path);
    if (!docId) return null;
    const docHandle = this.syncManager.getDoc(docId);
    if (!docHandle) return null;
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");
    if (nodesMap.size === 0) return null;
    // WP19 AC2: the snapshot a freshly mounted view is reconciled against is
    // SHARED TRUTH, and a tombstoned record is not part of it. Handing the
    // two-argument (no-suppression) snapshot to a view would put the deleted
    // card straight back on the user's screen, and the next save of that view
    // would then aim a stale surface at the record the peer just deleted.
    return buildCanvasData(nodesMap, edgesMap, docHandle.doc.getMap<unknown>(DELETED_MAP_NAME));
  }

  private currentSeq(path: string): number {
    return this.remoteSeq.get(path) ?? 0;
  }

  /**
   * WP27 AC1 — resolve the guid a subscribe should use, or refuse.
   *
   * ├── resolved  → republished to BOTH stores, so the manifest and `index.json`
   * │               agree afterwards regardless of which one answered.
   * ├── host, unresolved → MINT and bind. The host is the one client entitled to
   * │               name a board nobody has named yet.
   * └── guest, unresolved → `null`. Minting here is the two-document defect: the
   *                 guest would create a healthy, converging doc that the peer's
   *                 healthy, converging doc can never meet.
   */
  private async resolveGuidForSubscribe(
    path: string,
    role: "host" | "guest",
  ): Promise<string | null> {
    const store = this.identityStore;
    // No identity provider: the canonical path IS the identity token. See
    // `canvasDocIdFor` — the resulting doc id is the pre-WP27 one, built by the
    // same single constructor.
    if (!store) return path;

    let resolved: string | null = null;
    try {
      resolved = await store.guidForPath(path);
    } catch {
      resolved = null;
    }
    if (isUsableGuid(resolved)) {
      try {
        await store.bind(resolved, path);
      } catch {
        /* the mapping we just READ is still usable if re-publishing it failed */
      }
      return resolved;
    }

    if (role !== "host") return null;

    const minted = mintCanvasGuid();
    try {
      await store.bind(minted, path);
    } catch {
      this.logger?.warn(
        "canvas-sync",
        `subscribe ${path}: minted guid could not be published - peers may not resolve it`,
      );
    }
    return minted;
  }

  /**
   * WP27 AC1 — write the identity into `meta`.
   *
   * Guarded BEFORE the transaction, never inside it: Yjs emits a real update for
   * a same-value LWW `set`, so an unguarded stamp would echo to every peer on
   * every subscribe of every board, forever (the same property WP8 AC3 pins for
   * the migration).
   *
   * `meta` is reached through `doc.getMap`, never assigned — the container is
   * created once per doc and keeps its identity, so a peer writing into it keeps
   * merging with us (WP8 AC1).
   *
   * `epoch` is seeded ONLY when the doc has none. WP27 defines the key; WP28
   * owns monotonicity, comparison, host-increment and conflict handling (Shared
   * Ownership Contract §2). There is deliberately no comparison here.
   */
  private stampIdentity(doc: Y.Doc, guid: string, path: string): void {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    const writeGuid = meta.get(GUID_KEY) !== guid;
    const writePath = meta.get(PATH_KEY) !== path;
    const writeEpoch = meta.get(EPOCH_KEY) === undefined;
    if (!writeGuid && !writePath && !writeEpoch) return;
    doc.transact(() => {
      if (writeGuid) meta.set(GUID_KEY, guid);
      if (writePath) meta.set(PATH_KEY, path);
      if (writeEpoch) meta.set(EPOCH_KEY, INITIAL_CANVAS_EPOCH);
    });
  }

  // ── WP28 — the epoch rule, wired ─────────────────────────────────────────
  //
  // `canvas-epoch.ts` is a pure core and takes the impure world by injection.
  // This is where the real world is supplied: the `.canvas` projection is
  // `serializeCanvas` (the SAME single projection `CanvasPersistence` writes with
  // — an archive produced by a second serializer could agree with a broken one),
  // the write is a vault write that PROPAGATES its failure, the notification is
  // an Obsidian `Notice`, and the date is the local calendar day.

  /**
   * The archive write, and it is deliberately NOT {@link writeToDisk}.
   *
   * `writeToDisk` swallows its error into a `Notice`, applies the WP4 sequence
   * gate and mutes vault events — all correct for the CRDT→disk projection of a
   * LIVE board, and all wrong here. The conflict copy is fail-closed: if these
   * bytes do not land, {@link resolveEpochConflict} must adopt nothing, and it
   * can only know that if the rejection reaches it. It is also a NEW user file
   * that nothing is subscribed to, so nothing about it is an echo to suppress.
   */
  private async writeConflictCopy(canonicalPath: string, content: string): Promise<void> {
    if (!isPathSafe(canonicalPath)) {
      throw new Error(`canvas-epoch: refusing to write a conflict copy to ${canonicalPath}`);
    }
    const diskPath = toLocalPath(canonicalPath);
    // NEVER CLOBBER. `conflictCopyPath` is deterministic and day-granular, so a
    // second conflict on the same board on the same day names the SAME file — and
    // the file already there is another loser's only surviving copy. Overwriting
    // it destroys exactly the data the archive exists to preserve, which is the
    // one outcome this mechanism may not produce. An identical body is an
    // idempotent re-run and is fine; anything else is refused, and fail-closed
    // then means the adoption does not happen either, so nothing is lost at all.
    if (await this.vault.adapter.exists(diskPath)) {
      const existing = await this.vault.adapter.read(diskPath);
      if (existing === content) return;
      throw new Error(
        `canvas-epoch: ${diskPath} already exists with different content - refusing to overwrite an existing conflict copy`,
      );
    }
    const parentDir = diskPath.substring(0, diskPath.lastIndexOf("/"));
    if (parentDir) await ensureFolder(this.vault, parentDir);
    await this.vault.adapter.write(diskPath, content);
  }

  /** The real {@link EpochConflictEnv}. One builder, so both call sites agree. */
  private epochConflictEnv(): EpochConflictEnv {
    return {
      serializeDoc: (doc: Y.Doc) =>
        serializeCanvas(
          doc.getMap<Y.Map<unknown>>("nodes"),
          doc.getMap<Y.Map<unknown>>("edges"),
          doc.getMap<unknown>(DELETED_MAP_NAME),
        ),
      writeConflictCopy: (path: string, content: string) => this.writeConflictCopy(path, content),
      notify: (message: string) => this.epochNotify(message),
      today: () => this.epochToday(),
      logger: this.logger ?? undefined,
    };
  }

  /**
   * WP28's seam for WP30 — adopt a materialised WINNER into this path's live doc.
   *
   * This is the COMPLETE half of AC1 and the only place a full adoption can
   * happen, because it is the only place a winner exists as its own document.
   * WP30's "import from file" builds exactly that (parse the file into a staged
   * doc, {@link bumpEpoch} it) and calls this; the wholesale container
   * replacement then propagates to every peer as ordinary Yjs deletes and sets.
   *
   * Returns `null` when this client has no doc for the path — never a synthesised
   * "equal" outcome, which a caller could not tell from a real one.
   */
  async adoptEpochWinner(rawPath: string, winner: Y.Doc): Promise<EpochConflictOutcome | null> {
    const path = toCanonicalPath(normalizePath(rawPath));
    const docId = this.canvasDocIdFor(path);
    if (docId === null) return null;
    const docHandle = this.syncManager.getDoc(docId);
    if (!docHandle) return null;
    return resolveEpochConflict({
      doc: docHandle.doc,
      winner,
      canvasPath: path,
      env: this.epochConflictEnv(),
    });
  }

  /**
   * AC2/AC4 on the LOSING side, at the seam where two replicas of one guid
   * actually meet: `subscribe`, once `waitForSync` has settled.
   *
   * The doc this client is now holding is its own sidecar replay MERGED with what
   * the peers had. If the settled epoch is higher than the epoch this client's
   * own durable replica carried, then this replica was behind — its history was
   * superseded by a deliberate re-seed it did not take part in — and AC2 says its
   * state is ARCHIVED and NAMED rather than silently absorbed.
   *
   * Two things make this the right seam and not merely an available one:
   *
   *   ├── the local replica is materialisable HERE and nowhere else. The sidecar
   *   │   is a second, independent replay of exactly this guid, so staging it
   *   │   into a scratch doc reconstructs the loser's pre-merge state byte for
   *   │   byte. After `subscribe` returns, that state exists only inside the
   *   │   union and can no longer be separated from it.
   *   └── it is INERT until an epoch actually differs. Nothing in the shipped
   *       plugin calls `bumpEpoch` yet (that is WP30's import command), so
   *       `settled === 0` short-circuits before any extra I/O — this costs a
   *       comparison per subscribe today and becomes live the moment WP30 lands.
   *
   * The scratch doc is what {@link resolveEpochConflict} adopts into, and that is
   * not a wasted transaction: it is what proves the archive was written from the
   * loser's state BEFORE anything replaced it, and it leaves the scratch replica
   * holding the winner's state so the two are never confused. The LIVE doc is
   * never touched here — its convergence is Yjs's, driven by the winner's own
   * wholesale replacement (see {@link adoptEpochWinner}).
   *
   * Never throws. A failed archive means "not archived yet" and is logged; a
   * subscribe must not die because a conflict copy could not be written.
   */
  private async reconcileEpochOnSubscribe(path: string, guid: string, doc: Y.Doc): Promise<void> {
    const sidecar = this.sidecar;
    if (sidecar === null || this.identityStore === null) return;
    // Epoch 0 is "nobody has ever deliberately re-seeded this board". No replica
    // can be behind a board that has never moved, so there is nothing to compare.
    if (readEpoch(doc) === 0) return;

    const staged = new Y.Doc();
    try {
      await sidecar.load(guid, staged);
      // A missing or corrupt sidecar is the defined degradation (WP24 AC3): this
      // client behaves like a fresh peer. Archiving an empty board would hand the
      // user a file with none of their work in it and a notice claiming it holds
      // their previous version.
      if (staged.getMap<unknown>("nodes").size === 0 && staged.getMap<unknown>("edges").size === 0) {
        return;
      }
      await resolveEpochConflict({
        doc: staged,
        winner: doc,
        canvasPath: path,
        env: this.epochConflictEnv(),
      });
    } catch (error) {
      this.logger?.warn(
        "canvas-epoch",
        `epoch reconcile failed for ${path}: ${
          error instanceof Error ? error.message : String(error)
        } - nothing was archived`,
      );
    } finally {
      staged.destroy();
    }
  }

  /** The mutable path cell the subscribe-time closures read. See AC2. */
  private pathRefFor(path: string): { current: string } {
    const existing = this.observedPathRefs.get(path);
    if (existing) {
      existing.current = path;
      return existing;
    }
    const created = { current: path };
    this.observedPathRefs.set(path, created);
    return created;
  }

  /**
   * WP27 AC2/AC3 — move every PATH-KEYED structure from one key to the other.
   *
   * The registries stay path-keyed (AC3 forbids re-keying them by guid); what a
   * rename changes is which path is the live key. Listed exhaustively and moved
   * in one place, because a rename that forgets one of them fails in a way that
   * only shows up under a specific later event — a stale write timer firing for
   * the retired name, an un-cleared `recentDiskWrite` swallowing the first real
   * edit, a lost seed-refusal ledger un-withholding a write this client refused.
   */
  private rekeyPathState(oldPath: string, newPath: string): void {
    const moveSet = (set: Set<string>): void => {
      if (!set.delete(oldPath)) return;
      set.add(newPath);
    };
    const moveMap = <V>(map: Map<string, V>): void => {
      if (!map.has(oldPath)) return;
      const value = map.get(oldPath) as V;
      map.delete(oldPath);
      map.set(newPath, value);
    };

    moveSet(this.subscribedPaths);
    moveSet(this.recentDiskWrites);
    moveSet(this.recentLocalEdits);
    moveMap(this.guidByPath);
    moveMap(this.observers);
    moveMap(this.seqHandlers);
    moveMap(this.writeTimers);
    moveMap(this.writeFirstScheduled);
    moveMap(this.externalWriteSettleTimers);
    moveMap(this.lastWrittenContent);
    moveMap(this.seedRefusalLedgers);
    // WP29: the knowledge is about the DOC, and a rename does not change which
    // doc the (renamed) path names — left behind, the renamed canvas would
    // report "nothing knows this board" and become seedable from a stale file.
    moveMap(this.seedKnowledgeByPath);
    moveMap(this.remoteSeq);
    // WP4's Surface-Shadow is the capture path's intent basis and is per-path.
    // Left behind, the renamed canvas would have an EMPTY shadow and the first
    // save after a rename would replay the whole file as fresh intent — the
    // exact window the cascade starts in.
    moveMap(this.shadow.paths);

    const ref = this.observedPathRefs.get(oldPath);
    if (ref) {
      this.observedPathRefs.delete(oldPath);
      ref.current = newPath;
      this.observedPathRefs.set(newPath, ref);
    }
  }

  async subscribe(rawPath: string, role: "host" | "guest"): Promise<void> {
    const path = toCanonicalPath(normalizePath(rawPath));
    // A peer/host controls manifest keys; reject any that would escape the vault.
    if (!isPathSafe(path)) return;
    if (this.subscribedPaths.has(path)) return;
    // Claimed SYNCHRONOUSLY, before the first await, exactly as before: US5 AC3
    // ("a pending subscribe already counts as owned") is what keeps the raw-text
    // path unreachable while a subscribe is in flight, and the identity
    // resolution below is now the first of several awaits inside that window.
    this.subscribedPaths.add(path);

    // WP27 AC1 — identity BEFORE the doc. Nothing is asked of the sync manager
    // until this client knows WHICH document the path names, because asking is
    // what creates it.
    const guid = await this.resolveGuidForSubscribe(path, role);
    if (guid === null) {
      // The mixed-version rule (charter §3): a client that cannot resolve a guid
      // treats the doc as UNKNOWN and asks peers or the manifest — it never
      // seeds a second doc for the same file. So a guest with no mapping opens
      // nothing at all, and a later subscribe joins the peer's doc instead of
      // meeting it as a stranger.
      this.subscribedPaths.delete(path);
      return;
    }
    // An unsubscribe (or a destroy) may have landed while identity resolved.
    if (!this.subscribedPaths.has(path)) return;
    this.guidByPath.set(path, guid);

    const docId = canvasDocId(guid);
    const docHandle = this.syncManager.getDoc(docId);
    if (!docHandle) {
      this.subscribedPaths.delete(path);
      this.guidByPath.delete(path);
      return;
    }

    // WP25 AC1 — the SIDECAR, between `getDoc` and `waitForSync`, and AWAITED.
    //
    // The placement is the whole acceptance criterion. Both orders reach the
    // same end state (Yjs merges commute), so nothing about the resulting
    // document can tell you which happened first; what differs is WHAT THE PEER
    // MEETS. Loaded first, the exchange is between two related replicas of the
    // same board. Issued CONCURRENTLY with `waitForSync` it usually looks fine
    // and loses the race on a slow disk, at which point the peer syncs against
    // an empty replica and the two histories merge as strangers.
    //
    // `attach` comes first so no update emitted while the replay is in flight
    // escapes the history; the load's own apply is stamped `SIDECAR_LOAD_ORIGIN`
    // and is excluded there, so replaying cannot re-append what was just read.
    //
    // Only with an identity store: without one the identity token is the
    // canonical PATH (see `canvasDocIdFor`), and naming sidecar files after a
    // path would both leak `.canvas` into the sidecar directory and lose the
    // history at the first rename.
    //
    // WP29 (AC1), FIRST MEASUREMENT: the `SidecarLoadResult` this load already
    // returns and used to discard. "The sidecar knows this doc" is a claim about
    // a REPLICA having been replayed, so it is true iff a checkpoint was applied
    // or at least one history frame was. A MISSING (or otherwise degraded) load
    // is explicitly NOT knowledge — reading "a load ran" as "the sidecar knows
    // it" would make every board unseedable the moment a lifecycle is wired. A
    // frame log with no checkpoint IS knowledge: that is a sidecar's normal
    // state between compactions.
    let sidecarKnowsDoc = false;
    if (this.sidecar !== null && this.identityStore !== null) {
      this.sidecar.attach(guid, docHandle.doc);
      // Never throws by WP24's AC3 — a degraded verdict is reported and nothing
      // is applied — but a subscribe must not become the first place that
      // discovers otherwise.
      try {
        const loaded = await this.sidecar.load(guid, docHandle.doc);
        sidecarKnowsDoc = loaded.checkpointApplied === true || loaded.historyEntriesApplied > 0;
      } catch {
        /* degrade, never break (I5) */
      }
      if (!this.subscribedPaths.has(path)) return;
    }

    // WP29 (AC1), SECOND MEASUREMENT: "a peer knows this doc" is a STATE-VECTOR
    // DELTA ACROSS THE SYNC STEP, and it has to be, for two reasons:
    //
    //   ├── not "the doc is non-empty" — that is the condition that already
    //   │   existed, and it is exactly the one that is wrong for a cleared
    //   │   board.
    //   └── not "foreign clientIDs are present" — the sidecar load ran a moment
    //       ago, REPLAYS UPDATES UNDER THEIR ORIGINAL AUTHORS' IDs, and would
    //       therefore be read as a peer. That collapses AC1's two independent
    //       conditions into one.
    //
    // A state vector only ever grows, so byte-inequality across the await is
    // exactly "this replica gained state while the peers were speaking".
    const stateBeforeSync = Y.encodeStateVector(docHandle.doc);
    try {
      await this.syncManager.waitForSync(docId);
    } catch {
      this.subscribedPaths.delete(path);
      this.guidByPath.delete(path);
      return;
    }
    const peerKnowsDoc = !sameBytes(stateBeforeSync, Y.encodeStateVector(docHandle.doc));

    if (!this.subscribedPaths.has(path)) return;
    // Recorded before the two early returns below, so a path whose observer is
    // already installed still reports what this subscribe measured.
    this.seedKnowledgeByPath.set(path, { sidecarKnowsDoc, peerKnowsDoc });
    if (this.observers.has(path)) return;

    // WP28 AC2/AC4 — THE EPOCH RULE, at the moment the two replicas have met.
    //
    // Placed after `waitForSync` (the peers' state is in) and BEFORE the host
    // seed below (which pushes this client's local file into the doc): the
    // question "was my history superseded?" has to be answered about the state
    // this client arrived with, not about the state it is about to write.
    // Awaited, so the archive is durable before anything else moves.
    await this.reconcileEpochOnSubscribe(path, guid, docHandle.doc);
    if (!this.subscribedPaths.has(path)) return;

    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");
    // WP19 AC2: the tombstone container is a THIRD observed map. A remote delete
    // writes ONLY here — it touches neither `nodes` nor `edges` — so a
    // subscription that watched the two record maps alone would never fire for a
    // peer's delete and the deletion would never reach the open canvas view.
    const deletedMap = docHandle.doc.getMap<unknown>(DELETED_MAP_NAME);

    // WP38 (C38 AC1) — THIS canvas doc's own manager, scoped to the three named
    // root types above. Two subscribed canvases therefore hold two managers
    // with two stacks; there is no shared stack for them to interact through.
    // Attached BEFORE the host seed below so that the seed — which runs under
    // no tracked origin — is observably not undoable rather than merely
    // unobserved.
    this.undoRegistry.attach(path, docHandle.doc);

    const diskPath = toLocalPath(path);
    if (role === "host") {
      const file = getFileByPath(this.vault, diskPath);
      if (file) {
        const content = await this.vault.read(file);
        // WP16: the temporary P1 decode bridge — the seed path still writes the
        // FLAT file shape into the doc until WP18 wires the registers.
        const data = decodeCanvasDataToFlat(parseCanvas(content));
        this.recentLocalEdits.add(path);
        docHandle.doc.transact(() => {
          this.applyCanvasToYMaps(path, nodesMap, edgesMap, data);
        });
        this.recentLocalEdits.delete(path);
        // Bug C: establish the ECHO baseline so a byte-identical first modify is
        // recognised as our own write (WP4 AC1: this is no longer the intent
        // basis, only the echo/telemetry aid).
        this.lastWrittenContent.set(path, content);
        // WP4: the host seed is the same class of receipt as a closed-view
        // persistence write — this client just pushed exactly this file into the
        // doc, so the surface provably holds it. Without this the shadow is empty
        // right after a subscribe and the first Obsidian save replays the whole
        // file as intent, which is precisely the window the cascade starts in.
        this.advanceShadowFromContent(path, content, false);
      }
    }
    // WP7 (US5 AC13/AC17): the GUEST seed is gone from here. `CanvasPersistence`
    // owns it now via `coldOpen()`, which the wiring layer runs after this
    // subscribe resolves (i.e. after `waitForSync`) and before `start()`:
    //   ├── doc NON-empty → "doc-wins" → flush() → the stale file is overwritten
    //   │                   from the doc. Behaviour-equivalent to the seed write
    //   │                   this replaces, minus the second writer.
    //   └── doc EMPTY     → the file is parsed ONCE and SEEDS the doc, instead of
    //                       only recording a diff baseline. Deliberate change.
    // The HOST branch above no longer deletes: WP29 (AC2) removed the
    // record-level delete-by-omission, so it is an UPSERT of the records the
    // file names and nothing else. It still differs from `coldOpen`'s doc-wins
    // branch — that one writes the doc to disk, this one writes the file into
    // the doc — so the two are still not interchangeable.

    // WP27 AC1 — the IDENTITY STAMP, and its placement is load-bearing.
    //
    // It runs AFTER the host seed above and never before it, because WP8's
    // `migrateV1ToV2` is one-shot on `meta`. The marker was taught to ignore the
    // three identity keys (`canvas-schema.ts`, `hasSchemaClaim`) so the stamp
    // cannot arm it at all — but the ordering is kept anyway: the two defences
    // are independent, and the failure they prevent is silent and permanent (a
    // V1 doc left with no `schemaVersion`, no `pos`/`size`, no `ord`, while every
    // convergence oracle stays green).
    //
    // Only when an identity store is injected. Without one there is no identity
    // to stamp — writing the PATH into `meta.guid` would be a claim this client
    // cannot honour and a lie every peer would read.
    if (this.identityStore !== null) {
      this.stampIdentity(docHandle.doc, guid, path);
    }

    // WP27 AC2: the closures below read the path through this cell, so a rename
    // re-points the live data path instead of leaving it on the retired name.
    const pathRef = this.pathRefFor(path);

    // WP4 (US5 AC1): bump the per-path remote sequence on every non-local
    // transaction. afterTransaction fires exactly once per transaction (unlike
    // the two deep observers below), so a remote delta touching both maps counts
    // once. Local edits (transact() from applyLocalDiffToYMaps / seeding) have
    // tr.local === true and never bump.
    const afterTx = (tr: Y.Transaction) => {
      if (!tr.local) {
        this.remoteSeq.set(pathRef.current, this.currentSeq(pathRef.current) + 1);
      }
    };
    docHandle.doc.on("afterTransaction", afterTx);
    this.seqHandlers.set(path, () => docHandle.doc.off("afterTransaction", afterTx));

    const observer = () => {
      const livePath = pathRef.current;
      if (this.recentLocalEdits.has(livePath)) return;
      // REMOTE delta: patch the OPEN canvas view directly — Obsidian ignores
      // external .canvas writes while the view is open, so a file-only sync leaves
      // the view stale/scattered until a full reload.
      if (this.onRemoteCanvasUpdate) {
        try {
          this.onRemoteCanvasUpdate(livePath, buildCanvasData(nodesMap, edgesMap, deletedMap));
        } catch {
          /* live reconciliation must never break the data path */
        }
      }
      // WP7 (US5 AC13): the CRDT→disk write is RETIRED here. `CanvasPersistence`
      // is the single writer for every canvas-owned path; scheduling a second
      // flush from this observer is exactly the two-writer race this round
      // exists to remove. What remains is the corruption TELEMETRY, on the same
      // trailing debounce so it still narrates once per settled burst rather
      // than once per delta (US6 AC5).
      //
      // WP20: that same pass is now the QUARANTINE AUDITOR, so it needs the
      // tombstone container as well — which this observer already watches, so a
      // peer's repair delta and a peer's quarantine both re-arm it.
      this.scheduleCanvasAudit(livePath, nodesMap, edgesMap, deletedMap);
    };
    nodesMap.observeDeep(observer);
    edgesMap.observeDeep(observer);
    deletedMap.observeDeep(observer);
    this.observers.set(path, () => {
      nodesMap.unobserveDeep(observer);
      edgesMap.unobserveDeep(observer);
      deletedMap.unobserveDeep(observer);
    });

    // Initial-sync fix: the observer above only fires on SUBSEQUENT remote deltas,
    // never on the seed that just completed via waitForSync. If the guest already
    // had this canvas OPEN, its live view is still showing the stale local file
    // (wrong positions / disconnected edges) — Obsidian ignores the disk write we
    // just did. Drive one authoritative reconcile now so the open view snaps to
    // shared truth. Host's own view IS the source of truth, so only guests need it.
    if (role === "guest" && this.onRemoteCanvasUpdate && nodesMap.size > 0) {
      try {
        this.onRemoteCanvasUpdate(path, buildCanvasData(nodesMap, edgesMap, deletedMap));
      } catch {
        /* live reconciliation must never break subscribe */
      }
    }
  }

  unsubscribe(rawPath: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    // WP27: resolved BEFORE the identity is dropped below — the doc to release
    // is named by the guid, and after a rename the path is no longer able to
    // name it at all.
    const docId = this.canvasDocIdFor(path);
    // WP25 AC2 — read BEFORE the identity is dropped below, for the same reason
    // `docId` is.
    const sidecarGuid = this.guidByPath.get(path);
    this.subscribedPaths.delete(path);
    const timer = this.writeTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      this.writeTimers.delete(path);
    }
    const settleTimer = this.externalWriteSettleTimers.get(path);
    if (settleTimer) {
      clearTimeout(settleTimer);
      this.externalWriteSettleTimers.delete(path);
    }
    this.writeFirstScheduled.delete(path);
    this.remoteSeq.delete(path);
    const unobserve = this.observers.get(path);
    if (unobserve) {
      unobserve();
      this.observers.delete(path);
    }
    const detachSeq = this.seqHandlers.get(path);
    if (detachSeq) {
      detachSeq();
      this.seqHandlers.delete(path);
    }
    // WP63: drop the SHARED reference, never `reset()` it — a `CanvasPersistence`
    // for this path may still be alive and withholding, and un-withholding it
    // from here would let the very write this WP exists to stop reach the file.
    // A later re-subscribe re-seeds and gets a fresh ledger.
    this.seedRefusalLedgers.delete(path);
    // WP29: the measurement belongs to the subscribe that took it. A later
    // re-subscribe takes it again; until then this path knows nothing, which is
    // the same answer it gave before it was ever subscribed.
    this.seedKnowledgeByPath.delete(path);
    this.guidByPath.delete(path);
    this.observedPathRefs.delete(path);
    // WP25 AC2 — the retired doc must STOP appending. Left attached it keeps
    // writing into a history nobody is reading, and the next subscribe replays
    // two lifetimes of frames for the same board. The handler is removed
    // synchronously inside `detach`, before its first await; what the promise
    // carries is the flush of the tail (`unsubscribe` is synchronous by
    // contract, so it cannot be awaited here).
    if (this.sidecar !== null && sidecarGuid !== undefined) {
      void this.sidecar.detach(sidecarGuid);
    }
    // WP38 (C38 AC1) — the manager is destroyed with its doc. It holds a
    // reference to the doc and to every stack item over it, so leaving it
    // attached past the release is a retained reference AND an undo that can
    // reach a torn-down surface.
    this.undoRegistry.detach(path);
    if (docId) this.syncManager.releaseDoc(docId);
  }

  /**
   * WP27 AC2 — the RENAME entry point. A rename is a METADATA UPDATE.
   *
   * What moves: `meta.path`, the manifest mapping, `index.json`, and every
   * path-keyed structure in this class. What does NOT move: the guid, the doc
   * id, and the `Y.Doc` itself.
   *
   * What this method deliberately is NOT is `unsubscribe(old)` + `subscribe(new)`.
   * That variant leaves every key set plausible and destroys peer history: the
   * doc is released and re-acquired, so un-flushed remote state is gone, the
   * `Y.Doc` is a different object, and the board silently restarts from whatever
   * the relay happens to still hold. Nothing throws.
   *
   * The three re-pointings are independent and each one alone is insufficient:
   *
   *   ├── the MAPS      → `getCanvasDocHandle(new)` and `isSubscribed(new)`
   *   ├── `meta.path` + the two stores → what a PEER and the next session read
   *   └── the OBSERVER cell → the live data path. A rename that fixes the maps
   *       but leaves the closures on the old path gives correct metadata over a
   *       dead channel: the remote hook fires under the retired name and the
   *       open view is never patched again.
   *
   * A path this client holds no identity for is not ours to rename, so it is a
   * no-op rather than an error — `vault-events` cannot know which `.canvas`
   * paths `CanvasSync` owns before it calls.
   */
  async handleRename(oldRawPath: string, newRawPath: string): Promise<void> {
    const oldPath = toCanonicalPath(normalizePath(oldRawPath));
    const newPath = toCanonicalPath(normalizePath(newRawPath));
    if (oldPath === newPath) return;
    const guid = this.guidByPath.get(oldPath);
    if (guid === undefined) return;
    if (!isPathSafe(newPath)) return;

    this.rekeyPathState(oldPath, newPath);

    // The doc is reached by its UNCHANGED id — this creates nothing and releases
    // nothing, it only re-labels what the doc says about itself.
    if (this.identityStore !== null) {
      const docHandle = this.syncManager.getDoc(canvasDocId(guid));
      if (docHandle) this.stampIdentity(docHandle.doc, guid, newPath);
    }

    const store = this.identityStore;
    if (!store) return;
    // BIND first, then UNBIND: in that order the mapping is never absent from
    // both stores at once, so a peer resolving mid-rename finds the new path or
    // the old one — never nothing, which would make it mint a second identity.
    try {
      await store.bind(guid, newPath);
    } catch {
      /* a failed publish must not tear down a live subscription */
    }
    try {
      await store.unbind(oldPath);
    } catch {
      /* idempotent by contract; `renameFile` may already have moved the entry */
    }
  }

  async handleLocalModify(rawPath: string): Promise<void> {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (this.recentDiskWrites.has(path)) return;
    if (!this.subscribedPaths.has(path)) return;
    // Bug G: never push local edits for a read-only canvas path (defense in
    // depth; the authoritative check is server-side in ws-handler.ts).
    if (!this.canWrite(path)) return;

    const docId = this.canvasDocIdFor(path);
    if (!docId) return;
    const docHandle = this.syncManager.getDoc(docId);
    if (!docHandle) return;

    // WP8 AC4 — the SCHEMA-MAJOR GATE. A doc stamped with a major this build
    // cannot translate (CONCEPT_V2 Teil 12) gets no local capture at all: any
    // write we made would be a GUESS about a shape we do not understand, and a
    // guess in a CRDT is permanent. Same shape as the `canWrite` guard above —
    // return before a single write reaches `nodesMap` / `edgesMap`.
    //
    // Deliberately LOCAL and deliberately narrow (P1 half of the mixed-version
    // rule; the room-level Receive-and-Persist mode is WP32):
    //   ├── `CanvasPersistence` is NOT touched — the CRDT→disk direction keeps
    //   │   running, so the user still SEES what peers send.
    //   └── only this path stops; every other subscribed path on this client
    //       captures normally.
    if (isSchemaMajorMismatch(docHandle.doc)) {
      this.logger?.warn(
        "canvas-sync",
        `local modify ${path}: schema major mismatch - local capture disabled for this path (persistence continues)`,
      );
      return;
    }

    const file = getFileByPath(this.vault, toLocalPath(path));
    if (!file) return;

    const content = await this.vault.read(file);

    // WP4 AC2 — the BYTE echo breaker (BUILD_SPEC D9), which replaced the
    // semantic `canvasRecordsEqual` compare. It is sound only because WP3 made
    // this client's serialisation canonical, and it is deliberately NOT a timer:
    // identical bytes are our own write coming back. Zero CRDT writes and NO
    // shadow mutation — the bytes prove what the DISK holds, never what an open
    // Obsidian canvas holds (that receipt is a confirmed apply, WP5's job).
    if (content === this.lastWrittenContent.get(path)) {
      this.logger?.debug("canvas-sync", `local modify ${path}: no-op (disk == shared state)`);
      return;
    }

    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");
    const maps = { node: nodesMap, edge: edgesMap };
    // WP19: the tombstone container for THIS path. It is both the resurrect
    // block's input (`createDocTombstoneView`) and the delete path's only
    // output — no delete below touches `nodesMap` / `edgesMap` at all.
    const deletedMap = docHandle.doc.getMap<unknown>(DELETED_MAP_NAME);

    // WP4 AC1: the save is parsed, CAPTURE-ROUNDED (§4.4) and then classified
    // against the Surface-Shadow. The three-way read of `lastWrittenContent` is
    // gone — the CRDT is not an input to the verdict either, which is precisely
    // why a stale save can no longer be mistaken for intent.
    // WP16: the temporary P1 decode bridge — the capture path still classifies
    // FLAT fields against the Surface-Shadow until WP18 wires the registers.
    const save = toParsedSave(path, decodeCanvasDataToFlat(parseCanvas(content)));
    const surface = this.surfaceStateProvider(path);
    // WP19 AC2: the resurrect block now reads the doc's real `deleted`
    // container unless a caller injected a view at the seam.
    const tombstones = this.tombstoneView ?? createDocTombstoneView(deletedMap);
    const plan = this.planCapture(save, surface, tombstones);
    const saved: SaveIndex = {
      node: new Map(save.nodes.map((record) => [record.id, record])),
      edge: new Map(save.edges.map((record) => [record.id, record])),
    };

    // AC4: the DIVERGENT discards — fields the save re-stated at the shadow's
    // value while the CRDT has genuinely moved on. Read BEFORE the transaction,
    // so the compared value is the one the capture actually classified against.
    // WP36 REPRESENTATION BLINDNESS — the doc value is read through the same
    // render the projection uses, because a `Y.Text` is never `!==`-equal to
    // the string the shadow holds.
    //
    // `discard.value` is the SHADOW's value, and the shadow stores the
    // RENDERED projection (C36 AC4, `buildApplyReceipt` -> `advanceFromReceipt`).
    // Compared raw, a migrated `text` / `label` is unequal to its own rendered
    // string, so the "the CRDT has genuinely moved on" test answered TRUE for
    // every discarded text field whether or not anything had moved — the
    // `SHADOW STALE:` signature stopped distinguishing a real divergence from
    // a restatement, on the two fields where a stale push is most destructive.
    // A diagnostic that fires unconditionally is not a diagnostic.
    const divergent = plan.discarded.filter((discard) => {
      const record = maps[discard.kind].get(discard.id);
      return record !== undefined && renderDocValue(record.get(discard.field)) !== discard.value;
    });

    // WP38 (C38 AC1/AC5) — THE ORIGIN, and it is created by this work package.
    // Before WP38 the call below was a bare `doc.transact(fn)` with no origin
    // argument at all. Nothing about WHAT this transaction writes changes: an
    // origin rides on the transaction, not in the document, and `transact(fn)`
    // and `transact(fn, origin)` produce identical document state.
    //
    // WHICH origin is a decision, and it is taken here because a nested
    // `doc.transact(fn, otherOrigin)` inside an already-open transaction is
    // IGNORED by Yjs — the outer origin wins — so it cannot be taken at the
    // write site. The decision itself is `canvas/canvas-undo.ts`'s; what this
    // file supplies is the measurement it is a function of: the STORED value
    // under every collaborative-text field this pass is about to write, read
    // before the transaction opens.
    const collabTextTargets: unknown[] = [];
    if (this.collabTextEnabled) {
      for (const upsert of plan.upserts) {
        if (!isCollabTextField(upsert.field) || typeof upsert.value !== "string") continue;
        // Only an EXISTING record can be converted. A record this pass creates
        // is built detached by `buildDetachedRecord` and never reaches
        // `writeCollabText`, so creating a card keeps a plain string and stays
        // a normal, undoable step.
        const existing = maps[upsert.kind]?.get(upsert.id);
        if (existing === undefined) continue;
        collabTextTargets.push(existing.get(upsert.field));
      }
    }
    const captureOrigin = chooseCaptureOrigin(captureConvertsCollabText(collabTextTargets));

    // The step boundary, decided against the registry's injected clock BEFORE
    // the transaction opens — `stopCapturing()` has to be in effect when Yjs's
    // `afterTransaction` handler runs, or the boundary lands one step late.
    this.undoRegistry.noteCapture(path);

    this.recentLocalEdits.add(path);
    const applied = docHandle.doc.transact(
      () =>
        // WP19: the author of every tombstone this pass writes is THIS client, and
        // the `by` half of the merge tiebreak is that clientID as a string. It is
        // read from the doc rather than invented so the value a peer sees in the
        // entry is the same id it sees on the update itself.
        this.applyIntentPlan(plan, maps, deletedMap, String(docHandle.doc.clientID)),
      captureOrigin,
    );
    this.recentLocalEdits.delete(path);

    // WP18 AC1 — the rejection signatures the capture boundary produced. Logged
    // OUTSIDE the transaction: a signature is for a human, never a mechanism,
    // and it must not be able to perturb the write it describes.
    for (const signature of applied.rejected) {
      this.logger?.warn("canvas-sync", signature);
    }

    // WP4 step 6: the shadow advances for what ACTUALLY happened — a record the
    // capture boundary refused advances nothing, so the divergence it represents
    // stays detectable.
    for (const upsert of applied.upserts) {
      advanceField(this.shadow, path, upsert.kind, upsert.id, upsert.field, upsert.value);
    }
    for (const del of applied.deletes) {
      markRecordAbsent(this.shadow, path, del.kind, del.id);
    }

    // WP21: the ECHO baseline advances unconditionally. It used to be withheld
    // whenever the lock seam refused a write, so that the edit the local file
    // still held stayed detectable on the next save. There is no such refusal
    // left — locks are pure UX and the data model resolves same-register
    // conflicts — so the baseline is simply what this pass wrote.
    this.lastWrittenContent.set(path, content);

    // WP4 AC4 — the `SHADOW STALE:` signature, ONE line per pass with at least
    // one divergent discard. A save re-states every unchanged field and C2
    // discards all of them; logging those too would bury the one line that
    // matters. Ids and field NAMES only — never a value (US6: no user data).
    if (divergent.length > 0) {
      this.logger?.debug(
        "canvas-sync",
        `SHADOW STALE: ${path} ${divergent.length} field(s) not pushed: ${divergent
          .map((discard) => `${discard.kind}/${discard.id}.${discard.field}`)
          .join(", ")}`,
      );
    }

    // WP36 AC1 — the same doc-level witness, on the log channel as well as in
    // the ring. Ids, field NAMES, shapes and COUNTS only; never a value (US6).
    // The ring, not this line, is the oracle: a log can stop silently.
    if (applied.textWrites.length > 0) {
      this.logger?.debug(
        "canvas-sync",
        `TEXT WRITE: ${path} ${applied.textWrites
          .map(
            (receipt) =>
              `${receipt.kind}/${receipt.id}.${receipt.field} ${receipt.targetBefore}->` +
              `${receipt.ytextAfter ? "ytext" : "value"} ops=${receipt.ops} ` +
              `${receipt.resolution}${receipt.migrated ? " MIGRATED" : ""}` +
              `${receipt.fallback ? " FALLBACK" : ""}${receipt.baseObserved ? "" : " NO-BASE"}`,
          )
          .join(", ")}`,
      );
    }

    // Telemetry: what did the local user's edit actually push? Correlate this with
    // any SCATTER/DETACH signature on the following disk write.
    if (this.logger) {
      // A node the local user "changed" to a state missing geometry is the direct
      // upstream cause of a scatter — flag it at the source, not just on write.
      const changedNoGeo = applied.changed.filter((id) => {
        const fields = saved.node.get(id)?.fields;
        return !fields || typeof fields.x !== "number" || typeof fields.y !== "number";
      });
      this.logger.debug(
        "canvas-sync",
        `local modify ${path}: +${applied.created.length} ~${applied.changed.length} -${applied.deletedNodeIds.length} node(s)` +
          (applied.deletedNodeIds.length
            ? ` deleted=[${applied.deletedNodeIds.join(", ")}]`
            : ""),
      );
      if (changedNoGeo.length) {
        this.logger.warn(
          "canvas-sync",
          `local disk read missing geometry for: ${changedNoGeo.join(", ")} (guard kept CRDT geometry)`,
        );
      }
    }
  }

  /**
   * WP4: the intent plan for one save.
   *
   * With the shadow rebase ON (the default and the only production state) this
   * is `planIntentDiff` verbatim. With it OFF at the discrimination seam
   * (BUILD_SPEC §8) the save is no longer classified against the shadow at all:
   * every observed field becomes intent and nothing is discarded, which is the
   * pre-V2 observation-as-intent behaviour whose defect class V2 removes. The
   * delete rule, the resurrect block, the byte echo breaker and the capture-side
   * rounding are untouched by the seam — only the classification changes.
   */
  private planCapture(
    save: ParsedSave,
    surface: SurfaceState,
    tombstones: TombstoneView,
  ): IntentPlan {
    const plan = planIntentDiff(this.shadow, save, tombstones, surface);
    if (this.shadowRebaseEnabled) return plan;
    plan.upserts = [];
    plan.discarded = [];
    for (const kind of RECORD_KINDS) {
      for (const record of kind === "node" ? save.nodes : save.edges) {
        if (tombstones.isDeleted(kind, record.id)) continue;
        for (const field of Object.keys(record.fields)) {
          plan.upserts.push({
            path: save.path,
            kind,
            id: record.id,
            field,
            value: record.fields[field],
          });
        }
      }
    }
    return plan;
  }

  /**
   * WP4: apply an intent plan to the shared maps, inside the caller's single
   * transaction, and report what actually landed.
   *
   * ├── upsert — the record's `Y.Map` is created on the first upsert for an id
   * │            absent from the doc, otherwise the field is set only when the
   * │            current value differs. A field the save omitted is NEVER
   * │            deleted (I7): a save is a partial observation, not a removal.
   * ├── delete — WP19: `deleted[id] := {t, by, on:true}` through WP12's
   * │            `applyTombstoneOp`. The record's key and its `Y.Map` are NOT
   * │            touched, so the delete is reversible and mergeable; the GAP-5
   * │            edge cascade is now a consequence of the same suppression rule
   * │            inside `buildCanvasData` rather than a second action here.
   * └── WP21: there is no lock seam here any more. No branch consults a lock
   *     before writing, and no branch refuses an id on a lock's behalf.
   */
  /**
   * WP36 — THE capture write for `text` / `label`. Three-way, never two-way.
   *
   * The two operands the merge needs are already in hand at this point and no
   * new state store is required for either:
   *
   *   ├── `next`    — the string the local `.canvas` file holds, i.e. the
   *   │               intent `planIntentDiff` classified.
   *   └── `base`    — the Surface-Shadow's value for THIS field, which is
   *                   "what this client last confirmed is on the surface". It
   *                   is read here, INSIDE the transaction, because the shadow
   *                   is only advanced after `applyIntentPlan` returns — so it
   *                   still holds the pre-capture value, which is exactly the
   *                   three-way base.
   *
   * `applyMinimalYTextUpdate` is NOT called, here or on any other canvas
   * capture path: it diffs the `Y.Text`'s own content against the incoming
   * string, and on this path the incoming string is the local FILE, which lacks
   * a peer's freshly merged characters — so the helper computes them as a
   * deletion. `plugin/src/utils.ts` is byte-unchanged by this work package.
   */
  private writeCollabText(
    record: Y.Map<unknown>,
    path: string,
    kind: ShadowRecordKind,
    id: string,
    field: string,
    next: string,
  ): TextWriteReceipt {
    const existingValue = record.get(field);
    const shadowValue = getField(this.shadow, path, kind, id, field);
    const base = typeof shadowValue === "string" ? shadowValue : undefined;

    if (isYText(existingValue)) {
      const current = existingValue.toString();
      const plan = planTextMerge(base, next, current);
      applyTextOpsToYText(existingValue, plan.ops);
      return this.recordTextWrite({
        path,
        kind,
        id,
        field,
        targetBefore: "ytext",
        ytextAfter: true,
        migrated: false,
        ops: plan.ops.length,
        resolution: plan.resolution,
        fallback: plan.fallback,
        baseObserved: base !== undefined,
        baseLength: base?.length ?? -1,
        currentLength: current.length,
        nextLength: next.length,
        resultLength: existingValue.length,
      });
    }

    // ---- THE LAZY, WRITE-TRIGGERED CONVERSION -----------------------------
    //
    // ONE operation: a `Y.Text` is constructed with the record's previous
    // string, the merge's ops are applied to it WHILE IT IS STILL DETACHED
    // (Yjs queues them and replays them at integration, the same mechanism
    // `buildDetachedRecord` relies on for a whole record), and only the
    // finished value is `set`. So:
    //
    //   ├── the key is never deleted, and never absent for an instant;
    //   ├── no empty `Y.Text` is ever attached and filled afterwards; and
    //   └── no observer, on any peer, can see this record without its `text`.
    //
    // That is what keeps the conversion off the Ä4 shape, whose refusal
    // composes into a deletion. It is also per-record and per-field: there is
    // no bulk pass over the doc, and a record the local user did not edit is
    // never converted.
    const previous = typeof existingValue === "string" ? existingValue : undefined;
    const targetBefore: TextWriteReceipt["targetBefore"] =
      existingValue === undefined ? "absent" : previous !== undefined ? "string" : "other";
    if (targetBefore === "other") {
      // Something is under this key that is neither a string nor a `Y.Text`.
      // Converting it would be a guess about a shape this build does not
      // understand, and a guess in a CRDT is permanent — so the pre-WP36
      // register write is kept, unchanged.
      if (!docValueEquals(existingValue, next)) record.set(field, next);
      return this.recordTextWrite({
        path,
        kind,
        id,
        field,
        targetBefore,
        ytextAfter: false,
        migrated: false,
        ops: 0,
        resolution: "identical",
        fallback: false,
        baseObserved: base !== undefined,
        baseLength: base?.length ?? -1,
        currentLength: -1,
        nextLength: next.length,
        resultLength: next.length,
      });
    }
    const start = previous ?? "";
    const plan = planTextMerge(base, next, start);
    const converted = new Y.Text(start);
    applyTextOpsToYText(converted, plan.ops);
    record.set(field, converted);
    return this.recordTextWrite({
      path,
      kind,
      id,
      field,
      targetBefore,
      ytextAfter: true,
      migrated: true,
      ops: plan.ops.length,
      resolution: plan.resolution,
      fallback: plan.fallback,
      baseObserved: base !== undefined,
      baseLength: base?.length ?? -1,
      currentLength: start.length,
      nextLength: next.length,
      resultLength: plan.result.length,
    });
  }

  /** Stamp a receipt with its sequence number and keep it in the ring. */
  private recordTextWrite(receipt: Omit<TextWriteReceipt, "seq">): TextWriteReceipt {
    const stamped: TextWriteReceipt = { seq: ++this.textWriteSeq, ...receipt };
    this.textWriteReceipts.push(stamped);
    if (this.textWriteReceipts.length > TEXT_RECEIPT_RING) this.textWriteReceipts.shift();
    return stamped;
  }

  /**
   * WP36 AC1 — the doc-level witness, read-only, for the E2E control channel.
   *
   * Carries no user text: counts, lengths and shapes only.
   */
  getTextWriteReceipts(rawPath?: string): TextWriteReceipt[] {
    if (rawPath === undefined) return this.textWriteReceipts.slice();
    // Scoped by path, because the ring is per-CLIENT: a caller asking "what did
    // this board's captures do?" must not be handed another board's receipts,
    // which is how a per-field count silently becomes a session count.
    const path = toCanonicalPath(normalizePath(rawPath));
    return this.textWriteReceipts.filter((receipt) => receipt.path === path);
  }

  /**
   * WP36 AC1 — WHAT THE DOC ACTUALLY HOLDS under `text` / `label`, per record.
   *
   * The projected string is identical whether the field is a `Y.Text` or a
   * plain string, so `canvas.state` and `canvas.file` cannot discriminate. This
   * reads the `Y.Map` itself. Lengths only — never the text.
   */
  getTextShape(rawPath: string): {
    path: string;
    subscribed: boolean;
    fields: {
      kind: ShadowRecordKind;
      id: string;
      field: string;
      shape: "ytext" | "string" | "other";
      length: number;
    }[];
  } | null {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (!this.subscribedPaths.has(path)) return { path, subscribed: false, fields: [] };
    const docId = this.canvasDocIdFor(path);
    if (!docId) return null;
    const docHandle = this.syncManager.getDoc(docId);
    if (!docHandle) return null;
    const fields: {
      kind: ShadowRecordKind;
      id: string;
      field: string;
      shape: "ytext" | "string" | "other";
      length: number;
    }[] = [];
    const spaces: { kind: ShadowRecordKind; map: Y.Map<Y.Map<unknown>> }[] = [
      { kind: "node", map: docHandle.doc.getMap<Y.Map<unknown>>("nodes") },
      { kind: "edge", map: docHandle.doc.getMap<Y.Map<unknown>>("edges") },
    ];
    for (const space of spaces) {
      for (const [id, record] of space.map) {
        for (const field of [V2_FIELD.text, V2_FIELD.label]) {
          const value = record.get(field);
          if (value === undefined) continue;
          if (isYText(value)) {
            fields.push({ kind: space.kind, id, field, shape: "ytext", length: value.length });
          } else if (typeof value === "string") {
            fields.push({ kind: space.kind, id, field, shape: "string", length: value.length });
          } else {
            fields.push({ kind: space.kind, id, field, shape: "other", length: -1 });
          }
        }
      }
    }
    return { path, subscribed: true, fields };
  }

  private applyIntentPlan(
    plan: IntentPlan,
    maps: { node: Y.Map<Y.Map<unknown>>; edge: Y.Map<Y.Map<unknown>> },
    deletedMap: Y.Map<unknown>,
    author: string,
  ): AppliedIntent {
    const applied: AppliedIntent = {
      upserts: [],
      deletes: [],
      rejected: [],
      deletedNodeIds: [],
      created: [],
      changed: [],
      textWrites: [],
    };

    // One entry per record, in plan order, so a record absent from the doc is
    // created once and takes all of its upserts in this same transaction.
    const groups = new Map<string, FieldUpsertIntent[]>();
    for (const upsert of plan.upserts) {
      const key = `${upsert.kind}|${upsert.id}`;
      const group = groups.get(key);
      if (group) group.push(upsert);
      else groups.set(key, [upsert]);
    }

    for (const fields of groups.values()) {
      const { path, kind, id } = fields[0];
      // WP3 (US3 AC2) diff-inferred lock claim: the local user provably changed
      // this node, so claim the lock. WP21: the claim is UX only — nothing reads
      // it back here, and the write below is never gated on it.
      if (kind === "node") this.onLocalNodeChange?.(path, id);
      const existing = maps[kind].get(id);

      // WP18 AC1 — the CAPTURE boundary consults the validator before writing.
      // The subject is the record as it WILL be once this pass is applied
      // (I7: nothing is removed, so that is `doc ∪ proposal`), judged on its
      // content rather than on which vocabulary it is spelt in. A refusal is
      // signed and drops this record's writes only.
      const proposal: Record<string, unknown> = {};
      for (const upsert of fields) proposal[upsert.field] = upsert.value;
      const admission = admitRecordIngest(
        projectPostWriteRecord(existing, proposal, kind),
        kind,
        id,
        "local",
        INGEST_BOUNDARY.capture,
      );
      if (!admission.admitted) {
        applied.rejected.push(admission.signature as string);
        continue;
      }

      if (!existing) {
        // GAP-2 / US2 AC3 delete-wins, no-resurrect: an id the shadow still holds
        // as `present` while the doc no longer has it was deleted by a peer.
        // NEVER re-create it — for nodes AND edges — even if the local user also
        // edited it. `absent`/`unknown` means this is a genuinely new record.
        if (getRecordState(this.shadow, path, kind, id) === "present") continue;
        // WP18 AC2 — ONE transaction carrying a COMPLETE record: the container
        // is populated while still DETACHED and attached only afterwards, so no
        // observer and no peer ever sees a half-built record under this id.
        maps[kind].set(id, buildDetachedRecord(proposal, id, applied.rejected));
        for (const upsert of fields) applied.upserts.push(upsert);
        if (kind === "node") applied.created.push(id);
        continue;
      }
      // US2 AC2: merge PER FIELD into the existing Y.Map — never
      // `ymap.set(id, new Y.Map())`, which detaches the record and silently
      // discards a peer's concurrent edit to a DIFFERENT field of it.
      for (const upsert of fields) {
        if (upsert.field === V2_FIELD.type) {
          // WP11's write-once guard owns `type`. Its `noop` branch is what keeps
          // a re-stated same-value type off the wire; a refusal writes nothing
          // and does not advance the shadow for that field.
          const verdict = guardTypeWrite(existing as unknown as V2RecordMap, id, upsert.value as string);
          if (verdict.kind === "rejected") {
            applied.rejected.push(verdict.signature);
            continue;
          }
          applied.upserts.push(upsert);
          continue;
        }
        // WP36 (C36 AC1/AC2) — THE WRITE ROUTER, and it sits BEFORE the equality
        // question rather than inside it.
        //
        // `docValueEquals` is a VALUE-equality predicate shared with
        // `upsertRecordFields`; a `Y.Text` arm there would make real edits
        // silently skip. The correct shape is a ROUTING decision: a `text` /
        // `label` field whose intent is a string never reaches the register
        // `set` at all, so no capture path can overwrite a `Y.Text` with a
        // plain value.
        //
        // `collabTextEnabled` is the B32 control seam: with it OFF the field
        // falls through to the register write below, which is precisely the
        // pre-WP36 whole-string LWW behaviour the migrated oracles must go red
        // against. There is no production caller.
        if (this.collabTextEnabled && isCollabTextField(upsert.field) && typeof upsert.value === "string") {
          applied.textWrites.push(
            this.writeCollabText(existing, path, kind, id, upsert.field, upsert.value),
          );
          applied.upserts.push(upsert);
          continue;
        }
        if (!docValueEquals(existing.get(upsert.field), upsert.value)) {
          existing.set(upsert.field, upsert.value);
        }
        applied.upserts.push(upsert);
      }
      // Keep any register the record already carries in step with the flat keys
      // this boundary writes (see `syncRegistersFromFlat`).
      syncRegistersFromFlat(existing);
      if (kind === "node") applied.changed.push(id);
    }

    // WP19 AC1 — ONE Lamport stamp for the whole pass, read BEFORE the first
    // write. The pass is one logical event, its ops target distinct ids, and
    // taking the stamp up front keeps it a pure function of the state this
    // capture classified against rather than of the order the ids happen to
    // come out of the plan in.
    const stamp = plan.deletes.length > 0 ? nextTombstoneTime(deletedMap) : 0;
    for (const del of plan.deletes) {
      // WP21: neither branch consults a lock any more. A node delete used to be
      // refused while a peer held the node, and an edge delete while a peer held
      // either endpoint; both refusals are gone, so the only thing left to
      // distinguish the branches is the node-id bookkeeping.
      if (del.kind === "node") applied.deletedNodeIds.push(del.id);
      // WP19 AC1 — THE delete. Both kinds (node and edge) end here, and
      // neither touches `maps`: the record's `Y.Map` keeps its identity and
      // every field it holds, which is the whole of what makes the delete
      // reversible (AC4) and mergeable (AC2). `applyTombstoneOp` merges against
      // whatever is already stored, so this op can LOSE to a fresher peer op —
      // a delete has no privilege over an undo.
      applyTombstoneOp(deletedMap, del.id, { t: stamp, by: author, on: true });
      applied.deletes.push(del);
    }

    // WP19 AC3 — THE CASCADE, WHICH IS NO LONGER AN ACTION.
    //
    // `pruneEdgesForDeletedNodes` used to run here and call
    // `edgesMap.delete(edgeId)` for every edge touching a just-deleted node.
    // That is exactly the key removal AC3 forbids: it destroyed the edge's field
    // container, so undoing the node delete could never bring its arrows back
    // with their labels, colours and routing.
    //
    // Nothing replaces it, because nothing has to. `buildCanvasData` — the ONE
    // doc→file/view projection, shared by `serializeCanvas`, `getCanvasSnapshot`
    // and the live-view hook — builds its `visibleNodeIds` set from the very
    // same tombstone predicate and already refuses to emit an edge whose
    // endpoint node is not in it. The cascade is therefore a consequence of the
    // suppression rule rather than a second mechanism that could disagree with
    // it, and it now applies to a REMOTE delete too, which the old prune (local
    // capture only) never covered.

    return applied;
  }

  /**
   * WP4 AC3 / the host seed: record that `content` provably reached the surface.
   *
   * `markMissingAbsent` is the closed-view case: with no open Obsidian canvas the
   * FILE is the surface, so a record the writer left out is known-absent rather
   * than merely unobserved, and may become a delete intent later.
   */
  private advanceShadowFromContent(
    path: string,
    content: string,
    markMissingAbsent: boolean,
  ): void {
    // WP16: the temporary P1 decode bridge — the shadow is keyed by flat field
    // names until WP18 wires the registers.
    const data = decodeCanvasDataToFlat(parseCanvas(content));
    for (const kind of RECORD_KINDS) {
      const records = kind === "node" ? data.nodes : data.edges;
      for (const [id, record] of Object.entries(records)) {
        advanceRecord(this.shadow, path, kind, id, record as Record<string, ShadowFieldValue>);
      }
      if (!markMissingAbsent) continue;
      const pathState = this.shadow.paths.get(path);
      if (!pathState) continue;
      const missing: string[] = [];
      for (const [id, shadowRecord] of pathState[kind]) {
        if (shadowRecord.state !== "present") continue;
        if (Object.prototype.hasOwnProperty.call(records, id)) continue;
        missing.push(id);
      }
      for (const id of missing) {
        markRecordAbsent(this.shadow, path, kind, id);
      }
    }
  }

  // WP21: the lock-seam gate lived here. It is REMOVED, not rewritten. It asked
  // whether a per-node lock permitted one diff entry — a node on its own id, an
  // edge on BOTH of its endpoints — and its `false` dropped the local write and
  // held the echo baseline. Locks are now pure UX: they still colour rings and
  // still revert the loser's VIEW, but they carry no write authority, because
  // the data model resolves same-register conflicts by itself. There is no
  // replacement, because a capture path with no write-authorisation branch is
  // the point.

  // WP19 AC3: `pruneEdgesForDeletedNodes` lived here. It is REMOVED, not
  // rewritten — see the note at its old call site in `applyIntentPlan`. The
  // GAP-5 property it owned (no dangling edge ever reaches the view or the file)
  // is now `buildCanvasData`'s `visibleNodeIds` guard, which answers the same
  // question from the same tombstone predicate for a remote delete as well as a
  // local one. The endpoint reader it used (`readEndpointNodeId`) stays: the
  // corruption telemetry in `auditCanvasState` is its other caller.

  isRecentDiskWrite(rawPath: string): boolean {
    return this.recentDiskWrites.has(toCanonicalPath(normalizePath(rawPath)));
  }

  isSubscribed(rawPath: string): boolean {
    return this.subscribedPaths.has(toCanonicalPath(normalizePath(rawPath)));
  }

  destroy(): void {
    for (const timer of this.writeTimers.values()) {
      clearTimeout(timer);
    }
    this.writeTimers.clear();
    for (const timer of this.externalWriteSettleTimers.values()) {
      clearTimeout(timer);
    }
    this.externalWriteSettleTimers.clear();
    this.writeFirstScheduled.clear();
    this.remoteSeq.clear();
    for (const [, unobserve] of this.observers) {
      unobserve();
    }
    this.observers.clear();
    for (const [, detachSeq] of this.seqHandlers) {
      detachSeq();
    }
    this.seqHandlers.clear();
    for (const path of [...this.subscribedPaths]) {
      const docId = this.canvasDocIdFor(path);
      if (docId) this.syncManager.releaseDoc(docId);
      // WP25: same rule as `unsubscribe` — a released doc that still carries an
      // update handler keeps writing frames nobody will read. The LIFECYCLE
      // itself is not destroyed here: it is injected, not owned, and one
      // lifecycle serves every `CanvasSync` the plugin builds.
      const guid = this.guidByPath.get(path);
      if (this.sidecar !== null && guid !== undefined) void this.sidecar.detach(guid);
    }
    // WP38 (C38 AC1) — every manager goes with the docs it was bound to.
    this.undoRegistry.destroy();
    this.subscribedPaths.clear();
    this.guidByPath.clear();
    this.observedPathRefs.clear();
    this.recentDiskWrites.clear();
    this.recentLocalEdits.clear();
    this.lastWrittenContent.clear();
    // WP63: same rule as `unsubscribe` — release the references, never reset the
    // ledgers themselves.
    this.seedRefusalLedgers.clear();
    this.seedKnowledgeByPath.clear();
  }

  /**
   * WP18 — the HOST SEED write boundary.
   *
   * Consumes the FLAT file shape (the host seed's doc vocabulary is unchanged;
   * `coldOpen` is the boundary that moves to the registers) and applies it as
   * VALIDATED, CREATE-ONCE, UPSERT-ONLY writes:
   *
   *   ├── AC1 — each record is checked through {@link admitRecordIngest} before
   *   │         anything is written for it, and a refusal is signed.
   *   ├── AC2 — a new record is built detached and attached complete; an
   *   │         existing one is merged in place, never replaced.
   *   └── AC3 — no key is deleted because the file omitted it (I7).
   *
   * WP29 (AC2) extended that from KEYS to RECORDS: the record-level
   * delete-by-omission this method used to drive through {@link seedFlatSpace}
   * is gone. The host's local file is no longer the host's picture of the WHOLE
   * board — it is a set of proposals about the records it names, and a rejoin is
   * an ordinary related-replica merge. `ledger.reset()` stays: this is still a
   * re-seed of the path, and this seed's refusals are the only ones that count.
   */
  private applyCanvasToYMaps(
    path: string,
    nodesMap: Y.Map<Y.Map<unknown>>,
    edgesMap: Y.Map<Y.Map<unknown>>,
    data: FlatCanvasData,
  ): void {
    // WP63: this IS a re-seed of the path, so the previous session's verdicts
    // are stale — the ledger starts from what THIS seed decides.
    const ledger = this.seedRefusalLedger(path);
    ledger.reset();
    ledger.note([
      ...this.seedFlatSpace(nodesMap, data.nodes, "node"),
      ...this.seedFlatSpace(edgesMap, data.edges, "edge"),
    ]);
  }

  /**
   * WP63 (I11): the per-path refused set the host seed fills and
   * `CanvasPersistence` reads before it writes.
   *
   * It lives here rather than in the writer because the host seed runs during
   * `subscribe`, i.e. BEFORE the writer for that path exists — the two objects
   * therefore have to share the ledger, and the one that runs first has to own
   * it. Created on demand so the wiring layer can hand it to the writer without
   * caring whether a host seed ever ran.
   */
  /**
   * WP29 (AC1) — what THIS client learned about the doc behind `rawPath` during
   * `subscribe`, for the wiring layer to hand to that path's `CanvasPersistence`.
   *
   * Path-keyed (one `CanvasSync` serves every canvas in the vault), stable
   * across repeat calls, and {@link NOTHING_KNOWS_DOC} for a path that was never
   * subscribed — which is the honest answer, and also the one that keeps a
   * genuinely new board seedable.
   */
  seedKnowledgeFor(rawPath: string): SeedKnowledge {
    const path = toCanonicalPath(normalizePath(rawPath));
    return this.seedKnowledgeByPath.get(path) ?? NOTHING_KNOWS_DOC;
  }

  seedRefusalLedger(rawPath: string): SeedRefusalLedger {
    const path = toCanonicalPath(normalizePath(rawPath));
    let ledger = this.seedRefusalLedgers.get(path);
    if (!ledger) {
      ledger = new SeedRefusalLedger();
      this.seedRefusalLedgers.set(path, ledger);
    }
    return ledger;
  }

  private seedFlatSpace(
    container: Y.Map<Y.Map<unknown>>,
    records: Record<string, Record<string, unknown>>,
    kind: IngestRecordKind,
  ): SeedRefusal[] {
    const signatures: string[] = [];
    const refusals: SeedRefusal[] = [];
    for (const [id, source] of Object.entries(records)) {
      const admission = admitRecordIngest(
        projectPostWriteRecord(container.get(id), source, kind),
        kind,
        id,
        "local",
        INGEST_BOUNDARY.hostSeed,
      );
      if (!admission.admitted) {
        signatures.push(admission.signature as string);
        refusals.push({
          boundary: INGEST_BOUNDARY.hostSeed,
          kind,
          id,
          reason: admission.reason as IngestReasonCode,
        });
        continue;
      }
      writeRecordCreateOnce(container, id, source, signatures);
    }
    // WP29 (AC2) — R4 IS GONE FROM HERE. This is where the record-level
    // delete-by-omission used to be: a `Set` of every id already in the
    // container, emptied of everything the file mentioned, and then deleted.
    // The host's file was allowed to speak for records it had never heard of,
    // so a rejoin with a stale `.canvas` silently removed every card the peers
    // had drawn while this client was away — and shipped that removal to them.
    //
    // NOTHING REPLACES IT, deliberately. A tombstone would be the same removal
    // in WP19's vocabulary; a seed has no opinion about deletion. What is left
    // is what `seedRecordsIntoYMaps` (the cold-open seed writer) has always
    // done: validated, create-once, upsert-only writes of the ids the source
    // actually names. Destruction is only ever an explicit user action (WP30).
    for (const signature of signatures) {
      this.logger?.warn("canvas-sync", signature);
    }
    return refusals;
  }

  // WP7: formerly `scheduleDiskWrite`. The disk write it drove is retired (that
  // is now `CanvasPersistence`'s sole job); the debounce is kept purely so the
  // SCATTER / DETACH / NO TYPE telemetry still fires once per settled burst of
  // remote deltas instead of once per delta.
  private scheduleCanvasAudit(
    path: string,
    nodesMap: Y.Map<Y.Map<unknown>>,
    edgesMap: Y.Map<Y.Map<unknown>>,
    deletedMap: Y.Map<unknown>,
  ): void {
    const now = Date.now();
    let firstScheduled = this.writeFirstScheduled.get(path);
    if (firstScheduled === undefined) {
      firstScheduled = now;
      this.writeFirstScheduled.set(path, now);
    }
    const existing = this.writeTimers.get(path);
    if (existing) clearTimeout(existing);
    // Trailing debounce (DEBOUNCE_MS) capped by a max wait since the first
    // pending update (MAX_WAIT_MS), so a continuous stream of remote updates
    // is still audited at least ~every MAX_WAIT_MS instead of resetting forever.
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, firstScheduled + MAX_WAIT_MS - now));
    this.writeTimers.set(
      path,
      setTimeout(() => {
        this.writeTimers.delete(path);
        this.writeFirstScheduled.delete(path);
        this.auditCanvasState(path, nodesMap, edgesMap, deletedMap);
      }, delay),
    );
  }

  /**
   * WP7 (BUILD_SPEC § 6.2, US5 AC15/AC7): told by the wiring layer that
   * `CanvasPersistence` — the single writer — just put `content` on disk.
   *
   * Two jobs, both of which used to be side effects of `writeToDisk`:
   *  ├── advance the three-way-diff baseline, so `handleLocalModify` still
   *  │   diffs the local file against what this client knows the file to be.
   *  │   Without this the baseline goes stale the moment another component
   *  │   writes the file, and the next local modify replays the whole file as
   *  │   "user changes" (the Part V failure mode).
   *  └── mark the path as a recent disk write for the settle window, so
   *      `vault-events.ts:121`'s existing `canvasSync.isRecentDiskWrite(path)`
   *      check still suppresses OUR write's echo — with no change at the
   *      vault-events end.
   */
  noteExternalDiskWrite(rawPath: string, content: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    this.lastWrittenContent.set(path, content);
    // WP4 AC3 — the CLOSED-VIEW receipt. With no open Obsidian canvas the FILE
    // is the surface this path's next save comes from, so what the single writer
    // just put there provably reached it: every written record advances the
    // shadow field by field, and every record the shadow still holds as present
    // but the content omits becomes known-ABSENT. With the view OPEN the shadow
    // is not touched at all — an open canvas ignores external file writes, so
    // only a confirmed apply is a receipt there, and that is WP5's mechanism.
    if (this.surfaceStateProvider(path).viewOpen === false) {
      this.advanceShadowFromContent(path, content, true);
    }
    this.recentDiskWrites.add(path);
    const existing = this.externalWriteSettleTimers.get(path);
    if (existing) clearTimeout(existing);
    this.externalWriteSettleTimers.set(
      path,
      setTimeout(() => {
        this.externalWriteSettleTimers.delete(path);
        this.recentDiskWrites.delete(path);
      }, VAULT_EVENT_SETTLE_MS),
    );
  }

  /**
   * WP20 — ONE settled audit pass of self-repair (AC1–AC4).
   *
   * Plan first, write second, and write only transitions. The plan is computed
   * against a single consistent read of the doc, so the two id spaces cannot see
   * each other half-repaired, and an EMPTY plan returns before touching anything
   * — which is what makes a second pass over an unchanged doc emit exactly zero
   * deltas rather than a stream of semantically-identical rewrites (AC3).
   *
   * ONE Lamport stamp for the whole pass, read BEFORE the first write, exactly as
   * `applyIntentPlan` takes it: the pass is one logical event and its ops target
   * distinct ids, so the stamp must not depend on the order the ids happened to
   * come out of the containers in. Because `nextTombstoneTime` is strictly above
   * every stamp this replica can see, an op issued here always dominates the
   * state it was planned against — it can still LOSE to a peer's genuinely
   * fresher op, which is the point of routing through `applyTombstoneOp` rather
   * than writing the entry directly.
   *
   * Concurrency (AC3, second half): three replicas seeing the same broken doc
   * plan the same verdict and issue the same-`t` op with their own `by`. Yjs
   * resolves the same-key writes to ONE of them — which one is a `random.uint32()`
   * coin flip and is deliberately not relied on — and every replica ends up
   * holding that same entry, whose VERDICT is identical in all three candidates.
   * The next pass then reads it as the fixed point it is and plans nothing, so no
   * replica reads another's quarantine as work to do.
   */
  private repairCanvasState(
    nodesMap: Y.Map<Y.Map<unknown>>,
    edgesMap: Y.Map<Y.Map<unknown>>,
    deletedMap: Y.Map<unknown>,
  ): void {
    const actions: QuarantineAction[] = [];
    planQuarantineActions(nodesMap, "node", deletedMap, actions);
    planQuarantineActions(edgesMap, "edge", deletedMap, actions);
    if (actions.length === 0) return;

    const stamp = nextTombstoneTime(deletedMap);
    const author = String(deletedMap.doc?.clientID ?? 0);
    for (const action of actions) {
      if (action.op === "quarantine") {
        // AC1: the record's own container is not passed in, not reachable and
        // never touched — the quarantine is entirely a write to `deleted`.
        applyTombstoneOp(deletedMap, action.id, { t: stamp, by: author, on: true, q: true });
        const line = quarantineSignature(action.kind, action.id, action.reason);
        this.logger?.warn("canvas-sync", line);
      } else {
        // AC2: an ordinary `on:false` op — the same shape as an undo, so a stale
        // release cannot lift a fresher quarantine and there is no second
        // arbitration rule for it to exploit. `q` is simply not carried forward,
        // which is what makes `isTombstoneQuarantined` read the result as
        // released.
        applyTombstoneOp(deletedMap, action.id, { t: stamp, by: author, on: false });
        this.logger?.warn("canvas-sync", quarantineReleaseSignature(action.kind, action.id));
      }
    }
  }

  // Scatter/detach/no-type telemetry: inspect the CRDT snapshot about to be
  // serialized and surface the three corruption signatures to the status console —
  // (1) a live node missing geometry (→ card scatter), (2) an edge whose endpoint
  // node is absent (→ arrow detach; pruned from disk this write, self-heals when
  // the node returns) and (3) WP5/US3 AC12: a live node that lost its `type`, or a
  // `type: "file"` node that lost its `file`. Obsidian's importData drops a node
  // with an unknown type — and every edge attached to it — so this third class is
  // the most destructive and was previously invisible: the x/y and dangling-endpoint
  // checks cannot see it. Detection only (US3 out of scope: repairing the node).
  private auditCanvasState(
    path: string,
    nodesMap: Y.Map<Y.Map<unknown>>,
    edgesMap: Y.Map<Y.Map<unknown>>,
    deletedMap: Y.Map<unknown>,
  ): void {
    // WP20: the REPAIR runs first and runs unconditionally. It is deliberately
    // NOT behind the logger guard below — self-healing is a property of the doc,
    // and a client that happens to have no console attached must still converge
    // to the same state as one that has (AC3).
    this.repairCanvasState(nodesMap, edgesMap, deletedMap);
    if (!this.logger) return;
    const nodeIds = new Set<string>(nodesMap.keys());
    const noGeo: string[] = [];
    const noType: string[] = [];
    const fileNodesWithoutFile: string[] = [];
    for (const [id, node] of nodesMap) {
      // WP18: geometry may live in WP9's atomic register OR in the flat file
      // keys — a half-migrated doc holds both shapes, and a telemetry line that
      // only knew one of them would cry SCATTER over a perfectly placed card.
      const hasRegisterGeometry = readPosRegister(node as unknown as V2RecordMap) !== undefined;
      const hasFlatGeometry =
        typeof node.get("x") === "number" && typeof node.get("y") === "number";
      if (!hasRegisterGeometry && !hasFlatGeometry) noGeo.push(id);
      const type = node.get("type");
      if (typeof type !== "string" || type.length === 0) {
        noType.push(id);
      } else if (type === "file" && typeof node.get("file") !== "string") {
        fileNodesWithoutFile.push(id);
      }
    }
    const danglingEdges: string[] = [];
    for (const [id, edge] of edgesMap) {
      const from = readEndpointNodeId(edge, FROM_KEY);
      const to = readEndpointNodeId(edge, TO_KEY);
      if (
        (from !== undefined && !nodeIds.has(from)) ||
        (to !== undefined && !nodeIds.has(to))
      ) {
        danglingEdges.push(id);
      }
    }
    this.logger.debug(
      "canvas-sync",
      `disk write ${path}: nodes=${nodeIds.size} edges=${edgesMap.size}`,
    );
    if (noGeo.length) {
      this.logger.warn(
        "canvas-sync",
        `SCATTER signature: ${noGeo.length} node(s) missing geometry: ${noGeo.join(", ")}`,
      );
    }
    if (danglingEdges.length) {
      this.logger.warn(
        "canvas-sync",
        `DETACH signature: ${danglingEdges.length} edge(s) pruned (endpoint absent): ${danglingEdges.join(", ")}`,
      );
    }
    // WP5 (US3 AC12/AC13, US6): one greppable line per audit, listing only the
    // broken ids — never node text or any other user data.
    const noTypeParts: string[] = [];
    if (noType.length) {
      noTypeParts.push(`${noType.length} node(s) missing type: ${noType.join(", ")}`);
    }
    if (fileNodesWithoutFile.length) {
      noTypeParts.push(
        `${fileNodesWithoutFile.length} file node(s) missing file: ${fileNodesWithoutFile.join(", ")}`,
      );
    }
    if (noTypeParts.length) {
      this.logger.warn("canvas-sync", `NO TYPE signature: ${noTypeParts.join("; ")}`);
    }
  }

  // WP7 (US5 AC13, BUILD_SPEC § 9 WP7 AC9): RETAINED as the seed-path helper,
  // but it has NO CRDT-observer-driven caller any more — the doc observer no
  // longer schedules a disk write at all, so this class is not a `.canvas`
  // writer during a session. The `expectedSeq` gate below is likewise retained
  // rather than ported into `CanvasPersistence`: the new writer serializes the
  // doc synchronously immediately before its (queued) write, so the early
  // snapshot this gate compensates for cannot exist there.
  private async writeToDisk(path: string, content: string, expectedSeq?: number): Promise<void> {
    // Final defense-in-depth gate: every disk write funnels through here.
    if (!isPathSafe(path)) return;
    if (this.lastWrittenContent.get(path) === content) return;
    // WP4 (US5 AC1): version/sequence gate. If a remote delta was integrated
    // after this flush snapshotted its content (sequence ADVANCED past the
    // snapshot), the snapshot is stale — writing it would overwrite the in-flight
    // remote change on disk. Yield; the observer that integrated the remote delta
    // scheduled its own flush of the newer content. Strict ">" (not "!=") so a
    // reset (destroy clearing the map -> 0) is never read as staleness. Seed
    // writes pass no expectedSeq and are intentionally ungated.
    if (expectedSeq !== undefined && this.currentSeq(path) > expectedSeq) return;
    const diskPath = toLocalPath(path);
    this.recentDiskWrites.add(path);
    this.fileOpsManager.mutePathEvents(diskPath);
    try {
      const parentDir = diskPath.substring(0, diskPath.lastIndexOf("/"));
      if (parentDir) await ensureFolder(this.vault, parentDir);
      // Re-check after the awaited folder ensure: a remote delta may have landed
      // during the await. Yield rather than clobber it.
      if (expectedSeq !== undefined && this.currentSeq(path) > expectedSeq) return;
      await this.vault.adapter.write(diskPath, content);
      this.lastWrittenContent.set(path, content);
    } catch {
      new Notice(`Live Share: failed to write canvas ${diskPath}`);
    } finally {
      setTimeout(() => {
        this.recentDiskWrites.delete(path);
        this.fileOpsManager.unmutePathEvents(diskPath);
      }, VAULT_EVENT_SETTLE_MS);
    }
  }
}
