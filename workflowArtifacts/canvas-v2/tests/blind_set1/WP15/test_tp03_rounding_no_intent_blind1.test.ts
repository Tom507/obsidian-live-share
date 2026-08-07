// WP15 AC2 — same guarantee as the visible test, attacked from a different
// angle: negative coordinates (where rounding direction is easy to get
// backwards) and a batch of several records restated with rounding-only
// noise in the same planIntentDiff call, mixed with one record that carries
// a genuine change, to prove the fix does not over-suppress.

import { describe, expect, it } from "vitest";

import {
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
} from "../../../canvas/canvas-shadow";
import { encodePos, encodeSize } from "../../../canvas/canvas-registers";

const PATH = "Boards/Retro.canvas";
const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

const SURFACE: SurfaceState = {
  viewOpen: true,
  handedToView: { node: new Set(["a", "b", "c"]), edge: new Set() },
};

describe("WP15 AC2 — rounding-only noise across several records in one pass", () => {
  it("negative coordinates that round to the stored pixel produce no intent", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "a", { pos: encodePos(-10, -20) as any });

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "a", fields: { pos: encodePos(-9.6, -20.4) as any } }], // rounds to [-10, -20]
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, SURFACE);

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([
      { path: PATH, kind: "node", id: "a", field: "pos", value: [-10, -20], reason: "equals-shadow" },
    ]);
  });

  it("a batch of three: two rounding-only restatements and one real move -> exactly one upsert", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "a", { pos: encodePos(1, 1) as any });
    advanceRecord(shadow, PATH, "node", "b", { size: encodeSize(50, 50) as any });
    advanceRecord(shadow, PATH, "node", "c", { pos: encodePos(9, 9) as any });

    const save: ParsedSave = {
      path: PATH,
      nodes: [
        { id: "a", fields: { pos: encodePos(1.49, 0.6) as any } }, // rounds to [1, 1] -- stale
        { id: "b", fields: { size: encodeSize(49.6, 50.4) as any } }, // rounds to [50, 50] -- stale
        { id: "c", fields: { pos: encodePos(15, 9) as any } }, // genuine move
      ],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, SURFACE);

    expect(plan.upserts).toEqual([{ path: PATH, kind: "node", id: "c", field: "pos", value: [15, 9] }]);
    expect(plan.discarded).toHaveLength(2);
    expect(plan.discarded.every((entry) => entry.reason === "equals-shadow")).toBe(true);
  });
});
