// WP2 / AC2 — a field that differs from the shadow is intent.
//
// AC2: "A field whose value in the save differs from the shadow produces exactly
// one upsert intent and no deletion of any other key of that record."
//
// Two halves, both load-bearing:
//   - EXACTLY ONE upsert. Not one per record, not a whole-record overwrite: the
//     unit of intent is the field (I6).
//   - NO deletion of any other key. This is I7 and the R1 defect: a save is a
//     PARTIAL observation of a record, so a key the save does not mention has not
//     been deleted — it simply was not reported. `writeRecordMinimal`'s
//     "delete keys absent from next" behaviour is exactly what must not reappear.
//
// A field the shadow has never observed (unknown or absent record) also differs
// from the shadow — `undefined` is not a value — so it is an upsert. That is how
// a genuinely new node reaches the CRDT.

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

function openSurface(nodes: string[] = [], edges: string[] = []): SurfaceState {
  return {
    viewOpen: true,
    handedToView: { node: new Set(nodes), edge: new Set(edges) },
  };
}

function save(nodes: ParsedSave["nodes"], edges: ParsedSave["edges"] = []): ParsedSave {
  return { path: PATH, nodes, edges };
}

describe("WP2 AC2 — a differing field produces exactly one upsert", () => {
  it("one moved field yields one upsert and nothing else", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 100, y: 220, width: 400, height: 300 });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 100, y: 260, width: 400, height: 300 } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "n1", field: "y", value: 260 },
    ]);
    expect(plan.deletes).toEqual([]);
  });

  it("does not delete a shadow field the save omits (I7 — partial observation)", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", {
      x: 10,
      y: 20,
      width: 400,
      height: 300,
      color: "4",
      text: "keep me",
    });

    // The save reports only the two geometry fields it changed.
    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 11, y: 21 } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.deletes).toEqual([]);
    expect(plan.upserts).toHaveLength(2);
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "node", id: "n1", field: "x", value: 11 });
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "node", id: "n1", field: "y", value: 21 });
    // The unmentioned fields are neither upserted nor discarded — they were not observed.
    expect(plan.discarded).toEqual([]);
  });

  it("every field of a record the shadow has never seen is an upsert", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "existing", { x: 1 });

    const plan = planIntentDiff(
      shadow,
      save([
        { id: "existing", fields: { x: 1 } },
        { id: "fresh", fields: { x: 500, y: 500, type: "text", text: "new" } },
      ]),
      NO_TOMBSTONES,
      openSurface(["existing"]),
    );

    const fresh = plan.upserts.filter((intent) => intent.id === "fresh");
    expect(fresh).toHaveLength(4);
    expect(fresh.map((intent) => intent.field).sort()).toEqual(["text", "type", "x", "y"]);
    expect(plan.deletes).toEqual([]);
  });

  it("a record the shadow knows as absent is re-created field by field", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 10, y: 20 });
    markRecordAbsent(shadow, PATH, "node", "n1");

    // The user pasted the node back. `absent` carries no field values, so every
    // field of the save differs from "not observed" and is intent.
    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 10, y: 20 } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.upserts).toHaveLength(2);
    expect(plan.discarded).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("a type change with an equal-looking value is a difference (strict comparison)", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 10, color: "1" });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: "10", color: 1 } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.upserts).toHaveLength(2);
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "node", id: "n1", field: "x", value: "10" });
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "node", id: "n1", field: "color", value: 1 });
    expect(plan.discarded).toEqual([]);
  });

  it("intent does not depend on the view being open", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 10 });

    const closed: SurfaceState = {
      viewOpen: false,
      handedToView: { node: new Set(), edge: new Set() },
    };
    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 99 } }]),
      NO_TOMBSTONES,
      closed,
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "n1", field: "x", value: 99 },
    ]);
  });

  it("changing one record does not touch its neighbours", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 1, y: 1 });
    advanceRecord(shadow, PATH, "node", "n2", { x: 2, y: 2 });
    advanceRecord(shadow, PATH, "edge", "e1", { fromNode: "n1", toNode: "n2" });

    const plan = planIntentDiff(
      shadow,
      save(
        [
          { id: "n1", fields: { x: 1, y: 7 } },
          { id: "n2", fields: { x: 2, y: 2 } },
        ],
        [{ id: "e1", fields: { fromNode: "n1", toNode: "n2" } }],
      ),
      NO_TOMBSTONES,
      openSurface(["n1", "n2"], ["e1"]),
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "n1", field: "y", value: 7 },
    ]);
    expect(plan.deletes).toEqual([]);
    expect(plan.discarded).toHaveLength(5);
  });

  it("the same id in the two kinds is two independent records", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "same", { x: 1 });
    advanceRecord(shadow, PATH, "edge", "same", { fromNode: "a" });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "same", fields: { x: 1 } }], [{ id: "same", fields: { fromNode: "b" } }]),
      NO_TOMBSTONES,
      openSurface(["same"], ["same"]),
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "edge", id: "same", field: "fromNode", value: "b" },
    ]);
    expect(plan.discarded).toHaveLength(1);
    expect(plan.discarded[0].kind).toBe("node");
  });

  it("the upsert carries the path of the save", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 1 });

    const plan = planIntentDiff(
      shadow,
      { path: "Other/Deep/Nested.canvas", nodes: [{ id: "n1", fields: { x: 1 } }], edges: [] },
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    // The shadow knows nothing about that other path, so x=1 is new intent there.
    expect(plan.upserts).toEqual([
      { path: "Other/Deep/Nested.canvas", kind: "node", id: "n1", field: "x", value: 1 },
    ]);
  });
});
