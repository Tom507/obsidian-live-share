// WP15 AC1 — the highest-value assertion in this WP (I8): a change to ONE
// COMPONENT of a composite register marks the WHOLE register as intent, not
// just the changed component. With pos/size/from/to stored atomically
// (test_tp01), the staleness diff in planIntentDiff never sees "x" or "y" —
// it only ever sees "pos" as one opaque value. A save that moves a card's x
// but leaves its y untouched must therefore produce exactly ONE upsert for
// field "pos", and that upsert's value must carry BOTH components (the new x
// together with the unchanged y) — never a partial patch, never a second,
// component-shaped intent.

import { describe, expect, it } from "vitest";

import {
  advanceField,
  createSurfaceShadow,
  planIntentDiff,
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
} from "../../../canvas/canvas-shadow";
import { encodePos, encodeSize } from "../../../canvas/canvas-registers";

const PATH = "Vault/Board.canvas";
const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

function openSurface(nodeIds: string[]): SurfaceState {
  return { viewOpen: true, handedToView: { node: new Set(nodeIds), edge: new Set() } };
}

describe("WP15 AC1 — one changed component of a composite marks the WHOLE register as intent", () => {
  it("pos: x moves, y is unchanged -> exactly one upsert for 'pos' carrying [newX, sameY]", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "card", "pos", encodePos(10, 20) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "card", fields: { pos: encodePos(15, 20) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["card"]));

    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].field).toBe("pos");
    expect(plan.upserts[0].value).toEqual([15, 20]);
    // No second, component-shaped intent leaks through.
    expect(plan.upserts.some((u) => u.field === "x" || u.field === "y")).toBe(false);
  });

  it("size: height moves, width is unchanged -> exactly one upsert for 'size' carrying [sameWidth, newHeight]", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "card", "size", encodeSize(260, 60) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "card", fields: { size: encodeSize(260, 90) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["card"]));

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "card", field: "size", value: [260, 90] },
    ]);
  });

  it("a component that is unchanged never contributes its own discard entry", () => {
    // If the module ever regressed into per-component tracking, the unchanged
    // "y" would show up as its own discarded-stale entry. It must not exist
    // as a field at all -- there is only ever "pos".
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "card", "pos", encodePos(1, 1) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "card", fields: { pos: encodePos(2, 1) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["card"]));

    expect(plan.discarded).toEqual([]);
    expect(plan.upserts).toHaveLength(1);
  });
});
