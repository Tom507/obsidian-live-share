// WP13 / AC1 (middle case) — blind counterpart 1. Different angle from the
// visible test: builds a FIVE-element chain by repeatedly inserting into the
// tightest remaining gap (rather than a single before/after pair), and
// verifies the entire chain is simultaneously consistent under `compareOrd`
// via a full sort rather than pairwise checks alone. Different data
// vocabulary and a different assertion shape throughout — not a renamed copy.

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

describe("WP13 AC1 blind1 — a five-element chain built by repeated midpoint insertion is fully consistent", () => {
  it("inserting into alternating gaps of a growing chain keeps every adjacent pair strictly ordered under compareOrd", () => {
    const rng = makeRng(555);
    const left = allocateOrd(undefined, undefined, "author-left", rng);
    const right = allocateOrd(left, undefined, "author-right", rng);

    // Insert into the whole gap, then into each half, building a 5-node chain.
    const middle = allocateOrd(left, right, "author-middle", rng);
    const leftQuarter = allocateOrd(left, middle, "author-left-quarter", rng);
    const rightQuarter = allocateOrd(middle, right, "author-right-quarter", rng);

    const chain = [left, leftQuarter, middle, rightQuarter, right];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(compareOrd(chain[i], chain[i + 1])).toBeLessThan(0);
    }

    const sortedCopy = [...chain].reverse().sort(compareOrd);
    expect(sortedCopy).toEqual(chain);
  });

  it("a value allocated between two members of the chain never equals either endpoint per compareOrd", () => {
    const rng = makeRng(556);
    const left = allocateOrd(undefined, undefined, "author-left", rng);
    const right = allocateOrd(left, undefined, "author-right", rng);
    const inserted = allocateOrd(left, right, "author-insert", rng);

    expect(compareOrd(inserted, left)).not.toBe(0);
    expect(compareOrd(inserted, right)).not.toBe(0);
  });
});
