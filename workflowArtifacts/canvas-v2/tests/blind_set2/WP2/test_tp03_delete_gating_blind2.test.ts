// WP2 / AC3 — the hand-over receipt is evidence, and evidence is per record.
//
// Angle of attack: the visible risk in AC3 is treating `surfaceState` as a global
// switch ("the view is open, so absences are deletes") instead of as a per-record
// receipt. This file therefore never uses a uniform surface: in every scenario
// some records are on the hand-over list and some are not, and the assertion is
// on the exact SET of deleted keys rather than on a count.
//
// Second attack: the same id living in both id spaces, and a record that changed
// shadow state twice (present → absent → present). Both are shapes where a
// lookup that forgets the kind, or that uses `Map.has()` instead of the shadow's
// three-state reader, silently produces a delete for the wrong record.
//
// Third attack: the delete intent must be independent of what else the save
// contains — adding an unrelated new node to the save must not change the delete
// set.

import { describe, expect, it } from "vitest";

import {
  type IntentPlan,
  type ParsedSave,
  type SurfaceShadow,
  type SurfaceState,
  type TombstoneView,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  markRecordAbsent,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "canvases/space station.canvas";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

function deleteKeys(plan: IntentPlan): string[] {
  return plan.deletes.map((intent) => `${intent.kind}:${intent.id}`).sort();
}

function surface(viewOpen: boolean, nodes: string[], edges: string[]): SurfaceState {
  return { viewOpen, handedToView: { node: new Set(nodes), edge: new Set(edges) } };
}

/** Six records: three nodes, three edges, all `present`. */
function populated(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  for (const id of ["hub", "arm", "pod"]) advanceField(shadow, PATH, "node", id, "x", 1);
  for (const id of ["hub", "tether", "beam"]) advanceField(shadow, PATH, "edge", id, "fromNode", "hub");
  return shadow;
}

const EMPTY_SAVE: ParsedSave = { path: PATH, nodes: [], edges: [] };

describe("WP2 AC3 — deletes follow the receipt, record by record", () => {
  it("only the receipted records are deleted, not the whole surface", () => {
    const plan = planIntentDiff(
      populated(),
      EMPTY_SAVE,
      NO_TOMBSTONES,
      surface(true, ["arm"], ["beam", "tether"]),
    );

    expect(deleteKeys(plan)).toEqual(["edge:beam", "edge:tether", "node:arm"]);
  });

  it("the same id in both id spaces is receipted separately", () => {
    const onlyNode = planIntentDiff(populated(), EMPTY_SAVE, NO_TOMBSTONES, surface(true, ["hub"], []));
    const onlyEdge = planIntentDiff(populated(), EMPTY_SAVE, NO_TOMBSTONES, surface(true, [], ["hub"]));
    const both = planIntentDiff(populated(), EMPTY_SAVE, NO_TOMBSTONES, surface(true, ["hub"], ["hub"]));

    expect(deleteKeys(onlyNode)).toEqual(["node:hub"]);
    expect(deleteKeys(onlyEdge)).toEqual(["edge:hub"]);
    expect(deleteKeys(both)).toEqual(["edge:hub", "node:hub"]);
  });

  it("a record still in the save is never deleted, whatever the receipt says", () => {
    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "hub", fields: { x: 1 } }],
      edges: [{ id: "hub", fields: { fromNode: "hub" } }],
    };

    const plan = planIntentDiff(
      populated(),
      save,
      NO_TOMBSTONES,
      surface(true, ["hub", "arm", "pod"], ["hub", "tether", "beam"]),
    );

    expect(deleteKeys(plan)).toEqual(["edge:beam", "edge:tether", "node:arm", "node:pod"]);
  });

  it("present → absent → present is deletable again; present → absent is not", () => {
    const shadow = populated();
    markRecordAbsent(shadow, PATH, "node", "arm");
    markRecordAbsent(shadow, PATH, "node", "pod");
    // "arm" comes back on the surface; "pod" stays known-absent.
    advanceField(shadow, PATH, "node", "arm", "x", 2);

    const plan = planIntentDiff(shadow, EMPTY_SAVE, NO_TOMBSTONES, surface(true, ["arm", "pod"], []));

    expect(deleteKeys(plan)).toEqual(["node:arm"]);
  });

  it("closing the view suppresses every delete, receipts notwithstanding", () => {
    const open = planIntentDiff(
      populated(),
      EMPTY_SAVE,
      NO_TOMBSTONES,
      surface(true, ["hub", "arm", "pod"], ["hub", "tether", "beam"]),
    );
    const closed = planIntentDiff(
      populated(),
      EMPTY_SAVE,
      NO_TOMBSTONES,
      surface(false, ["hub", "arm", "pod"], ["hub", "tether", "beam"]),
    );

    expect(deleteKeys(open)).toHaveLength(6);
    expect(deleteKeys(closed)).toEqual([]);
  });

  it("an empty receipt set with an open view deletes nothing", () => {
    const plan = planIntentDiff(populated(), EMPTY_SAVE, NO_TOMBSTONES, surface(true, [], []));

    expect(plan.deletes).toEqual([]);
    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });

  it("adding an unrelated new record to the save leaves the delete set unchanged", () => {
    const receipts = surface(true, ["arm"], ["beam"]);
    const withoutNew = planIntentDiff(populated(), EMPTY_SAVE, NO_TOMBSTONES, receipts);
    const withNew = planIntentDiff(
      populated(),
      { path: PATH, nodes: [{ id: "solar-panel", fields: { x: 9, y: 9 } }], edges: [] },
      NO_TOMBSTONES,
      receipts,
    );

    expect(deleteKeys(withNew)).toEqual(deleteKeys(withoutNew));
    expect(withNew.upserts).toHaveLength(2);
  });

  it("receipt ids are compared exactly — no trimming, no case folding", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "Pod ", { x: 1 });
    advanceRecord(shadow, PATH, "node", "pod", { x: 1 });

    const plan = planIntentDiff(shadow, EMPTY_SAVE, NO_TOMBSTONES, surface(true, ["Pod "], []));

    expect(deleteKeys(plan)).toEqual(["node:Pod "]);
  });
});
