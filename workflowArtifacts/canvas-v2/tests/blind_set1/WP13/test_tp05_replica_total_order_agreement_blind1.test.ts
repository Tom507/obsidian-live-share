// WP13 / AC2 (part 2) — blind counterpart 1. Different angle: simulates
// three "replicas" (never two — Shared Ownership Contract §4) each receiving
// the SAME seven records in a genuinely different delivery order (forward,
// interleaved, reverse), and asserts all three converge on one canonical
// `(ord, id)` sequence. No ord collisions in this data set, unlike the
// visible test which also covers the colliding-ord tie-break — a distinct
// angle on the same "total order agreement" claim.

import { describe, expect, it } from "vitest";

import { allocateOrd, compareOrdId, type OrdIdEntry } from "../../../../../plugin/src/canvas/canvas-ord";

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

describe("WP13 AC2 blind1 — three simulated replicas converge on one (ord, id) sequence from three delivery orders", () => {
  it("forward, interleaved and reverse delivery orders all sort to the same final sequence", () => {
    const rng = makeRng(2000);
    const n1 = allocateOrd(undefined, undefined, "author-n1", rng);
    const n2 = allocateOrd(n1, undefined, "author-n2", rng);
    const n3 = allocateOrd(n1, n2, "author-n3", rng);
    const n4 = allocateOrd(n3, n2, "author-n4", rng);

    const canonical: OrdIdEntry[] = [
      { ord: n1, id: "record-1" },
      { ord: n3, id: "record-3" },
      { ord: n4, id: "record-4" },
      { ord: n2, id: "record-2" },
    ];

    const replicaForward = [...canonical];
    const replicaInterleaved = [canonical[2], canonical[0], canonical[3], canonical[1]];
    const replicaReverse = [...canonical].reverse();

    const sortedForward = replicaForward.sort(compareOrdId).map((e) => e.id);
    const sortedInterleaved = replicaInterleaved.sort(compareOrdId).map((e) => e.id);
    const sortedReverse = replicaReverse.sort(compareOrdId).map((e) => e.id);

    expect(sortedInterleaved).toEqual(sortedForward);
    expect(sortedReverse).toEqual(sortedForward);
  });

  it("compareOrdId is antisymmetric for every distinct pair in the batch", () => {
    const rng = makeRng(2001);
    const n1 = allocateOrd(undefined, undefined, "author-p1", rng);
    const n2 = allocateOrd(n1, undefined, "author-p2", rng);
    const n3 = allocateOrd(n1, n2, "author-p3", rng);

    const entries: OrdIdEntry[] = [
      { ord: n1, id: "p1" },
      { ord: n2, id: "p2" },
      { ord: n3, id: "p3" },
    ];

    for (const a of entries) {
      for (const b of entries) {
        if (a === b) continue;
        expect(compareOrdId(a, b)).toBe(-compareOrdId(b, a));
      }
    }
  });
});
