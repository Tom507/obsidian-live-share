// WP13 / AC2 (part 1) — blind counterpart 2. Different angle: nine
// NUMERIC-STRING clientIDs ("1".."9" — an edge case for a suffix-embedding
// jitter scheme, since numeric-looking ids could tempt a naive
// implementation to sort them numerically instead of as opaque strings) race
// the same pair, and uniqueness is checked via `indexOf` round-tripping
// rather than `Set` size, a different mechanism from both siblings.

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

describe("WP13 AC2 blind2 — numeric-string clientIDs racing the same pair still produce distinct ords", () => {
  it("nine numeric-string clientIDs ('1'..'9') each produce an ord unique among the nine", () => {
    const setupRng = makeRng(24680);
    const floor = allocateOrd(undefined, undefined, "peer-floor", setupRng);
    const ceiling = allocateOrd(floor, undefined, "peer-ceiling", setupRng);

    const clientIDs = Array.from({ length: 9 }, (_, i) => String(i + 1));
    const results = clientIDs.map((clientID) => allocateOrd(floor, ceiling, clientID, makeRng(13579)));

    for (let i = 0; i < results.length; i++) {
      expect(results.indexOf(results[i])).toBe(i);
    }
  });

  it("two clients whose ids differ only by case ('Client-X' vs 'client-x') still produce distinct ords", () => {
    const setupRng = makeRng(24681);
    const floor = allocateOrd(undefined, undefined, "peer-floor2", setupRng);
    const ceiling = allocateOrd(floor, undefined, "peer-ceiling2", setupRng);

    const lower = allocateOrd(floor, ceiling, "client-x", makeRng(2468));
    const upper = allocateOrd(floor, ceiling, "Client-X", makeRng(2468));

    expect(lower).not.toBe(upper);
    expect(compareOrd(floor, lower)).toBeLessThan(0);
    expect(compareOrd(lower, ceiling)).toBeLessThan(0);
    expect(compareOrd(floor, upper)).toBeLessThan(0);
    expect(compareOrd(upper, ceiling)).toBeLessThan(0);
  });
});
