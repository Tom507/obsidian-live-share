// WP12 / AC1 (part 1) — "concurrent operations on the same id converge by LWW
// on `on` using `t` with `by` as tiebreak, identically on every replica."
//
// This is the pure merge function in isolation (BUILD_SPEC §5 C12): given two
// candidate tombstone entries for the same id, the one with the higher
// Lamport `t` wins outright — `on`'s own value never overrides `t`, and the
// argument order the merge is called with must not matter (Shared Ownership
// Contract §4: never reason from a specific CRDT tie-break; this is WP12's
// own explicit (t, by) comparison, exercised directly and deterministically).

import { describe, expect, it } from "vitest";

import { mergeTombstoneEntries } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC1 — higher Lamport t wins the tombstone merge, regardless of on or by", () => {
  it("a later delete op (higher t) beats an earlier undo op (lower t); argument order does not matter", () => {
    const earlierUndo: TombstoneEntry = { t: 5, by: "peer-a", on: false };
    const laterDelete: TombstoneEntry = { t: 9, by: "peer-b", on: true };

    expect(mergeTombstoneEntries(earlierUndo, laterDelete)).toEqual(laterDelete);
    expect(mergeTombstoneEntries(laterDelete, earlierUndo)).toEqual(laterDelete);
  });

  it("a later undo op (higher t) beats an earlier delete op (lower t); argument order does not matter", () => {
    const earlierDelete: TombstoneEntry = { t: 2, by: "peer-c", on: true };
    const laterUndo: TombstoneEntry = { t: 3, by: "peer-a", on: false };

    expect(mergeTombstoneEntries(earlierDelete, laterUndo)).toEqual(laterUndo);
    expect(mergeTombstoneEntries(laterUndo, earlierDelete)).toEqual(laterUndo);
  });
});
