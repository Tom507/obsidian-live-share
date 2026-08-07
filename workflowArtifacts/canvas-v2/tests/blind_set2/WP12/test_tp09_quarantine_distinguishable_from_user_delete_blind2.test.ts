// WP12 AC4 — same distinguishability guarantee, attacked with the explicit
// q:false-vs-absent edge case: an entry with q EXPLICITLY set to false must
// read identically to one where q is simply absent — neither is quarantine —
// while a bona fide q:true, on:true entry is.

import { describe, expect, it } from "vitest";

import { isTombstoneQuarantined, isTombstoneSuppressed } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC4 — an explicit q:false is indistinguishable from an absent q, and neither is quarantine", () => {
  it("q:false and q-absent both report not-quarantined, while both still suppress", () => {
    const qExplicitlyFalse: TombstoneEntry = { t: 1, by: "peer-a", on: true, q: false };
    const qAbsent: TombstoneEntry = { t: 1, by: "peer-a", on: true };
    const qTrue: TombstoneEntry = { t: 1, by: "peer-a", on: true, q: true };

    expect(isTombstoneQuarantined(qExplicitlyFalse)).toBe(false);
    expect(isTombstoneQuarantined(qAbsent)).toBe(false);
    expect(isTombstoneQuarantined(qTrue)).toBe(true);

    expect(isTombstoneSuppressed(qExplicitlyFalse)).toBe(true);
    expect(isTombstoneSuppressed(qAbsent)).toBe(true);
    expect(isTombstoneSuppressed(qTrue)).toBe(true);
  });
});
