// WP12 / AC4 (part 1) — "Quarantine (q:true with on:true) is distinguishable
// from a user delete."
//
// Both a plain user delete and a quarantine suppress the record identically
// (AC2 is q-agnostic — on:true is on:true), but only the quarantine entry
// must report as quarantined. This also pins the edge case implied by the
// AC's exact wording "q:true WITH on:true": a stale/leftover q:true on an
// entry that is no longer on:true (e.g. after release) must NOT read as
// quarantined — quarantine is a property of the CURRENT suppressed state,
// not a permanent tag on the id.

import { describe, expect, it } from "vitest";

import { isTombstoneQuarantined, isTombstoneSuppressed } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC4 — quarantine is distinguishable from a user delete even though both suppress", () => {
  it("both suppress the record identically, but only the quarantine entry reports as quarantined", () => {
    const userDelete: TombstoneEntry = { t: 5, by: "peer-a", on: true };
    const quarantine: TombstoneEntry = { t: 5, by: "peer-a", on: true, q: true };

    expect(isTombstoneSuppressed(userDelete)).toBe(true);
    expect(isTombstoneSuppressed(quarantine)).toBe(true);

    expect(isTombstoneQuarantined(userDelete)).toBe(false);
    expect(isTombstoneQuarantined(quarantine)).toBe(true);
  });

  it("a leftover q:true on an entry that is no longer on:true does not read as quarantined", () => {
    const releasedButQFlagLingers: TombstoneEntry = { t: 9, by: "peer-c", on: false, q: true };

    expect(isTombstoneSuppressed(releasedButQFlagLingers)).toBe(false);
    expect(isTombstoneQuarantined(releasedButQFlagLingers)).toBe(false);
  });
});
