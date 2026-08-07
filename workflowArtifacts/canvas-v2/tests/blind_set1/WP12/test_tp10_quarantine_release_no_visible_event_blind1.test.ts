// WP12 AC4 — same "no user-visible event" guarantee, attacked structurally:
// normalise both a plain undo result and a quarantine-release result down to
// their KEY SHAPE (ignoring the actual t/by/on values) and assert the two
// shapes are identical — proving the release path does not attach any extra
// field (an "event", "notified", "visibleChange" marker, etc.) that a plain
// undo would not also carry.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp } from "../../../canvas/canvas-tombstone";
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

function keyShape(value: unknown): string[] {
  return Object.keys(value as object).sort();
}

describe("WP12 AC4 — a quarantine-release result carries no extra key beyond a plain undo result", () => {
  it("the two results normalise to the identical key shape", () => {
    const undoMap = new StubTombstoneMap();
    applyTombstoneOp(undoMap, "plain-1", { t: 10, by: "peer-q", on: true });
    const plainUndoResult = applyTombstoneOp(undoMap, "plain-1", { t: 20, by: "peer-q", on: false });

    const releaseMap = new StubTombstoneMap();
    applyTombstoneOp(releaseMap, "quarantined-1", { t: 10, by: "auditor", on: true, q: true });
    const releaseResult = applyTombstoneOp(releaseMap, "quarantined-1", { t: 20, by: "auditor", on: false });

    expect(keyShape(releaseResult)).toEqual(keyShape(plainUndoResult));
  });
});
