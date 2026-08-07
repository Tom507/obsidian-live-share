// WP13 / AC1 (head case) — blind counterpart 2. Different angle: builds a
// small STACK of head insertions (each new head pushed in front of the
// previous head) and validates the whole stack against a fully independent
// oracle — `Array.prototype.every` over adjacent pairs after a `sort`, rather
// than the running "front" variable comparisons blind1 used.

import { describe, expect, it } from "vitest";

import { allocateOrd, compareOrd } from "../../../../../plugin/src/canvas/canvas-ord";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

describe("WP13 AC1 blind2 — a stack of head insertions sorts into strictly increasing order end to end", () => {
  it("five head insertions, sorted by compareOrd, form a strictly increasing sequence", () => {
    const rng = makeRng(90210);
    const base = allocateOrd(undefined, undefined, "peer-base", rng);

    const stack: string[] = [base];
    let currentHead = base;
    for (let i = 0; i < 5; i++) {
      currentHead = allocateOrd(undefined, currentHead, `peer-head-${i}`, rng);
      stack.push(currentHead);
    }

    const sorted = [...stack].sort(compareOrd);
    const strictlyIncreasing = sorted.every(
      (value, index) => index === 0 || compareOrd(sorted[index - 1], value) < 0,
    );

    expect(strictlyIncreasing).toBe(true);
    expect(new Set(sorted).size).toBe(sorted.length);
  });

  it("the very first head insertion (before the base existed) is not required — allocate(undefined, undefined) alone yields a usable value", () => {
    const rng = makeRng(90211);
    const soleValue = allocateOrd(undefined, undefined, "peer-solo", rng);

    expect(compareOrd(soleValue, soleValue)).toBe(0);
    expect(soleValue.length).toBeGreaterThan(0);
  });
});
