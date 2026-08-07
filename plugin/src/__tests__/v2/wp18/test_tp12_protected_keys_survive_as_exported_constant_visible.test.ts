// WP18 — `PROTECTED_KEYS` stays EXPORTED with UNCHANGED MEMBERSHIP even though
// this WP retires its last reader.
//
// Shared Ownership Contract §4: retiring the seam that reads a constant is not
// a licence to delete the constant. `PROTECTED_KEYS` is defence in depth per
// WP20's charter, and two live tests read it as a constant
// (`w4-canvas-integrity` A8; WP3 `blind_set1/test_geometry_keys_drift`), so
// deleting it would break tests that have nothing to do with the seam being
// removed.
//
// `GEOMETRY_KEYS` is bound even harder: BUILD_SPEC §3.1 S2 makes any change to
// its membership or its export an ESCALATE, not a refactor. The relationship
// between the two — strict superset — is the invariant that made the wider
// guard meaningful in the first place, and it is asserted here rather than
// assumed.

import { describe, expect, it } from "vitest";

import { GEOMETRY_KEYS, PROTECTED_KEYS } from "../../../files/canvas-sync";

/** Membership as it stands, and as it must still stand after WP18. */
const EXPECTED_GEOMETRY = ["height", "width", "x", "y"];
const EXPECTED_PROTECTED = [
  "fromNode",
  "fromSide",
  "height",
  "toNode",
  "toSide",
  "type",
  "width",
  "x",
  "y",
];

describe("WP18 — PROTECTED_KEYS survives the retirement of its last reader", () => {
  it("both sets are still exported with exactly their established membership", () => {
    expect(PROTECTED_KEYS, "PROTECTED_KEYS is no longer an exported Set").toBeInstanceOf(Set);
    expect(GEOMETRY_KEYS, "GEOMETRY_KEYS is no longer an exported Set").toBeInstanceOf(Set);

    expect([...GEOMETRY_KEYS].sort(), "GEOMETRY_KEYS membership changed — that is an ESCALATE").toEqual(
      EXPECTED_GEOMETRY,
    );
    expect(
      [...PROTECTED_KEYS].sort(),
      "PROTECTED_KEYS membership changed while its last reader was retired",
    ).toEqual(EXPECTED_PROTECTED);
  });

  it("PROTECTED_KEYS is still a STRICT superset of GEOMETRY_KEYS", () => {
    for (const key of GEOMETRY_KEYS) {
      expect(PROTECTED_KEYS.has(key), `PROTECTED_KEYS lost the geometry key \`${key}\``).toBe(true);
    }
    expect(
      PROTECTED_KEYS.size,
      "PROTECTED_KEYS is no longer strictly wider than GEOMETRY_KEYS",
    ).toBeGreaterThan(GEOMETRY_KEYS.size);
  });
});
