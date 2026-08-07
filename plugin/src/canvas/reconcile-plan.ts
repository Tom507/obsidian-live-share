// WP5 / US3 — the live-canvas reconcile classifier, extracted as a PURE module.
//
// Why it exists: before this module `main.ts::reconcileLiveCanvas` decided
// "structural" from the id-set difference ALONE, and its non-structural branch
// applied x/y/width/height only. A remote change to a card's `text` / `color` /
// `type` or an edge's `fromSide` / `toSide` / `label` therefore never reached an
// OPEN canvas view: Obsidian's model kept the stale values, its own
// `requestSave()` serialised the whole drifted model, and `handleLocalModify`
// pushed those stale values back — reverting the peer who made the change.
//
// The fix is to classify against the data we LAST APPLIED to that view (the
// per-path shadow `main.ts` keeps), not against the live id sets alone:
//
//   ├── "structural" → full `reloadCanvasData` (the only way a non-geometry field
//   │                  or a membership change can reach the live view)
//   ├── "geometry"   → per-node `moveAndResize` (US3 AC6: the smooth drag path
//   │                  must NOT become a full setData on every mouse move)
//   └── "noop"       → nothing changed; make no mutating adapter call at all
//
// Purity contract (US3 AC2/AC3): same inputs → same output. No clock, no DOM, no
// Obsidian import, no adapter read — every fact it needs is an argument, so it is
// unit-testable in isolation (`src/__tests__/reconcile-plan.test.ts`).

/** The three ways the live view can be brought back in line with shared truth. */
export type ReconcilePlan = "structural" | "geometry" | "noop";

/** A `.canvas` snapshot in the shape `buildCanvasData()` / `getCanvasSnapshot()` return. */
export interface CanvasRecords {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

export interface ReconcilePlanInput {
  /** Shared truth we want the live view to show. */
  desired: CanvasRecords;
  /** What we last successfully APPLIED to this view; null before the first apply. */
  lastApplied: CanvasRecords | null;
  /** Ids currently present in the live view (`adapter.getLiveNodeIds()`). */
  liveNodeIds: ReadonlySet<string>;
  /** Ids currently present in the live view (`adapter.getLiveEdgeIds()`). */
  liveEdgeIds: ReadonlySet<string>;
  /** Freshly mounted / authoritative rollback: force a full reload (US3 AC8). */
  initial?: boolean;
}

/**
 * The only keys whose change can be applied per-node without a full reload, and
 * NODES only — an edge has no geometry, so any edge difference is structural.
 *
 * Deliberately a module-private mirror of `GEOMETRY_KEYS`
 * (`src/files/canvas-sync.ts`) so this module stays free of the Obsidian import
 * chain (US3 AC2). `canvas-model-bridge.ts:94` keeps its own copy for the same
 * reason. The drift guard lives in `canvas-sync.test.ts` (US3 AC10), which
 * asserts the two sets are identical.
 */
export const RECONCILE_GEOMETRY_KEYS: ReadonlySet<string> = new Set([
  "x",
  "y",
  "width",
  "height",
]);

/** Ids of every record carrying a usable string id; mangled records are skipped. */
export function canvasIds(records: ReadonlyArray<Record<string, unknown>>): Set<string> {
  const out = new Set<string>();
  for (const record of records) {
    const id = record.id;
    if (typeof id === "string" && id.length > 0) out.add(id);
  }
  return out;
}

/**
 * Detached shallow copy, for storing a snapshot as the "last applied" shadow.
 *
 * The same record objects are handed to Obsidian's private `setData` during a
 * structural reload; Obsidian may retain them in its own model. Copying first
 * means the shadow can never silently follow a later in-place mutation of the
 * live model and start claiming we applied something we did not. Values in a
 * `.canvas` record are primitives, so one level is exact.
 */
export function cloneCanvasRecords(data: CanvasRecords): CanvasRecords {
  return {
    nodes: data.nodes.map((node) => ({ ...node })),
    edges: data.edges.map((edge) => ({ ...edge })),
  };
}

function sameStringSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Index by id, or null when any record lacks a usable id — an unidentifiable
 * record can never be matched against the shadow, so the caller must fall back
 * to a full reload rather than silently treat it as somebody else's move.
 */
function indexById(
  records: ReadonlyArray<Record<string, unknown>>,
): Map<string, Record<string, unknown>> | null {
  const out = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const id = record.id;
    if (typeof id !== "string" || id.length === 0) return null;
    out.set(id, record);
  }
  return out;
}

type RecordsDiff = "same" | "geometry" | "structural";

/**
 * Compare one record collection against the last-applied one.
 *
 * `"geometry"` is reserved for NODE x/y/width/height moves between two numbers.
 * A geometry key that appears or disappears, or turns non-numeric, is structural:
 * the per-node path requires all four as numbers and would silently skip the
 * node, leaving the view stale.
 */
function diffRecords(
  desired: ReadonlyArray<Record<string, unknown>>,
  lastApplied: ReadonlyArray<Record<string, unknown>>,
  kind: "node" | "edge",
): RecordsDiff {
  const next = indexById(desired);
  const prev = indexById(lastApplied);
  if (!next || !prev) return "structural";
  if (next.size !== prev.size) return "structural";

  let geometry = false;
  for (const [id, nextRecord] of next) {
    const prevRecord = prev.get(id);
    if (!prevRecord) return "structural";
    const keys = new Set<string>([...Object.keys(nextRecord), ...Object.keys(prevRecord)]);
    for (const key of keys) {
      const a = nextRecord[key];
      const b = prevRecord[key];
      if (a === b) continue;
      if (
        kind === "node" &&
        RECONCILE_GEOMETRY_KEYS.has(key) &&
        typeof a === "number" &&
        typeof b === "number"
      ) {
        geometry = true;
        continue;
      }
      return "structural";
    }
  }
  return geometry ? "geometry" : "same";
}

/**
 * Classify what the live canvas view needs (US3 AC1/AC3-AC8).
 *
 * Order matters: `initial` wins, then a live-view membership difference (the
 * local view gained/lost a record the shared doc does not have), then the
 * shadow-relative field diff.
 */
export function planReconcile(input: ReconcilePlanInput): ReconcilePlan {
  // US3 AC8: an authoritative pass (fresh mount, loser-revert) always reloads —
  // the open view may hold a stale local file whose id sets happen to match.
  if (input.initial) return "structural";

  // Membership difference against the LIVE view: only a full reload can add or
  // remove a card/arrow, and this is also the HEAD behaviour we must preserve.
  if (!sameStringSet(canvasIds(input.desired.nodes), input.liveNodeIds)) return "structural";
  if (!sameStringSet(canvasIds(input.desired.edges), input.liveEdgeIds)) return "structural";

  // Nothing applied yet for this path: we cannot prove the difference is
  // geometry-only, so take the safe branch.
  if (!input.lastApplied) return "structural";

  const nodes = diffRecords(input.desired.nodes, input.lastApplied.nodes, "node");
  if (nodes === "structural") return "structural";
  // Any edge field difference (fromSide/toSide/label/color/endpoints) needs the
  // reload — per-node geometry cannot re-route an arrow (US3 AC5).
  if (diffRecords(input.desired.edges, input.lastApplied.edges, "edge") !== "same") {
    return "structural";
  }
  return nodes === "geometry" ? "geometry" : "noop";
}
