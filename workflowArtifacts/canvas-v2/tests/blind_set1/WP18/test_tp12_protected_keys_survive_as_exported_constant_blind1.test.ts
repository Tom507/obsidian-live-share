// WP18 blind1 — `PROTECTED_KEYS` survives its last reader's retirement, stated
// as a SET DIFFERENCE rather than as two membership lists.
//
// The visible probe pins both sets by enumeration. This one pins the
// RELATIONSHIP: what `PROTECTED_KEYS` adds on top of `GEOMETRY_KEYS` is exactly
// the five structural keys WP5 introduced, no more and no fewer. A refactor
// that quietly folded the two sets together, or that trimmed the guard down to
// its geometry core "since nothing reads the rest any more", passes an
// enumeration of `GEOMETRY_KEYS` and fails here.

import { describe, expect, it } from "vitest";

import { GEOMETRY_KEYS, PROTECTED_KEYS } from "../../../files/canvas-sync";

const STRUCTURAL_ADDITIONS = ["fromNode", "fromSide", "toNode", "toSide", "type"];

describe("WP18 blind1 — the guard sets keep their exact relationship", () => {
  it("PROTECTED_KEYS minus GEOMETRY_KEYS is exactly the five structural keys", () => {
    const difference = [...PROTECTED_KEYS].filter((key) => !GEOMETRY_KEYS.has(key)).sort();
    expect(
      difference,
      "the structural half of PROTECTED_KEYS changed while its last reader was retired",
    ).toEqual(STRUCTURAL_ADDITIONS);
  });

  it("GEOMETRY_KEYS is entirely contained in PROTECTED_KEYS and neither set is empty", () => {
    expect(GEOMETRY_KEYS.size, "GEOMETRY_KEYS was emptied").toBe(4);
    expect(PROTECTED_KEYS.size, "PROTECTED_KEYS was emptied").toBe(9);
    const missing = [...GEOMETRY_KEYS].filter((key) => !PROTECTED_KEYS.has(key));
    expect(missing, "PROTECTED_KEYS no longer covers every geometry key").toEqual([]);
  });

  it("the two exports are distinct Set instances, not one aliased under two names", () => {
    expect(PROTECTED_KEYS).not.toBe(GEOMETRY_KEYS);
    expect(GEOMETRY_KEYS.has("type"), "GEOMETRY_KEYS absorbed a structural key").toBe(false);
    expect(GEOMETRY_KEYS.has("fromNode"), "GEOMETRY_KEYS absorbed an endpoint key").toBe(false);
  });
});
