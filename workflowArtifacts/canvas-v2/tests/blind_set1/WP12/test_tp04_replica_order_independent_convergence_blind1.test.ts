// WP12 AC1 — replica convergence, attacked with FOUR replicas / four arrival
// orders and FIVE ops (including a stale undo mixed in among deletes and a
// quarantine), a larger interleaving space than the visible test's three
// replicas / three ops.

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

function applyAll(order: TombstoneEntry[]): StubTombstoneMap {
  const map = new StubTombstoneMap();
  for (const op of order) applyTombstoneOp(map, "card-fanout", op);
  return map;
}

describe("WP12 AC1 — four replicas converge identically over five ops in four different arrival orders", () => {
  it("all four replicas land on the same final entry: the one with the highest t", () => {
    const ops: TombstoneEntry[] = [
      { t: 1, by: "peer-a", on: true },
      { t: 5, by: "peer-b", on: false },
      { t: 3, by: "peer-c", on: false }, // stale undo, arrives out of order
      { t: 9, by: "peer-d", on: true, q: true }, // the eventual winner
      { t: 6, by: "peer-e", on: true },
    ];

    const replicaA = applyAll(ops);
    const replicaB = applyAll([ops[4], ops[0], ops[3], ops[1], ops[2]]);
    const replicaC = applyAll([ops[2], ops[3], ops[4], ops[0], ops[1]]);
    const replicaD = applyAll([...ops].reverse());

    const final = readTombstoneEntry(replicaA, "card-fanout");
    expect(final).toEqual(ops[3]);
    expect(readTombstoneEntry(replicaB, "card-fanout")).toEqual(final);
    expect(readTombstoneEntry(replicaC, "card-fanout")).toEqual(final);
    expect(readTombstoneEntry(replicaD, "card-fanout")).toEqual(final);
  });
});
