// WP13 / AC1 (tail case) — blind counterpart 2. Different angle: builds a
// stack of six tail appends and validates strict increase via a `reduce`
// accumulator that also counts violations, asserting the violation count is
// exactly zero — a different assertion mechanism from both the visible test
// (pairwise loop) and blind1 (sort-then-toEqual).

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

describe("WP13 AC1 blind2 — six tail appends never produce an out-of-order adjacent pair", () => {
  it("a reduce-counted scan over six appends finds zero ordering violations", () => {
    const rng = makeRng(55555);
    const base = allocateOrd(undefined, undefined, "peer-base2", rng);

    const appended: string[] = [base];
    let tail = base;
    for (let i = 0; i < 6; i++) {
      tail = allocateOrd(tail, undefined, `peer-tail-${i}`, rng);
      appended.push(tail);
    }

    const violationCount = appended.reduce((count, value, index) => {
      if (index === 0) return count;
      return compareOrd(appended[index - 1], value) < 0 ? count : count + 1;
    }, 0);

    expect(violationCount).toBe(0);
  });

  it("the last appended value is strictly greater than the FIRST value in the whole chain, transitively", () => {
    const rng = makeRng(55556);
    const base = allocateOrd(undefined, undefined, "peer-base3", rng);
    const second = allocateOrd(base, undefined, "peer-t1", rng);
    const third = allocateOrd(second, undefined, "peer-t2", rng);

    expect(compareOrd(base, third)).toBeLessThan(0);
  });
});
