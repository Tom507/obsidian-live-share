// WP2 / AC1 — a field equal to the shadow is staleness, never intent.
//
// AC1: "A field whose value in the save equals the shadow value produces **no**
// intent, **even when the CRDT value differs from the shadow** — this case must
// be represented as a discarded-staleness entry, not silently dropped."
//
// This is the heart of the initiative (CONCEPT_V2 Teil 5, W1). In the Symptom-2
// cascade the open view never received peer B's field, so Obsidian serialises
// exactly the shadow value back to disk. Diffing that save against the CRDT (or
// against the disk snapshot) reads it as "the user reverted B's edit" and pushes
// the stale value into the shared state. Diffing it against the SHADOW reads it
// as what it is: the view is stale, the reconciler will fix the view, and the
// capture path stays silent.
//
// The structural guarantee behind "even when the CRDT value differs": the CRDT
// is not a parameter of this function AT ALL, so it cannot influence the verdict.
// The arity assertion below pins that.
//
// "Not silently dropped" is the second half and is equally binding: the discard
// has to be observable, because WP4 AC4 makes it a logged signature and WP23's
// shadow-consistency assertion needs it as evidence.

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Vault/Board.canvas";

/** No id is tombstoned — AC1 is about a live record. */
const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

/** The view is open and was handed every record this file uses. */
function openSurface(nodes: string[] = [], edges: string[] = []): SurfaceState {
  return {
    viewOpen: true,
    handedToView: { node: new Set(nodes), edge: new Set(edges) },
  };
}

function save(nodes: ParsedSave["nodes"], edges: ParsedSave["edges"] = []): ParsedSave {
  return { path: PATH, nodes, edges };
}

describe("WP2 AC1 — a save field equal to the shadow is discarded staleness", () => {
  it("produces no upsert and no delete", () => {
    const shadow = createSurfaceShadow();
    // The last value that provably reached the surface Obsidian saved from.
    advanceRecord(shadow, PATH, "node", "n1", { x: 100, y: 220, width: 400 });

    // Obsidian re-serialises exactly that surface — byte for byte.
    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 100, y: 220, width: 400 } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("reports every equal field as an explicit discarded-staleness entry", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 100, y: 220, width: 400 });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 100, y: 220, width: 400 } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.discarded).toHaveLength(3);
    expect(plan.discarded).toContainEqual({
      path: PATH,
      kind: "node",
      id: "n1",
      field: "x",
      value: 100,
      reason: "equals-shadow",
    });
    expect(plan.discarded).toContainEqual({
      path: PATH,
      kind: "node",
      id: "n1",
      field: "y",
      value: 220,
      reason: "equals-shadow",
    });
    expect(plan.discarded).toContainEqual({
      path: PATH,
      kind: "node",
      id: "n1",
      field: "width",
      value: 400,
      reason: "equals-shadow",
    });
  });

  it("the CRDT is not an input — the verdict cannot depend on the diverged value", () => {
    // The scenario this pins: the shadow says x=100 because that is the last
    // value the view confirmed. A peer has since moved the node to x=900 in the
    // CRDT. Obsidian saves the stale view: x=100. The old code diffed against
    // disk/CRDT, saw 100 != 900 and pushed 100. The new rule cannot even ask.
    expect(planIntentDiff.length).toBe(4);

    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 100 });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { x: 100 } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.upserts).toEqual([]);
    // WP94 (C94 AC6): `withheld` joined the plan as a fourth first-class output
    // — see the argument in `test_tp06`. The ARITY pin above is untouched and
    // still holds at 4: WP94 carries its completeness verdict on the SAVE, which
    // is where a fact about the observation belongs, precisely so that this
    // contract — no fifth parameter, and above all no CRDT — stays literal.
    expect(Object.keys(plan).sort()).toEqual(["deletes", "discarded", "upserts", "withheld"]);
  });

  it("discards per field, not per record — one changed field does not rescue the rest", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 100, y: 220, color: "3" });

    const plan = planIntentDiff(
      shadow,
      // Only y moved. x and color are the stale echo of the shadow.
      save([{ id: "n1", fields: { x: 100, y: 999, color: "3" } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "n1", field: "y", value: 999 },
    ]);
    expect(plan.discarded).toHaveLength(2);
    expect(plan.discarded.map((entry) => entry.field).sort()).toEqual(["color", "x"]);
    expect(plan.deletes).toEqual([]);
  });

  it("holds for edges exactly as for nodes", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "edge", "e1", { fromNode: "n1", toNode: "n2", toEnd: "arrow" });

    const plan = planIntentDiff(
      shadow,
      save([], [{ id: "e1", fields: { fromNode: "n1", toNode: "n2", toEnd: "arrow" } }]),
      NO_TOMBSTONES,
      openSurface([], ["e1"]),
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toHaveLength(3);
    expect(plan.discarded.every((entry) => entry.kind === "edge")).toBe(true);
  });

  it("an observed `null` equal to a saved `null` is a discard, not an upsert", () => {
    const shadow = createSurfaceShadow();
    // `null` is an OBSERVED value in the shadow, distinct from "never observed".
    advanceRecord(shadow, PATH, "node", "n1", { color: null });

    const plan = planIntentDiff(
      shadow,
      save([{ id: "n1", fields: { color: null } }]),
      NO_TOMBSTONES,
      openSurface(["n1"]),
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([
      { path: PATH, kind: "node", id: "n1", field: "color", value: null, reason: "equals-shadow" },
    ]);
  });

  it("the whole save being stale yields zero intents and one discard per field", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 0, y: 0 });
    advanceRecord(shadow, PATH, "node", "n2", { x: 50, y: 60 });
    advanceRecord(shadow, PATH, "edge", "e1", { fromNode: "n1", toNode: "n2" });

    const plan = planIntentDiff(
      shadow,
      save(
        [
          { id: "n1", fields: { x: 0, y: 0 } },
          { id: "n2", fields: { x: 50, y: 60 } },
        ],
        [{ id: "e1", fields: { fromNode: "n1", toNode: "n2" } }],
      ),
      NO_TOMBSTONES,
      openSurface(["n1", "n2"], ["e1"]),
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.discarded).toHaveLength(6);
  });
});
