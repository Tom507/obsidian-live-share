// WP12 AC3 (mechanism) — same guarantee, attacked with a three-op chain
// instead of the visible test's two-op sequence: delete, then a fresh undo
// restores the record, then a STALE delete (lower t than the undo) arrives
// late and must NOT re-suppress it. This proves the "no special-casing"
// property holds symmetrically — stale ops lose no matter which direction
// they point.

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

describe("WP12 AC3 — a stale delete arriving after a fresher undo does not re-suppress the record", () => {
  it("delete(t=5) -> undo(t=8) restores it -> stale delete(t=6) arriving late changes nothing", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-chain", { t: 5, by: "peer-a", on: true });
    applyTombstoneOp(map, "card-chain", { t: 8, by: "peer-b", on: false });
    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-chain"))).toBe(false);

    applyTombstoneOp(map, "card-chain", { t: 6, by: "peer-c", on: true }); // stale, arrives after the undo
    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-chain"))).toBe(false);
  });
});
