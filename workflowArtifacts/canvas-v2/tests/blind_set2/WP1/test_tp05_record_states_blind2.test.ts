// WP1 / AC3 — the three states are per SURFACE, and only the state reader
// separates the two "no fields" cases.
//
// Angle of attack: one and the same record id is driven into all three states at
// once — `present` on one path, `absent` on a second, `unknown` on a third — and
// the full 3×2 (path × kind) matrix is asserted in one pass. Any implementation
// that hangs presence off the record id rather than off the (path, kind) surface
// fails the matrix even though every single-path test would pass.
//
// Second angle: `getRecordFields` returns `null` for BOTH `absent` and `unknown`,
// so it can never be the discriminator. The test pins that explicitly, so a coder
// cannot "simplify" the state reader away later.

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const PRESENT_PATH = "Surfaces/open-view.canvas";
const ABSENT_PATH = "Surfaces/closed-view.canvas";
const UNKNOWN_PATH = "Surfaces/never-subscribed.canvas";
const ID = "shared-record";
const KINDS: readonly ShadowRecordKind[] = ["node", "edge"];

describe("WP1 AC3 — record state is a property of the surface, not of the id", () => {
  it("holds all three states for the same id on three different paths", () => {
    const shadow = createSurfaceShadow();

    for (const kind of KINDS) {
      advanceRecord(shadow, PRESENT_PATH, kind, ID, { x: 1, y: 2 });
      markRecordAbsent(shadow, ABSENT_PATH, kind, ID);
    }

    for (const kind of KINDS) {
      expect(getRecordState(shadow, PRESENT_PATH, kind, ID)).toBe("present");
      expect(getRecordState(shadow, ABSENT_PATH, kind, ID)).toBe("absent");
      expect(getRecordState(shadow, UNKNOWN_PATH, kind, ID)).toBe("unknown");
    }
  });

  it("`absent` and `unknown` are indistinguishable through the field readers", () => {
    const shadow = createSurfaceShadow();
    markRecordAbsent(shadow, ABSENT_PATH, "node", ID);

    expect(getRecordFields(shadow, ABSENT_PATH, "node", ID)).toBeNull();
    expect(getRecordFields(shadow, UNKNOWN_PATH, "node", ID)).toBeNull();
    expect(getField(shadow, ABSENT_PATH, "node", ID, "x")).toBeUndefined();
    expect(getField(shadow, UNKNOWN_PATH, "node", ID, "x")).toBeUndefined();

    // ...and the state reader is the ONLY thing that tells them apart.
    expect(getRecordState(shadow, ABSENT_PATH, "node", ID)).toBe("absent");
    expect(getRecordState(shadow, UNKNOWN_PATH, "node", ID)).toBe("unknown");
  });

  it("advancing on one surface never changes the state on another", () => {
    const shadow = createSurfaceShadow();
    markRecordAbsent(shadow, ABSENT_PATH, "node", ID);

    advanceField(shadow, PRESENT_PATH, "node", ID, "x", 3);

    expect(getRecordState(shadow, ABSENT_PATH, "node", ID)).toBe("absent");
    expect(getRecordState(shadow, PRESENT_PATH, "node", ID)).toBe("present");
    expect(getRecordState(shadow, UNKNOWN_PATH, "node", ID)).toBe("unknown");
  });

  it("marking absent on one surface does not mark the edge of the same id absent", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PRESENT_PATH, "node", ID, { x: 1 });
    advanceRecord(shadow, PRESENT_PATH, "edge", ID, { fromNode: "a", toNode: "b" });

    markRecordAbsent(shadow, PRESENT_PATH, "node", ID);

    expect(getRecordState(shadow, PRESENT_PATH, "node", ID)).toBe("absent");
    expect(getRecordState(shadow, PRESENT_PATH, "edge", ID)).toBe("present");
    expect(getRecordFields(shadow, PRESENT_PATH, "edge", ID)).toEqual({
      fromNode: "a",
      toNode: "b",
    });
  });

  it("a full observe → vanish → reappear cycle ends `present` with the newest fields only", () => {
    const shadow = createSurfaceShadow();

    advanceRecord(shadow, PRESENT_PATH, "node", ID, { x: 1, y: 1, text: "v1", color: "2" });
    expect(getRecordState(shadow, PRESENT_PATH, "node", ID)).toBe("present");

    markRecordAbsent(shadow, PRESENT_PATH, "node", ID);
    expect(getRecordState(shadow, PRESENT_PATH, "node", ID)).toBe("absent");

    advanceRecord(shadow, PRESENT_PATH, "node", ID, { x: 2, y: 2, text: "v2" });

    expect(getRecordState(shadow, PRESENT_PATH, "node", ID)).toBe("present");
    expect(getRecordFields(shadow, PRESENT_PATH, "node", ID)).toEqual({ x: 2, y: 2, text: "v2" });
    expect(getField(shadow, PRESENT_PATH, "node", ID, "color")).toBeUndefined();
  });
});
