// WP2 / AC2 — the upsert set is exactly the perturbed set.
//
// Angle of attack: a table over one wide record. The shadow is built once from a
// ten-field fixture; each table row perturbs a named subset of those fields and
// states the expected upsert fields. Because the perturbation is the only thing
// that changes between rows, the assertion "upserts == perturbed" is a direct
// measurement of the granularity of the diff. An implementation that upserts the
// whole record fails every row with a non-empty complement; one that upserts
// nothing fails every row; one that is per-field passes all of them.
//
// The second half of AC2 — "no deletion of any other key of that record" — is
// asserted on every row rather than once, because the failure mode it guards
// against (`writeRecordMinimal`'s "delete keys absent from next", R1) is exactly
// a per-row consequence of a shrinking save.

import { describe, expect, it } from "vitest";

import {
  type ShadowFieldValue,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  markRecordAbsent,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Projekte/Roadmap.canvas";
const ID = "karte";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

const BASE: Record<string, ShadowFieldValue> = {
  type: "text",
  text: "Sprintziel",
  x: -320,
  y: 480,
  width: 250,
  height: 60,
  color: "6",
  pinned: true,
  ord: 12.5,
  note: null,
};

const SURFACE: SurfaceState = {
  viewOpen: true,
  handedToView: { node: new Set([ID]), edge: new Set() },
};

function baseShadow() {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH, "node", ID, BASE);
  return shadow;
}

type Row = readonly [
  label: string,
  perturbation: Record<string, ShadowFieldValue>,
  expectedFields: readonly string[],
];

const ROWS: readonly Row[] = [
  ["nothing moved", {}, []],
  ["one number", { y: 481 }, ["y"]],
  ["one string", { text: "Sprintziel v2" }, ["text"]],
  ["one boolean", { pinned: false }, ["pinned"]],
  ["null → value", { note: "jetzt gesetzt" }, ["note"]],
  ["value → null", { color: null }, ["color"]],
  ["a pair", { x: -319, width: 251 }, ["width", "x"]],
  ["sign flip on zero-crossing", { x: 320 }, ["x"]],
  ["float precision", { ord: 12.500000001 }, ["ord"]],
  [
    "everything at once",
    { type: "file", text: "x", x: 0, y: 0, width: 1, height: 1, color: "1", pinned: false, ord: 0, note: "n" },
    ["color", "height", "note", "ord", "pinned", "text", "type", "width", "x", "y"],
  ],
];

describe("WP2 AC2 — upserts are exactly the fields that moved", () => {
  for (const [label, perturbation, expectedFields] of ROWS) {
    it(`${label} → upserts [${expectedFields.join(", ")}]`, () => {
      const fields = { ...BASE, ...perturbation };

      const plan = planIntentDiff(
        baseShadow(),
        { path: PATH, nodes: [{ id: ID, fields }], edges: [] },
        NO_TOMBSTONES,
        SURFACE,
      );

      expect(plan.upserts.map((intent) => intent.field).sort()).toEqual([...expectedFields].sort());
      for (const intent of plan.upserts) {
        expect(intent.value).toBe(fields[intent.field]);
        expect(intent.id).toBe(ID);
        expect(intent.kind).toBe("node");
      }
      // AC2, second half: never a deletion of an untouched key.
      expect(plan.deletes).toEqual([]);
      expect(plan.discarded).toHaveLength(Object.keys(BASE).length - expectedFields.length);
    });
  }

  it("a shrinking save deletes nothing — partial observation is not removal (I7)", () => {
    // The save mentions two of the ten known fields, and changes one of them.
    const plan = planIntentDiff(
      baseShadow(),
      { path: PATH, nodes: [{ id: ID, fields: { x: -320, y: 999 } }], edges: [] },
      NO_TOMBSTONES,
      SURFACE,
    );

    expect(plan.deletes).toEqual([]);
    expect(plan.upserts).toEqual([{ path: PATH, kind: "node", id: ID, field: "y", value: 999 }]);
    expect(plan.discarded).toHaveLength(1);
  });

  it("a record the shadow marked absent is rebuilt field by field", () => {
    const shadow = baseShadow();
    markRecordAbsent(shadow, PATH, "node", ID);

    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [{ id: ID, fields: BASE }], edges: [] },
      NO_TOMBSTONES,
      SURFACE,
    );

    expect(plan.upserts).toHaveLength(Object.keys(BASE).length);
    expect(plan.discarded).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("edge endpoints are ordinary fields and upsert one at a time", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "edge", "kante", {
      fromNode: "a",
      fromSide: "right",
      toNode: "b",
      toSide: "left",
      toEnd: "arrow",
    });

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [],
        edges: [
          {
            id: "kante",
            fields: { fromNode: "a", fromSide: "right", toNode: "c", toSide: "left", toEnd: "arrow" },
          },
        ],
      },
      NO_TOMBSTONES,
      { viewOpen: true, handedToView: { node: new Set(), edge: new Set(["kante"]) } },
    );

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "edge", id: "kante", field: "toNode", value: "c" },
    ]);
    expect(plan.deletes).toEqual([]);
  });

  it("several records each contribute their own upserts independently", () => {
    const shadow = createSurfaceShadow();
    for (const index of [1, 2, 3, 4]) {
      advanceRecord(shadow, PATH, "node", `n${index}`, { x: index, y: index });
    }

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [
          { id: "n1", fields: { x: 1, y: 1 } },
          { id: "n2", fields: { x: 20, y: 2 } },
          { id: "n3", fields: { x: 3, y: 30 } },
          { id: "n4", fields: { x: 40, y: 40 } },
        ],
        edges: [],
      },
      NO_TOMBSTONES,
      { viewOpen: true, handedToView: { node: new Set(["n1", "n2", "n3", "n4"]), edge: new Set() } },
    );

    expect(plan.upserts).toHaveLength(4);
    expect(plan.upserts.filter((intent) => intent.id === "n1")).toEqual([]);
    expect(plan.upserts.filter((intent) => intent.id === "n4")).toHaveLength(2);
    expect(plan.discarded).toHaveLength(4);
    expect(plan.deletes).toEqual([]);
  });
});
