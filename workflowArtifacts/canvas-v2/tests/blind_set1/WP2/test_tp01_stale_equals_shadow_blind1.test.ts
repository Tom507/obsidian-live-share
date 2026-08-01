// WP2 / AC1 — staleness as an algebraic property, not a hand-picked example.
//
// Angle of attack: instead of asserting one crafted stale field, this file
// derives the save FROM the shadow. If a save is a faithful re-serialisation of
// what the surface last showed, then by AC1 *every* field of it is staleness —
// so the plan must be `upserts: [], deletes: [], discarded: <every field>`.
// That is a total property over the whole fixture, and it fails loudly for any
// implementation that special-cases a value type (booleans, `null`, empty
// strings) or that only compares the geometry keys.
//
// The fixture is edge-heavy and unicode-heavy on purpose: the visible risk is an
// implementation that walks `nodes` and forgets `edges`, or that compares field
// values after some normalisation of the key or the string.

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type ParsedSaveRecord,
  type ShadowFieldValue,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Notizen/Übersicht — Q3.canvas";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

/** Deterministic generator: record i carries a mix of every value type. */
function makeRecord(prefix: string, index: number): ParsedSaveRecord {
  const fields: Record<string, ShadowFieldValue> = {
    label: `${prefix}-${index}`,
    ord: index * 7,
    pinned: index % 2 === 0,
    note: index % 3 === 0 ? null : "",
  };
  return { id: `${prefix}${index}`, fields };
}

const NODES: ParsedSaveRecord[] = Array.from({ length: 5 }, (_, i) => makeRecord("knoten", i));
const EDGES: ParsedSaveRecord[] = Array.from({ length: 7 }, (_, i) => makeRecord("kante", i));

const SAVE: ParsedSave = { path: PATH, nodes: NODES, edges: EDGES };

const FIELD_COUNT = [...NODES, ...EDGES].reduce(
  (total, record) => total + Object.keys(record.fields).length,
  0,
);

/** A shadow advanced to exactly the state the save describes. */
function shadowMirroringTheSave() {
  const shadow = createSurfaceShadow();
  for (const record of NODES) advanceRecord(shadow, PATH, "node", record.id, record.fields);
  for (const record of EDGES) advanceRecord(shadow, PATH, "edge", record.id, record.fields);
  return shadow;
}

const SURFACE: SurfaceState = {
  viewOpen: true,
  handedToView: {
    node: new Set(NODES.map((record) => record.id)),
    edge: new Set(EDGES.map((record) => record.id)),
  },
};

describe("WP2 AC1 — a save mirroring the shadow is entirely staleness", () => {
  it("produces no upsert and no delete anywhere in the fixture", () => {
    const plan = planIntentDiff(shadowMirroringTheSave(), SAVE, NO_TOMBSTONES, SURFACE);

    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("reports one discard per field — nothing is silently dropped", () => {
    const plan = planIntentDiff(shadowMirroringTheSave(), SAVE, NO_TOMBSTONES, SURFACE);

    expect(plan.discarded).toHaveLength(FIELD_COUNT);
    const keys = plan.discarded.map((entry) => `${entry.kind}:${entry.id}.${entry.field}`);
    expect(new Set(keys).size).toBe(FIELD_COUNT);
  });

  it("covers both id spaces — edges are not forgotten", () => {
    const plan = planIntentDiff(shadowMirroringTheSave(), SAVE, NO_TOMBSTONES, SURFACE);

    expect(plan.discarded.filter((entry) => entry.kind === "node")).toHaveLength(20);
    expect(plan.discarded.filter((entry) => entry.kind === "edge")).toHaveLength(28);
  });

  it("carries the observed value and the path on every discard entry", () => {
    const plan = planIntentDiff(shadowMirroringTheSave(), SAVE, NO_TOMBSTONES, SURFACE);

    for (const entry of plan.discarded) {
      expect(entry.path).toBe(PATH);
      expect(entry.reason).toBe("equals-shadow");
    }
    expect(plan.discarded).toContainEqual({
      path: PATH,
      kind: "edge",
      id: "kante3",
      field: "pinned",
      value: false,
      reason: "equals-shadow",
    });
    expect(plan.discarded).toContainEqual({
      path: PATH,
      kind: "node",
      id: "knoten0",
      field: "note",
      value: null,
      reason: "equals-shadow",
    });
    expect(plan.discarded).toContainEqual({
      path: PATH,
      kind: "node",
      id: "knoten1",
      field: "note",
      value: "",
      reason: "equals-shadow",
    });
  });

  it("survives every value type — `false`, `null` and `\"\"` are values, not absence", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "typen", {
      falsch: false,
      leer: "",
      nichts: null,
      null_string: "null",
      nullwert: 0,
    });

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [
          {
            id: "typen",
            fields: { falsch: false, leer: "", nichts: null, null_string: "null", nullwert: 0 },
          },
        ],
        edges: [],
      },
      NO_TOMBSTONES,
      { viewOpen: true, handedToView: { node: new Set(["typen"]), edge: new Set() } },
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toHaveLength(5);
  });

  it("staleness is decided per field even when only one record changed", () => {
    const shadow = shadowMirroringTheSave();
    const mutated: ParsedSave = {
      path: PATH,
      nodes: NODES,
      edges: EDGES.map((record) =>
        record.id === "kante4" ? { id: record.id, fields: { ...record.fields, ord: -1 } } : record,
      ),
    };

    const plan = planIntentDiff(shadow, mutated, NO_TOMBSTONES, SURFACE);

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "edge", id: "kante4", field: "ord", value: -1 },
    ]);
    expect(plan.discarded).toHaveLength(FIELD_COUNT - 1);
  });
});
