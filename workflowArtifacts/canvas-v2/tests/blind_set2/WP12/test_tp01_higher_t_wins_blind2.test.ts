// WP12 AC1 — same guarantee, attacked via applyTombstoneOp on a stub map
// with the HIGHER-t op applied FIRST and the lower-t op arriving SECOND
// (write order reversed relative to t order). A naive "last write wins"
// implementation that skips the (t, by) comparison would let the
// later-applied, lower-t op silently overwrite the correct state — this
// test catches exactly that bug.

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

describe("WP12 AC1 — the higher-t op wins even when it is applied to the map before the lower-t op arrives", () => {
  it("applying the winning (higher t) op first, then a losing (lower t) op, leaves the higher-t state in place", () => {
    const map = new StubTombstoneMap();

    applyTombstoneOp(map, "card-order", { t: 50, by: "peer-first", on: true });
    applyTombstoneOp(map, "card-order", { t: 12, by: "peer-second", on: false }); // arrives later, but t is lower

    const final = readTombstoneEntry(map, "card-order");
    expect(final).toEqual({ t: 50, by: "peer-first", on: true });
    expect(isTombstoneSuppressed(final)).toBe(true);
  });
});
