// WP2 / DoD — rule precedence, and the plan's blast radius.
//
// Angle of attack: with four rules there are overlaps, and the DoD only holds if
// the overlaps resolve the same way every time. This file pins the three that
// actually occur in production, using ONE id (`x`) that plays a different role in
// each id space so a kind-blind classifier collapses them:
//
//   1. tombstoned AND present in the save          → rule 4 wins: nothing at all.
//   2. tombstoned AND missing from the save        → rule 3 applies unchanged:
//      the block guards resurrection, not deletion, so a receipted absence is
//      still a delete intent (re-asserting an existing tombstone converges).
//   3. never observed AND present in the save AND receipted → rule 2 only: a
//      brand-new record is upserts, never a delete.
//
// Second attack — blast radius: the shadow also holds a second, unrelated path
// with the same record ids. Nothing from that path may appear in the plan, and
// every entry the plan does contain must name the save's path.

import { describe, expect, it } from "vitest";

import {
  type IntentPlan,
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  markRecordAbsent,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "notes/Fall-Studie (v2).canvas";
const OTHER = "notes/Fall-Studie (v1).canvas";

function buildShadow() {
  const shadow = createSurfaceShadow();

  // A whole second surface with the very same ids, inserted FIRST so that an
  // implementation which takes "the" path state instead of looking up
  // `save.path` reaches for this one.
  for (const id of ["x", "y", "z"]) {
    advanceRecord(shadow, OTHER, "node", id, { p: 111 });
    advanceRecord(shadow, OTHER, "edge", id, { p: 111 });
  }

  // node x  — tombstoned and still in the save (overlap 1)
  advanceRecord(shadow, PATH, "node", "x", { p: 1, q: 2 });
  // edge x  — tombstoned and gone from the save (overlap 2)
  advanceRecord(shadow, PATH, "edge", "x", { p: 1 });
  // node y  — plain staleness plus one real move
  advanceRecord(shadow, PATH, "node", "y", { p: 1, q: 2, r: 3 });
  // edge y  — gone from the save, receipted (plain rule 3)
  advanceRecord(shadow, PATH, "edge", "y", { p: 1 });
  // node z  — gone from the save, NOT receipted
  advanceRecord(shadow, PATH, "node", "z", { p: 1 });
  // edge z  — known-absent already
  advanceRecord(shadow, PATH, "edge", "z", { p: 1 });
  markRecordAbsent(shadow, PATH, "edge", "z");

  return shadow;
}

const SAVE: ParsedSave = {
  path: PATH,
  nodes: [
    { id: "x", fields: { p: 77, q: 88 } },
    { id: "y", fields: { p: 1, q: 42, r: 3 } },
    { id: "new", fields: { p: 5, q: 6 } },
  ],
  edges: [],
};

const TOMBSTONES: TombstoneView = { isDeleted: (_kind, id) => id === "x" };

const SURFACE: SurfaceState = {
  viewOpen: true,
  handedToView: { node: new Set(["x", "y", "new"]), edge: new Set(["x", "y", "z"]) },
};

function keys(plan: IntentPlan) {
  return {
    upserts: plan.upserts.map((i) => `${i.kind}:${i.id}.${i.field}`).sort(),
    deletes: plan.deletes.map((i) => `${i.kind}:${i.id}`).sort(),
    discarded: plan.discarded.map((e) => `${e.kind}:${e.id}.${e.field}`).sort(),
  };
}

describe("WP2 DoD — overlaps resolve identically every time", () => {
  it("tombstoned AND in the save → no entry in any category", () => {
    const result = keys(planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE));

    expect(result.upserts).not.toContain("node:x.p");
    expect(result.upserts).not.toContain("node:x.q");
    expect(result.discarded.some((key) => key.startsWith("node:x."))).toBe(false);
    expect(result.deletes).not.toContain("node:x");
  });

  it("tombstoned AND missing from the save → the delete rule still applies", () => {
    const result = keys(planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE));

    expect(result.deletes).toContain("edge:x");
  });

  it("never observed AND in the save → upserts only, never a delete", () => {
    const result = keys(planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE));

    expect(result.upserts).toContain("node:new.p");
    expect(result.upserts).toContain("node:new.q");
    expect(result.deletes).not.toContain("node:new");
  });

  it("the whole plan is exactly the expected three sets", () => {
    const result = keys(planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE));

    expect(result.upserts).toEqual(["node:new.p", "node:new.q", "node:y.q"]);
    expect(result.deletes).toEqual(["edge:x", "edge:y"]);
    expect(result.discarded).toEqual(["node:y.p", "node:y.r"]);
  });

  it("the second surface in the shadow contributes nothing", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    for (const entry of [...plan.upserts, ...plan.deletes, ...plan.discarded]) {
      expect(entry.path).toBe(PATH);
    }
  });

  it("an unreceipted missing record and an already-absent one stay silent", () => {
    const result = keys(planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE));

    expect(result.deletes).not.toContain("node:z");
    expect(result.deletes).not.toContain("edge:z");
  });

  it("empty categories are still arrays, not undefined", () => {
    const plan = planIntentDiff(
      createSurfaceShadow(),
      { path: PATH, nodes: [], edges: [] },
      TOMBSTONES,
      SURFACE,
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.discarded).toEqual([]);
    expect(Object.keys(plan).sort()).toEqual(["deletes", "discarded", "upserts"]);
  });

  it("the same call twice gives the same three sets", () => {
    const first = keys(planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE));
    const second = keys(planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE));

    expect(second).toEqual(first);
  });
});
