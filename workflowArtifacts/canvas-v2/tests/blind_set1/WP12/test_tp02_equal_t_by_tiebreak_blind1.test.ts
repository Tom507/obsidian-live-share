// WP12 AC1 — the equal-t tiebreak, attacked with a numeric-looking `by` edge
// case that a naive (numeric) tiebreak implementation would get wrong: under
// PLAIN STRING comparison, "client-100" < "client-99" (the character '1' is
// less than '9' at the first differing position), even though 100 > 99
// numerically. The tiebreak must be lexicographic, not numeric.

import { describe, expect, it } from "vitest";

import { mergeTombstoneEntries } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC1 — equal-t tiebreak is lexicographic on by, not numeric", () => {
  it("'client-99' wins over 'client-100' under plain string comparison, despite 100 > 99 numerically", () => {
    const client100: TombstoneEntry = { t: 42, by: "client-100", on: true };
    const client99: TombstoneEntry = { t: 42, by: "client-99", on: false };

    expect(mergeTombstoneEntries(client100, client99)).toEqual(client99);
    expect(mergeTombstoneEntries(client99, client100)).toEqual(client99);
  });
});
