// WP9 / P1 — the ATOMIC GEOMETRY REGISTERS, and the V2 record vocabulary.
//
// Why it exists (I8, ATOMIC IS WHAT BELONGS TOGETHER): in V1 a card's position
// lived in the doc as two independent LWW registers, `x` and `y`. Two peers
// dragging the same card at the same time therefore merged per KEY, and the
// winner of `x` could be a different author than the winner of `y` — producing a
// coordinate that NOBODY submitted. The card lands somewhere neither user
// dragged it, on every replica, and no test that inspects one field at a time
// can see it. The same holds for `width`/`height`.
//
// The fix is not a smarter merge; it is a smaller alphabet. A position is ONE
// value:
//
//   ├── `pos`  → one LWW register holding `[x, y]`   (BUILD_SPEC §4.3)
//   └── `size` → one LWW register holding `[w, h]`
//
// Yjs resolves a same-key concurrent write by picking one writer's whole value,
// so with the pair behind a single key a torn combination is not merely unlikely
// — it is unrepresentable. `pos` and `size` stay SEPARATE keys precisely so that
// move ⊥ resize still commutes: a concurrent move and resize both survive.
//
// The FILE keeps its old shape. `.canvas` on disk still has flat `x`, `y`,
// `width`, `height` — `GEOMETRY_KEYS` (`src/files/canvas-sync.ts`) now describes
// that *file* schema and is untouched by this module, which deliberately does
// NOT export a competing set of its own (BUILD_SPEC §3.1 S2 — changing that set
// is an ESCALATE). The translation between the two worlds is the codec below.
//
// Purity contract (BUILD_SPEC §3, D12): this module imports NOTHING — no
// editor host, no filesystem, no clock, no randomness, and not even Yjs. The
// precedents are `reconcile-plan.ts` and `canvas-canonical.ts`. The doc
// read/write helpers in PART C reach the CRDT through the structural
// `V2RecordMap` interface below, which `Y.Map<unknown>` satisfies as-is, so the
// register semantics stay unit-testable without a doc and the module stays free
// of the Yjs import chain.
//
// OWNERSHIP (Shared Ownership Contract §1): this file is the single definition
// site for the V2 record field key names, the `V2Node` / `V2Edge` record types,
// the `pos` / `size` register types and their file↔doc codec. WP10 APPENDS the
// `from` / `to` endpoint registers here; WP8, WP14, WP15, WP16 and WP17 import
// from here and must never re-declare any of it — not as a local `const`, not as
// an inline string literal in a hot path.

// ---------------------------------------------------------------------------
// PART A — the V2 record vocabulary (field key names and record shapes)
// ---------------------------------------------------------------------------

/**
 * The V2 doc field key names, in one place.
 *
 * These are the keys of a record's `Y.Map<field, value>` (BUILD_SPEC §4.2), NOT
 * the keys of the `.canvas` file: `pos` and `size` replace the file's four flat
 * geometry keys, `from` / `to` replace the six flat endpoint keys, and `ord`
 * exists only in the doc (it is never written to the file).
 *
 * Every consumer imports these instead of writing `"pos"` inline. A misspelt
 * literal in one call site is a silent data-loss bug that no type checker and no
 * single-module test can catch.
 */
export const V2_FIELD = {
  id: "id",
  type: "type",
  /** `[x, y]` — one atomic LWW register. */
  pos: "pos",
  /** `[width, height]` — one atomic LWW register. */
  size: "size",
  /** `{node, side, end?}` — one atomic LWW register (value type owned by WP10). */
  from: "from",
  /** `{node, side, end?}` — one atomic LWW register (value type owned by WP10). */
  to: "to",
  /** Fractional-index string; doc-only, never serialised to the file (WP13). */
  ord: "ord",
  text: "text",
  label: "label",
  file: "file",
  subpath: "subpath",
  url: "url",
  color: "color",
  background: "background",
  backgroundStyle: "backgroundStyle",
} as const;

/** Any V2 doc field key name. */
export type V2FieldKey = (typeof V2_FIELD)[keyof typeof V2_FIELD];

/** The doc key of the atomic position register. */
export const POS_KEY = V2_FIELD.pos;

/** The doc key of the atomic size register. */
export const SIZE_KEY = V2_FIELD.size;

/**
 * A node record's V2 doc fields. `id`, `type`, `pos` and `size` are the ingest
 * validity core (BUILD_SPEC §4.5); everything else is type-specific or optional.
 */
export const V2_NODE_FIELD_KEYS: readonly V2FieldKey[] = [
  V2_FIELD.id,
  V2_FIELD.type,
  V2_FIELD.pos,
  V2_FIELD.size,
  V2_FIELD.ord,
  V2_FIELD.color,
  V2_FIELD.file,
  V2_FIELD.subpath,
  V2_FIELD.url,
  V2_FIELD.text,
  V2_FIELD.label,
  V2_FIELD.background,
  V2_FIELD.backgroundStyle,
];

/** An edge record's V2 doc fields. `id`, `from` and `to` are the validity core. */
export const V2_EDGE_FIELD_KEYS: readonly V2FieldKey[] = [
  V2_FIELD.id,
  V2_FIELD.from,
  V2_FIELD.to,
  V2_FIELD.ord,
  V2_FIELD.color,
  V2_FIELD.label,
];

/**
 * One `[x, y]` position, as it lives in the doc: a SINGLE register value.
 *
 * `readonly` on purpose — a register value is replaced, never mutated in place.
 * Mutating the array a peer is holding would be exactly the torn write this
 * component exists to make impossible.
 */
export type PosRegister = readonly [x: number, y: number];

/** One `[width, height]` size, as it lives in the doc: a SINGLE register value. */
export type SizeRegister = readonly [width: number, height: number];

/** A position in the `.canvas` FILE shape: two flat keys. */
export interface FilePos {
  x: number;
  y: number;
}

/** A size in the `.canvas` FILE shape: two flat keys. */
export interface FileSize {
  width: number;
  height: number;
}

/**
 * A V2 node record as it lives in the doc.
 *
 * `pos` and `size` are the atomic registers; the flat file keys `x` / `y` /
 * `width` / `height` never appear here. `text` is typed as `string` for now and
 * will widen when P4 moves it to a nested `Y.Text` — a read must tolerate BOTH
 * shapes, so no consumer may narrow it with a hard `typeof === "string"`
 * validity assertion (Shared Ownership Contract §3).
 */
export interface V2Node {
  id: string;
  type: string;
  pos: PosRegister;
  size: SizeRegister;
  ord?: string;
  color?: string;
  file?: string;
  subpath?: string;
  url?: string;
  text?: unknown;
  label?: unknown;
  background?: string;
  backgroundStyle?: string;
}

/**
 * A V2 edge record as it lives in the doc.
 *
 * The `from` / `to` key NAMES are owned here (`V2_FIELD`), but their composite
 * VALUE type `{node, side, end?}` and its file↔doc codec are WP10's and are
 * appended to this module by WP10. The type parameter is that seam: WP10 and its
 * consumers instantiate `V2Edge<EndpointRegister>`, while this file avoids
 * re-declaring a shape it does not own. Default `unknown` keeps every field
 * present and correctly named in the meantime.
 */
export interface V2Edge<TEndpoint = unknown> {
  id: string;
  from: TEndpoint;
  to: TEndpoint;
  ord?: string;
  color?: string;
  label?: unknown;
}

// ---------------------------------------------------------------------------
// PART B — the pure file↔doc codec (no doc, no Yjs, no side effects)
// ---------------------------------------------------------------------------

/**
 * Normalise one geometry scalar for storage (BUILD_SPEC §4.4).
 *
 * Rounding happens on the way INTO the register, so a rounded value can never
 * later surface as a delta that reads like user intent, and the doc can never
 * hold sub-pixel geometry no matter how undisciplined a call site is. It is
 * idempotent, which is what makes it safe to apply at every capture boundary
 * without coordination — a caller that already rounded through
 * `roundCanvasGeometry` (`canvas-canonical.ts`) sees no change at all.
 *
 * `-0` is normalised to `0`: a peer that produced `+0` must serialise
 * identically, and `JSON.stringify(-0)` is `"0"` anyway. A non-finite value
 * (`NaN` / `±Infinity`) is passed through untouched rather than mangled into a
 * plausible-looking number — it is garbage, and `isPosRegister` rejects it at
 * the read boundary instead of pretending it is a coordinate.
 */
function normalizeGeometryScalar(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/**
 * Build the stored pair. Frozen so the value inside the doc cannot be edited in
 * place by anybody holding a reference to it — "replace the register, never
 * patch one coordinate" becomes a runtime property, not a convention.
 */
function freezePair(a: number, b: number): readonly [number, number] {
  return Object.freeze([a, b]) as readonly [number, number];
}

/**
 * File → doc: the two flat file keys become ONE register value.
 *
 * Integer geometry round-trips losslessly (C9 AC1); fractional input is rounded
 * to whole pixels first (§4.4). The returned tuple is frozen — a register value
 * is replaced, never edited.
 */
export function encodePos(x: number, y: number): PosRegister {
  return freezePair(normalizeGeometryScalar(x), normalizeGeometryScalar(y));
}

/** File → doc, for the size register. Same contract as {@link encodePos}. */
export function encodeSize(width: number, height: number): SizeRegister {
  return freezePair(normalizeGeometryScalar(width), normalizeGeometryScalar(height));
}

/**
 * Doc → file: the register value becomes the two flat file keys `x` and `y`.
 *
 * Emits exactly the geometry keys the file schema declares — no more, no less —
 * so a serialiser can spread the result straight into a `.canvas` record.
 */
export function decodePos(pos: PosRegister): FilePos {
  return { x: pos[0], y: pos[1] };
}

/** Doc → file, for the size register: the flat `width` / `height` keys. */
export function decodeSize(size: SizeRegister): FileSize {
  return { width: size[0], height: size[1] };
}

function isFinitePair(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

/**
 * Is this arbitrary doc value a well-formed position register?
 *
 * The read boundary is where a V1 doc, a hand-edited file, a future schema or a
 * buggy peer shows up. A register is well formed only WHOLE: a two-element array
 * of finite numbers. A one-element array, a `[NaN, 3]`, an object `{x, y}` or a
 * bare number is rejected outright rather than half-read — half-reading is how a
 * torn value gets back in through the door this component locked.
 */
export function isPosRegister(value: unknown): value is PosRegister {
  return isFinitePair(value);
}

/** Is this arbitrary doc value a well-formed size register? */
export function isSizeRegister(value: unknown): value is SizeRegister {
  return isFinitePair(value);
}

/** Narrow an arbitrary doc value to a position register, or `undefined`. */
export function asPosRegister(value: unknown): PosRegister | undefined {
  return isPosRegister(value) ? value : undefined;
}

/** Narrow an arbitrary doc value to a size register, or `undefined`. */
export function asSizeRegister(value: unknown): SizeRegister | undefined {
  return isSizeRegister(value) ? value : undefined;
}

function pairEquals(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a === b || (Object.is(a[0], b[0]) && Object.is(a[1], b[1]));
}

/**
 * Whole-value equality for two position registers.
 *
 * `Object.is` rather than `===` so the comparison is total: two registers hold
 * the same position or they do not, with no `NaN !== NaN` surprise. Since the
 * register is atomic, "equal" is a property of the PAIR — there is deliberately
 * no per-coordinate comparison in this module's API.
 */
export function posEquals(a: PosRegister, b: PosRegister): boolean {
  return pairEquals(a, b);
}

/** Whole-value equality for two size registers. Same contract as {@link posEquals}. */
export function sizeEquals(a: SizeRegister, b: SizeRegister): boolean {
  return pairEquals(a, b);
}

// ---------------------------------------------------------------------------
// PART C — doc accessors (the only part that touches a CRDT record)
// ---------------------------------------------------------------------------

/**
 * The slice of a record container these helpers need.
 *
 * Structural on purpose: `Y.Map<unknown>` satisfies it as-is, so callers pass a
 * real record with no cast, while this module keeps the zero-import purity
 * contract and stays testable against a plain stub. Only `get` and `set` appear
 * — a register is never deleted (I7, OBSERVATION NEVER DELETES); it is replaced.
 */
export interface V2RecordMap {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

/**
 * Read the raw position register from a record, or `undefined` when the record
 * has none / holds a malformed one.
 */
export function readPosRegister(record: V2RecordMap): PosRegister | undefined {
  return asPosRegister(record.get(POS_KEY));
}

/** Read the raw size register from a record, or `undefined`. */
export function readSizeRegister(record: V2RecordMap): SizeRegister | undefined {
  return asSizeRegister(record.get(SIZE_KEY));
}

/**
 * Read a record's position already translated into the FILE shape `{x, y}`, or
 * `undefined` when the register is absent or malformed.
 */
export function readPos(record: V2RecordMap): FilePos | undefined {
  const register = readPosRegister(record);
  return register ? decodePos(register) : undefined;
}

/** Read a record's size in the FILE shape `{width, height}`, or `undefined`. */
export function readSize(record: V2RecordMap): FileSize | undefined {
  const register = readSizeRegister(record);
  return register ? decodeSize(register) : undefined;
}

/**
 * Write a whole position register in ONE `set` — the single operation this
 * component exists for.
 *
 * One key, one value, one delta: concurrent authors race for the whole pair, so
 * the merged result is always one author's complete `{x, y}`. There is
 * deliberately no `writeX` / `writeY`, because offering one would reintroduce
 * exactly the tearing this makes unrepresentable.
 */
export function writePosRegister(record: V2RecordMap, pos: PosRegister): void {
  record.set(POS_KEY, pos);
}

/** Write a whole size register in ONE `set`. Same contract as {@link writePosRegister}. */
export function writeSizeRegister(record: V2RecordMap, size: SizeRegister): void {
  record.set(SIZE_KEY, size);
}

/**
 * Capture-side convenience: take the file's flat `x` / `y`, normalise and store
 * them as one atomic register.
 */
export function writePos(record: V2RecordMap, x: number, y: number): void {
  writePosRegister(record, encodePos(x, y));
}

/** Capture-side convenience for the size register. Same contract as {@link writePos}. */
export function writeSize(record: V2RecordMap, width: number, height: number): void {
  writeSizeRegister(record, encodeSize(width, height));
}
