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

// ---------------------------------------------------------------------------
// PART D — WP10 / P1: the ATOMIC `from` / `to` ENDPOINT REGISTERS
// ---------------------------------------------------------------------------
//
// Same disease as PART B's geometry, one step nastier. In V1 an edge endpoint
// lived in the doc as up to three independent LWW keys — `fromNode`,
// `fromSide`, `fromEnd` — so two peers re-routing the SAME arrow at the same
// time merged per KEY. The winner of `fromNode` could be a different author
// than the winner of `fromSide`, producing an endpoint NOBODY submitted:
// peer A's node with peer B's side. That is not a cosmetic glitch, it is the
// "arrow points at a side where nothing hangs" class — a geometrically
// impossible edge, identical on every replica, invisible to any test that
// inspects one field at a time.
//
// The fix is the same smaller alphabet (I8, ATOMIC IS WHAT BELONGS TOGETHER).
// An endpoint is ONE value (BUILD_SPEC §4.3):
//
//   ├── `from` → one LWW register holding `{node, side, end?}`
//   └── `to`   → one LWW register holding `{node, side, end?}`
//
// `from` and `to` stay SEPARATE keys for the same reason `pos` and `size` do:
// re-routing the head ⊥ re-routing the tail, so both concurrent changes must
// survive (AC3). Within one endpoint, nothing is independent — node, side and
// end describe a single attachment point and travel together or not at all.
//
// The FILE keeps its old flat shape: `.canvas` on disk still carries
// `fromNode` / `fromSide` / `fromEnd` and the `to*` counterparts. Those six
// key names are declared exactly once, in `ENDPOINT_FILE_KEYS` below, and the
// translation between the two worlds is `encodeEndpointFromFile` /
// `decodeEndpointToFile`.
//
// OWNERSHIP (Shared Ownership Contract §1): WP10 owns the endpoint VALUE type
// and its file↔doc codec, and appends them here. The `from` / `to` KEY NAMES
// are WP9's and are reused from `V2_FIELD` above — this part re-declares
// nothing, not the keys, not `V2Edge`, not `V2RecordMap`. WP8, WP14, WP15,
// WP16 and WP17 import from here.

/**
 * One edge endpoint, as it lives in the doc: a SINGLE register value.
 *
 * `node` is mandatory and non-empty and ALONE decides the register's presence
 * (C10 AC5). `side` and `end` are genuinely OPTIONAL components of that one
 * value — `fromSide`/`toSide` are optional in the JSON Canvas format, so an
 * edge attached to a node with no side named is a legal, fully-connected edge
 * and must be representable here. An absent component is ABSENT rather than
 * `undefined`/`""`: a stored empty would round-trip to the file as a key that
 * exists with no meaning, which is neither the component nor its absence.
 *
 * Optionality is a property of the VALUE'S SHAPE, never of the write
 * granularity: the register is still exactly one LWW value holding one
 * `{node, side?, end?}`, replaced whole, so no author's `node` can ever combine
 * with another author's `side` (C10 AC4).
 *
 * `readonly` on purpose, and the values are frozen at construction: a register
 * value is replaced, never patched. Patching one component of an endpoint
 * somebody else is holding is exactly the torn write this exists to prevent.
 */
export interface EndpointRegister {
  readonly node: string;
  readonly side?: string;
  readonly end?: string;
}

/** The doc key of the atomic `from` endpoint register. */
export const FROM_KEY = V2_FIELD.from;

/** The doc key of the atomic `to` endpoint register. */
export const TO_KEY = V2_FIELD.to;

/** Which of an edge's two endpoint registers is meant. */
export type EndpointSlot = typeof FROM_KEY | typeof TO_KEY;

/** Both endpoint slots, for consumers that must handle an edge exhaustively. */
export const ENDPOINT_SLOTS: readonly EndpointSlot[] = [FROM_KEY, TO_KEY];

/**
 * The `.canvas` FILE key names each endpoint slot expands into.
 *
 * The single definition site for these six strings (Shared Ownership Contract
 * §1). `canvas-sync.ts`'s `PROTECTED_KEYS` mentions four of them as a V1 delete
 * guard and is deliberately left alone — it guards the seed boundary until
 * WP18 and is not the V2 schema.
 */
export const ENDPOINT_FILE_KEYS = {
  [FROM_KEY]: { node: "fromNode", side: "fromSide", end: "fromEnd" },
  [TO_KEY]: { node: "toNode", side: "toSide", end: "toEnd" },
} as const;

/**
 * An endpoint's components in the `.canvas` FILE vocabulary but WITHOUT the
 * slot prefix — the shape {@link decodeEndpoint} hands back, so a caller that
 * wants a mutable, plain copy of a register never has to reach into the frozen
 * doc value.
 */
export interface FileEndpoint {
  node: string;
  side?: string;
  end?: string;
}

/**
 * The prefixed file fields for one slot, derived from {@link ENDPOINT_FILE_KEYS}
 * so the six literals exist in exactly one place: `{fromNode, fromSide?,
 * fromEnd?}` for `from`, `{toNode, toSide?, toEnd?}` for `to`.
 *
 * Only `*Node` is mandatory — the JSON Canvas format makes `fromSide`/`toSide`
 * optional, and a side-less register expands to the `*Side` key being ABSENT,
 * never `null` and never `""` (C10 AC5).
 */
export type EndpointFileFields<S extends EndpointSlot = EndpointSlot> = Record<
  (typeof ENDPOINT_FILE_KEYS)[S]["node"],
  string
> &
  Partial<
    Record<
      (typeof ENDPOINT_FILE_KEYS)[S]["side"] | (typeof ENDPOINT_FILE_KEYS)[S]["end"],
      string
    >
  >;

/**
 * A V2 edge record with its endpoints instantiated — the concrete form of
 * WP9's `V2Edge<TEndpoint>` seam. Consumers should use this rather than
 * spelling out `V2Edge<EndpointRegister>` at every site.
 */
export type V2EdgeRecord = V2Edge<EndpointRegister>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function describeValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Is this optional component ABSENT?
 *
 * `""`, `null` and `undefined` all mean "the file did not say" for `side` and
 * `end` (C10 AC5). They are normalised to the KEY BEING OMITTED rather than
 * stored, so a register never carries an empty component and the file never
 * gains a `fromSide: ""`.
 */
function isAbsentComponent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Normalise one optional endpoint component: absent → `undefined`, a string →
 * itself VERBATIM.
 *
 * WP10 does not validate the side vocabulary and must not start: an
 * unrecognised side from a forward-compatible file is carried through opaquely
 * rather than normalised away, so no information is lost. Only a value that is
 * neither an absence nor a string is a caller error worth a throw.
 */
function normaliseComponent(component: "side" | "end", value: unknown): string | undefined {
  if (isAbsentComponent(value)) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(
      `canvas endpoint register: '${component}' must be a string when present, got ${describeValue(value)}`,
    );
  }
  return value;
}

/**
 * Build a whole endpoint register — the ONLY construction route (C10 AC4/AC5).
 *
 * `node` ALONE decides the register's presence, and its guard is a RUNTIME one,
 * not merely the TypeScript signature: endpoints arrive from `.canvas` JSON,
 * from Obsidian's untyped private canvas view and from remote peers, so every
 * real call site is one `any` away from handing in `undefined`. An endpoint
 * with no node is not an endpoint at all — that is refused loudly here instead
 * of being stored and discovered later as an arrow attached to nothing.
 *
 * `side` and `end` are OPTIONAL (C10 AC5). `fromSide`/`toSide` are optional in
 * the JSON Canvas format, so refusing a side-less endpoint would make a legal,
 * fully-connected edge unrepresentable — and, downstream, deletable from the
 * user's own file. Absent means the key is omitted from the stored value
 * entirely; `""`, `null` and `undefined` are all absences, never stored.
 *
 * This does NOT weaken AC4: the result is still ONE value, written whole, and
 * there is still no route that populates one component of an existing register.
 *
 * The result is frozen — see {@link EndpointRegister}.
 */
export function encodeEndpoint(node: string, side?: string, end?: string): EndpointRegister {
  if (!isNonEmptyString(node)) {
    throw new TypeError(
      `canvas endpoint register: 'node' must be a non-empty string, got ${describeValue(node)}`,
    );
  }
  const normalisedSide = normaliseComponent("side", side);
  const normalisedEnd = normaliseComponent("end", end);

  const register: { node: string; side?: string; end?: string } = { node };
  if (normalisedSide !== undefined) register.side = normalisedSide;
  if (normalisedEnd !== undefined) register.end = normalisedEnd;
  return Object.freeze(register);
}

/**
 * Doc → the endpoint's components, as a plain mutable object.
 *
 * `side` and `end` are omitted from the result when the register has none, so
 * `"end" in decodeEndpoint(...)` answers "did the file have an arrowhead?"
 * rather than "is the value undefined?" — and likewise `"side" in ...` answers
 * "did the file name a side?" (C10 AC5).
 */
export function decodeEndpoint(endpoint: EndpointRegister): FileEndpoint {
  const decoded: FileEndpoint = { node: endpoint.node };
  if (isNonEmptyString(endpoint.side)) decoded.side = endpoint.side;
  if (isNonEmptyString(endpoint.end)) decoded.end = endpoint.end;
  return decoded;
}

/**
 * Doc → file: one register becomes the flat, slot-prefixed `.canvas` keys, so
 * a serialiser can spread the result straight into an edge record.
 * `fromSide` / `toSide` and `fromEnd` / `toEnd` appear ONLY when the register
 * carries that component — a side-less endpoint round-trips as the `*Side` key
 * being absent, never `null` and never `""` (C10 AC5).
 */
export function decodeEndpointToFile<S extends EndpointSlot>(
  slot: S,
  endpoint: EndpointRegister,
): EndpointFileFields<S> {
  const keys = ENDPOINT_FILE_KEYS[slot];
  const fields: Record<string, string> = {
    [keys.node]: endpoint.node,
  };
  if (isNonEmptyString(endpoint.side)) fields[keys.side] = endpoint.side;
  if (isNonEmptyString(endpoint.end)) fields[keys.end] = endpoint.end;
  return fields as EndpointFileFields<S>;
}

/**
 * File → doc: read one slot's flat keys off a `.canvas` edge record and build
 * the composite register, or `undefined` when the file does not carry a whole
 * endpoint.
 *
 * This is a READ boundary — a hand-edited file, a V1 doc or a buggy peer shows
 * up here — so a missing or malformed `node` yields "absent", never a throw and
 * never a register without an attachment point.
 *
 * The `*Node` key ALONE decides whether a register is built (C10 AC5): the
 * `.canvas` format makes `fromSide`/`toSide` optional, so `{fromNode: "n1"}` is
 * a whole, legal endpoint and reading it as absent is how a fully-connected
 * edge went missing from the user's file. `*Side` and `*End` are taken only
 * when present and non-empty; a malformed one is dropped rather than voiding
 * the whole endpoint, because the attachment point is still fully known and
 * only the decoration is not.
 */
export function encodeEndpointFromFile(
  slot: EndpointSlot,
  source: Readonly<Record<string, unknown>>,
): EndpointRegister | undefined {
  const keys = ENDPOINT_FILE_KEYS[slot];
  const node = source[keys.node];
  if (!isNonEmptyString(node)) return undefined;
  const side = source[keys.side];
  const end = source[keys.end];
  return encodeEndpoint(
    node,
    isNonEmptyString(side) ? side : undefined,
    isNonEmptyString(end) ? end : undefined,
  );
}

/**
 * Is this arbitrary doc value a well-formed endpoint register?
 *
 * PRESENCE IS DECIDED BY `node` ALONE (C10 AC5). `side` and `end` are optional
 * components of the one value, so `{node: "n1"}` is a whole register — a
 * legal, side-less JSON Canvas endpoint — and reading it as absent is precisely
 * the defect this predicate had: a fully-connected edge reported as dangling,
 * refused at ingest, and then written out of the user's `.canvas` file.
 *
 * Optional-WHEN-PRESENT, though, not optional-and-anything: `""`/`null` are
 * absences and tolerated, but a component present with the WRONG TYPE means the
 * value did not come from this module's API and the whole register is ABSENT,
 * not partial — half-reading is how the torn endpoint this component locked out
 * gets back in through the read door. A value with no `node`, or a non-string
 * `node`, is not a register at all.
 */
export function isEndpointRegister(value: unknown): value is EndpointRegister {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as { node?: unknown; side?: unknown; end?: unknown };
  if (!isNonEmptyString(candidate.node)) return false;
  return isOptionalComponent(candidate.side) && isOptionalComponent(candidate.end);
}

/**
 * An optional endpoint component is well-formed when it is absent (`undefined`,
 * `null` or `""`) or a string. Anything else — a number, an object, an array,
 * a boolean — is a wrong-typed component, and makes the whole register absent.
 */
function isOptionalComponent(value: unknown): boolean {
  return isAbsentComponent(value) || typeof value === "string";
}

/** Narrow an arbitrary doc value to an endpoint register, or `undefined`. */
export function asEndpointRegister(value: unknown): EndpointRegister | undefined {
  return isEndpointRegister(value) ? value : undefined;
}

/**
 * Whole-value equality for two endpoint registers.
 *
 * Since the endpoint is atomic, "equal" is a property of the WHOLE triple —
 * there is deliberately no per-component comparison in this module's API, for
 * the same reason there is no per-coordinate one in PART B.
 */
export function endpointEquals(a: EndpointRegister, b: EndpointRegister): boolean {
  return a === b || (a.node === b.node && a.side === b.side && a.end === b.end);
}

/** Read one slot's endpoint register from a record, or `undefined`. */
export function readEndpoint(
  record: V2RecordMap,
  slot: EndpointSlot,
): EndpointRegister | undefined {
  return asEndpointRegister(record.get(slot));
}

/** Read the `from` endpoint register, or `undefined` when absent / malformed. */
export function readFrom(record: V2RecordMap): EndpointRegister | undefined {
  return readEndpoint(record, FROM_KEY);
}

/** Read the `to` endpoint register, or `undefined` when absent / malformed. */
export function readTo(record: V2RecordMap): EndpointRegister | undefined {
  return readEndpoint(record, TO_KEY);
}

/**
 * Read the whole `from` register, or `undefined`.
 *
 * Explicit `*Register` spelling, symmetric with {@link writeFromRegister} and
 * with PART B's {@link readPosRegister} / {@link readSizeRegister}. A partially
 * populated stored value is read back as `undefined` (absent), never as a
 * partial object — wholeness is enforced on the way OUT as well as on the way
 * in, so a value hand-written past this module's API cannot present itself as a
 * half-endpoint to a consumer (C10 AC4).
 */
export function readFromRegister(record: V2RecordMap): EndpointRegister | undefined {
  return readEndpoint(record, FROM_KEY);
}

/** Read the whole `to` register, or `undefined`. Same contract as {@link readFromRegister}. */
export function readToRegister(record: V2RecordMap): EndpointRegister | undefined {
  return readEndpoint(record, TO_KEY);
}

/**
 * Does this edge record have BOTH endpoints, wholly?
 *
 * The schema invariant "no endpoint-less edge" in one predicate, so WP14's
 * ingest validity core and WP23's fuzzer oracle ask the same question the same
 * way instead of each re-deriving it.
 *
 * "Has an endpoint" means `from.node` / `to.node` and nothing else (C10 AC5,
 * CONCEPT_V2 Teil 11) — `side` is not a conjunct. The two absences stay
 * distinguishable: a register that is ABSENT is a dangling edge and fails here;
 * a register that is PRESENT WITH NO SIDE is attached and passes.
 */
export function hasBothEndpoints(record: V2RecordMap): boolean {
  return readFrom(record) !== undefined && readTo(record) !== undefined;
}

/**
 * Write a whole endpoint register in ONE `set` — the single operation this
 * component exists for.
 *
 * One key, one value, one delta: concurrent re-routers race for the whole
 * `{node, side, end?}`, so the merged result is always one author's complete
 * endpoint. There is deliberately no `writeFromNode` / `writeFromSide` /
 * `writeFromEnd`, because offering one would reintroduce precisely the tearing
 * this makes unrepresentable (C10 AC4).
 */
export function writeEndpointRegister(
  record: V2RecordMap,
  slot: EndpointSlot,
  endpoint: EndpointRegister,
): void {
  record.set(slot, endpoint);
}

/** Write a whole `from` register. Same contract as {@link writeEndpointRegister}. */
export function writeFromRegister(record: V2RecordMap, endpoint: EndpointRegister): void {
  writeEndpointRegister(record, FROM_KEY, endpoint);
}

/** Write a whole `to` register. Same contract as {@link writeEndpointRegister}. */
export function writeToRegister(record: V2RecordMap, endpoint: EndpointRegister): void {
  writeEndpointRegister(record, TO_KEY, endpoint);
}

/**
 * Capture-side convenience: validate the components and store them as one
 * atomic `from` register. Throws via {@link encodeEndpoint} on an endpoint with
 * no `node`, so nothing is written at all in that case. `side` and `end` are
 * optional (C10 AC5) — omitting them writes a side-less endpoint, not a partial
 * one.
 */
export function writeFrom(record: V2RecordMap, node: string, side?: string, end?: string): void {
  writeFromRegister(record, encodeEndpoint(node, side, end));
}

/** Capture-side convenience for the `to` register. Same contract as {@link writeFrom}. */
export function writeTo(record: V2RecordMap, node: string, side?: string, end?: string): void {
  writeToRegister(record, encodeEndpoint(node, side, end));
}
