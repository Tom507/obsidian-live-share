// WP13 / AC2 (part 2) — blind counterpart 2. Different angle: an EIGHT-entry
// batch with TWO separate colliding-ord pairs (not one, unlike the visible
// test), sorted from four fixed hand-written permutations (not
// reverse/interleave helpers), asserting all four converge — a materially
// larger and structurally different dataset from both siblings.

import { describe, expect, it } from "vitest";

import { allocateOrd, compareOrdId, type OrdIdEntry } from "../../../../../plugin/src/canvas/canvas-ord";

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

describe("WP13 AC2 blind2 — eight entries with two colliding-ord pairs still converge to one order from four permutations", () => {
  it("four hand-written permutations of an eight-entry batch all sort identically", () => {
    const rng = makeRng(11111);
    const a = allocateOrd(undefined, undefined, "peer-a", rng);
    const b = allocateOrd(a, undefined, "peer-b", rng);
    const c = allocateOrd(b, undefined, "peer-c", rng);
    const collide1 = allocateOrd(a, b, "peer-collide-1", rng);
    const collide2 = allocateOrd(b, c, "peer-collide-2", rng);

    const batch: OrdIdEntry[] = [
      { ord: a, id: "rec-a" },
      { ord: collide1, id: "rec-collide1-y" },
      { ord: collide1, id: "rec-collide1-x" },
      { ord: b, id: "rec-b" },
      { ord: collide2, id: "rec-collide2-y" },
      { ord: collide2, id: "rec-collide2-x" },
      { ord: c, id: "rec-c" },
    ];

    const permA = [batch[3], batch[0], batch[6], batch[1], batch[4], batch[2], batch[5]];
    const permB = [batch[6], batch[5], batch[4], batch[3], batch[2], batch[1], batch[0]];
    const permC = [batch[1], batch[2], batch[3], batch[4], batch[5], batch[6], batch[0]];
    const permD = [...batch];

    const idsA = [...permA].sort(compareOrdId).map((e) => e.id);
    const idsB = [...permB].sort(compareOrdId).map((e) => e.id);
    const idsC = [...permC].sort(compareOrdId).map((e) => e.id);
    const idsD = [...permD].sort(compareOrdId).map((e) => e.id);

    expect(idsB).toEqual(idsA);
    expect(idsC).toEqual(idsA);
    expect(idsD).toEqual(idsA);

    // Within each colliding pair, id order is deterministic (lexicographic).
    expect(idsA.indexOf("rec-collide1-x")).toBeLessThan(idsA.indexOf("rec-collide1-y"));
    expect(idsA.indexOf("rec-collide2-x")).toBeLessThan(idsA.indexOf("rec-collide2-y"));
  });
});
