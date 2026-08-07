// WP2 / AC3 — a missing record is a delete intent only under proof.
//
// AC3: "A record missing from the save that exists in the shadow produces a
// delete intent **only** when the view is open **and** that record was handed to
// the view in the last apply; in every other case it produces no intent."
//
// The argument (CONCEPT_V2 Teil 5): Obsidian cannot have deleted a record it
// never had. Absence in a save is only evidence of deletion when we can prove
// the surface actually carried the record — which is exactly what the open view
// plus the last apply's hand-over set prove. Without that proof, absence is
// ignorance, and turning ignorance into a tombstone destroys peers' records.
//
// `surfaceState` is the injected seam here, so the gate is directly
// discriminating: flip `viewOpen` or drop the id from `handedToView` and the
// delete intent must vanish for otherwise identical inputs.

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  markRecordAbsent,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Vault/Board.canvas";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

function surface(viewOpen: boolean, nodes: string[] = [], edges: string[] = []): SurfaceState {
  return { viewOpen, handedToView: { node: new Set(nodes), edge: new Set(edges) } };
}

function save(nodes: ParsedSave["nodes"] = [], edges: ParsedSave["edges"] = []): ParsedSave {
  return { path: PATH, nodes, edges };
}

/** A shadow that knows n1 (still saved) and n2 (missing from the save). */
function shadowWithTwoNodes() {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH, "node", "n1", { x: 1, y: 1 });
  advanceRecord(shadow, PATH, "node", "n2", { x: 2, y: 2 });
  return shadow;
}

const REMAINING = save([{ id: "n1", fields: { x: 1, y: 1 } }]);

describe("WP2 AC3 — delete intents require an open view and a hand-over receipt", () => {
  it("open view + handed to the view → exactly one delete intent", () => {
    const plan = planIntentDiff(
      shadowWithTwoNodes(),
      REMAINING,
      NO_TOMBSTONES,
      surface(true, ["n1", "n2"]),
    );

    expect(plan.deletes).toEqual([{ path: PATH, kind: "node", id: "n2" }]);
    expect(plan.upserts).toEqual([]);
  });

  it("view closed, record handed in the last apply → no intent", () => {
    const plan = planIntentDiff(
      shadowWithTwoNodes(),
      REMAINING,
      NO_TOMBSTONES,
      surface(false, ["n1", "n2"]),
    );

    expect(plan.deletes).toEqual([]);
  });

  it("view open, record NOT handed in the last apply → no intent", () => {
    const plan = planIntentDiff(
      shadowWithTwoNodes(),
      REMAINING,
      NO_TOMBSTONES,
      surface(true, ["n1"]),
    );

    expect(plan.deletes).toEqual([]);
  });

  it("view closed and record not handed → no intent", () => {
    const plan = planIntentDiff(shadowWithTwoNodes(), REMAINING, NO_TOMBSTONES, surface(false, []));

    expect(plan.deletes).toEqual([]);
  });

  it("the gate discriminates: the only change is the seam", () => {
    // Same shadow, same save, same tombstones — only `surfaceState` differs.
    const withProof = planIntentDiff(
      shadowWithTwoNodes(),
      REMAINING,
      NO_TOMBSTONES,
      surface(true, ["n1", "n2"]),
    );
    const withoutProof = planIntentDiff(
      shadowWithTwoNodes(),
      REMAINING,
      NO_TOMBSTONES,
      surface(false, ["n1", "n2"]),
    );

    expect(withProof.deletes).toHaveLength(1);
    expect(withoutProof.deletes).toHaveLength(0);
    expect(withProof.upserts).toEqual(withoutProof.upserts);
    expect(withProof.discarded).toEqual(withoutProof.discarded);
  });

  it("a record the shadow knows as absent produces no delete intent", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 1, y: 1 });
    advanceRecord(shadow, PATH, "node", "gone", { x: 5 });
    markRecordAbsent(shadow, PATH, "node", "gone");

    // It is already known to be off the surface — there is nothing left to delete.
    const plan = planIntentDiff(shadow, REMAINING, NO_TOMBSTONES, surface(true, ["n1", "gone"]));

    expect(plan.deletes).toEqual([]);
  });

  it("a record the shadow has never observed produces no delete intent", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 1, y: 1 });

    // "ghost" is in the hand-over set but was never advanced into the shadow.
    const plan = planIntentDiff(shadow, REMAINING, NO_TOMBSTONES, surface(true, ["n1", "ghost"]));

    expect(plan.deletes).toEqual([]);
  });

  it("the hand-over set is kind-scoped — a node receipt does not license an edge delete", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "edge", "x", { fromNode: "a", toNode: "b" });

    const wrongKind = planIntentDiff(shadow, save(), NO_TOMBSTONES, surface(true, ["x"], []));
    const rightKind = planIntentDiff(shadow, save(), NO_TOMBSTONES, surface(true, [], ["x"]));

    expect(wrongKind.deletes).toEqual([]);
    expect(rightKind.deletes).toEqual([{ path: PATH, kind: "edge", id: "x" }]);
  });

  it("deletes several proven records at once and leaves the unproven ones alone", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "keep", { x: 0 });
    advanceRecord(shadow, PATH, "node", "a", { x: 1 });
    advanceRecord(shadow, PATH, "node", "b", { x: 2 });
    advanceRecord(shadow, PATH, "node", "c", { x: 3 });
    advanceRecord(shadow, PATH, "edge", "e1", { fromNode: "a", toNode: "b" });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "keep", fields: { x: 0 } }]),
      NO_TOMBSTONES,
      // "c" was never handed over, and no edge was.
      surface(true, ["keep", "a", "b"]),
    );

    expect(plan.deletes).toHaveLength(2);
    expect(plan.deletes).toContainEqual({ path: PATH, kind: "node", id: "a" });
    expect(plan.deletes).toContainEqual({ path: PATH, kind: "node", id: "b" });
    expect(plan.deletes).not.toContainEqual({ path: PATH, kind: "node", id: "c" });
    expect(plan.deletes).not.toContainEqual({ path: PATH, kind: "edge", id: "e1" });
  });

  it("a delete intent names the record only — it is not a field-level event", () => {
    const plan = planIntentDiff(
      shadowWithTwoNodes(),
      REMAINING,
      NO_TOMBSTONES,
      surface(true, ["n1", "n2"]),
    );

    expect(Object.keys(plan.deletes[0]).sort()).toEqual(["id", "kind", "path"]);
    // Nothing about the vanished record leaks into the other two categories.
    expect(plan.upserts.some((intent) => intent.id === "n2")).toBe(false);
    expect(plan.discarded.some((entry) => entry.id === "n2")).toBe(false);
  });

  it("shadow state of another path never licenses a delete on this one", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, "Other.canvas", "node", "n2", { x: 2 });
    advanceRecord(shadow, PATH, "node", "n1", { x: 1, y: 1 });

    const plan = planIntentDiff(shadow, REMAINING, NO_TOMBSTONES, surface(true, ["n1", "n2"]));

    expect(plan.deletes).toEqual([]);
  });
});
