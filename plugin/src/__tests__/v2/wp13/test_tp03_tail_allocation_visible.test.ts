// WP13 / AC1 (tail case) — `allocate(last, undefined)` sorts strictly after
// the existing last element, i.e. "at the end of the sequence" is a real,
// exercised path — the mirror image of tp02's head case, not derivable from
// it by search-and-replace since the allocator is not guaranteed symmetric
// (a jitter/alphabet implementation could legitimately treat "append" and
// "prepend" differently).

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

describe("WP13 AC1 — allocate(last, undefined) sorts strictly after the tail", () => {
  it("allocate(existing, undefined) sorts strictly after that existing value", () => {
    const rng = makeRng(20);
    const existing = allocateOrd(undefined, undefined, "client-existing", rng);

    const tailValue = allocateOrd(existing, undefined, "client-newtail", rng);

    expect(compareOrd(existing, tailValue)).toBeLessThan(0);
  });

  it("a second tail allocation sits after the first tail allocation, chaining correctly", () => {
    const rng = makeRng(21);
    const original = allocateOrd(undefined, undefined, "client-original", rng);
    const firstTail = allocateOrd(original, undefined, "client-tail-1", rng);
    const secondTail = allocateOrd(firstTail, undefined, "client-tail-2", rng);

    expect(compareOrd(original, firstTail)).toBeLessThan(0);
    expect(compareOrd(firstTail, secondTail)).toBeLessThan(0);
    expect(compareOrd(original, secondTail)).toBeLessThan(0);
  });

  it("appending three values in a row produces a strictly increasing chain end to end", () => {
    const rng = makeRng(22);
    let tail = allocateOrd(undefined, undefined, "client-base", rng);
    const chain = [tail];

    for (let i = 0; i < 3; i++) {
      const next = allocateOrd(tail, undefined, `client-append-${i}`, rng);
      chain.push(next);
      tail = next;
    }

    for (let i = 0; i < chain.length - 1; i++) {
      expect(compareOrd(chain[i], chain[i + 1])).toBeLessThan(0);
    }
  });
});
