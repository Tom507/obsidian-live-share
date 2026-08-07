// WP13 / AC2 (part 1) — blind counterpart 1. Different angle: ten distinct
// clientIDs (not two or three) race the same pair with the SAME rng seed
// each, and the test asserts full pairwise uniqueness (every pair of the ten
// differs), a stronger and differently-shaped claim than the visible test's
// direct two/three-way comparison.

import { describe, expect, it } from "vitest";

import { allocateOrd, compareOrd } from "../../../../../plugin/src/canvas/canvas-ord";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

describe("WP13 AC2 blind1 — ten distinct clientIDs racing the same pair all produce pairwise-distinct ords", () => {
  it("ten clients, identical neighbours, identical rng seed per call → ten pairwise-distinct strings", () => {
    const setupRng = makeRng(1000);
    const floor = allocateOrd(undefined, undefined, "author-floor", setupRng);
    const ceiling = allocateOrd(floor, undefined, "author-ceiling", setupRng);

    const clientIDs = Array.from({ length: 10 }, (_, i) => `peer-${String(i).padStart(2, "0")}`);
    const results = clientIDs.map((clientID) => allocateOrd(floor, ceiling, clientID, makeRng(4242)));

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        expect(results[i]).not.toBe(results[j]);
      }
    }
  });

  it("every one of the ten results still sorts strictly inside the shared window", () => {
    const setupRng = makeRng(1001);
    const floor = allocateOrd(undefined, undefined, "author-floor", setupRng);
    const ceiling = allocateOrd(floor, undefined, "author-ceiling", setupRng);

    const clientIDs = ["north", "south", "east", "west", "up"];
    const results = clientIDs.map((clientID) => allocateOrd(floor, ceiling, clientID, makeRng(7070)));

    for (const value of results) {
      expect(compareOrd(floor, value)).toBeLessThan(0);
      expect(compareOrd(value, ceiling)).toBeLessThan(0);
    }
  });
});
