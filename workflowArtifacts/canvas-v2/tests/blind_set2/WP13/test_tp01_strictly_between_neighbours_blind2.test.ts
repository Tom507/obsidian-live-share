// WP13 / AC1 (middle case) — blind counterpart 2. Different angle again:
// builds the neighbour pair from a TAIL chain (two consecutive appends, not
// the seed pair used by the visible test or blind1's insert-into-gaps chain)
// and additionally checks `compareOrd`'s ANTISYMMETRY explicitly
// (`compareOrd(a, b) === -compareOrd(b, a)`) alongside the strict-between
// claim, which neither sibling test exercises.

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

describe("WP13 AC1 blind2 — a middle allocation between two tail-chained neighbours is strictly between them", () => {
  it("allocating between the two most recently appended elements sits strictly between them", () => {
    const rng = makeRng(31337);
    const root = allocateOrd(undefined, undefined, "peer-root", rng);
    const nextToLast = allocateOrd(root, undefined, "peer-second", rng);
    const last = allocateOrd(nextToLast, undefined, "peer-third", rng);

    const inserted = allocateOrd(nextToLast, last, "peer-insert", rng);

    expect(compareOrd(nextToLast, inserted)).toBeLessThan(0);
    expect(compareOrd(inserted, last)).toBeLessThan(0);
  });

  it("compareOrd is antisymmetric for the neighbour pair and the freshly inserted value", () => {
    const rng = makeRng(31338);
    const root = allocateOrd(undefined, undefined, "peer-root2", rng);
    const tail = allocateOrd(root, undefined, "peer-tail2", rng);
    const inserted = allocateOrd(root, tail, "peer-insert2", rng);

    expect(compareOrd(root, inserted)).toBe(-compareOrd(inserted, root));
    expect(compareOrd(inserted, tail)).toBe(-compareOrd(tail, inserted));
    expect(compareOrd(root, tail)).toBe(-compareOrd(tail, root));
  });
});
