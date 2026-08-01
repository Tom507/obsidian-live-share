// WP9 / AC4 — `GEOMETRY_KEYS` keeps exactly {x, y, width, height} and stays
// exported, now describing the file schema (BUILD_SPEC §3.1 S2).
//
// This is WP9's own angle, not a copy of the WP3 drift guard
// (`v2/wp3/test_geometry_keys_drift_visible.test.ts`, which checks the
// canonical module's private mirror and its own source purity). WP9
// introduces a NEW place the four keys could leak or shrink: the register
// module's own encode/decode surface. This test ties GEOMETRY_KEYS directly
// to what that surface actually emits, and checks the register module does
// not shadow the export with a competing declaration of its own.

import { describe, expect, it } from "vitest";

import * as CanvasRegisters from "../../../canvas/canvas-registers";
import { decodePos, decodeSize, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { GEOMETRY_KEYS } from "../../../files/canvas-sync";

describe("WP9 AC4 — GEOMETRY_KEYS stays exactly {x, y, width, height} and stays exported", () => {
  it("is unchanged after the register module has been imported", () => {
    expect([...GEOMETRY_KEYS].sort()).toEqual(["height", "width", "x", "y"]);
    expect(GEOMETRY_KEYS.size).toBe(4);
  });

  it("the register module's own file-shape output uses exactly the geometry keys, no more, no less", () => {
    const filePos = decodePos(encodePos(12, 34));
    const fileSize = decodeSize(encodeSize(56, 78));
    const merged = { ...filePos, ...fileSize };

    expect(Object.keys(merged).sort()).toEqual([...GEOMETRY_KEYS].sort());
  });

  it("does not redeclare or export its own GEOMETRY_KEYS — WP9 imports the owner's set, never re-declares it", () => {
    expect("GEOMETRY_KEYS" in CanvasRegisters).toBe(false);
  });
});
