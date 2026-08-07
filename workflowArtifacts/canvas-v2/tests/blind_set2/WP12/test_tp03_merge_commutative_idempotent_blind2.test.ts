// WP12 AC1 — commutativity/idempotence, attacked with a value-based (not
// reference-based) idempotence check: merging an entry with a freshly
// constructed object that has the SAME field values but a different object
// identity must still be treated as identical (idempotent), proving the
// merge compares by value, not by reference.

import { describe, expect, it } from "vitest";

import { mergeTombstoneEntries } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC1 — merge idempotence and commutativity hold by value, not by object identity", () => {
  it("merging an entry with a distinct-but-equal-value copy changes nothing", () => {
    const original: TombstoneEntry = { t: 30, by: "peer-value", on: true, q: true };
    const copy: TombstoneEntry = { t: 30, by: "peer-value", on: true, q: true };

    expect(original).not.toBe(copy); // distinct object identity
    expect(mergeTombstoneEntries(original, copy)).toEqual(original);
    expect(mergeTombstoneEntries(copy, original)).toEqual(original);
  });

  it("commutativity holds across a spread of differing-t and differing-by pairs", () => {
    const pairs: Array<[TombstoneEntry, TombstoneEntry]> = [
      [
        { t: 0, by: "zero-a", on: true },
        { t: 0, by: "zero-b", on: false },
      ],
      [
        { t: 999, by: "high", on: false },
        { t: 1, by: "low", on: true },
      ],
    ];

    for (const [a, b] of pairs) {
      expect(mergeTombstoneEntries(a, b)).toEqual(mergeTombstoneEntries(b, a));
    }
  });
});
