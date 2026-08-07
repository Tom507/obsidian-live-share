// WP12 AC4 — same distinguishability guarantee, attacked with a batch/filter
// angle instead of the visible test's pairwise comparison: a mixed list of
// entries (plain deletes, quarantines, undone, undefined) is filtered by
// isTombstoneQuarantined, and the resulting subset must be exactly the
// quarantined ones — while isTombstoneSuppressed remains true for both
// suppressed categories.

import { describe, expect, it } from "vitest";

import { isTombstoneQuarantined, isTombstoneSuppressed } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC4 — filtering a mixed batch by isTombstoneQuarantined isolates exactly the quarantined records", () => {
  it("only the quarantine entries pass the filter; suppression is true for both quarantines and plain deletes", () => {
    const records: Record<string, TombstoneEntry | undefined> = {
      "card-1": { t: 1, by: "peer-a", on: true }, // plain delete
      "card-2": { t: 2, by: "auditor", on: true, q: true }, // quarantine
      "card-3": undefined, // never deleted
      "card-4": { t: 3, by: "peer-b", on: false }, // undone
      "card-5": { t: 4, by: "auditor", on: true, q: true }, // quarantine
    };

    const quarantinedIds = Object.entries(records)
      .filter(([, entry]) => isTombstoneQuarantined(entry))
      .map(([id]) => id)
      .sort();

    expect(quarantinedIds).toEqual(["card-2", "card-5"]);

    for (const id of ["card-1", "card-2", "card-5"]) {
      expect(isTombstoneSuppressed(records[id])).toBe(true);
    }
    for (const id of ["card-3", "card-4"]) {
      expect(isTombstoneSuppressed(records[id])).toBe(false);
    }
  });
});
