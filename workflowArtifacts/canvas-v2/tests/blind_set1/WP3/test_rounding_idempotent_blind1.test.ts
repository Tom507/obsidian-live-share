import { describe, expect, it } from "vitest";

import { roundCanvasGeometry, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC3 (idempotence) — angle: a hand-picked adversarial fixture table instead of
// a generator, applied THREE times, plus the property that matters downstream:
// re-rounding a captured record cannot change the bytes that reach disk (which
// is what "rounding never reads as intent" means in practice).

type Rec = Record<string, unknown>;

const ADVERSARIAL = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  0.49999999999999994,
  -0.49999999999999994,
  1e-9,
  -1e-9,
  123.5,
  -123.5,
  2 ** 31 + 0.5,
  -(2 ** 31) - 0.5,
  Number.EPSILON,
];

const record = (value: number, index: number): Rec => ({
  id: `n${index}`,
  type: "text",
  x: value,
  y: -value,
  width: Math.abs(value) + 0.5,
  height: 60,
  text: "constant",
});

describe("capture-side rounding is a fixed point (AC3)", () => {
  it("reaches its fixed point after the first application", () => {
    ADVERSARIAL.forEach((value, index) => {
      const once = roundCanvasGeometry(record(value, index));
      const twice = roundCanvasGeometry(once);
      const thrice = roundCanvasGeometry(twice);

      expect(twice).toEqual(once);
      expect(thrice).toEqual(once);
      expect(Object.keys(thrice)).toEqual(Object.keys(once));
    });
  });

  it("emits only whole, non-negative-zero pixels after one pass", () => {
    ADVERSARIAL.forEach((value, index) => {
      const once = roundCanvasGeometry(record(value, index));

      for (const key of ["x", "y", "width", "height"]) {
        expect(Number.isInteger(once[key] as number)).toBe(true);
        expect(Object.is(once[key], -0)).toBe(false);
      }
    });
  });

  it("cannot change the serialised bytes on a second capture", () => {
    const captured = ADVERSARIAL.map((value, index) => roundCanvasGeometry(record(value, index)));
    const recaptured = captured.map((node) => roundCanvasGeometry(node));

    expect(serializeCanonicalCanvas({ nodes: recaptured, edges: [] })).toBe(
      serializeCanonicalCanvas({ nodes: captured, edges: [] }),
    );
  });

  it("leaves the non-geometry payload untouched across repeated passes", () => {
    const out = roundCanvasGeometry(roundCanvasGeometry(roundCanvasGeometry(record(7.25, 0))));

    expect(out.text).toBe("constant");
    expect(out.type).toBe("text");
    expect(out.id).toBe("n0");
  });
});
