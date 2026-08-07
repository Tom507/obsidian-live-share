// WP15 AC1 — same guarantee as the visible test, third angle: BOTH
// components change simultaneously (not just one), which must still collapse
// to a single upsert (never two), and an endpoint's optional "end" component
// appearing where it was previously absent is still one whole-register
// upsert for "to".

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

const PATH = "Vault/Kanban.canvas";
const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

function openSurface(nodeIds: string[], edgeIds: string[] = []): SurfaceState {
  return { viewOpen: true, handedToView: { node: new Set(nodeIds), edge: new Set(edgeIds) } };
}

describe("WP15 AC1 — even a simultaneous two-component change is still exactly one upsert", () => {
  it("pos: both x and y move at once -> still exactly one upsert for 'pos'", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "note", "pos", encodePos(0, 0) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "note", fields: { pos: encodePos(500, 500) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["note"]));

    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].value).toEqual([500, 500]);
  });

  it("size: both width and height move at once -> still exactly one upsert for 'size'", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "note", "size", encodeSize(20, 20) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "note", fields: { size: encodeSize(300, 5) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["note"]));

    expect(plan.upserts).toEqual([{ path: PATH, kind: "node", id: "note", field: "size", value: [300, 5] }]);
  });

  it("to: an 'end' marker newly appears alongside an unchanged node/side -> one upsert for the whole endpoint", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "edge", "e-1", "to", encodeEndpoint("target", "left") as any);

    const save: ParsedSave = {
      path: PATH,
      edges: [{ id: "e-1", fields: { to: encodeEndpoint("target", "left", "arrow") as any } }],
      nodes: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface([], ["e-1"]));

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "edge", id: "e-1", field: "to", value: { node: "target", side: "left", end: "arrow" } },
    ]);
  });
});
