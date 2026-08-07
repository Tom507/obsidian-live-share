// WP12 / AC1 (part 4) — "identically on every replica."
//
// A "replica" here is simulated as: the same set of ops handed to
// applyTombstoneOp in a DIFFERENT arrival order, on its own independent
// tombstone map. This is the pure-merge-function analogue of WP13's
// replica-order test, and it deliberately does NOT stage a race of raw
// concurrent Y.Map writes on the same key (Shared Ownership Contract §4) —
// Yjs would break that tie on a random clientID, which is not the mechanism
// under test. Three replicas / three arrival orders, per the "never reason
// from two peers only" rule.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry, TombstoneMap } from "../../../canvas/canvas-tombstone";

class StubTombstoneMap implements TombstoneMap {
  private readonly entries = new Map<string, unknown>();
  get(key: string): unknown {
    return this.entries.get(key);
  }
  set(key: string, value: unknown): unknown {
    this.entries.set(key, value);
    return value;
  }
}

describe("WP12 AC1 — tombstone convergence is identical on every replica regardless of arrival order", () => {
  it("three replicas applying the same three ops in three different orders converge to the same entry", () => {
    const ops: TombstoneEntry[] = [
      { t: 4, by: "peer-a", on: true },
      { t: 7, by: "peer-b", on: false },
      { t: 7, by: "peer-c", on: true, q: true },
    ];

    const replicaOne = new StubTombstoneMap();
    for (const op of ops) applyTombstoneOp(replicaOne, "card-9", op);

    const replicaTwo = new StubTombstoneMap();
    for (const op of [ops[2], ops[0], ops[1]]) applyTombstoneOp(replicaTwo, "card-9", op);

    const replicaThree = new StubTombstoneMap();
    for (const op of [ops[1], ops[2], ops[0]]) applyTombstoneOp(replicaThree, "card-9", op);

    const final = readTombstoneEntry(replicaOne, "card-9");
    // t=7 is the highest; between the two t=7 ops, "peer-c" > "peer-b", so
    // ops[2] is the deterministic winner on every replica.
    expect(final).toEqual(ops[2]);
    expect(readTombstoneEntry(replicaTwo, "card-9")).toEqual(final);
    expect(readTombstoneEntry(replicaThree, "card-9")).toEqual(final);
  });
});
