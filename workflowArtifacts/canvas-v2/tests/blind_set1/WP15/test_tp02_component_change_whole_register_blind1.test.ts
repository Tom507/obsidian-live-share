// WP15 AC1 — same guarantee as the visible test, attacked from a different
// angle: the CHANGED component is the other axis (y, not x; width, not
// height), and one case exercises the endpoint register's "side" component
// on an edge. Different ids and values from the visible test.

import { describe, expect, it } from "vitest";

import {
  advanceField,
  createSurfaceShadow,
  planIntentDiff,
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
} from "../../../canvas/canvas-shadow";
import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";

const PATH = "Boards/Retro.canvas";
const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

function openSurface(nodeIds: string[], edgeIds: string[] = []): SurfaceState {
  return { viewOpen: true, handedToView: { node: new Set(nodeIds), edge: new Set(edgeIds) } };
}

describe("WP15 AC1 — a single-component change always carries the whole register", () => {
  it("pos: y moves, x is unchanged -> one upsert for 'pos' carrying [sameX, newY]", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "sticky", "pos", encodePos(40, 40) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "sticky", fields: { pos: encodePos(40, 400) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["sticky"]));

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "sticky", field: "pos", value: [40, 400] },
    ]);
  });

  it("size: width moves, height is unchanged -> one upsert for 'size' carrying [newWidth, sameHeight]", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "sticky", "size", encodeSize(100, 80) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "sticky", fields: { size: encodeSize(240, 80) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["sticky"]));

    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].value).toEqual([240, 80]);
  });

  it("from: only 'side' changes, 'node' is unchanged -> one upsert for 'from' carrying the whole endpoint", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "edge", "e9", "from", encodeEndpoint("sticky", "left") as any);

    const save: ParsedSave = {
      path: PATH,
      edges: [{ id: "e9", fields: { from: encodeEndpoint("sticky", "right") as any } }],
      nodes: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface([], ["e9"]));

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "edge", id: "e9", field: "from", value: { node: "sticky", side: "right" } },
    ]);
    expect(plan.discarded).toEqual([]);
  });
});
