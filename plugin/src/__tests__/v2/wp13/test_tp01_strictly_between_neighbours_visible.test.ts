// WP13 / AC1 (middle case) — an allocated value sorts strictly between its two
// neighbours under the MODULE'S OWN comparator.
//
// Why `compareOrd` and never `<`: `compareOrd` is the single shared definition
// of ord order (Shared Ownership Contract §1 — WP8, WP16 and WP17 all import
// it). A test that asserted `mid < after` with plain JS string comparison
// would still go green even if `compareOrd`'s collation disagreed with `<` —
// exactly the silent-divergence failure mode this WP exists to prevent. So
// every ordering assertion in this WP's suite goes through `compareOrd`, never
// through a raw operator on the string.
//
// The two neighbours themselves come from the allocator, not from hand-picked
// literals — using `allocateOrd` to seed `before`/`after` means this test
// never has to assume anything about the alphabet's shape, only about the
// comparator's contract.

import { describe, expect, it } from "vitest";

import { allocateOrd, compareOrd } from "../../../canvas/canvas-ord";

/** Deterministic seam per BUILD_SPEC: mulberry32, no Math.random, reproducible. */
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

describe("WP13 AC1 — allocated value sorts strictly between its neighbours (middle case)", () => {
  it("allocateOrd(before, after, clientID) sits strictly between before and after per compareOrd", () => {
    const rng = makeRng(1);
    const before = allocateOrd(undefined, undefined, "client-seed-lo", rng);
    const after = allocateOrd(before, undefined, "client-seed-hi", rng);

    const mid = allocateOrd(before, after, "client-mid", rng);

    expect(compareOrd(before, mid)).toBeLessThan(0);
    expect(compareOrd(mid, after)).toBeLessThan(0);
  });

  it("holds across several independent (before, after) pairs, not just one lucky case", () => {
    const rng = makeRng(2);
    let lo = allocateOrd(undefined, undefined, "seed-a", rng);
    let hi = allocateOrd(lo, undefined, "seed-b", rng);

    for (let i = 0; i < 5; i++) {
      const mid = allocateOrd(lo, hi, `client-${i}`, rng);
      expect(compareOrd(lo, mid)).toBeLessThan(0);
      expect(compareOrd(mid, hi)).toBeLessThan(0);
      // Widen the window each round by pushing a fresh neighbour past `hi`,
      // so each iteration exercises a genuinely different pair.
      hi = allocateOrd(hi, undefined, `client-widen-${i}`, rng);
    }
  });

  it("compareOrd is reflexive: a value never sorts strictly before or after itself", () => {
    const rng = makeRng(3);
    const value = allocateOrd(undefined, undefined, "client-self", rng);
    expect(compareOrd(value, value)).toBe(0);
  });
});
