// WP2 / AC4 — what the block must NOT turn into.
//
// Angle of attack: AC4 removes a record from consideration. The two ways to get
// that wrong are both silent:
//   1. treating the blocked record as "not in the save", which converts a
//      resurrect attempt into a DELETE intent — the record then disappears for
//      every peer instead of merely not coming back;
//   2. treating the block as a filter on the output instead of on the input, so
//      the record still shows up as a discarded-staleness observation and lands
//      in WP4's debug signature as if the user had touched it.
// Both are asserted directly here, against a save in which the blocked record is
// the only content.
//
// A third attack: the tombstone view is an injected seam that must be consulted
// with the record's own kind and id and nothing else. The view used here throws
// on any unexpected argument shape, so a lookup keyed by path, by a composite
// string or by the wrong kind fails loudly instead of silently returning false.

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type ShadowRecordKind,
  type SurfaceState,
  type TombstoneView,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "z/final.canvas";

const OPEN: SurfaceState = {
  viewOpen: true,
  handedToView: { node: new Set(["ghost", "solo", "keeper"]), edge: new Set(["ghost", "solo"]) },
};

/** Rejects anything that is not a plain (kind, id) lookup. */
function strictView(deleted: ReadonlySet<string>): TombstoneView {
  return {
    isDeleted: (kind: ShadowRecordKind, id: string) => {
      if (kind !== "node" && kind !== "edge") throw new Error(`bad kind: ${String(kind)}`);
      if (typeof id !== "string") throw new Error(`bad id: ${String(id)}`);
      return deleted.has(`${kind}:${id}`);
    },
  };
}

describe("WP2 AC4 — a blocked record is removed from consideration, not deleted", () => {
  it("never turns a blocked record into a delete intent", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "solo", { x: 1, y: 2 });

    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [{ id: "solo", fields: { x: 5, y: 6 } }], edges: [] },
      strictView(new Set(["node:solo"])),
      OPEN,
    );

    expect(plan.deletes).toEqual([]);
    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });

  it("a blocked record is not reported as staleness either", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "edge", "solo", { fromNode: "a", toNode: "b", color: "2" });

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [],
        // Two fields identical to the shadow, one changed.
        edges: [{ id: "solo", fields: { fromNode: "a", toNode: "b", color: "9" } }],
      },
      strictView(new Set(["edge:solo"])),
      OPEN,
    );

    expect(plan.discarded).toEqual([]);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("is consulted with the record's own kind — a node tombstone never blocks an edge", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "ghost", "x", 1);
    advanceField(shadow, PATH, "edge", "ghost", "fromNode", "n");

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [{ id: "ghost", fields: { x: 2 } }],
        edges: [{ id: "ghost", fields: { fromNode: "m" } }],
      },
      strictView(new Set(["edge:ghost"])),
      OPEN,
    );

    expect(plan.upserts).toEqual([{ path: PATH, kind: "node", id: "ghost", field: "x", value: 2 }]);
  });

  it("blocks a record whose id is a prototype member name", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "__proto__", "x", 1);
    advanceField(shadow, PATH, "node", "constructor", "x", 1);

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [
          { id: "__proto__", fields: { x: 2 } },
          { id: "constructor", fields: { x: 2 } },
        ],
        edges: [],
      },
      strictView(new Set(["node:__proto__"])),
      { viewOpen: true, handedToView: { node: new Set(["__proto__", "constructor"]), edge: new Set() } },
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "constructor", field: "x", value: 2 },
    ]);
  });

  it("a blocked record does not shield its neighbours from the delete rule", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "solo", "x", 1);
    advanceField(shadow, PATH, "node", "keeper", "x", 1);

    const save: ParsedSave = { path: PATH, nodes: [{ id: "solo", fields: { x: 1 } }], edges: [] };
    const plan = planIntentDiff(shadow, save, strictView(new Set(["node:solo"])), OPEN);

    // "keeper" is missing from the save, present in the shadow, open + receipted.
    expect(plan.deletes).toEqual([{ path: PATH, kind: "node", id: "keeper" }]);
    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });

  it("a view that blocks everything still leaves the plan well-formed", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "solo", "x", 1);

    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [{ id: "solo", fields: { x: 3 } }], edges: [] },
      strictView(new Set(["node:solo", "node:keeper", "edge:solo"])),
      OPEN,
    );

    expect(Object.keys(plan).sort()).toEqual(["deletes", "discarded", "upserts"]);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });
});
