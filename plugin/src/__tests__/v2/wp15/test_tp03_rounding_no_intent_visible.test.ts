// WP15 AC2 — a save whose coordinate differs only in ROUNDING produces NO
// intent, because capture-side rounding (canvas-registers.ts's
// normalizeGeometryScalar, applied inside encodePos/encodeSize) happens
// before the value ever reaches the shadow's staleness comparison.
//
// The trap this pins: encodePos/encodeSize build a FROZEN, freshly allocated
// array on every call (freezePair). Two calls with fractional input that
// rounds to the identical integer pair produce two DIFFERENT array objects
// holding the SAME two numbers. If planIntentDiff's staleness rule (rule 2)
// still compares composite field values with `===` (reference equality,
// inherited from the V1 world where every field was a lone primitive), those
// two calls will never compare equal and a save that changed nothing will
// still read as intent — silently reintroducing the Symptom-2 cascade this
// whole initiative exists to stop (I6). The comparison must be VALUE
// equality for composite fields.

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

describe("WP15 AC2 — rounding-only differences produce zero intent", () => {
  it("pos: a fractional coordinate that rounds to the stored integer pair produces no upsert", () => {
    const shadow = createSurfaceShadow();
    // Shadow already holds the rounded register from an earlier capture.
    advanceField(shadow, PATH, "node", "card", "pos", encodePos(100, 200) as any);

    // A fresh save re-encodes a fractional coordinate that rounds to the SAME
    // pixel pair. encodePos allocates a brand-new frozen array -- reference-
    // distinct from the one already in the shadow, value-identical to it.
    const restated = encodePos(100.3, 199.6); // rounds to [100, 200]
    expect(restated).not.toBe(encodePos(100, 200)); // sanity: genuinely different instances

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "card", fields: { pos: restated as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["card"]));

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([
      { path: PATH, kind: "node", id: "card", field: "pos", value: [100, 200], reason: "equals-shadow" },
    ]);
  });

  it("size: a fractional dimension that rounds to the stored integer pair produces no upsert", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "card", "size", encodeSize(260, 60) as any);

    const restated = encodeSize(260.49, 60.4); // rounds to [260, 60]

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "card", fields: { size: restated as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["card"]));

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toHaveLength(1);
    expect(plan.discarded[0].reason).toBe("equals-shadow");
  });

  it("a genuine sub-pixel-looking move that rounds to a DIFFERENT pixel still produces an upsert", () => {
    // Discrimination: prove the fix does not swallow real intent along with
    // the false positive. 100 -> 100, but 100.6 -> 101: a different pixel.
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "card", "pos", encodePos(100, 200) as any);

    const moved = encodePos(100.6, 200); // rounds to [101, 200]

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "card", fields: { pos: moved as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, openSurface(["card"]));

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "card", field: "pos", value: [101, 200] },
    ]);
    expect(plan.discarded).toEqual([]);
  });
});
