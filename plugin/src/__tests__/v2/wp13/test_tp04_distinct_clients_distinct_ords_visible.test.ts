// WP13 / AC2 (part 1) — two clients allocating between the SAME pair of
// neighbours produce DIFFERENT strings (jitter + clientID suffix).
//
// This is a PURE function with an explicit `clientID` parameter (BUILD_SPEC
// §"Interfaces"), so per the WP13 test-design rule it is fed two different
// clientIDs directly rather than simulated through concurrent Yjs writes —
// concurrent same-key CRDT writes are a coin flip (Shared Ownership Contract
// §4) and would be the wrong oracle for a deterministic pure function.
//
// The two calls share the SAME seeded rng sequence (a fresh generator with an
// identical seed for each call), so if the two outputs differ, the difference
// is attributable to `clientID`, not to incidentally different jitter draws.

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

describe("WP13 AC2 — distinct clientIDs allocating between the same pair produce distinct ords", () => {
  it("two clients, same neighbours, same rng seed per call → different ord strings", () => {
    const setupRng = makeRng(100);
    const before = allocateOrd(undefined, undefined, "client-lo", setupRng);
    const after = allocateOrd(before, undefined, "client-hi", setupRng);

    const fromClientA = allocateOrd(before, after, "client-alpha", makeRng(777));
    const fromClientB = allocateOrd(before, after, "client-beta", makeRng(777));

    expect(fromClientA).not.toBe(fromClientB);
  });

  it("both clients' allocations remain strictly between the shared neighbours", () => {
    const setupRng = makeRng(101);
    const before = allocateOrd(undefined, undefined, "client-lo", setupRng);
    const after = allocateOrd(before, undefined, "client-hi", setupRng);

    const fromClientA = allocateOrd(before, after, "client-alpha", makeRng(888));
    const fromClientB = allocateOrd(before, after, "client-beta", makeRng(888));

    expect(compareOrd(before, fromClientA)).toBeLessThan(0);
    expect(compareOrd(fromClientA, after)).toBeLessThan(0);
    expect(compareOrd(before, fromClientB)).toBeLessThan(0);
    expect(compareOrd(fromClientB, after)).toBeLessThan(0);
  });

  it("holds for three distinct clientIDs racing the same pair, not just two", () => {
    const setupRng = makeRng(102);
    const before = allocateOrd(undefined, undefined, "client-lo", setupRng);
    const after = allocateOrd(before, undefined, "client-hi", setupRng);

    const results = ["client-x", "client-y", "client-z"].map((clientID) =>
      allocateOrd(before, after, clientID, makeRng(999)),
    );

    expect(new Set(results).size).toBe(results.length);
  });
});
