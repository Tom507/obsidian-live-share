// WP1 / C1 — the Surface-Shadow core, a PURE headless module.
//
// Why it exists: V2 needs to know, per subscribed canvas, the last version of
// each FIELD that provably reached the surface Obsidian's save comes from. The
// V1 shadow (`main.ts:114 canvasApplied`) is record-granular: it stores whole
// `.canvas` records per path, so an advance from one source (a confirmed view
// apply) silently overwrote what another source (a captured local edit, or a
// closed-view persistence write) had just learned about a DIFFERENT field of the
// same record. Field granularity is the basis the V2 intent diff rests on (I6),
// and a partial advance must never delete a field it does not mention (I7).
//
// The key hierarchy IS the contract (AC1):
//
//   ├── path   ← canonical path string, treated as an OPAQUE key
//   │   ├── kind   ← "node" / "edge": two separate id spaces per surface
//   │   │   ├── id     ← record id
//   │   │   │   └── field  ← last observed value for that field
//
// Every level is a `Map`, never a plain object: record ids and field names such
// as `constructor` are ordinary data here and must behave like ordinary keys.
//
// Three record states, not two (AC3). "Never observed on this surface" and
// "handed to the surface and found missing" are different knowledge: only the
// latter may ever become a delete intent downstream, so a `Map.has()`-only
// design (which collapses them) would be a defect.
//
// Purity contract (AC1, DoD): same inputs → same state. No package import at
// all, no Obsidian, no clock, no entropy, no host global, no file I/O — every
// fact the module needs is an argument. The precedent is the sibling pure core
// `canvas/reconcile-plan.ts`, which likewise imports nothing.
//
// Path canonicalisation happens at the subsystem boundary (BUILD_SPEC §4.4).
// This module never normalises, never lower-cases and never prefix-matches a
// path: keys are compared and deleted exactly as handed in.
//
// WP15 / C15 — the shadow at ATOMIC-REGISTER granularity.
//
// The storage hierarchy above is unchanged; what changes is the vocabulary of
// its lowest level. A V2 field is an atomic REGISTER (BUILD_SPEC §4.3): `pos` is
// one `[x, y]` value, `size` one `[w, h]`, `from`/`to` one `{node, side, end?}`
// each. The four V1 geometry keys and the six V1 endpoint keys no longer exist
// as shadow field names (AC4) — they describe the `.canvas` FILE, and the
// file↔doc translation is `canvas-registers.ts`'s codec, not this module's.
//
// Two consequences fall out of that, and both are the point of the change:
//
//   ├── a change to ONE component of a composite marks the WHOLE register as
//   │      intent (I8), automatically — the diff below never sees "x", only
//   │      "pos", so there is no per-component verdict to get wrong; and
//   └── staleness must therefore be judged by VALUE, not by reference, because
//          `encodePos`/`encodeSize`/`encodeEndpoint` freeze a freshly allocated
//          value on every call (see `fieldValueEquals`).
//
// The type-only import below is the Shared Ownership Contract §1 in action: the
// register value shapes are WP9's and WP10's, so they are imported rather than
// re-declared here. It is erased at compile time, so the runtime purity contract
// (no import at all) is untouched.

import type { EndpointRegister, PosRegister, SizeRegister } from "./canvas-registers";

/** The two record kinds of a `.canvas` file. */
export type ShadowRecordKind = "node" | "edge";

/**
 * The value types a shadow field can carry.
 *
 * The scalars are V1's and are unchanged. The three composite members are the
 * V2 ATOMIC REGISTERS, imported from their owning module (`canvas-registers.ts`,
 * WP9/WP10) rather than re-spelled here — a second declaration of `{node, side,
 * end?}` that drifted from WP10's would be invisible to every test.
 *
 * `undefined` is deliberately NOT a member: `getField` uses it as the sentinel
 * for "never observed", so a stored `undefined` would make an observed field
 * read back as unobserved.
 */
export type ShadowFieldValue =
  | string
  | number
  | boolean
  | null
  | PosRegister
  | SizeRegister
  | EndpointRegister;

/** What the shadow knows about one record on one surface. */
export type ShadowRecordState = "present" | "absent" | "unknown";

/**
 * One record's shadow.
 *
 * `unknown` is deliberately NOT representable here — it is the absence of a
 * `ShadowRecord`, which is why `getRecordState` is the only discriminator.
 * `absent` records carry an empty `fields` map.
 */
export interface ShadowRecord {
  state: "present" | "absent";
  fields: Map<string, ShadowFieldValue>;
}

/** Level 2 of the hierarchy: the two id spaces of one surface. */
export type ShadowPathState = { [K in ShadowRecordKind]: Map<string, ShadowRecord> };

/** Level 1: the whole shadow, keyed by canonical path. */
export interface SurfaceShadow {
  paths: Map<string, ShadowPathState>;
}

/** A fresh, empty shadow. No module-level state — two calls are independent. */
export function createSurfaceShadow(): SurfaceShadow {
  return { paths: new Map<string, ShadowPathState>() };
}

/** The path entry, created on first write. Never called from a reader. */
function ensurePathState(shadow: SurfaceShadow, path: string): ShadowPathState {
  const existing = shadow.paths.get(path);
  if (existing) return existing;
  const created: ShadowPathState = {
    node: new Map<string, ShadowRecord>(),
    edge: new Map<string, ShadowRecord>(),
  };
  shadow.paths.set(path, created);
  return created;
}

/**
 * The record entry, created on first write and marked `present`.
 *
 * An `absent` record that is observed again becomes `present` and starts from an
 * EMPTY field map: the fields it had before it went missing are stale knowledge
 * about a different incarnation, so only the newly observed ones may be read.
 */
function ensurePresentRecord(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
): ShadowRecord {
  const pathState = ensurePathState(shadow, path);
  const existing = pathState[kind].get(id);
  if (existing) {
    if (existing.state === "absent") {
      existing.state = "present";
      existing.fields = new Map<string, ShadowFieldValue>();
    }
    return existing;
  }
  const created: ShadowRecord = {
    state: "present",
    fields: new Map<string, ShadowFieldValue>(),
  };
  pathState[kind].set(id, created);
  return created;
}

/** The record entry, or undefined when path, kind entry or id was never seen. */
function findRecord(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
): ShadowRecord | undefined {
  return shadow.paths.get(path)?.[kind].get(id);
}

/**
 * Upsert exactly ONE field (AC2).
 *
 * Creates the path, the record and the field if needed, and marks the record
 * `present`. Touches no other field, no other record and no other path.
 * `value` may be `null` — that is an observed value, not "not observed".
 */
export function advanceField(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
  field: string,
  value: ShadowFieldValue,
): void {
  ensurePresentRecord(shadow, path, kind, id).fields.set(field, value);
}

/**
 * Upsert every entry of `fields` in one step, and mark the record `present`.
 *
 * I7: a field NOT mentioned in `fields` is left exactly as it was — a partial
 * report about a record must never be read as "the rest is gone". An empty
 * `fields` object changes no value but still records "this record is present".
 */
export function advanceRecord(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
  fields: Readonly<Record<string, ShadowFieldValue>>,
): void {
  const record = ensurePresentRecord(shadow, path, kind, id);
  for (const field of Object.keys(fields)) {
    record.fields.set(field, fields[field]);
  }
}

/**
 * Record the knowledge "handed to this surface, and it is not there" (AC3).
 *
 * Legal for a never-observed record — the result is `absent`, not `unknown`,
 * because the caller DID look. Idempotent, and it affects no other record.
 */
export function markRecordAbsent(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
): void {
  const pathState = ensurePathState(shadow, path);
  const existing = pathState[kind].get(id);
  if (existing) {
    existing.state = "absent";
    existing.fields.clear();
    return;
  }
  pathState[kind].set(id, {
    state: "absent",
    fields: new Map<string, ShadowFieldValue>(),
  });
}

/**
 * The only discriminator between `absent` and `unknown` (AC3).
 *
 * `"unknown"` whenever the path, the kind entry or the id was never observed.
 */
export function getRecordState(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
): ShadowRecordState {
  return findRecord(shadow, path, kind, id)?.state ?? "unknown";
}

/**
 * The last observed value of one field.
 *
 * `undefined` means "never observed" (or the record is not `present`); `null`
 * means "observed, and the value was null". The two are never interchangeable.
 */
export function getField(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
  field: string,
): ShadowFieldValue | undefined {
  const record = findRecord(shadow, path, kind, id);
  if (!record || record.state !== "present") return undefined;
  return record.fields.get(field);
}

/**
 * A DETACHED copy of a present record's fields — `{}` when it has none, `null`
 * for `absent` and for `unknown` alike (use `getRecordState` to tell those two
 * apart).
 *
 * Detached because callers hand the result on to diffing and serialisation; if
 * it aliased the live field store, a caller mutating its own copy would silently
 * rewrite what the shadow claims reached the surface.
 *
 * Written with `defineProperty` so that a field literally named `__proto__`
 * lands as an ordinary own key instead of reassigning the copy's prototype.
 */
export function getRecordFields(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
): Record<string, ShadowFieldValue> | null {
  const record = findRecord(shadow, path, kind, id);
  if (!record || record.state !== "present") return null;
  const copy: Record<string, ShadowFieldValue> = {};
  for (const [field, value] of record.fields) {
    Object.defineProperty(copy, field, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return copy;
}

/**
 * Drop a whole surface from the shadow on unsubscribe / teardown (AC4).
 *
 * Deletes by EXACT key — never by prefix, never case-insensitively — and leaves
 * no empty container behind, so the path reads `unknown` again afterwards and
 * can be repopulated from scratch. A no-op for an unknown path: it must not
 * create an entry.
 */
export function clearPath(shadow: SurfaceShadow, path: string): void {
  shadow.paths.delete(path);
}

/** The path keys currently held, as a plain array. Order is not significant. */
export function listPaths(shadow: SurfaceShadow): string[] {
  return [...shadow.paths.keys()];
}

// ---------------------------------------------------------------------------
// WP2 / C2 — the shadow-relative intent diff.
//
// The four rules of CONCEPT_V2 Teil 5 as ONE total, pure call. It answers a
// single question per observation: does this Obsidian save express INTENT, or is
// it merely the stale echo of a surface that had not caught up yet?
//
// The load-bearing structural fact is what is NOT a parameter: the CRDT. A field
// whose save value equals the shadow value is staleness even when the CRDT has
// long since moved on — the old capture path diffed against disk/CRDT, saw a
// difference and pushed the stale value back over a peer's edit (the Symptom-2
// cascade). Here the verdict cannot depend on the diverged value, because the
// diverged value is not reachable from this function at all.
//
// Nothing is applied. This call returns a plan; advancing the shadow and writing
// the CRDT are WP4's job, so the shadow is read-only here and every returned
// array and object is freshly built on every call.
// ---------------------------------------------------------------------------

/** One record as it appears in a parsed Obsidian save. */
export interface ParsedSaveRecord {
  id: string;
  fields: Readonly<Record<string, ShadowFieldValue>>;
}

/** A parsed `.canvas` save: one surface, its two id spaces as arrays (file order). */
export interface ParsedSave {
  path: string;
  nodes: readonly ParsedSaveRecord[];
  edges: readonly ParsedSaveRecord[];
}

/** Read-only seam over the `deleted` container: `true` iff the id carries `on:true`. */
export interface TombstoneView {
  isDeleted(kind: ShadowRecordKind, id: string): boolean;
}

/** What the surface can prove about the last apply. */
export interface SurfaceState {
  viewOpen: boolean;
  handedToView: {
    readonly node: ReadonlySet<string>;
    readonly edge: ReadonlySet<string>;
  };
}

/** "This field changed on the surface" — the unit of intent is the FIELD (I6). */
export interface FieldUpsertIntent {
  path: string;
  kind: ShadowRecordKind;
  id: string;
  field: string;
  value: ShadowFieldValue;
}

/** "This record was proven gone from a surface that provably carried it" (AC3). */
export interface DeleteIntent {
  path: string;
  kind: ShadowRecordKind;
  id: string;
}

/**
 * "This field was observed and deliberately NOT turned into intent" (AC1).
 *
 * The discard is a first-class output, not an absence: WP4 turns it into a
 * logged signature and WP23's shadow-consistency assertion needs it as evidence
 * that the stale field was seen and rejected rather than never noticed.
 */
export interface DiscardedStaleness {
  path: string;
  kind: ShadowRecordKind;
  id: string;
  field: string;
  value: ShadowFieldValue;
  reason: "equals-shadow";
}

/** Exactly these three keys, always arrays, never `undefined`. */
export interface IntentPlan {
  upserts: FieldUpsertIntent[];
  deletes: DeleteIntent[];
  discarded: DiscardedStaleness[];
}

/**
 * Is this an ordinary data object — the shape a register or a parsed `.canvas`
 * value can actually take?
 *
 * Prototype-checked rather than `typeof === "object"`, so a class instance, a
 * `Map`, a `Date` or anything else exotic falls through to reference equality
 * instead of being key-compared as if it were plain data. `null` prototype is
 * admitted because `Object.create(null)` is the safe shape for a container whose
 * keys are attacker-influenced content, which record fields are.
 */
function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A register's own keys that carry an observed value.
 *
 * A key whose value is `undefined` is treated as ABSENT, which is exactly how
 * `canvas-registers.ts` treats it: `encodeEndpoint` OMITS `end` rather than
 * storing `undefined`, and `endpointEquals` compares `a.end === b.end` so the
 * two spellings already mean one thing to the owning module. Disagreeing with
 * the owner here would make the same endpoint read as two different values.
 */
function observedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}

/**
 * A comparison depth no `.canvas` value can legitimately reach. Registers are
 * one level deep; the cap exists only so a malformed or self-referential value
 * from an untyped boundary cannot blow the stack inside a save path (I5:
 * degrade, never break). Hitting it yields "not equal", i.e. an upsert, which is
 * the same verdict the pre-WP15 reference comparison gave for any composite.
 */
const MAX_FIELD_COMPARE_DEPTH = 8;

/**
 * Whole-value equality for ONE shadow field — the WP15 AC2 fix.
 *
 * Rule 2 below used to ask `value === getField(...)`. For a V1 world in which
 * every field was a lone primitive that was exactly right. For V2 registers it
 * is a silent defect: `encodePos`/`encodeSize`/`encodeEndpoint` build a FRESHLY
 * ALLOCATED, frozen value on every call, so a save that re-encodes `100.3` and a
 * shadow holding the register built from `100` are two different objects holding
 * the same numbers. Reference equality calls them different, the restatement
 * reads as fresh INTENT, it is pushed to the CRDT and it overwrites newer peer
 * state — the Symptom-2 cascade, reintroduced through the one comparison this
 * module exists to get right (I6).
 *
 * The semantics, stated precisely:
 *
 *   ├── PRIMITIVES and identical references are decided by `===` and nothing
 *   │      else, byte-identically to before this WP. `0`/`-0` remain one
 *   │      observed value, `NaN` still never equals itself, `"1"` and `1` still
 *   │      differ, and `null` is still a value while `undefined` is not.
 *   ├── ARRAYS (`pos`, `size`) are equal iff same length and every element is
 *   │      equal under this same rule.
 *   └── PLAIN OBJECTS (`from`, `to`) are equal iff they carry the same observed
 *          keys and every one of those values is equal under this same rule.
 *
 * Mixed shapes (an array against an object, a register against a primitive) are
 * never equal, so a genuine shape change is intent, not staleness. The relation
 * is reflexive apart from `NaN`, symmetric and transitive — a save compared
 * against a shadow gets the same verdict whichever side holds which instance.
 */
function fieldValueEquals(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (depth >= MAX_FIELD_COMPARE_DEPTH) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!fieldValueEquals(a[index], b[index], depth + 1)) return false;
    }
    return true;
  }

  if (isPlainDataObject(a) && isPlainDataObject(b)) {
    const keysA = observedKeys(a);
    const keysB = observedKeys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!fieldValueEquals(a[key], b[key], depth + 1)) return false;
    }
    return true;
  }

  return false;
}

/**
 * Classify one parsed save against the shadow (AC1–AC5).
 *
 * Exactly four parameters — the arity is part of the contract, because a fifth
 * one carrying the CRDT is precisely the defect this design removes.
 *
 * Per record of the save, in this order:
 *
 *   1. Resurrect block (AC4) — a tombstoned id contributes to NO category, not
 *      even a discard. It is not staleness, it is out of scope. It still counts
 *      as "present in the save", so rule 4 never fires for it either.
 *   2. Staleness (AC1) — a field whose value equals the shadow value is a
 *      `DiscardedStaleness`, never an intent. Equality is whole-value and
 *      per-REGISTER (`fieldValueEquals`, WP15 AC2), so a save that restates the
 *      same pixel through a freshly encoded register is staleness rather than
 *      intent. `undefined` from `getField` means "never observed" and can
 *      therefore never match an observed value.
 *   3. Intent (AC2) — otherwise exactly one upsert for that (record, field).
 *      Because `pos`/`size`/`from`/`to` are single fields, one changed component
 *      yields one upsert carrying the WHOLE register (I8), never a per-component
 *      patch. A field the shadow holds but the save does not mention produces
 *      nothing: a save is a PARTIAL observation, never a removal (I7).
 *
 * And once over the shadow:
 *
 *   4. Delete (AC3) — a `present` record of `save.path` missing from the save is
 *      a delete intent ONLY with an open view AND a hand-over receipt for that
 *      (kind, id). Absence without that proof is ignorance, not deletion. This
 *      rule does not consult the tombstone view: re-asserting an existing
 *      tombstone converges.
 *
 * Only `save.path` is read; the two kinds are separate id spaces in the shadow,
 * the tombstone view and the hand-over sets alike.
 */
export function planIntentDiff(
  shadow: SurfaceShadow,
  save: ParsedSave,
  tombstones: TombstoneView,
  surface: SurfaceState,
): IntentPlan {
  const plan: IntentPlan = { upserts: [], deletes: [], discarded: [] };
  const kinds: readonly ShadowRecordKind[] = ["node", "edge"];
  // Which ids the save mentions at all — blocked records included, so that a
  // record the resurrect block silenced can never fall through into rule 4.
  const seen: { [K in ShadowRecordKind]: Set<string> } = {
    node: new Set<string>(),
    edge: new Set<string>(),
  };

  for (const kind of kinds) {
    for (const record of kind === "node" ? save.nodes : save.edges) {
      seen[kind].add(record.id);

      // Rule 1 — resurrect block.
      if (tombstones.isDeleted(kind, record.id)) continue;

      for (const field of Object.keys(record.fields)) {
        const value = record.fields[field];
        // Rule 2 — staleness, judged per WHOLE register by VALUE (WP15 AC2).
        // Primitives keep their exact `===` verdict; a composite register is
        // equal when it holds the same value, not when it is the same instance
        // — see `fieldValueEquals` for why reference equality is a defect here.
        if (fieldValueEquals(value, getField(shadow, save.path, kind, record.id, field))) {
          plan.discarded.push({
            path: save.path,
            kind,
            id: record.id,
            field,
            value,
            reason: "equals-shadow",
          });
          continue;
        }
        // Rule 3 — intent.
        plan.upserts.push({ path: save.path, kind, id: record.id, field, value });
      }
    }
  }

  // Rule 4 — delete, gated on the two seam flags.
  if (surface.viewOpen) {
    const pathState = shadow.paths.get(save.path);
    if (pathState) {
      for (const kind of kinds) {
        for (const [id, record] of pathState[kind]) {
          if (record.state !== "present") continue;
          if (seen[kind].has(id)) continue;
          if (!surface.handedToView[kind].has(id)) continue;
          plan.deletes.push({ path: save.path, kind, id });
        }
      }
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// WP5 / C5 — the per-field apply receipt in the reconcile path.
//
// V1 kept a SECOND structure next to the capture basis: `main.ts:114
// canvasApplied`, a record snapshot written wholesale whenever a reconcile pass
// "looked like" it had worked. Two defects fell out of that shape:
//
//   ├── a reload that did not land was still recorded as applied, so the stale
//   │   view's next save read as intent and reverted the peer (Symptom-2), and
//   └── ONE card held by the local user ("interacting") discarded the advance of
//       EVERY other card in the pass, because the snapshot is all-or-nothing.
//
// C5 removes the second structure entirely. The reconcile path now advances the
// SAME shadow the capture path classifies against, per FIELD, and only for
// records whose apply the adapter actually confirmed. Three additions:
//
//   ├── `shadowToCanvasRecords` — the projection `planReconcile` consumes as its
//   │      `lastApplied`, so classification and capture read one structure.
//   ├── `buildApplyReceipt` / `advanceFromReceipt` — the receipt seam: what the
//   │      pass tried, what the surface confirmed, what may therefore advance.
//   └── `createSurfaceStateStore` — the hand-over half of the same receipt, which
//          is what gates C4's delete rule.
//
// The purity contract is unchanged: no import, no clock, no I/O, no host global.
// Every decision below is a function of its arguments alone, which is what lets
// `main.ts` stay wiring (BUILD_SPEC §3.1 S11, WP5 AC4).
// ---------------------------------------------------------------------------

/** The two id spaces, in a fixed order, wherever both must be walked. */
const RECORD_KINDS: readonly ShadowRecordKind[] = ["node", "edge"];

/**
 * Write one own key onto a detached copy.
 *
 * `defineProperty`, like `getRecordFields`, so a field literally named
 * `__proto__` lands as ordinary data instead of reassigning the copy's
 * prototype. Record ids and field names are attacker-influenced content here.
 */
function defineField(
  target: Record<string, ShadowFieldValue>,
  field: string,
  value: ShadowFieldValue,
): void {
  Object.defineProperty(target, field, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** The `present` records of one id space, as detached, id-keyed record objects. */
function projectRecords(records: Map<string, ShadowRecord>): Record<string, ShadowFieldValue>[] {
  const out: Record<string, ShadowFieldValue>[] = [];
  for (const [id, record] of records) {
    // `absent` is knowledge, not membership: a record proven gone from the
    // surface must NOT appear in the classifier basis, or every future pass
    // would see a membership difference and reload forever.
    if (record.state !== "present") continue;
    const copy: Record<string, ShadowFieldValue> = {};
    for (const [field, value] of record.fields) defineField(copy, field, value);
    // The map KEY is the authoritative id — it wins over a field called `id`.
    defineField(copy, "id", id);
    out.push(copy);
  }
  return out;
}

/**
 * The classifier basis: the shadow, projected into the record shape
 * `planReconcile` already consumes (WP5 AC1).
 *
 * This is what makes "one structure" true rather than aspirational —
 * `reconcile-plan.ts` is not modified, the projection meets it where it is.
 *
 *   ├── unknown path      → `null`, which feeds `planReconcile`'s existing
 *   │                       "nothing applied yet → structural" branch.
 *   ├── known path        → both arrays always present; a path holding only
 *   │                       `absent` records yields `{nodes: [], edges: []}`,
 *   │                       which is NOT `null`.
 *   ├── `absent` records  → excluded.
 *   └── order             → shadow insertion order per kind. `planReconcile`
 *                           indexes by id, so order is not load-bearing; it is
 *                           deterministic so two calls can be compared.
 *
 * DETACHED: callers hand the result to diffing, and a caller mutating its own
 * copy must never rewrite what the shadow claims reached the surface.
 */
export function shadowToCanvasRecords(
  shadow: SurfaceShadow,
  path: string,
): { nodes: Record<string, ShadowFieldValue>[]; edges: Record<string, ShadowFieldValue>[] } | null {
  const pathState = shadow.paths.get(path);
  if (!pathState) return null;
  return { nodes: projectRecords(pathState.node), edges: projectRecords(pathState.edge) };
}

/**
 * What one reconcile pass can prove about ONE record.
 *
 * The split that matters is CONFIRMED vs everything else. "applied" and
 * "unchanged" both mean the values are on the surface; every other value means
 * "we tried", which V1 wrongly treated as "it landed".
 */
export type ApplyOutcome =
  | "applied"
  | "unchanged"
  | "interacting"
  | "missing"
  | "unsupported"
  | "failed";

/** One record's line in the receipt: what was attempted, and with which fields. */
export interface RecordApplyResult {
  kind: ShadowRecordKind;
  id: string;
  outcome: ApplyOutcome;
  fields: Readonly<Record<string, ShadowFieldValue>>;
}

/** What one reconcile pass handed to one surface, and what came back. */
export interface ApplyReceipt {
  path: string;
  /**
   * `true` only for a LANDED structural reload — the one pass that provably
   * REPLACES the surface's membership, and therefore the only one allowed to
   * conclude "the records I did not carry are not there".
   */
  exhaustive: boolean;
  records: readonly RecordApplyResult[];
}

/** The facts `reconcileLiveCanvas` gathers; the receipt is derived from them. */
export interface ReconcilePass {
  path: string;
  desired: {
    nodes: ReadonlyArray<Record<string, unknown>>;
    edges: ReadonlyArray<Record<string, unknown>>;
  };
  /** the verdict `planReconcile` returned for this pass */
  plan: "structural" | "geometry";
  /** `adapter.reloadCanvasData(...)` — structural passes and the edge reflow */
  reloaded?: boolean;
  /** `adapter.applyNodeGeometry(...)` per node id — geometry passes */
  nodeOutcomes?: ReadonlyMap<string, ApplyOutcome>;
}

/**
 * Every own key of a desired record, detached and typed as shadow values.
 *
 * One key is dropped: a value of `undefined`. `undefined` is not a
 * `ShadowFieldValue` and it is not representable in a `.canvas` file —
 * `canonicalizeRecord` omits such a key from the serialised document — so it
 * provably cannot be on the surface. Writing it into the shadow would be worse
 * than useless: `getField` returns `undefined` for "never observed", so a stored
 * `undefined` makes an observed field read as unobserved and silently collapses
 * the three-state model this module exists to keep apart.
 */
function toReceiptFields(record: Record<string, unknown>): Record<string, ShadowFieldValue> {
  const fields: Record<string, ShadowFieldValue> = {};
  for (const field of Object.keys(record)) {
    const value = record[field];
    if (value === undefined) continue;
    defineField(fields, field, value as ShadowFieldValue);
  }
  return fields;
}

/**
 * The outcome of ONE node in a geometry pass.
 *
 * `"interacting"` DOMINATES: a card the local user is still holding keeps that
 * outcome even when the follow-up edge-reflow reload landed in the same pass —
 * the reload re-seated every OTHER card, but Obsidian's drag state still owns
 * this one, so the shadow must not claim the desired value reached it. Any other
 * unconfirmed node becomes `"applied"` when the reflow reload landed, because
 * `setData` really did replace it. An id with NO entry was never confirmed at
 * all (the per-node loop skips records without four numeric geometry keys), so
 * it degrades to `"missing"`.
 */
function geometryNodeOutcome(
  reported: ApplyOutcome | undefined,
  reloaded: boolean,
): ApplyOutcome {
  if (reported === "interacting") return "interacting";
  if (reported === "applied" || reported === "unchanged") return reported;
  if (reloaded) return "applied";
  return reported ?? "missing";
}

/**
 * Turn one executed reconcile pass into a receipt (WP5 AC2/AC3).
 *
 * Mechanical and total: it reads no shadow, makes no adapter call and takes no
 * decision that depends on state outside `pass`. That is deliberate — it is the
 * function that lets `main.ts` gather facts and forward them without holding any
 * canvas logic of its own.
 *
 *   ├── a record without a usable string `id` is skipped (the `canvasIds` rule);
 *   ├── `fields` is EVERY own key of the desired record, `id` included, matching
 *   │      WP4's `toParsedRecords` so both sides describe a record identically —
 *   │      minus keys whose value is `undefined`, which no `.canvas` file can
 *   │      carry and which the shadow reads back as "never observed";
 *   ├── structural → every node and edge is `"applied"` when the reload landed
 *   │      and `"failed"` when it did not; `exhaustive` = the reload landed;
 *   └── geometry   → nodes per `geometryNodeOutcome`, edges `"applied"` when the
 *          reflow reload landed and otherwise `"unchanged"` (`planReconcile`
 *          only returns `"geometry"` when every edge already equals the basis,
 *          so `"unchanged"` is literally true); `exhaustive` is always `false`,
 *          because a geometry pass proves nothing about membership.
 */
export function buildApplyReceipt(pass: ReconcilePass): ApplyReceipt {
  const structural = pass.plan === "structural";
  const reloaded = pass.reloaded === true;
  const records: RecordApplyResult[] = [];

  // `source` is typed as required, but the records cross an untyped boundary (a
  // CRDT snapshot, ultimately a parsed `.canvas` file), and I5 says degrade,
  // never break: a malformed payload must leave the receipt short, not throw out
  // of the reconcile pass and take the sync with it.
  const collect = (
    kind: ShadowRecordKind,
    source: ReadonlyArray<Record<string, unknown>> | undefined,
  ) => {
    if (!Array.isArray(source)) return;
    for (const record of source) {
      if (!record || typeof record !== "object") continue;
      const id = record.id;
      // The same rule as `canvasIds`: a record we cannot identify can never be
      // matched against the shadow, so it is not describable in a receipt.
      if (typeof id !== "string" || id.length === 0) continue;
      let outcome: ApplyOutcome;
      if (structural) {
        outcome = reloaded ? "applied" : "failed";
      } else if (kind === "node") {
        outcome = geometryNodeOutcome(pass.nodeOutcomes?.get(id), reloaded);
      } else {
        outcome = reloaded ? "applied" : "unchanged";
      }
      records.push({ kind, id, outcome, fields: toReceiptFields(record) });
    }
  };

  collect("node", pass.desired?.nodes);
  collect("edge", pass.desired?.edges);

  return { path: pass.path, exhaustive: structural && reloaded, records };
}

/** Structurally identical to `FieldUpsertIntent`: one field, one proven value. */
export interface FieldAdvance {
  path: string;
  kind: ShadowRecordKind;
  id: string;
  field: string;
  value: ShadowFieldValue;
}

/** What the receipt DID — the evidence half of the same call that advanced. */
export interface ReceiptSummary {
  advanced: FieldAdvance[];
  unconfirmed: Array<{ kind: ShadowRecordKind; id: string; outcome: ApplyOutcome }>;
  markedAbsent: Array<{ kind: ShadowRecordKind; id: string }>;
  handed: { node: Set<string>; edge: Set<string> };
}

export interface ApplyReceiptOptions {
  /** BUILD_SPEC §8 discrimination seam. Defaults to `true`. Test-only when off. */
  perFieldReceipt?: boolean;
}

/** `true` iff the surface confirmed the values are on it. */
function isConfirmed(outcome: ApplyOutcome): boolean {
  return outcome === "applied" || outcome === "unchanged";
}

/**
 * The fields ONE confirmed receipt line may write, detached.
 *
 * Two filters, and neither of them withholds anything the surface confirmed:
 *
 *   ├── a value of `undefined` is dropped. `getField` uses `undefined` as the
 *   │      sentinel for "never observed", so storing it would make an OBSERVED
 *   │      field read back as unobserved — strictly less knowledge than leaving
 *   │      the key out, never more. `canonicalizeRecord` omits such a key from
 *   │      the `.canvas` file, so the value provably cannot be on the surface.
 *   └── a field literally named `id` takes the LINE's id, the same "the key
 *          wins" rule `shadowToCanvasRecords` applies in the other direction, so
 *          the projection and the shadow can never disagree about which record a
 *          field belongs to.
 */
function toAdvanceFields(line: RecordApplyResult): Record<string, ShadowFieldValue> {
  const fields: Record<string, ShadowFieldValue> = {};
  for (const field of Object.keys(line.fields)) {
    const value = line.fields[field];
    if (value === undefined) continue;
    defineField(fields, field, field === "id" ? line.id : value);
  }
  return fields;
}

/** Write one CONFIRMED receipt line into the shadow and record what that did. */
function advanceConfirmedLine(
  shadow: SurfaceShadow,
  path: string,
  line: RecordApplyResult,
  summary: ReceiptSummary,
): void {
  const fields = toAdvanceFields(line);
  // `advanceRecord`, not a bare `advanceField` loop: a CONFIRMED record with no
  // fields at all still proves "this record reached the surface", and that
  // presence is knowledge the delete rule and the classifier both depend on.
  advanceRecord(shadow, path, line.kind, line.id, fields);
  for (const field of Object.keys(fields)) {
    summary.advanced.push({
      path,
      kind: line.kind,
      id: line.id,
      field,
      value: fields[field],
    });
  }
  summary.handed[line.kind].add(line.id);
}

/**
 * V1's record-snapshot semantics, restored exactly (BUILD_SPEC §8).
 *
 * Both V1 defects in one branch: the single question V1 asked was
 * `interacting === 0`, so one held card discards the whole pass, and no other
 * outcome is consulted at all, so a reload that never landed is recorded as
 * applied. `exhaustive` absent-marking does not run — V1 had no such concept.
 * There is no production caller.
 */
function advanceAsRecordSnapshot(
  shadow: SurfaceShadow,
  receipt: ApplyReceipt,
  summary: ReceiptSummary,
): ReceiptSummary {
  for (const record of receipt.records) {
    if (record.outcome !== "interacting") continue;
    for (const skipped of receipt.records) {
      summary.unconfirmed.push({
        kind: skipped.kind,
        id: skipped.id,
        outcome: skipped.outcome,
      });
    }
    return summary;
  }
  for (const record of receipt.records) {
    for (const field of Object.keys(record.fields)) {
      const value = record.fields[field];
      advanceField(shadow, receipt.path, record.kind, record.id, field, value);
      summary.advanced.push({
        path: receipt.path,
        kind: record.kind,
        id: record.id,
        field,
        value,
      });
    }
    summary.handed[record.kind].add(record.id);
  }
  return summary;
}

/**
 * Rule 3 — the `exhaustive` absent sweep.
 *
 * Marks every record the shadow still holds as `present` for `receipt.path` and
 * the receipt does not carry. This is the one pass that proves "handed to the
 * surface and it is not there", and it is what stops a removed record from
 * making every future classification structural forever.
 *
 * Exactly TWO conditions gate it, and no third:
 *
 *   ├── `receipt.exhaustive` — only a LANDED structural reload replaced the
 *   │      surface's membership, so only it may conclude "not carried ⇒ not
 *   │      there". A geometry pass proves nothing about membership.
 *   └── `shadow.paths.get`, NEVER `ensurePathState` — rule 4 says an unknown
 *          path must stay unknown, or the classifier loses its safe structural
 *          branch for a surface nothing ever reached.
 *
 * A record the receipt CARRIED is never swept, whatever its outcome: an
 * `"interacting"` card is provably still on the surface, it just refused the new
 * values. That per-record carve-out is the whole of AC2/AC3 here. Extending it
 * to a WHOLE-PASS veto ("skip the sweep if anything went unconfirmed") is a
 * different and much worse rule: it leaves records the surface provably no
 * longer holds standing as `present` with their old field values, so the next
 * restatement of exactly those values reads as fresh INTENT instead of
 * staleness, gets pushed, and overwrites newer peer state — the cascade this
 * module exists to stop. Section 7 rule 3 states the sweep unconditionally on
 * `exhaustive`, and that is deliberate.
 */
function sweepAbsent(
  shadow: SurfaceShadow,
  receipt: ApplyReceipt,
  summary: ReceiptSummary,
): void {
  if (!receipt.exhaustive) return;
  const pathState = shadow.paths.get(receipt.path);
  if (!pathState) return;

  const carried: { [K in ShadowRecordKind]: Set<string> } = {
    node: new Set<string>(),
    edge: new Set<string>(),
  };
  for (const line of receipt.records) carried[line.kind].add(line.id);

  for (const kind of RECORD_KINDS) {
    for (const [id, record] of pathState[kind]) {
      if (record.state !== "present") continue;
      if (carried[kind].has(id)) continue;
      // In-place state flip — it inserts and removes nothing, so iterating the
      // map while calling it is safe.
      markRecordAbsent(shadow, receipt.path, kind, id);
      summary.markedAbsent.push({ kind, id });
    }
  }
}

/**
 * Advance the shadow by exactly what the surface confirmed (WP5 AC1–AC3).
 *
 * This is the ONLY writer of the reconcile side of the shadow, and the shadow it
 * writes is the same instance the capture path classifies against — which is
 * what "no drift between them" means operationally.
 *
 *   1. CONFIRMED (`"applied"` / `"unchanged"`) → every entry of `fields` is
 *      advanced and the id joins `handed[kind]`. A field the receipt does not
 *      mention is left exactly as it was: a partial report is not a removal (I7).
 *   2. UNCONFIRMED (anything else) → NO field of that record advances, the record
 *      is NOT handed over, and its existing knowledge is neither cleared nor
 *      altered. A skip is a deferral, not an erase, and not a hole either — the
 *      next pass re-delivers the same delta and lands it.
 *   3. `exhaustive === true` → every record the shadow holds as `present` for
 *      `receipt.path` that the receipt does not carry is marked `absent`. This is
 *      the one pass that proves "handed to the surface and it is not there", and
 *      it is what stops a removed record from making every future classification
 *      structural forever.
 *   4. A receipt that confirms nothing creates NO shadow entry at all — an
 *      unknown path stays `unknown` rather than becoming an empty path entry.
 *   5. Only `receipt.path` is touched, and the two kinds are separate id spaces.
 *
 * The dispatch unit is the receipt LINE, and the outcome on that line decides
 * alone. That is not a weaker reading of AC3's "the affected record": a line is
 * the receipt's description of one record, an unconfirmed line WRITES NOTHING,
 * and a confirmed line only ever writes — so the shadow state this produces is
 * the union of every confirmed line and is independent of array order either
 * way. What a whole-record veto would add is only the power to SUPPRESS a
 * confirmed line, and suppression is not free:
 *
 *   ├── advancing a field the surface did NOT take turns the user's next genuine
 *   │      edit back to that value into "staleness" and discards it; and
 *   └── FAILING to advance a field the surface DID take turns the next
 *          restatement of that value into fresh "intent" — it is pushed to the
 *          CRDT and overwrites newer peer state, which is the corruption cascade
 *          itself.
 *
 * Both directions lose data. There is no safe default to fall back on, so the
 * rule is exact rather than cautious: advance precisely what was confirmed,
 * advance nothing that was not, and let `exhaustive` mean what it says.
 */
export function advanceFromReceipt(
  shadow: SurfaceShadow,
  receipt: ApplyReceipt,
  opts?: ApplyReceiptOptions,
): ReceiptSummary {
  const summary: ReceiptSummary = {
    advanced: [],
    unconfirmed: [],
    markedAbsent: [],
    handed: { node: new Set<string>(), edge: new Set<string>() },
  };

  if (opts?.perFieldReceipt === false) {
    return advanceAsRecordSnapshot(shadow, receipt, summary);
  }

  for (const line of receipt.records) {
    if (!isConfirmed(line.outcome)) {
      // Rule 2: no field advances, nothing is handed over, and the record's
      // existing knowledge is left EXACTLY as it was. A skip is a deferral, not
      // an erase and not a hole — the next pass re-delivers the same delta.
      summary.unconfirmed.push({ kind: line.kind, id: line.id, outcome: line.outcome });
      continue;
    }
    advanceConfirmedLine(shadow, receipt.path, line, summary);
  }

  sweepAbsent(shadow, receipt, summary);
  return summary;
}

/**
 * The hand-over half of the receipt — what C4's delete rule is gated on.
 *
 * WP4 left `setSurfaceStateProvider` at its honest P0 default ("closed, nothing
 * handed"). This store owns the real value, and it is fed from the SAME
 * confirmed apply that advances the shadow (`ReceiptSummary.handed`), so the
 * hand-over receipt and the field receipt cannot drift apart.
 *
 * It never touches the shadow. That asymmetry is the point of TC5: closing a
 * canvas view voids the hand-over (nothing is on that surface any more) but must
 * NOT void the shadow, which is also the capture basis — dropping it is exactly
 * the cascade window V1 opened at `main.ts:1029`.
 */
export interface SurfaceStateStore {
  /** REPLACES the previous receipt for that path — it never accumulates. */
  noteHandover(
    path: string,
    handed: { node: ReadonlySet<string>; edge: ReadonlySet<string> },
  ): void;
  /** view closed / teardown: drops the hand-over for that path ONLY. */
  clearPath(path: string): void;
  clearAll(): void;
  /** what `CanvasSync` consumes. `handedToView` is empty for an unknown path. */
  stateFor(path: string): SurfaceState;
}

export function createSurfaceStateStore(
  isViewOpen: (path: string) => boolean,
): SurfaceStateStore {
  const handovers = new Map<string, { node: ReadonlySet<string>; edge: ReadonlySet<string> }>();
  return {
    noteHandover(path, handed) {
      // Copy on the way in: the summary's sets belong to the caller, and a
      // receipt that is later mutated must not retro-actively widen what we
      // claim was handed over.
      handovers.set(path, { node: new Set(handed.node), edge: new Set(handed.edge) });
    },
    clearPath(path) {
      handovers.delete(path);
    },
    clearAll() {
      handovers.clear();
    },
    stateFor(path) {
      const handed = handovers.get(path);
      return {
        viewOpen: isViewOpen(path),
        handedToView: handed ?? { node: new Set<string>(), edge: new Set<string>() },
      };
    },
  };
}
