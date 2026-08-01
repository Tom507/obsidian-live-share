// WP1 / AC2 (first half) — field isolation on EDGE records, with value-type churn.
//
// Angle of attack: edges rather than nodes, and a single field driven through
// every permitted value type (string → number → boolean → null → string) while
// eight sibling fields are checked by strict identity after every single step.
// A record-granular implementation, or one that normalises values on write,
// breaks on the `null` and `false` steps rather than on the happy path.

import { describe, expect, it } from "vitest";

import {
  type ShadowFieldValue,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordFields,
} from "../../../canvas/canvas-shadow";

const PATH = "Research/Graph.canvas";
const EDGE_ID = "edge-42";

const SIBLINGS: Record<string, ShadowFieldValue> = {
  fromNode: "alpha",
  fromSide: "right",
  fromEnd: "none",
  toNode: "omega",
  toSide: "left",
  toEnd: "arrow",
  color: "3",
  weight: 2,
};

function seeded() {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH, "edge", EDGE_ID, { ...SIBLINGS, label: "start" });
  return shadow;
}

describe("WP1 AC2 — one edge field moves, its siblings do not", () => {
  it("drives `label` through every value type while the siblings hold by identity", () => {
    const shadow = seeded();

    const journey: ShadowFieldValue[] = ["→ ✅ multi\nline", 0, false, null, "back to text", true, -1];

    for (const value of journey) {
      advanceField(shadow, PATH, "edge", EDGE_ID, "label", value);

      expect(getField(shadow, PATH, "edge", EDGE_ID, "label")).toBe(value);
      for (const [field, expected] of Object.entries(SIBLINGS)) {
        expect(getField(shadow, PATH, "edge", EDGE_ID, field)).toBe(expected);
      }
      expect(getRecordFields(shadow, PATH, "edge", EDGE_ID)).toEqual({
        ...SIBLINGS,
        label: value,
      });
    }
  });

  it("clearing a colour to `null` does not remove the field or disturb the endpoints", () => {
    const shadow = seeded();

    advanceField(shadow, PATH, "edge", EDGE_ID, "color", null);

    expect(getField(shadow, PATH, "edge", EDGE_ID, "color")).toBeNull();
    expect(getField(shadow, PATH, "edge", EDGE_ID, "fromNode")).toBe("alpha");
    expect(getField(shadow, PATH, "edge", EDGE_ID, "toSide")).toBe("left");
    expect(Object.keys(getRecordFields(shadow, PATH, "edge", EDGE_ID) ?? {}).sort()).toEqual(
      [...Object.keys(SIBLINGS), "label"].sort(),
    );
  });

  it("an advanceRecord that mentions ONE endpoint keeps the other endpoint intact (I7)", () => {
    const shadow = seeded();

    advanceRecord(shadow, PATH, "edge", EDGE_ID, { toNode: "sigma", toSide: "top" });

    expect(getField(shadow, PATH, "edge", EDGE_ID, "toNode")).toBe("sigma");
    expect(getField(shadow, PATH, "edge", EDGE_ID, "toSide")).toBe("top");
    expect(getField(shadow, PATH, "edge", EDGE_ID, "fromNode")).toBe("alpha");
    expect(getField(shadow, PATH, "edge", EDGE_ID, "fromSide")).toBe("right");
    expect(getField(shadow, PATH, "edge", EDGE_ID, "label")).toBe("start");
  });

  it("an empty advanceRecord changes nothing at all", () => {
    const shadow = seeded();
    const before = getRecordFields(shadow, PATH, "edge", EDGE_ID);

    advanceRecord(shadow, PATH, "edge", EDGE_ID, {});

    expect(getRecordFields(shadow, PATH, "edge", EDGE_ID)).toEqual(before);
  });

  it("field names differing only by case are distinct fields", () => {
    const shadow = seeded();

    advanceField(shadow, PATH, "edge", EDGE_ID, "Label", "capital");

    expect(getField(shadow, PATH, "edge", EDGE_ID, "Label")).toBe("capital");
    expect(getField(shadow, PATH, "edge", EDGE_ID, "label")).toBe("start");
  });
});
