import { describe, expect, it } from "vitest";

import { CANONICAL_GEOMETRY_KEYS, roundCanvasGeometry } from "../../../canvas/canvas-canonical";

// ===========================================================================
// WP3 AC3 (first half) — "The capture-side rounding helper maps geometry to
// whole pixels."
//
// BUILD_SPEC §4.4: geometry is rounded BEFORE the register write, so rounding
// can never appear as intent. If the rounding happened on the write side
// instead, every peer would see a "moved by 0.4px" delta that no user made and
// the shadow diff (C2) would classify it as a real edit.
//
// Only the four `.canvas` geometry keys are touched. Everything else — content
// fields, unknown fields, non-numeric values — passes through untouched, and
// the caller's record is never mutated.
// ===========================================================================

type Rec = Record<string, unknown>;

describe("WP3 AC3 — capture-side geometry rounding", () => {
  it("maps x/y/width/height to whole pixels", () => {
    const out = roundCanvasGeometry({
      id: "n1",
      type: "text",
      x: 10.4,
      y: -3.6,
      width: 99.5,
      height: 60.49,
      text: "t",
    });

    expect(out.x).toBe(10);
    expect(out.y).toBe(-4);
    expect(out.width).toBe(100);
    expect(out.height).toBe(60);
    for (const key of ["x", "y", "width", "height"]) {
      expect(Number.isInteger(out[key] as number)).toBe(true);
    }
  });

  it("normalises a rounded negative fraction to +0, never -0", () => {
    const out = roundCanvasGeometry({ id: "n1", x: -0.2, y: -0.5, width: 10, height: 10 });

    expect(Object.is(out.x, 0)).toBe(true);
    expect(Object.is(out.y, 0)).toBe(true);
    expect(Object.is(out.x, -0)).toBe(false);
  });

  it("touches nothing but the geometry keys", () => {
    const out = roundCanvasGeometry({
      id: "n1",
      type: "text",
      x: 1.7,
      y: 2.2,
      width: 3.5,
      height: 4.5,
      text: "1.5 stays 1.5",
      opacity: 0.75,
      customFloat: 12.34,
    });

    expect(out.text).toBe("1.5 stays 1.5");
    expect(out.opacity).toBe(0.75);
    expect(out.customFloat).toBe(12.34);
    expect(out.id).toBe("n1");
    expect(out.type).toBe("text");
  });

  it("leaves a non-numeric or missing geometry value exactly as it found it", () => {
    const out = roundCanvasGeometry({ id: "n1", x: "12.4", y: null, width: 20.6 });

    expect(out.x).toBe("12.4");
    expect(out.y).toBeNull();
    expect(out.width).toBe(21);
    expect("height" in out).toBe(false);
  });

  it("returns a new record, preserving key order, without mutating the input", () => {
    const input: Rec = { height: 4.4, id: "n1", width: 3.6, y: 2.5, x: 1.5, type: "text" };
    const keysBefore = Object.keys(input).join(",");

    const out = roundCanvasGeometry(input);

    expect(out).not.toBe(input);
    expect(input.x).toBe(1.5);
    expect(Object.keys(input).join(",")).toBe(keysBefore);
    expect(Object.keys(out).join(",")).toBe(keysBefore);
  });

  it("rounds exactly the keys the file schema calls geometry", () => {
    expect([...CANONICAL_GEOMETRY_KEYS].sort()).toEqual(["height", "width", "x", "y"]);

    const record: Rec = { id: "n1" };
    for (const key of CANONICAL_GEOMETRY_KEYS) record[key] = 7.6;
    record.notGeometry = 7.6;

    const out = roundCanvasGeometry(record);

    for (const key of CANONICAL_GEOMETRY_KEYS) expect(out[key]).toBe(8);
    expect(out.notGeometry).toBe(7.6);
  });
});
