// WP8 / P1 — the `meta` CONTAINER, the SCHEMA VERSION GATE, and the in-place
// V1→V2 DOC MIGRATION.
//
// Why it exists (BUILD_SPEC §5 C8, CONCEPT_V2 Teil 12): V2 changes the shape of
// the *doc* — `x`/`y` become one atomic `pos` register, `width`/`height` become
// `size`, the six flat endpoint keys become `from`/`to`, and every record gains
// an `ord`. The `.canvas` FILE format is unchanged. A doc therefore has to say
// which shape it is in, and an existing V1 doc has to be brought over exactly
// once, losing nothing:
//
//   ├── `meta`          → one top-level `Y.Map`, created once per doc and NEVER
//   │                     replaced. It carries `schemaVersion` today and gains
//   │                     `guid` / `epoch` / `path` in P2 (declared here, not
//   │                     filled — that is out of WP8's scope).
//   ├── migration       → one transaction, translate-and-carry-through.
//   └── the version gate→ a doc whose MAJOR differs from ours is not something
//                         we may guess a translation for. P1 degrades LOCALLY:
//                         capture off for that path, persistence untouched.
//
// ─────────────────────────────────────────────────────────────────────────
// THREE PROPERTIES THAT ARE EASY TO GET SUBTLY WRONG
// ─────────────────────────────────────────────────────────────────────────
// 1. IDENTITY, not existence (AC1). `meta` is reached through
//    `doc.getMap(META_MAP_NAME)`, which returns the SAME instance forever.
//    `parent.set(id, new Y.Map())` over an existing container is a forbidden
//    operation (BUILD_SPEC §4.2): a peer writing into the old container would
//    simply stop merging, and a P2 `guid` would vanish with it.
// 2. ZERO DELTA, not "same values" (AC3). Yjs produces a real update for a
//    same-value LWW `set`, and that update echoes to every peer. Idempotence is
//    therefore enforced by a guard BEFORE the transaction is opened, not by
//    writing identical values a second time.
// 3. TRANSLATE-AND-CARRY-THROUGH, not rebuild-from-an-allowlist (AC2). The
//    migration ADDS the register a V1 key set translates into and touches
//    NOTHING else. A record is never reconstructed from a list of known keys,
//    because that silently drops an unknown or forward-compat key — precisely
//    the data-loss class "no record loses a value in the process" forbids.
//
//    It is also purely ADDITIVE: not one key is deleted, including the flat V1
//    keys that were just translated. Two independent reasons, either of which
//    alone is sufficient:
//      ├── a deletion is not undone by a state vector. `encodeStateAsUpdate`
//      │   always carries the doc's WHOLE delete set, so a single `delete()` in
//      │   the migration makes every later update non-empty for every peer —
//      │   the doc could never again be shown to produce "no delta" (AC3).
//      └── in P1 the capture path still reads and writes the flat V1 keys
//          (`canvas-sync.ts`), and `.canvas` on disk is unchanged either way.
//          Removing the flat keys is the WRITE BOUNDARY's job when it moves to
//          the registers (WP18+, the `writeRecordMinimal` key-deletion seam) —
//          not a migration's, which must be survivable by a client that has not
//          yet made that move.
//
// ─────────────────────────────────────────────────────────────────────────
// OWNERSHIP (Shared Ownership Contract §1)
// ─────────────────────────────────────────────────────────────────────────
// This module owns the `meta` container name, the `schemaVersion` key,
// `SUPPORTED_SCHEMA_MAJOR`, the version-gate predicate and the V1→V2 migration
// — and nothing else. Everything it writes into a record is written through a
// symbol IMPORTED from its owner:
//
//   ├── WP9  `canvas-registers.ts` → the V2 field key names (`V2_FIELD`), the
//   │                                `pos` / `size` registers and their codec
//   ├── WP10 `canvas-registers.ts` → the `from` / `to` endpoint registers,
//   │                                `ENDPOINT_FILE_KEYS` (the six flat file key
//   │                                names) and `encodeEndpointFromFile`
//   └── WP13 `canvas-ord.ts`       → `allocateOrd` and `compareOrd`. `ord`s are
//                                    NEVER compared with `<` on raw strings or
//                                    with `localeCompare`; a migration that
//                                    invented its own order would make every
//                                    suite pass while replicas silently
//                                    disagreed on file byte order.
//
// FORWARD COMPATIBILITY (Shared Ownership Contract §3): P4 moves node `text` and
// edge `label` to a nested `Y.Text` WITHIN schema major 2. This migration
// therefore never inspects, normalises or asserts a type on `text` / `label` —
// they are carried through untouched, so both the plain-string and the `Y.Text`
// shape survive it unchanged, and the major is not bumped.

import * as Y from "yjs";

import { allocateOrd, compareOrd } from "./canvas-ord";
import {
  ENDPOINT_FILE_KEYS,
  ENDPOINT_SLOTS,
  type EndpointSlot,
  type FilePos,
  type FileSize,
  V2_FIELD,
  encodeEndpointFromFile,
  encodePos,
  encodeSize,
  writeEndpointRegister,
  writePosRegister,
  writeSizeRegister,
} from "./canvas-registers";

// ---------------------------------------------------------------------------
// PART A — the names and the supported major (this module's owned surface)
// ---------------------------------------------------------------------------

/** The top-level `Y.Map` holding doc-level metadata. Created once, never replaced. */
export const META_MAP_NAME = "meta";

/** The `meta` key carrying the doc's schema version. */
export const SCHEMA_VERSION_KEY = "schemaVersion";

/**
 * The schema major this client speaks.
 *
 * A MAJOR bump means "the doc says something this build cannot translate". It is
 * deliberately NOT bumped for additive, read-tolerant changes: P4's move of node
 * `text` / edge `label` to a nested `Y.Text` stays within major 2 (Shared
 * Ownership Contract §3), because a reader that tolerates both shapes has lost
 * nothing.
 */
export const SUPPORTED_SCHEMA_MAJOR = 2;

/**
 * The record containers this migration walks.
 *
 * Module-private on purpose: no P1 core owns these two container names (they are
 * inline literals in `canvas-sync.ts` and `canvas-persistence.ts`), and WP8 does
 * not claim ownership of them by exporting a competing definition. Importing
 * them from `canvas-sync.ts` is not an option either — that module imports THIS
 * one for the version gate, and the cycle would be real.
 */
const RECORD_MAP_NAMES = ["nodes", "edges"] as const;

/**
 * The four flat `.canvas` FILE geometry key names.
 *
 * Typed as `keyof FilePos` / `keyof FileSize` so they are checked against WP9's
 * file-shape types at compile time rather than being four loose string literals.
 * `canvas-sync.ts` exports `GEOMETRY_KEYS` for the same four names, but as an
 * unordered `Set` used as a delete guard — it cannot say which member is the
 * x-coordinate, and importing it here would create the cycle described above.
 */
const FILE_X: keyof FilePos = "x";
const FILE_Y: keyof FilePos = "y";
const FILE_WIDTH: keyof FileSize = "width";
const FILE_HEIGHT: keyof FileSize = "height";

// ---------------------------------------------------------------------------
// PART B — reading `meta` without creating it
// ---------------------------------------------------------------------------

/**
 * The `meta` container, but ONLY if the doc genuinely has one.
 *
 * `doc.getMap(name)` is a *definition*, not a read: calling it on a doc that has
 * no `meta` registers an empty container as a side effect. A predicate that did
 * that would make "does this doc have meta?" answer differently depending on who
 * asked first — and a migration guarded on it would then skip a doc that had
 * merely been *inspected*. So the registration is probed first, and emptiness is
 * treated as absence: a container with no entries carries no information and is
 * indistinguishable from one this process itself just conjured.
 */
function readMeta(doc: Y.Doc): Y.Map<unknown> | undefined {
  if (!doc.share.has(META_MAP_NAME)) return undefined;
  const meta = doc.getMap<unknown>(META_MAP_NAME);
  return meta.size > 0 ? meta : undefined;
}

/** How a stored `schemaVersion` reads. */
type SchemaMajor =
  /** No `schemaVersion` entry at all — the doc has not been stamped yet. */
  | { readonly kind: "absent" }
  /** A value we cannot read as a version — we do not know what this doc is. */
  | { readonly kind: "unreadable" }
  | { readonly kind: "major"; readonly major: number };

/**
 * Read the MAJOR out of a stored `schemaVersion`.
 *
 * A number is truncated (`2.4` is major 2 — a minor bump must never gate a
 * client out), and a `"2.4"`-style string is accepted because a hand-edited doc
 * or a future writer may well store it that way. Anything else is `unreadable`
 * rather than optimistically coerced to something plausible.
 */
function readSchemaMajor(value: unknown): SchemaMajor {
  if (value === undefined || value === null) return { kind: "absent" };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { kind: "unreadable" };
    return { kind: "major", major: Math.trunc(value) };
  }
  if (typeof value === "string") {
    const match = /^\s*(\d+)/.exec(value);
    return match ? { kind: "major", major: Number.parseInt(match[1], 10) } : { kind: "unreadable" };
  }
  return { kind: "unreadable" };
}

// ---------------------------------------------------------------------------
// PART C — the version gate
// ---------------------------------------------------------------------------

/**
 * Does this doc speak a schema major this client cannot translate?
 *
 * True ONLY when `meta` exists and says so. The two "no" cases are different
 * conditions and must not be conflated:
 *
 *   ├── no `meta` at all        → an unmigrated V1 doc. That is
 *   │                             {@link migrateV1ToV2}'s job, not a mismatch.
 *   └── `meta` without a version→ likewise unstamped; nothing claims a major, so
 *                                 nothing conflicts with ours.
 *
 * An `unreadable` version IS a mismatch. "I cannot tell what this doc is" and "I
 * know I cannot read this doc" have the same correct response — stop writing —
 * and the alternative is to guess a translation into shared state, which AC4
 * forbids outright.
 *
 * Pure and side-effect-free: it never creates `meta`, so asking the question
 * cannot change the answer to the next one.
 */
export function isSchemaMajorMismatch(doc: Y.Doc): boolean {
  const meta = readMeta(doc);
  if (meta === undefined) return false;
  const version = readSchemaMajor(meta.get(SCHEMA_VERSION_KEY));
  if (version.kind === "absent") return false;
  if (version.kind === "unreadable") return true;
  return version.major !== SUPPORTED_SCHEMA_MAJOR;
}

// ---------------------------------------------------------------------------
// PART D — the migration
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * `x` / `y` → the atomic `pos` register, `width` / `height` → `size`.
 *
 * A half-present or non-numeric geometry is left exactly as it is rather than
 * being dropped or "repaired" into a plausible number. An already-present
 * register is never overwritten: a doc that somehow holds both shapes keeps
 * both rather than having one silently chosen for it.
 */
function migrateGeometry(record: Y.Map<unknown>): void {
  if (record.get(V2_FIELD.pos) === undefined) {
    const x = record.get(FILE_X);
    const y = record.get(FILE_Y);
    if (isFiniteNumber(x) && isFiniteNumber(y)) {
      writePosRegister(record, encodePos(x, y));
    }
  }

  if (record.get(V2_FIELD.size) === undefined) {
    const width = record.get(FILE_WIDTH);
    const height = record.get(FILE_HEIGHT);
    if (isFiniteNumber(width) && isFiniteNumber(height)) {
      writeSizeRegister(record, encodeSize(width, height));
    }
  }
}

/**
 * `fromNode` / `fromSide` / `fromEnd` (and the `to*` counterparts) → the atomic
 * `from` / `to` endpoint registers.
 *
 * The composite value is built by WP10's `encodeEndpointFromFile`, which returns
 * `undefined` for anything that is not a WHOLE endpoint — so a half-populated V1
 * edge gets no register at all instead of one that claims more than the file
 * said.
 */
function migrateEndpoint(record: Y.Map<unknown>, slot: EndpointSlot): void {
  if (record.get(slot) !== undefined) return;
  const fileKeys = ENDPOINT_FILE_KEYS[slot];
  const source: Record<string, unknown> = {
    [fileKeys.node]: record.get(fileKeys.node),
    [fileKeys.side]: record.get(fileKeys.side),
    [fileKeys.end]: record.get(fileKeys.end),
  };

  const endpoint = encodeEndpointFromFile(slot, source);
  if (endpoint === undefined) return;

  writeEndpointRegister(record, slot, endpoint);
}

/**
 * Translate ONE record in place.
 *
 * Note what is absent: there is no list of keys to keep, no reconstruction of
 * the record, and no deletion. The container is the same `Y.Map` it always was,
 * and every key this function does not explicitly translate — `id`, `type`,
 * `text`, `label`, `file`, `color`, and every unknown or forward-compat key a
 * newer peer may have written — is never read and never written, so it cannot
 * be lost (AC2).
 */
function migrateRecordFields(record: Y.Map<unknown>): void {
  migrateGeometry(record);
  for (const slot of ENDPOINT_SLOTS) migrateEndpoint(record, slot);
}

/**
 * Give every record in one container an `ord`, appending in iteration order.
 *
 * `Y.Map` iteration order is unspecified, which is exactly why V1's order was
 * unstable and why `ord` exists at all — so the sequence a migration observes is
 * not authoritative, it merely has to be SOME total order that every record
 * lands in. Records that already carry an `ord` keep it (an `ord` is immutable,
 * WP13 AC4) and are folded into the running upper bound through WP13's
 * `compareOrd`, never through a raw string comparison.
 */
function assignOrds(records: Y.Map<Y.Map<unknown>>, clientID: string): void {
  let highest: string | undefined;

  const fold = (ord: string): void => {
    if (highest === undefined || compareOrd(ord, highest) > 0) highest = ord;
  };

  for (const record of records.values()) {
    if (!(record instanceof Y.Map)) continue;
    const existing = record.get(V2_FIELD.ord);
    if (typeof existing === "string" && existing.length > 0) {
      fold(existing);
      continue;
    }
    const allocated = allocateOrd(highest, undefined, clientID);
    record.set(V2_FIELD.ord, allocated);
    fold(allocated);
  }
}

function migrateRecordMap(doc: Y.Doc, name: string): void {
  if (!doc.share.has(name)) return;
  const records = doc.getMap<Y.Map<unknown>>(name);
  for (const record of records.values()) {
    // A non-`Y.Map` value cannot be a record. Leaving it alone is the whole
    // point: this migration does not repair a doc, it translates one.
    if (record instanceof Y.Map) migrateRecordFields(record);
  }
  assignOrds(records, String(doc.clientID));
}

/**
 * Dedicated transaction-origin stamp for the V1→V2 doc migration.
 *
 * Sibling of `CANVAS_SEED_ORIGIN` (`files/canvas-persistence.ts`), and it exists
 * for the same reason the seed's does: the two writes that cold open can make on
 * one doc are DIFFERENT KINDS of write and an observer must be able to tell them
 * apart. The seed is the single file→CRDT read; the migration reads nothing from
 * the file and is a purely doc-internal translation. Counting transactions alone
 * conflates them — which is exactly how "no file→CRDT read" came to be pinned by
 * a proxy (`tx.count() === 0`) that also forbade the migration the spec requires.
 *
 * Declared HERE, next to the transaction it stamps, rather than beside
 * `CANVAS_SEED_ORIGIN`: `canvas-persistence.ts` already imports this module, so
 * the reverse import would close a cycle. It is re-exported from there for
 * import-site symmetry.
 */
export const CANVAS_MIGRATION_ORIGIN: unique symbol = Symbol("canvas-migration-origin");

/**
 * Bring `doc` to schema V2 — fresh, V1-shaped or already-V2, uniformly.
 *
 * ONE transaction, so a peer or a persistence observer sees the migrated doc or
 * the original one and never a half-translated record (AC2).
 *
 * The presence of `meta` IS the migration marker, and the guard sits before
 * `doc.transact` rather than inside it: a second call opens no transaction,
 * fires no `update` event and produces zero delta (AC3). "Same values" would not
 * be enough — Yjs emits a real update for a same-value LWW `set`, and that
 * update would echo to every peer on every open, forever.
 *
 * The container is fetched with `doc.getMap`, never assigned, so `meta` is
 * created once per doc and keeps its identity for the doc's lifetime (AC1).
 * `guid` / `epoch` / `path` are deliberately NOT written here — they are P2's,
 * and this function must remain safe to run on a doc that already carries them.
 *
 * The transaction is stamped {@link CANVAS_MIGRATION_ORIGIN} so an observer can
 * name what it is looking at instead of inferring it from a count. It stays a
 * LOCAL transaction (Yjs's `local` flag is independent of the origin), so no
 * downstream origin filter — the binding's `tr.local` skip, the provider's
 * `origin === this` skip — changes behaviour because of it.
 */
export function migrateV1ToV2(doc: Y.Doc): void {
  if (readMeta(doc) !== undefined) return;

  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(SCHEMA_VERSION_KEY, SUPPORTED_SCHEMA_MAJOR);
    for (const name of RECORD_MAP_NAMES) migrateRecordMap(doc, name);
  }, CANVAS_MIGRATION_ORIGIN);
}
