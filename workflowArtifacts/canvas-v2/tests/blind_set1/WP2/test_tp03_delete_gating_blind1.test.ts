// WP2 / AC3 — the delete gate as an exhaustive truth table.
//
// Angle of attack: AC3 is a conjunction of three conditions —
//   (a) the record exists in the shadow as `present`,
//   (b) the view is open,
//   (c) the record was handed to the view in the last apply.
// A conjunction is the classic place to lose a term, and a single crafted
// example can only catch one of the three losses. This file therefore enumerates
// the full 3 x 2 x 2 product of (shadow state) x (viewOpen) x (handed) and states
// the expected verdict for each of the twelve cells. Exactly one cell may yield a
// delete intent; the other eleven must be silent.
//
// The record under test is an EDGE, and the surface state is built with the
// opposite kind populated as a decoy, so a kind-blind hand-over lookup shows up
// as a spurious delete.

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type ShadowRecordState,
  type SurfaceShadow,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  markRecordAbsent,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Team/Architektur.canvas";
const ID = "kante-42";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

/** The save always keeps one unrelated node, so it is never "an empty file". */
const SAVE: ParsedSave = {
  path: PATH,
  nodes: [{ id: "bleibt", fields: { x: 0, y: 0 } }],
  edges: [],
};

function shadowIn(state: ShadowRecordState): SurfaceShadow {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH, "node", "bleibt", { x: 0, y: 0 });
  if (state === "present") advanceRecord(shadow, PATH, "edge", ID, { fromNode: "a", toNode: "b" });
  if (state === "absent") {
    advanceRecord(shadow, PATH, "edge", ID, { fromNode: "a", toNode: "b" });
    markRecordAbsent(shadow, PATH, "edge", ID);
  }
  return shadow;
}

function surfaceFor(viewOpen: boolean, handed: boolean): SurfaceState {
  return {
    viewOpen,
    // The decoy: the same id is always in the NODE hand-over set.
    handedToView: { node: new Set(["bleibt", ID]), edge: new Set(handed ? [ID] : []) },
  };
}

const STATES: readonly ShadowRecordState[] = ["present", "absent", "unknown"];

describe("WP2 AC3 — the full delete truth table", () => {
  for (const state of STATES) {
    for (const viewOpen of [true, false]) {
      for (const handed of [true, false]) {
        const expected = state === "present" && viewOpen && handed ? 1 : 0;

        it(`shadow=${state} viewOpen=${viewOpen} handed=${handed} → ${expected} delete(s)`, () => {
          const plan = planIntentDiff(shadowIn(state), SAVE, NO_TOMBSTONES, surfaceFor(viewOpen, handed));

          expect(plan.deletes).toHaveLength(expected);
          if (expected === 1) {
            expect(plan.deletes[0]).toEqual({ path: PATH, kind: "edge", id: ID });
          }
          // The unrelated node is untouched in every cell.
          expect(plan.deletes.some((intent) => intent.id === "bleibt")).toBe(false);
        });
      }
    }
  }

  it("exactly one of the twelve cells produces a delete", () => {
    let deleting = 0;
    for (const state of STATES) {
      for (const viewOpen of [true, false]) {
        for (const handed of [true, false]) {
          const plan = planIntentDiff(shadowIn(state), SAVE, NO_TOMBSTONES, surfaceFor(viewOpen, handed));
          if (plan.deletes.length > 0) deleting += 1;
        }
      }
    }
    expect(deleting).toBe(1);
  });

  it("an emptied canvas deletes every proven record and nothing else", () => {
    const shadow = createSurfaceShadow();
    for (const id of ["a", "b", "c"]) advanceRecord(shadow, PATH, "node", id, { x: 1 });
    advanceRecord(shadow, PATH, "edge", "e", { fromNode: "a", toNode: "b" });
    // "d" was never observed on this surface at all.

    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [], edges: [] },
      NO_TOMBSTONES,
      {
        viewOpen: true,
        handedToView: { node: new Set(["a", "b", "c", "d"]), edge: new Set(["e"]) },
      },
    );

    expect(plan.deletes).toHaveLength(4);
    expect(plan.deletes.map((intent) => `${intent.kind}:${intent.id}`).sort()).toEqual([
      "edge:e",
      "node:a",
      "node:b",
      "node:c",
    ]);
    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });

  it("an emptied canvas with the view closed deletes nothing", () => {
    const shadow = createSurfaceShadow();
    for (const id of ["a", "b", "c"]) advanceRecord(shadow, PATH, "node", id, { x: 1 });

    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [], edges: [] },
      NO_TOMBSTONES,
      { viewOpen: false, handedToView: { node: new Set(["a", "b", "c"]), edge: new Set() } },
    );

    expect(plan.deletes).toEqual([]);
  });

  it("records of other paths in the shadow are never candidates", () => {
    const shadow = createSurfaceShadow();
    // The foreign paths are inserted FIRST, so an implementation that grabs
    // "the" path state instead of looking up `save.path` picks the wrong one.
    advanceRecord(shadow, "Team/Anderes.canvas", "node", "fremd", { x: 1 });
    advanceRecord(shadow, "Team/Drittes.canvas", "edge", "fremd", { fromNode: "q" });
    advanceRecord(shadow, PATH, "node", "bleibt", { x: 0, y: 0 });

    const plan = planIntentDiff(shadow, SAVE, NO_TOMBSTONES, {
      viewOpen: true,
      handedToView: { node: new Set(["bleibt", "fremd"]), edge: new Set(["fremd"]) },
    });

    expect(plan.deletes).toEqual([]);
  });
});
