// WP12 / AC3 (mechanism) — delete, undo and quarantine are "one converging
// mechanism with a single suppression rule" (Definition of Done). This test
// proves undo is not special-cased: a late-arriving undo with a LOWER t than
// an already-applied delete must not resurrect the record, exactly as any
// other stale op would lose under AC1's LWW rule. Only a fresh (higher-t)
// undo restores it.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
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

describe("WP12 AC3 — a stale (lower-t) undo never resurrects a record over a later delete; undo obeys the same LWW rule as any other op", () => {
  it("an undo op with lower t than an already-applied delete leaves the record suppressed", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-7", { t: 10, by: "peer-b", on: true }); // the delete
    applyTombstoneOp(map, "card-7", { t: 6, by: "peer-a", on: false }); // stale, arrives late

    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-7"))).toBe(true);
  });

  it("a fresh (higher-t) undo does restore the record", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-7", { t: 10, by: "peer-b", on: true });
    applyTombstoneOp(map, "card-7", { t: 11, by: "peer-a", on: false });

    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-7"))).toBe(false);
  });
});
