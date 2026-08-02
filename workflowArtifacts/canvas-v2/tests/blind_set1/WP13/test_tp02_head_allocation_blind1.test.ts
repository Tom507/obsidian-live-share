// WP13 / AC1 (head case) — blind counterpart 1. Different angle: prepends
// FOUR times in a row and checks the whole resulting chain with a single
// `sort(compareOrd)` call rather than pairwise assertions, and separately
// checks that a head insertion never equals the element it was inserted in
// front of.

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

describe("WP13 AC1 blind1 — repeated head prepends stay in strict descending prepend order", () => {
  it("four consecutive prepends form a chain that sorts identically to its construction order", () => {
    const rng = makeRng(600);
    const anchor = allocateOrd(undefined, undefined, "author-anchor", rng);

    let front = anchor;
    const prepended: string[] = [];
    for (let i = 0; i < 4; i++) {
      front = allocateOrd(undefined, front, `author-prepend-${i}`, rng);
      prepended.push(front);
    }

    // prepended[3] is the earliest in sequence order, prepended[0] the latest.
    const expectedAscending = [...prepended].reverse().concat(anchor);
    const shuffledInput = [anchor, ...prepended];
    const actualAscending = shuffledInput.sort(compareOrd);

    expect(actualAscending).toEqual(expectedAscending);
  });

  it("a head insertion never collides with the element it precedes", () => {
    const rng = makeRng(601);
    const anchor = allocateOrd(undefined, undefined, "author-anchor2", rng);
    const head = allocateOrd(undefined, anchor, "author-newhead", rng);

    expect(compareOrd(head, anchor)).not.toBe(0);
    expect(head).not.toBe(anchor);
  });
});
