// WP3 / P0 — the CANONICAL FORM CORE, extracted as a PURE module.
//
// Why it exists: two clients converge to the same doc state, but the order in
// which a Y.Map iterates its entries — and the order in which a record's keys
// were inserted — is a function of the LOCAL integration history, not of the
// state. Serialising that raw traversal makes two peers write different bytes
// for the same truth, which is fatal in V2 because byte equality is the echo
// breaker (BUILD_SPEC D9): every write echoes back as a "change" nobody made.
//
// The canonical form erases that difference in three independent dimensions:
//
//   ├── RECORD order  → ascending by `id`, compared by UTF-16 code unit. P1's
//   │                   fractional index (`ord`, WP17) does not exist yet, so the
//   │                   id is the only order information both peers provably
//   │                   share. Never `localeCompare` — a collator's answer
//   │                   depends on the host's ICU data and locale, so two peers
//   │                   on different machines would disagree and no unit test on
//   │                   a single machine would ever show it.
//   ├── KEY order     → the file schema's order first, then unknown/future keys
//   │                   appended in UTF-16 code-unit order. Canonicalisation is a
//   │                   REORDERING and nothing else: an unknown key is never
//   │                   dropped, or the next disk write deletes user data on
//   │                   every peer.
//   └── NUMBER text   → whatever `JSON.stringify` emits, which is exactly
//                       Obsidian's format (integral values without a decimal
//                       tail, `-0` written as `0`, no exponent notation for the
//                       magnitudes a canvas uses).
//
// Rounding is deliberately NOT part of serialisation. `roundCanvasGeometry` is
// the CAPTURE-side helper (BUILD_SPEC §4.4): geometry is rounded BEFORE the
// register write, so a rounded value can never reach a peer as a delta that
// reads like user intent. A genuinely fractional value already in the doc is
// written to disk faithfully.
//
// Purity contract (BUILD_SPEC §3, D12): this module imports NOTHING — no
// editor host, no filesystem, no clock, no randomness. The precedent is
// `reconcile-plan.ts`. It therefore keeps its own private mirror of the four
// geometry keys, exactly like `RECONCILE_GEOMETRY_KEYS`; the drift guard that
// keeps that copy honest lives in the WP3 test suite.

/** One `.canvas` node or edge, as it appears on disk / in the CRDT. */
export type CanvasRecord = Record<string, unknown>;

/** Which schema a record is canonicalised against. */
export type CanvasRecordKind = "node" | "edge";

/** A `.canvas` snapshot in the shape `buildCanvasData()` returns. */
export interface CanvasRecordSets {
  nodes: readonly CanvasRecord[];
  edges: readonly CanvasRecord[];
}

/** The same snapshot after canonicalisation: new arrays of new records. */
export interface CanonicalCanvasData {
  nodes: CanvasRecord[];
  edges: CanvasRecord[];
}

/**
 * Obsidian's own node key order (BUILD_SPEC §4.4). Every P0 `.canvas` node field
 * appears exactly once; no P1 field (`ord`, `pos`, `size`, `schemaVersion`) may
 * ever be added here — P0 has no such field on disk.
 */
export const CANONICAL_NODE_KEY_ORDER: readonly string[] = [
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "color",
  "file",
  "subpath",
  "url",
  "text",
  "label",
  "background",
  "backgroundStyle",
];

/** Obsidian's own edge key order (BUILD_SPEC §4.4). Same no-P1-field rule. */
export const CANONICAL_EDGE_KEY_ORDER: readonly string[] = [
  "id",
  "fromNode",
  "fromSide",
  "fromEnd",
  "toNode",
  "toSide",
  "toEnd",
  "color",
  "label",
];

/**
 * The four keys that describe WHERE a card sits, and the only keys the
 * capture-side rounding helper touches.
 *
 * Deliberately a module-private mirror of `GEOMETRY_KEYS`
 * (`src/files/canvas-sync.ts`) so this module stays a zero-import pure core —
 * the same arrangement as `RECONCILE_GEOMETRY_KEYS` in `reconcile-plan.ts`. The
 * drift guard asserting the two sets are identical lives in the WP3 tests;
 * membership is an ESCALATE-level invariant (BUILD_SPEC §3.1 S2).
 */
export const CANONICAL_GEOMETRY_KEYS: ReadonlySet<string> = new Set([
  "x",
  "y",
  "width",
  "height",
]);

const NODE_KEY_SET: ReadonlySet<string> = new Set(CANONICAL_NODE_KEY_ORDER);
const EDGE_KEY_SET: ReadonlySet<string> = new Set(CANONICAL_EDGE_KEY_ORDER);

/**
 * UTF-16 code-unit comparison — the same total order `Array.prototype.sort()`
 * uses by default, made explicit so nobody "improves" it into a locale collator
 * later. Host- and locale-independent by construction.
 */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const hasOwn = (record: CanvasRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/**
 * Reorder one record's keys into the canonical order for its kind.
 *
 * Returns a NEW plain object; the input is never mutated. Known keys come first
 * in schema order, then every remaining own key sorted by UTF-16 code unit. A
 * key whose value is `undefined` is omitted (JSON has no such value); every
 * other value — `null`, `0`, `false`, `""`, objects, arrays — is passed through
 * by identity. No key is added, removed, coerced or rounded.
 *
 * `kind` selects the schema, so the same record canonicalised as an edge moves
 * `type` into the unknown tail, and as a node moves `fromNode` / `toNode` there.
 */
export function canonicalizeRecord(record: CanvasRecord, kind: CanvasRecordKind): CanvasRecord {
  const order = kind === "edge" ? CANONICAL_EDGE_KEY_ORDER : CANONICAL_NODE_KEY_ORDER;
  const known = kind === "edge" ? EDGE_KEY_SET : NODE_KEY_SET;
  const out: CanvasRecord = {};

  for (const key of order) {
    if (!hasOwn(record, key)) continue;
    const value = record[key];
    if (value === undefined) continue;
    out[key] = value;
  }

  const unknownKeys: string[] = [];
  for (const key of Object.keys(record)) {
    if (known.has(key)) continue;
    if (record[key] === undefined) continue;
    unknownKeys.push(key);
  }
  unknownKeys.sort(compareCodeUnits);
  for (const key of unknownKeys) {
    out[key] = record[key];
  }

  return out;
}

/**
 * CAPTURE-side geometry rounding (BUILD_SPEC §4.4, AC3): map `x`/`y`/`width`/
 * `height` to whole pixels BEFORE the register write.
 *
 * Returns a NEW object preserving the input's own key order; the input is never
 * mutated. Only a FINITE number under one of the four geometry keys is rounded
 * (with `-0` normalised to `0`, since a peer that produced `+0` must serialise
 * identically); a string, `null`, `NaN`, `Infinity` or boolean is copied through
 * untouched, as is every non-geometry key. Absent keys stay absent, and
 * key-name matching is exact — `xx`, `x2`, `X`, `heights`, `maxWidth` are not
 * geometry.
 *
 * Idempotent: rounding a rounded record changes nothing, which is what makes it
 * safe to call at every capture boundary without coordination.
 */
export function roundCanvasGeometry(record: CanvasRecord): CanvasRecord {
  const out: CanvasRecord = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (CANONICAL_GEOMETRY_KEYS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      const rounded = Math.round(value);
      out[key] = rounded === 0 ? 0 : rounded;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Canonicalise a whole snapshot: every node against the node schema, every edge
 * against the edge schema, both arrays sorted ascending by id in UTF-16
 * code-unit order.
 *
 * The sort key is `String(record.id ?? "")`, so a record without an id sorts
 * first instead of throwing, and the sort is STABLE (equal ids keep their input
 * order). Returns new arrays of new records — the caller's snapshot is never
 * mutated. Does NOT round geometry (that is capture-side, AC3) and does not
 * prune or de-duplicate (pruning belongs to the seam that owns it).
 */
export function canonicalizeCanvasData(data: CanvasRecordSets): CanonicalCanvasData {
  return {
    nodes: canonicalizeRecords(data.nodes, "node"),
    edges: canonicalizeRecords(data.edges, "edge"),
  };
}

function canonicalizeRecords(
  records: readonly CanvasRecord[],
  kind: CanvasRecordKind,
): CanvasRecord[] {
  // Decorate with the input index so the sort is stable regardless of the
  // engine's sort implementation, and sort the SORT KEYS rather than re-reading
  // `id` inside the comparator.
  const decorated = records.map((record, index) => ({
    key: String(record.id ?? ""),
    index,
    record: canonicalizeRecord(record, kind),
  }));
  decorated.sort((a, b) => compareCodeUnits(a.key, b.key) || a.index - b.index);
  return decorated.map((entry) => entry.record);
}

/**
 * The canonical `.canvas` document text: one top-level object with `nodes`
 * before `edges`, tab-indented, `\n` line endings, NO trailing newline and no
 * BOM — byte-for-byte the shape `serializeCanvas` has always produced, now
 * order-independent.
 */
export function serializeCanonicalCanvas(data: CanvasRecordSets): string {
  return JSON.stringify(canonicalizeCanvasData(data), null, "\t");
}
