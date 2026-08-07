import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CANONICAL_GEOMETRY_KEYS,
  CANONICAL_NODE_KEY_ORDER,
} from "../../../canvas/canvas-canonical";
import { GEOMETRY_KEYS } from "../../../files/canvas-sync";

// ===========================================================================
// WP3 hard constraints — the drift guard, mirroring the established
// `RECONCILE_GEOMETRY_KEYS` pattern (`reconcile-plan.ts:45-60`, guarded in
// `canvas-sync.test.ts`).
//
// The canonical module must stay free of the Obsidian import chain, so it keeps
// its own copy of the four geometry keys. A private copy only stays honest with
// a guard, and BUILD_SPEC §3.1 S2 makes `GEOMETRY_KEYS` membership + export an
// ESCALATE-level invariant.
//
// The source-text purity check is the second half: "pure cores import nothing
// from Obsidian, the filesystem or a clock" (BUILD_SPEC §3, D12).
// ===========================================================================

const MODULE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../../canvas/canvas-canonical.ts", import.meta.url)),
  "utf8",
);

// Comments may discuss anything — only the CODE has to be pure.
const MODULE_CODE = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/.*$/gm,
  "$1",
);

describe("WP3 — geometry key drift guard and module purity", () => {
  it("CANONICAL_GEOMETRY_KEYS mirrors GEOMETRY_KEYS exactly", () => {
    expect([...CANONICAL_GEOMETRY_KEYS].sort()).toEqual([...GEOMETRY_KEYS].sort());
  });

  it("GEOMETRY_KEYS keeps exactly {x, y, width, height} and stays exported", () => {
    expect([...GEOMETRY_KEYS].sort()).toEqual(["height", "width", "x", "y"]);
    expect([...CANONICAL_GEOMETRY_KEYS].sort()).toEqual(["height", "width", "x", "y"]);
  });

  it("the canonical node key order carries every geometry key", () => {
    for (const key of CANONICAL_GEOMETRY_KEYS) {
      expect(CANONICAL_NODE_KEY_ORDER).toContain(key);
    }
  });

  it("the canonical module imports nothing at all — no Obsidian, no fs, no clock", () => {
    expect(MODULE_SOURCE.length).toBeGreaterThan(0);
    expect(MODULE_CODE).not.toMatch(/^\s*import\s/m);
    expect(MODULE_CODE).not.toMatch(/require\s*\(/);
    expect(MODULE_CODE).not.toContain("obsidian");
    expect(MODULE_CODE).not.toContain("Date.now");
    expect(MODULE_CODE).not.toContain("Math.random");
    expect(MODULE_CODE).not.toContain("performance.now");
  });
});
