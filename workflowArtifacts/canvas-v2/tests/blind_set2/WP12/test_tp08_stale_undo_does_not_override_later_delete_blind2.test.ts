// WP12 AC3 (mechanism) — same "no special-casing" guarantee, attacked with
// the quarantine variant: a quarantine op (t=5), then a STALE release
// attempt (t=3, on:false) arriving late must NOT release it; only a fresh
// (higher-t) release does. This ties AC3's convergence-of-undo property to
// AC4's quarantine mechanics — quarantine release is not exempt from LWW.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, isTombstoneQuarantined, isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
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

describe("WP12 AC3 — a stale release attempt does not override a fresher quarantine", () => {
  it("quarantine(t=5) -> stale release(t=3) changes nothing; the record stays quarantined and suppressed", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-q", { t: 5, by: "auditor", on: true, q: true });
    applyTombstoneOp(map, "card-q", { t: 3, by: "someone", on: false }); // stale

    const entry = readTombstoneEntry(map, "card-q");
    expect(isTombstoneSuppressed(entry)).toBe(true);
    expect(isTombstoneQuarantined(entry)).toBe(true);
  });

  it("a fresh (higher-t) release does restore the record", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-q2", { t: 5, by: "auditor", on: true, q: true });
    applyTombstoneOp(map, "card-q2", { t: 6, by: "auditor", on: false });

    expect(isTombstoneSuppressed(readTombstoneEntry(map, "card-q2"))).toBe(false);
  });
});
