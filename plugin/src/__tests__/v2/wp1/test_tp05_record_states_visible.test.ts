// WP1 / AC3 — present / known-absent / unknown are three readable states.
//
// AC3: "The shadow distinguishes three states for a record: present with known
// fields, known-absent (it was handed to the surface and is not there), and
// unknown (never observed on this surface) — and a caller can read which state
// applies."
//
// This is the distinction WP2 AC3 depends on: a record missing from a save may
// only become a delete intent when the shadow can prove the surface actually saw
// it. "Never observed" and "observed as gone" must therefore never collapse into
// one another — which a `Map.has()`-only design would do.

import { describe, expect, it } from "vitest";

import {
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const PATH = "Vault/States.canvas";

describe("WP1 AC3 — the three record states", () => {
  it("a record never observed on this surface is `unknown`", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "seen", { x: 1 });

    expect(getRecordState(shadow, PATH, "node", "never")).toBe("unknown");
    expect(getRecordState(shadow, "Other.canvas", "node", "seen")).toBe("unknown");
    expect(getRecordFields(shadow, PATH, "node", "never")).toBeNull();
    expect(getField(shadow, PATH, "node", "never", "x")).toBeUndefined();
  });

  it("a record with observed fields is `present` and its fields are readable", () => {
    const shadow = createSurfaceShadow();

    advanceField(shadow, PATH, "edge", "e1", "fromNode", "n1");

    expect(getRecordState(shadow, PATH, "edge", "e1")).toBe("present");
    expect(getRecordFields(shadow, PATH, "edge", "e1")).toEqual({ fromNode: "n1" });
  });

  it("a record handed to the surface and found missing is `absent`, not `unknown`", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "gone", { x: 1, y: 2, text: "bye" });

    markRecordAbsent(shadow, PATH, "node", "gone");

    expect(getRecordState(shadow, PATH, "node", "gone")).toBe("absent");
    expect(getRecordFields(shadow, PATH, "node", "gone")).toBeNull();
    expect(getField(shadow, PATH, "node", "gone", "x")).toBeUndefined();
    // ...and it is still a KNOWN record: the state is not "unknown".
    expect(getRecordState(shadow, PATH, "node", "gone")).not.toBe("unknown");
  });

  it("all three states coexist in one path and are read independently", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "here", { x: 1 });
    markRecordAbsent(shadow, PATH, "node", "gone");

    expect(getRecordState(shadow, PATH, "node", "here")).toBe("present");
    expect(getRecordState(shadow, PATH, "node", "gone")).toBe("absent");
    expect(getRecordState(shadow, PATH, "node", "never")).toBe("unknown");
  });

  it("re-observing an absent record makes it present again with only the new fields", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 1, y: 2, text: "old" });
    markRecordAbsent(shadow, PATH, "node", "n1");

    advanceField(shadow, PATH, "node", "n1", "x", 9);

    expect(getRecordState(shadow, PATH, "node", "n1")).toBe("present");
    expect(getRecordFields(shadow, PATH, "node", "n1")).toEqual({ x: 9 });
  });

  it("marking a never-observed record absent is legitimate knowledge, not a no-op", () => {
    const shadow = createSurfaceShadow();

    markRecordAbsent(shadow, PATH, "edge", "e-never-existed");

    expect(getRecordState(shadow, PATH, "edge", "e-never-existed")).toBe("absent");
    expect(getRecordState(shadow, PATH, "node", "e-never-existed")).toBe("unknown");
  });
});
