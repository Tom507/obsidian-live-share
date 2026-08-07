// WP2 / AC2 — intent under a save that is smaller than the record it describes.
//
// Angle of attack: R1 — the defect this WP exists to make impossible — is a
// *shrinkage* bug. `writeRecordMinimal` deleted every key the incoming record did
// not mention, so a partial observation destroyed data. This file therefore never
// sends a full record: every save here mentions a strict subset of the fields the
// shadow holds, shrinking step by step down to a record with no fields at all.
// The invariant asserted after every step is `deletes == []`.
//
// The second attack is on the "exactly one" in AC2: an upsert must name a single
// (record, field) pair, so a plan can never contain two intents for the same pair
// and never an intent that carries a whole field bag.
//
// Data is deliberately unlike the visible fixtures: negative and fractional
// geometry, ids that look like numbers, ids that differ only by case, and a
// record whose id is the empty string.

import { describe, expect, it } from "vitest";

import {
  type IntentPlan,
  type ParsedSave,
  type ShadowFieldValue,
  type SurfaceState,
  type TombstoneView,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "01 Inbox/2026-07-31.canvas";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

const OPEN_ALL: SurfaceState = {
  viewOpen: true,
  handedToView: {
    node: new Set(["0", "00", "Alpha", "alpha", ""]),
    edge: new Set(["0"]),
  },
};

const WIDE: Record<string, ShadowFieldValue> = {
  x: -0.5,
  y: 1024.25,
  width: 12,
  height: 34,
  color: "#ff00aa",
  text: "line one\nline two",
  flag: false,
  empty: "",
  nothing: null,
};

function wideShadow() {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH, "node", "0", WIDE);
  return shadow;
}

function planFor(fields: Record<string, ShadowFieldValue>): IntentPlan {
  const save: ParsedSave = { path: PATH, nodes: [{ id: "0", fields }], edges: [] };
  return planIntentDiff(wideShadow(), save, NO_TOMBSTONES, OPEN_ALL);
}

describe("WP2 AC2 — shrinking saves never delete, and intents stay singular", () => {
  it("shrinks from nine fields to zero without ever producing a delete", () => {
    const names = Object.keys(WIDE);

    for (let take = names.length; take >= 0; take -= 1) {
      const fields: Record<string, ShadowFieldValue> = {};
      for (const name of names.slice(0, take)) fields[name] = WIDE[name];

      const plan = planFor(fields);

      expect(plan.deletes).toEqual([]);
      expect(plan.upserts).toEqual([]);
      expect(plan.discarded).toHaveLength(take);
    }
  });

  it("a save record with no fields at all is not a delete", () => {
    const plan = planFor({});

    expect(plan.deletes).toEqual([]);
    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });

  it("one changed field inside a shrunken save is still exactly one upsert", () => {
    const plan = planFor({ text: "line one\nline two", flag: true });

    expect(plan.upserts).toEqual([{ path: PATH, kind: "node", id: "0", field: "flag", value: true }]);
    expect(plan.deletes).toEqual([]);
  });

  it("never emits two intents for the same (record, field) pair", () => {
    const plan = planFor({ x: 5, y: 5, width: 5, height: 5, color: "5" });

    const keys = plan.upserts.map((intent) => `${intent.kind}:${intent.id}.${intent.field}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(5);
    for (const intent of plan.upserts) {
      expect(Object.keys(intent).sort()).toEqual(["field", "id", "kind", "path", "value"]);
    }
  });

  it("ids that differ only by case are different records", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "Alpha", "x", 1);
    advanceField(shadow, PATH, "node", "alpha", "x", 1);

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [
          { id: "Alpha", fields: { x: 1 } },
          { id: "alpha", fields: { x: 2 } },
        ],
        edges: [],
      },
      NO_TOMBSTONES,
      OPEN_ALL,
    );

    expect(plan.upserts).toEqual([{ path: PATH, kind: "node", id: "alpha", field: "x", value: 2 }]);
    expect(plan.discarded).toHaveLength(1);
    expect(plan.discarded[0].id).toBe("Alpha");
  });

  it("numeric-looking ids and the empty id behave like ordinary keys", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "0", "x", 0);
    advanceField(shadow, PATH, "node", "00", "x", 0);
    advanceField(shadow, PATH, "node", "", "x", 0);

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [
          { id: "0", fields: { x: 0 } },
          { id: "00", fields: { x: 1 } },
          { id: "", fields: { x: 2 } },
        ],
        edges: [],
      },
      NO_TOMBSTONES,
      OPEN_ALL,
    );

    expect(plan.upserts).toHaveLength(2);
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "node", id: "00", field: "x", value: 1 });
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "node", id: "", field: "x", value: 2 });
    expect(plan.deletes).toEqual([]);
  });

  it("a prototype-named field carries its value into the upsert unchanged", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "0", "__proto__", "old");

    const fields = JSON.parse('{"__proto__":"new","constructor":"also new"}') as Record<
      string,
      ShadowFieldValue
    >;
    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [{ id: "0", fields }], edges: [] },
      NO_TOMBSTONES,
      OPEN_ALL,
    );

    expect(plan.upserts).toHaveLength(2);
    expect(plan.upserts).toContainEqual({
      path: PATH,
      kind: "node",
      id: "0",
      field: "__proto__",
      value: "new",
    });
    expect(plan.deletes).toEqual([]);
  });

  it("an unknown record and a known record in one save do not interfere", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "edge", "0", { fromNode: "a", toNode: "b" });

    const plan = planIntentDiff(
      shadow,
      {
        path: PATH,
        nodes: [{ id: "brand-new", fields: { x: 7, y: 8 } }],
        edges: [{ id: "0", fields: { fromNode: "a", toNode: "z" } }],
      },
      NO_TOMBSTONES,
      OPEN_ALL,
    );

    expect(plan.upserts).toHaveLength(3);
    expect(plan.upserts.filter((intent) => intent.kind === "node")).toHaveLength(2);
    expect(plan.upserts).toContainEqual({
      path: PATH,
      kind: "edge",
      id: "0",
      field: "toNode",
      value: "z",
    });
    expect(plan.discarded).toEqual([
      {
        path: PATH,
        kind: "edge",
        id: "0",
        field: "fromNode",
        value: "a",
        reason: "equals-shadow",
      },
    ]);
  });
});
