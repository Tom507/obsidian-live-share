import { describe, expect, it } from "vitest";

import { roundCanvasGeometry } from "../../../canvas/canvas-canonical";

// AC3 (whole pixels) — angle: a value table driven through the helper one case
// at a time, concentrating on the negative half-plane and on records that carry
// only PART of the geometry (Obsidian omits width/height on some node shapes and
// a partial disk read can drop the rest).

type Rec = Record<string, unknown>;

const CASES: Array<[number, number]> = [
  [0.49, 0],
  [0.5, 1],
  [-0.49, 0],
  [-0.5, 0],
  [-0.51, -1],
  [-1.5, -1],
  [-2.5, -2],
  [1.5, 2],
  [2.5, 3],
  [-1023.75, -1024],
  [4096.5, 4097],
  [-0.000001, 0],
];

describe("capture-side rounding maps geometry to whole pixels (AC3)", () => {
  it.each(CASES)("rounds %f to %i on every geometry key", (input, expected) => {
    const out = roundCanvasGeometry({ id: "n", x: input, y: input, width: input, height: input });

    for (const key of ["x", "y", "width", "height"]) {
      expect(Object.is(out[key], expected)).toBe(true);
    }
  });

  it("rounds a record that carries only x and y", () => {
    const out = roundCanvasGeometry({ id: "n", type: "text", x: -12.5, y: 7.5 });

    expect(out.x).toBe(-12);
    expect(out.y).toBe(8);
    expect("width" in out).toBe(false);
    expect("height" in out).toBe(false);
    expect(out.type).toBe("text");
  });

  it("returns an edge record — which has no geometry — unchanged in content", () => {
    const edgeRecord: Rec = {
      id: "e1",
      fromNode: "a",
      fromSide: "right",
      toNode: "b",
      toSide: "left",
      label: "0.5",
    };

    const out = roundCanvasGeometry(edgeRecord);

    expect(out).toEqual(edgeRecord);
    expect(out).not.toBe(edgeRecord);
  });

  it("leaves non-finite and non-numeric geometry alone rather than coercing it", () => {
    const out = roundCanvasGeometry({
      id: "n",
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      width: "300",
      height: true,
    });

    expect(Number.isNaN(out.x as number)).toBe(true);
    expect(out.y).toBe(Number.POSITIVE_INFINITY);
    expect(out.width).toBe("300");
    expect(out.height).toBe(true);
  });

  it("does not write back into the caller's record", () => {
    const live: Rec = { id: "n", x: 10.9, y: 10.9, width: 10.9, height: 10.9 };

    roundCanvasGeometry(live);
    roundCanvasGeometry(live);

    expect(live.x).toBe(10.9);
    expect(live.height).toBe(10.9);
  });
});
