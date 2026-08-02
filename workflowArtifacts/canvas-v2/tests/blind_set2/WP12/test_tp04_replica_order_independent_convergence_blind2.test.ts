// WP12 AC1 — replica convergence, attacked with a data set where the winner
// is decided outright by t (no tie among the top candidates), across three
// replicas / three arrival orders — a different shape of fixture from the
// tie-heavy visible and blind1 variants, to make sure the plain "highest t
// wins" path is independently verified for order-independence too.

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
  for (const op of order) applyTombstoneOp(map, "card-solo-winner", op);
  return map;
}

describe("WP12 AC1 — three replicas converge on the outright-highest-t entry regardless of arrival order", () => {
  it("all three replicas land on the op with t=200, the unambiguous highest", () => {
    const ops: TombstoneEntry[] = [
      { t: 40, by: "peer-a", on: true },
      { t: 200, by: "peer-b", on: false },
      { t: 90, by: "peer-c", on: true, q: true },
    ];

    const replicaOne = applyAll(ops);
    const replicaTwo = applyAll([ops[1], ops[2], ops[0]]);
    const replicaThree = applyAll([ops[2], ops[0], ops[1]]);

    const final = readTombstoneEntry(replicaOne, "card-solo-winner");
    expect(final).toEqual(ops[1]);
    expect(readTombstoneEntry(replicaTwo, "card-solo-winner")).toEqual(final);
    expect(readTombstoneEntry(replicaThree, "card-solo-winner")).toEqual(final);
  });
});
