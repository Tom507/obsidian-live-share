// WP12 / AC4 (part 2) — "releasing quarantine restores the record without a
// user-visible delete/undelete event."
//
// WP12 owns only the q flag MECHANICS (the quarantine auditor's decision
// logic is WP20's, out of scope here — TaskCharter §2). What is in scope and
// testable now: this module offers no event/notification side channel at
// all, for ANY transition, and a quarantine release goes through the exact
// same `applyTombstoneOp` mechanism as an ordinary undo — there is no
// dedicated "release" function whose mere existence a caller could treat as
// a signal to show the user something.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, isTombstoneQuarantined, isTombstoneSuppressed } from "../../../canvas/canvas-tombstone";
import type { TombstoneMap } from "../../../canvas/canvas-tombstone";
import * as CanvasTombstone from "../../../canvas/canvas-tombstone";

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

describe("WP12 AC4 — releasing a quarantine restores the record through the same mechanism as undo, with no separate user-visible event channel", () => {
  it("the module exports no event/notification surface at all", () => {
    const eventLikePattern = /event|notify|emit|listener|subscribe|onchange/i;
    const offending = Object.keys(CanvasTombstone).filter((name) => eventLikePattern.test(name));
    expect(offending).toEqual([]);
  });

  it("release uses applyTombstoneOp exactly like an ordinary undo — no dedicated release function exists or is needed", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-77", { t: 1, by: "peer-a", on: true, q: true }); // quarantined
    expect(isTombstoneSuppressed(applyTombstoneOp(map, "card-77", { t: 1, by: "peer-a", on: true, q: true }))).toBe(
      true,
    );
    expect(isTombstoneQuarantined(applyTombstoneOp(map, "card-77", { t: 1, by: "peer-a", on: true, q: true }))).toBe(
      true,
    );

    const released = applyTombstoneOp(map, "card-77", { t: 2, by: "auditor", on: false }); // release, same call shape as undo

    expect(isTombstoneSuppressed(released)).toBe(false);
  });

  it("a plain user undo and a quarantine release produce an identically-shaped result entry", () => {
    const undoMap = new StubTombstoneMap();
    applyTombstoneOp(undoMap, "card-a", { t: 1, by: "peer-a", on: true });
    const undone = applyTombstoneOp(undoMap, "card-a", { t: 2, by: "peer-a", on: false });

    const releaseMap = new StubTombstoneMap();
    applyTombstoneOp(releaseMap, "card-b", { t: 1, by: "peer-a", on: true, q: true });
    const released = applyTombstoneOp(releaseMap, "card-b", { t: 2, by: "peer-a", on: false });

    expect(Object.keys(undone as object).sort()).toEqual(Object.keys(released as object).sort());
    expect(isTombstoneSuppressed(undone)).toBe(isTombstoneSuppressed(released));
  });
});
