// WP12 / AC1 (part 3) — "converge ... identically on every replica" implies
// the merge is commutative (order of the two inputs never changes the
// result) and idempotent (merging a value with itself, or re-applying the
// same op twice, changes nothing). These are the two algebraic properties
// that make convergence possible at all — without them, two replicas that
// received the same two ops in different order, or one replica that saw an
// op retransmitted, could disagree.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, mergeTombstoneEntries, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
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

describe("WP12 AC1 — the merge is commutative and idempotent", () => {
  it("merging a with b yields the same result as merging b with a, for several distinct (t, by) pairs", () => {
    const pairs: Array<[TombstoneEntry, TombstoneEntry]> = [
      [
        { t: 1, by: "p1", on: true },
        { t: 2, by: "p2", on: false },
      ],
      [
        { t: 4, by: "p3", on: false },
        { t: 4, by: "p1", on: true },
      ],
      [
        { t: 9, by: "zzz", on: true, q: true },
        { t: 9, by: "aaa", on: false },
      ],
    ];

    for (const [a, b] of pairs) {
      expect(mergeTombstoneEntries(a, b)).toEqual(mergeTombstoneEntries(b, a));
    }
  });

  it("merging an entry with itself changes nothing", () => {
    const entry: TombstoneEntry = { t: 6, by: "solo", on: true, q: true };
    expect(mergeTombstoneEntries(entry, entry)).toEqual(entry);
  });

  it("re-applying the identical op to the same map twice via applyTombstoneOp is a no-op the second time", () => {
    const map = new StubTombstoneMap();
    const op: TombstoneEntry = { t: 3, by: "peer-x", on: true };

    const first = applyTombstoneOp(map, "card-1", op);
    const second = applyTombstoneOp(map, "card-1", op);

    expect(second).toEqual(first);
    expect(readTombstoneEntry(map, "card-1")).toEqual(op);
  });
});
