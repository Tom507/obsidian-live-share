// WP13 / AC3 — repeated allocation between ever-closer neighbours terminates
// and stays correct: the string GROWS rather than colliding or losing
// precision.
//
// Drives >=100 successive midpoint allocations, always narrowing towards the
// SAME side (the classic worst case for a fractional index: repeatedly
// inserting immediately after the same neighbour). The oracle throughout is
// `compareOrd`, never a floating-point midpoint — the whole point of a
// fractional index as a STRING is that it has no float precision floor to
// exhaust. No wall-clock sleeps, no timing constants (BUILD_SPEC / Shared
// Ownership Contract §4); the loop is bounded by iteration count only.

import { describe, expect, it } from "vitest";

import { allocateOrd, compareOrd } from "../../../canvas/canvas-ord";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITERATIONS = 120;

describe("WP13 AC3 — dense repeated allocation between ever-closer neighbours terminates and stays correct", () => {
  it("120 successive inserts narrowing toward the same lower neighbour never collide and stay ordered", () => {
    const rng = makeRng(300);
    const lo = allocateOrd(undefined, undefined, "client-lo", rng);
    let hi = allocateOrd(lo, undefined, "client-hi", rng);

    const insertedInOrder: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const mid = allocateOrd(lo, hi, `client-${i}`, rng);
      expect(compareOrd(lo, mid)).toBeLessThan(0);
      expect(compareOrd(mid, hi)).toBeLessThan(0);
      insertedInOrder.push(mid);
      hi = mid; // each subsequent insert targets an ever-closer neighbour
    }

    // No two of the 120 allocations collided.
    expect(new Set(insertedInOrder).size).toBe(ITERATIONS);

    // Global correctness, not just pairwise: sorting the full chain
    // (lo, then every insert in REVERSE insertion order, then the original
    // hi) by compareOrd reproduces exactly the chain as constructed.
    const fullChainAscending = [lo, ...[...insertedInOrder].reverse()];
    const sorted = [...fullChainAscending].sort(compareOrd);
    expect(sorted).toEqual(fullChainAscending);
  });

  it("the allocated strings grow rather than plateauing at a fixed length", () => {
    const rng = makeRng(301);
    const lo = allocateOrd(undefined, undefined, "client-lo", rng);
    let hi = allocateOrd(lo, undefined, "client-hi", rng);

    let sawLongerThanInitial = false;
    const initialLength = Math.max(lo.length, hi.length);
    for (let i = 0; i < ITERATIONS; i++) {
      const mid = allocateOrd(lo, hi, `client-${i}`, rng);
      if (mid.length > initialLength) sawLongerThanInitial = true;
      hi = mid;
    }

    // Precision must come from string growth, never from a float that runs
    // out of representable midpoints — so eventually some allocated value
    // must be longer than the two original endpoints.
    expect(sawLongerThanInitial).toBe(true);
  });
});
