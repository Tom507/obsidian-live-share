// WP13 / AC3 — blind counterpart 1. Different angle from the visible test:
// narrows toward the UPPER neighbour instead of the lower one (mirror-image
// worst case — repeatedly inserting immediately BEFORE the same neighbour
// rather than immediately after), and runs 150 iterations rather than 120.
// Still no wall-clock sleeps or timing constants; still uses compareOrd as
// the sole ordering oracle, never a float midpoint.

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

const ITERATIONS = 150;

describe("WP13 AC3 blind1 — 150 successive inserts narrowing toward the same upper neighbour never collide", () => {
  it("repeatedly inserting immediately before the same ceiling stays collision-free and ordered", () => {
    const rng = makeRng(3000);
    let lo = allocateOrd(undefined, undefined, "author-floor", rng);
    const ceiling = allocateOrd(lo, undefined, "author-ceiling", rng);

    const insertedInOrder: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const mid = allocateOrd(lo, ceiling, `author-insert-${i}`, rng);
      expect(compareOrd(lo, mid)).toBeLessThan(0);
      expect(compareOrd(mid, ceiling)).toBeLessThan(0);
      insertedInOrder.push(mid);
      lo = mid; // each subsequent insert targets an ever-closer neighbour on the LOW side
    }

    expect(new Set(insertedInOrder).size).toBe(ITERATIONS);

    const fullChainAscending = [...insertedInOrder, ceiling];
    const sorted = [...fullChainAscending].sort(compareOrd);
    expect(sorted).toEqual(fullChainAscending);
  });

  it("the allocated strings do not plateau at the original floor/ceiling length", () => {
    const rng = makeRng(3001);
    let lo = allocateOrd(undefined, undefined, "author-floor2", rng);
    const ceiling = allocateOrd(lo, undefined, "author-ceiling2", rng);
    const baselineLength = Math.max(lo.length, ceiling.length);

    let grewAtLeastOnce = false;
    for (let i = 0; i < ITERATIONS; i++) {
      const mid = allocateOrd(lo, ceiling, `author-insert2-${i}`, rng);
      if (mid.length > baselineLength) grewAtLeastOnce = true;
      lo = mid;
    }

    expect(grewAtLeastOnce).toBe(true);
  });
});
