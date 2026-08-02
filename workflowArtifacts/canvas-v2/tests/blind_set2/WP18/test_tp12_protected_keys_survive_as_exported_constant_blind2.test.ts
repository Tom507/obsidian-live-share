// WP18 blind2 — `PROTECTED_KEYS` membership pinned against WP10's OWN endpoint
// key names rather than against re-spelt literals.
//
// The four endpoint members of the guard are `fromNode`, `fromSide`, `toNode`
// and `toSide`, and those exact four strings are owned by
// `ENDPOINT_FILE_KEYS` (Shared Ownership Contract §1). Deriving them here means
// a rename on either side shows up as a failure instead of as two files that
// silently disagree.
//
// The `end` members (`fromEnd`, `toEnd`) are deliberately NOT in the guard, and
// that is asserted too: "unchanged membership" is a two-sided claim, and a
// well-meaning widening is as much a change as a trim.

import { describe, expect, it } from "vitest";

import { ENDPOINT_FILE_KEYS, FROM_KEY, TO_KEY } from "../../../canvas/canvas-registers";
import { GEOMETRY_KEYS, PROTECTED_KEYS } from "../../../files/canvas-sync";

describe("WP18 blind2 — the guard's endpoint membership matches WP10's own key names", () => {
  it("every `node` and `side` file key is protected", () => {
    for (const slot of [FROM_KEY, TO_KEY]) {
      const keys = ENDPOINT_FILE_KEYS[slot];
      expect(PROTECTED_KEYS.has(keys.node), `PROTECTED_KEYS lost \`${keys.node}\``).toBe(true);
      expect(PROTECTED_KEYS.has(keys.side), `PROTECTED_KEYS lost \`${keys.side}\``).toBe(true);
    }
  });

  it("neither `end` file key was added to the guard", () => {
    for (const slot of [FROM_KEY, TO_KEY]) {
      const keys = ENDPOINT_FILE_KEYS[slot];
      expect(
        PROTECTED_KEYS.has(keys.end),
        `PROTECTED_KEYS gained \`${keys.end}\` — membership is unchanged in BOTH directions`,
      ).toBe(false);
    }
  });

  it("the guard is still exported, still holds `type`, and still covers all four geometry keys", () => {
    expect(PROTECTED_KEYS).toBeInstanceOf(Set);
    expect(PROTECTED_KEYS.has("type"), "PROTECTED_KEYS lost the structural `type` key").toBe(true);
    expect([...GEOMETRY_KEYS].filter((key) => !PROTECTED_KEYS.has(key))).toEqual([]);
    expect(PROTECTED_KEYS.size, "PROTECTED_KEYS changed size").toBe(9);
  });
});
