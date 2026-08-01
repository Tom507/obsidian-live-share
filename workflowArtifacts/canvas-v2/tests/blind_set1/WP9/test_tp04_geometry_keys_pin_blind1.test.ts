// WP9 AC4 — same pin, attacked by repetition and mutation-guarding: run the
// encode/decode surface many times with varied values and confirm the emitted
// file-shape key set matches GEOMETRY_KEYS on every single call (not just
// once), and that GEOMETRY_KEYS itself is never mutated by any of it.

import { describe, expect, it } from "vitest";

import { decodePos, decodeSize, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { GEOMETRY_KEYS } from "../../../files/canvas-sync";

const SAMPLES: ReadonlyArray<{ x: number; y: number; width: number; height: number }> = [
  { x: 0, y: 0, width: 0, height: 0 },
  { x: 1, y: -1, width: 2, height: 2 },
  { x: -99, y: 99, width: 5, height: 900 },
  { x: 42, y: 42, width: 42, height: 42 },
  { x: -1000, y: 1000, width: 1, height: 1000 },
];

describe("WP9 AC4 — geometry key set holds across repeated encode/decode and is never mutated", () => {
  it("every sample's file shape has exactly the geometry keys", () => {
    const expectedKeys = [...GEOMETRY_KEYS].sort();

    for (const sample of SAMPLES) {
      const merged = {
        ...decodePos(encodePos(sample.x, sample.y)),
        ...decodeSize(encodeSize(sample.width, sample.height)),
      };
      expect(Object.keys(merged).sort()).toEqual(expectedKeys);
    }
  });

  it("GEOMETRY_KEYS keeps its size and membership after all of the above", () => {
    expect(GEOMETRY_KEYS.size).toBe(4);
    for (const key of ["x", "y", "width", "height"]) expect(GEOMETRY_KEYS.has(key)).toBe(true);
  });
});
