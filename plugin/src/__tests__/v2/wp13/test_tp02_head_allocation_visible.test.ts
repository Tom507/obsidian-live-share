// WP13 / AC1 (head case) — `allocate(undefined, first)` sorts strictly before
// the existing first element, i.e. "at the start of the sequence" is a real,
// exercised path, not just the middle case with one side omitted incidentally.
//
// This also exercises the true base case — `allocateOrd(undefined, undefined,
// …)` for a doc with no ord yet — as the setup step, since the head case is
// meaningless without an existing element to sit in front of.

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

describe("WP13 AC1 — allocate(undefined, first) sorts strictly before the head", () => {
  it("the very first allocation (both neighbours absent) returns a non-empty, self-consistent ord", () => {
    const rng = makeRng(10);
    const first = allocateOrd(undefined, undefined, "client-first", rng);

    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
    expect(compareOrd(first, first)).toBe(0);
  });

  it("allocate(undefined, existing) sorts strictly before that existing value", () => {
    const rng = makeRng(11);
    const existing = allocateOrd(undefined, undefined, "client-existing", rng);

    const headValue = allocateOrd(undefined, existing, "client-newhead", rng);

    expect(compareOrd(headValue, existing)).toBeLessThan(0);
  });

  it("a second head allocation sits before the first head allocation, chaining correctly", () => {
    const rng = makeRng(12);
    const original = allocateOrd(undefined, undefined, "client-original", rng);
    const firstHead = allocateOrd(undefined, original, "client-head-1", rng);
    const secondHead = allocateOrd(undefined, firstHead, "client-head-2", rng);

    expect(compareOrd(secondHead, firstHead)).toBeLessThan(0);
    expect(compareOrd(firstHead, original)).toBeLessThan(0);
    expect(compareOrd(secondHead, original)).toBeLessThan(0);
  });
});
