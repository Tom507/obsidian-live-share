// WP1 / AC2 (first half) — advancing one field touches only that field.
//
// AC2: "Advancing a single field leaves every other field of the same record
// untouched..."
//
// This is the property the whole V2 diff basis rests on (I6): the shadow is
// advanced per field from three different sources, so an advance that rewrote the
// whole record would re-introduce exactly the record-granular behaviour
// `main.ts:114 canvasApplied` has today.

import { describe, expect, it } from "vitest";

import {
  type ShadowFieldValue,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
} from "../../../canvas/canvas-shadow";

const PATH = "Vault/Board.canvas";

const NODE_FIELDS: Record<string, ShadowFieldValue> = {
  x: 100,
  y: 200,
  width: 400,
  height: 300,
  type: "text",
  text: "original",
  color: "4",
};

function seeded() {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH, "node", "n1", NODE_FIELDS);
  return shadow;
}

describe("WP1 AC2 — per-field advance leaves the rest of the record untouched", () => {
  it("advancing `x` changes only `x`", () => {
    const shadow = seeded();

    advanceField(shadow, PATH, "node", "n1", "x", 140);

    expect(getRecordFields(shadow, PATH, "node", "n1")).toEqual({
      ...NODE_FIELDS,
      x: 140,
    });
  });

  it("advancing each field in turn accumulates exactly one change per step", () => {
    const shadow = seeded();
    const expected: Record<string, ShadowFieldValue> = { ...NODE_FIELDS };

    for (const [field, value] of [
      ["y", 205],
      ["text", "edited"],
      ["color", "6"],
      ["height", 301],
    ] as const) {
      advanceField(shadow, PATH, "node", "n1", field, value);
      expected[field] = value;
      expect(getRecordFields(shadow, PATH, "node", "n1")).toEqual(expected);
    }
  });

  it("advancing a field the record does not have yet adds it and keeps the rest", () => {
    const shadow = seeded();

    advanceField(shadow, PATH, "node", "n1", "label", "new field");

    expect(getRecordFields(shadow, PATH, "node", "n1")).toEqual({
      ...NODE_FIELDS,
      label: "new field",
    });
    expect(getField(shadow, PATH, "node", "n1", "label")).toBe("new field");
  });

  it("re-advancing a field to the same value is a no-op for the whole record", () => {
    const shadow = seeded();

    advanceField(shadow, PATH, "node", "n1", "text", "original");

    expect(getRecordFields(shadow, PATH, "node", "n1")).toEqual(NODE_FIELDS);
    expect(getRecordState(shadow, PATH, "node", "n1")).toBe("present");
  });

  it("a partial advanceRecord upserts only the given fields and deletes none (I7)", () => {
    const shadow = seeded();

    advanceRecord(shadow, PATH, "node", "n1", { x: 1, text: "partial" });

    expect(getRecordFields(shadow, PATH, "node", "n1")).toEqual({
      ...NODE_FIELDS,
      x: 1,
      text: "partial",
    });
  });

  it("advancing a field of one record does not create fields on another", () => {
    const shadow = seeded();
    advanceRecord(shadow, PATH, "node", "n2", { x: 0, y: 0 });

    advanceField(shadow, PATH, "node", "n1", "color", "1");

    expect(getRecordFields(shadow, PATH, "node", "n2")).toEqual({ x: 0, y: 0 });
    expect(getField(shadow, PATH, "node", "n2", "color")).toBeUndefined();
  });
});
