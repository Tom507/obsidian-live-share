// WP12 AC4 — same "no user-visible event" guarantee, attacked by scanning
// for a dedicated release/quarantine-specific function name. If WP12 (or a
// later WP re-implementing on top of it) ever added a `releaseQuarantine` /
// `unquarantine` / `revokeQuarantine` export, that would be exactly the
// "separate signal a caller could treat as an event" this AC forbids —
// release must go through the same general applyTombstoneOp path as any
// other op.

import { describe, expect, it } from "vitest";

import { applyTombstoneOp, isTombstoneSuppressed } from "../../../canvas/canvas-tombstone";
import * as CanvasTombstone from "../../../canvas/canvas-tombstone";
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

describe("WP12 AC4 — no dedicated quarantine-release export exists; release is an ordinary applyTombstoneOp call", () => {
  it("no exported name matches a release/unquarantine/revoke naming pattern", () => {
    const releaseLikePattern = /releasequarantine|unquarantine|revokequarantine|quarantinerelease/i;
    const offending = Object.keys(CanvasTombstone).filter((name) => releaseLikePattern.test(name));
    expect(offending).toEqual([]);
  });

  it("the single general-purpose applyTombstoneOp is sufficient to both quarantine and release, with no other function involved", () => {
    const map = new StubTombstoneMap();
    applyTombstoneOp(map, "card-final", { t: 1, by: "auditor", on: true, q: true });
    const released = applyTombstoneOp(map, "card-final", { t: 2, by: "auditor", on: false });

    expect(isTombstoneSuppressed(released)).toBe(false);
  });
});
