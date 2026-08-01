import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as canonical from "../../../canvas/canvas-canonical";
import { GEOMETRY_KEYS } from "../../../files/canvas-sync";

// Hard constraints — the pure-core contract (BUILD_SPEC D12: "pure cores import
// nothing from Obsidian, the filesystem or a clock") and the `GEOMETRY_KEYS`
// invariant (§3.1 S2, an ESCALATE-level abort criterion).
// Angle: assert the module's PUBLIC SURFACE by shape (what is exported and of
// what kind) and screen the source for the whole family of impurity tokens, not
// just the Obsidian import.

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../../canvas/canvas-canonical.ts", import.meta.url)),
  "utf8",
);

/** The module's CODE, with comments removed — prose may discuss anything. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FORBIDDEN = [
  "obsidian",
  "node:fs",
  "node:path",
  "require(",
  "Date.now",
  "new Date",
  "Math.random",
  "performance.now",
  "setTimeout",
  "setInterval",
  "process.",
  "window.",
  "document.",
  "localeCompare",
];

describe("the canonical core stays pure and its key sets stay in step", () => {
  it("exports exactly the documented public surface", () => {
    expect(typeof canonical.canonicalizeRecord).toBe("function");
    expect(typeof canonical.canonicalizeCanvasData).toBe("function");
    expect(typeof canonical.roundCanvasGeometry).toBe("function");
    expect(typeof canonical.serializeCanonicalCanvas).toBe("function");
    expect(Array.isArray(canonical.CANONICAL_NODE_KEY_ORDER)).toBe(true);
    expect(Array.isArray(canonical.CANONICAL_EDGE_KEY_ORDER)).toBe(true);
    expect(canonical.CANONICAL_GEOMETRY_KEYS instanceof Set).toBe(true);
  });

  it("contains no import statement and no impurity token", () => {
    expect(CODE.length).toBeGreaterThan(0);
    expect(CODE).not.toMatch(/^\s*import\s/m);
    expect(CODE).not.toMatch(/^\s*export\s+.*\bfrom\b/m);
    for (const token of FORBIDDEN) {
      expect(CODE.includes(token)).toBe(false);
    }
  });

  it("mirrors the exported GEOMETRY_KEYS without importing canvas-sync", () => {
    expect([...canonical.CANONICAL_GEOMETRY_KEYS].sort()).toEqual([...GEOMETRY_KEYS].sort());
    expect([...GEOMETRY_KEYS].sort()).toEqual(["height", "width", "x", "y"]);
    expect(CODE).not.toContain("canvas-sync");
  });

  it("is deterministic — the same call twice gives the same answer", () => {
    const record = { id: "n", type: "text", x: 1.5, y: 2.5, width: 3.5, height: 4.5, text: "t" };

    expect(canonical.roundCanvasGeometry(record)).toEqual(canonical.roundCanvasGeometry(record));
    expect(JSON.stringify(canonical.canonicalizeRecord(record, "node"))).toBe(
      JSON.stringify(canonical.canonicalizeRecord(record, "node")),
    );
    expect(canonical.serializeCanonicalCanvas({ nodes: [record], edges: [] })).toBe(
      canonical.serializeCanonicalCanvas({ nodes: [record], edges: [] }),
    );
  });
});
