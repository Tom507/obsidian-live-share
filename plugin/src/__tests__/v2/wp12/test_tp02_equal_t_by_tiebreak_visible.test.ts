// WP12 / AC1 (part 2) — the `by` tiebreak when `t` is equal.
//
// Pinned rule (binding for the implementation, see Worker 3's handover): when
// two candidate entries share the same `t`, the entry whose `by` sorts
// GREATER under plain string comparison wins. This is a deterministic,
// replica-independent rule — it must NOT be derived from Yjs's own
// concurrent-write tie-break (which is `clientID`-random and would make this
// a coin flip), and it must NOT depend on which peer's op was applied first.

import { describe, expect, it } from "vitest";

import { mergeTombstoneEntries } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC1 — equal t breaks the tie on by (deterministic, replica-independent)", () => {
  it("with equal t, the entry whose by sorts greater wins, regardless of argument order", () => {
    const fromClientA: TombstoneEntry = { t: 7, by: "client-a", on: true };
    const fromClientZ: TombstoneEntry = { t: 7, by: "client-z", on: false };

    expect(mergeTombstoneEntries(fromClientA, fromClientZ)).toEqual(fromClientZ);
    expect(mergeTombstoneEntries(fromClientZ, fromClientA)).toEqual(fromClientZ);
  });

  it("the tiebreak is a plain lexicographic string comparison on by", () => {
    const first: TombstoneEntry = { t: 11, by: "aaa", on: false };
    const second: TombstoneEntry = { t: 11, by: "aab", on: true };

    // "aab" > "aaa" lexicographically.
    expect(mergeTombstoneEntries(first, second).by).toBe("aab");
    expect(mergeTombstoneEntries(second, first).by).toBe("aab");
  });
});
