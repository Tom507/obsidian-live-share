// WP12 AC1 — the equal-t tiebreak, attacked with a three-way sequential
// application via applyTombstoneOp (rather than the raw merge function) and
// three distinct `by` values applied in a NON-sorted arrival order. The
// final winner must be the greatest `by` regardless of the order the three
// ops were applied in.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import type { TombstoneMap } from "../../../canvas/canvas-tombstone";

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

describe("WP12 AC1 — equal-t tiebreak resolves to the greatest by, independent of application order", () => {
  it("applying by='m' then by='a' then by='z' (all same t) ends on 'z'", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-tie", { t: 8, by: "m", on: true });
    applyTombstoneOp(map, "card-tie", { t: 8, by: "a", on: false });
    applyTombstoneOp(map, "card-tie", { t: 8, by: "z", on: true, q: true });

    expect(readTombstoneEntry(map, "card-tie")).toEqual({ t: 8, by: "z", on: true, q: true });
  });

  it("applying the same three ops in a different order ('z' first) still ends on 'z'", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-tie-2", { t: 8, by: "z", on: true, q: true });
    applyTombstoneOp(map, "card-tie-2", { t: 8, by: "m", on: true });
    applyTombstoneOp(map, "card-tie-2", { t: 8, by: "a", on: false });

    expect(readTombstoneEntry(map, "card-tie-2")).toEqual({ t: 8, by: "z", on: true, q: true });
  });
});
