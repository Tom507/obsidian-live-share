// WP13 / AC3 — blind counterpart 2. Different angle from both siblings:
// narrows in a ZIGZAG (alternating which side of the window tightens each
// iteration, not always the same side), for 130 iterations. The ascending
// chain is reconstructed incrementally by splicing each new value into its
// exact position (immediately before the side being narrowed), so the final
// assertion checks the WHOLE reconstructed chain against an independent
// `sort(compareOrd)`, not just pairwise loop checks. Still no timing
// constants; still uses compareOrd exclusively as the oracle.

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

const ITERATIONS = 130;

describe("WP13 AC3 blind2 — zigzag narrowing from both sides of the window stays collision-free and ordered", () => {
  it("130 zigzag inserts (alternating which side narrows) never collide and reconstruct into one strict ascending chain", () => {
    const rng = makeRng(20260801);
    const floor = allocateOrd(undefined, undefined, "peer-floor", rng);
    const ceiling = allocateOrd(floor, undefined, "peer-ceiling", rng);

    const chain: string[] = [floor, ceiling];
    let lo = floor;
    let hi = ceiling;

    for (let i = 0; i < ITERATIONS; i++) {
      const mid = allocateOrd(lo, hi, `peer-zigzag-${i}`, rng);
      expect(compareOrd(lo, mid)).toBeLessThan(0);
      expect(compareOrd(mid, hi)).toBeLessThan(0);

      if (i % 2 === 0) {
        // Narrow from the top: mid becomes the new immediate predecessor of `hi`.
        const hiIndex = chain.indexOf(hi);
        chain.splice(hiIndex, 0, mid);
        hi = mid;
      } else {
        // Narrow from the bottom: mid becomes the new immediate successor of `lo`.
        const loIndex = chain.indexOf(lo);
        chain.splice(loIndex + 1, 0, mid);
        lo = mid;
      }
    }

    expect(new Set(chain).size).toBe(chain.length);

    const shuffledCopy = [...chain].reverse();
    expect(shuffledCopy.sort(compareOrd)).toEqual(chain);
  });
});
