// WP12 AC1 — commutativity/idempotence, attacked from a different angle:
// idempotence is checked by applying the SAME op three times in a row (not
// twice), and commutativity is checked with a quarantine entry included in
// the pair set. Different data from the visible test.

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

describe("WP12 AC1 — merge stays commutative and idempotent under a different data set", () => {
  it("merging a with b yields the same result as merging b with a, including a quarantine entry in the pair", () => {
    const pairs: Array<[TombstoneEntry, TombstoneEntry]> = [
      [
        { t: 100, by: "alpha", on: true, q: true },
        { t: 50, by: "beta", on: false },
      ],
      [
        { t: 8, by: "kappa", on: false },
        { t: 8, by: "kappa", on: false },
      ],
    ];

    for (const [a, b] of pairs) {
      expect(mergeTombstoneEntries(a, b)).toEqual(mergeTombstoneEntries(b, a));
    }
  });

  it("applying the identical op to the same map three times in a row never changes the stored entry after the first apply", () => {
    const map = new StubTombstoneMap();
    const op: TombstoneEntry = { t: 17, by: "peer-repeat", on: true, q: true };

    const first = applyTombstoneOp(map, "card-repeat", op);
    applyTombstoneOp(map, "card-repeat", op);
    const third = applyTombstoneOp(map, "card-repeat", op);

    expect(third).toEqual(first);
    expect(readTombstoneEntry(map, "card-repeat")).toEqual(op);
  });
});
