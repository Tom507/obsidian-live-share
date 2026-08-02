// WP13 / AC1 (tail case) — blind counterpart 1. Different angle: appends
// FOUR times in a row and validates the whole chain with `sort(compareOrd)`
// against the construction order, mirroring blind1's head test but for
// appends — a different data vocabulary and a different chain length from
// the visible tail test (which used 3 appends and pairwise checks only).

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

describe("WP13 AC1 blind1 — repeated tail appends stay in strict ascending append order", () => {
  it("four consecutive appends form a chain that sorts identically to its construction order", () => {
    const rng = makeRng(650);
    const anchor = allocateOrd(undefined, undefined, "author-anchor", rng);

    let back = anchor;
    const appended: string[] = [];
    for (let i = 0; i < 4; i++) {
      back = allocateOrd(back, undefined, `author-append-${i}`, rng);
      appended.push(back);
    }

    const expectedAscending = [anchor, ...appended];
    const shuffledInput = [...appended].reverse().concat(anchor);
    const actualAscending = shuffledInput.sort(compareOrd);

    expect(actualAscending).toEqual(expectedAscending);
  });

  it("a tail insertion never collides with the element it follows", () => {
    const rng = makeRng(651);
    const anchor = allocateOrd(undefined, undefined, "author-anchor2", rng);
    const tail = allocateOrd(anchor, undefined, "author-newtail", rng);

    expect(compareOrd(anchor, tail)).not.toBe(0);
    expect(tail).not.toBe(anchor);
  });
});
