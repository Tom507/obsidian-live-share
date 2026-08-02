// WP13 / AC2 (part 2) — the resulting (ord, id) total order is identical on
// every replica.
//
// A "replica" here is simulated as: the same set of {ord, id} entries handed
// to `compareOrdId` in a DIFFERENT starting permutation. If the comparator is
// a genuine total order, `Array.prototype.sort` must converge to the same
// final sequence regardless of the array's initial order — exactly the
// property that makes WP17's canonical serialiser byte-identical across
// replicas that received the same deltas in different wire orders.
//
// This also pins the comparator's tie-break rule for the (rare, but
// spec-required) case of two entries sharing an identical `ord`: order falls
// back to `id`. That fallback is part of "a total order that all replicas
// compute identically" — without it, two colliding ords would leave the
// order UNDEFINED rather than merely improbable.

import { describe, expect, it } from "vitest";

import { allocateOrd, compareOrdId, type OrdIdEntry } from "../../../canvas/canvas-ord";

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

describe("WP13 AC2 — (ord, id) total order agrees across replicas regardless of arrival order", () => {
  it("sorting the same entries from two different starting permutations yields the same sequence", () => {
    const rng = makeRng(200);
    const a = allocateOrd(undefined, undefined, "client-a", rng);
    const b = allocateOrd(a, undefined, "client-b", rng);
    const mid1 = allocateOrd(a, b, "client-1", rng);
    const mid2 = allocateOrd(a, b, "client-2", rng);

    const entries: OrdIdEntry[] = [
      { ord: b, id: "tail-node" },
      { ord: mid1, id: "mid-node-1" },
      { ord: a, id: "head-node" },
      { ord: mid2, id: "mid-node-2" },
    ];

    const replicaOne = [...entries].sort(compareOrdId);
    const replicaTwo = [...entries].reverse().sort(compareOrdId);
    const replicaThree = [entries[2], entries[0], entries[3], entries[1]].sort(compareOrdId);

    const idsOne = replicaOne.map((e) => e.id);
    const idsTwo = replicaTwo.map((e) => e.id);
    const idsThree = replicaThree.map((e) => e.id);

    expect(idsTwo).toEqual(idsOne);
    expect(idsThree).toEqual(idsOne);
  });

  it("two entries sharing an identical ord are ordered by id, consistently in both directions", () => {
    const collidingOrd = "shared-ord-value";
    const entryLow: OrdIdEntry = { ord: collidingOrd, id: "aaa" };
    const entryHigh: OrdIdEntry = { ord: collidingOrd, id: "zzz" };

    expect(compareOrdId(entryLow, entryHigh)).toBeLessThan(0);
    expect(compareOrdId(entryHigh, entryLow)).toBeGreaterThan(0);
    expect(compareOrdId(entryLow, entryLow)).toBe(0);
  });

  it("a batch of five entries with two colliding ords still sorts identically from any permutation", () => {
    const rng = makeRng(201);
    const a = allocateOrd(undefined, undefined, "client-a", rng);
    const b = allocateOrd(a, undefined, "client-b", rng);
    const collidingOrd = allocateOrd(a, b, "client-collide", rng);

    const entries: OrdIdEntry[] = [
      { ord: a, id: "head" },
      { ord: collidingOrd, id: "record-b" },
      { ord: collidingOrd, id: "record-a" },
      { ord: b, id: "tail" },
    ];

    const forward = [...entries].sort(compareOrdId).map((e) => e.id);
    const shuffled = [entries[3], entries[1], entries[0], entries[2]].sort(compareOrdId).map((e) => e.id);

    expect(shuffled).toEqual(forward);
    // The two colliding entries land adjacent, ordered by id ("record-a" < "record-b").
    const collideIndexA = forward.indexOf("record-a");
    const collideIndexB = forward.indexOf("record-b");
    expect(collideIndexA).toBe(collideIndexB - 1);
  });
});
