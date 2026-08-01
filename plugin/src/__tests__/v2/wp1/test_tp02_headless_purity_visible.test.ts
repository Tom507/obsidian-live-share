// WP1 / AC1 (second half) — the module is headless.
//
// AC1: "...and it has **no** import of Obsidian, no clock, no DOM and no file I/O."
// DoD: "a headless module whose entire state can be constructed, advanced and read
// without any Obsidian or filesystem access."
//
// The oracle is the module SOURCE, not a runtime probe: under Vitest's default
// node environment `document` and `window` are already undefined, so a runtime
// check would pass for a module that does use them. `canvas-single-writer.test.ts`
// (AC8) establishes source scanning as the repo's pattern for exactly this.
//
// The precedent for the pure-core shape is `canvas/reconcile-plan.ts` — zero
// imports at all.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  advanceField,
  createSurfaceShadow,
  getRecordFields,
  listPaths,
} from "../../../canvas/canvas-shadow";

const SOURCE_URL = new URL("../../../canvas/canvas-shadow.ts", import.meta.url);
const RAW = readFileSync(SOURCE_URL, "utf8");

/** Comments may legitimately NAME the forbidden things; code may not use them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(RAW);

/** Every `from "x"` / `import("x")` / `require("x")` specifier in the module. */
function importSpecifiers(code: string): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(/\bfrom\s*["']([^"']+)["']/g)) found.add(match[1]);
  for (const match of code.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)) {
    found.add(match[1]);
  }
  for (const match of code.matchAll(/\bimport\s+["']([^"']+)["']/g)) found.add(match[1]);
  return [...found];
}

describe("WP1 AC1 — canvas-shadow.ts is headless", () => {
  it("imports no package — only relative modules are permitted", () => {
    for (const specifier of importSpecifiers(CODE)) {
      expect(specifier.startsWith("./") || specifier.startsWith("../")).toBe(true);
    }
  });

  it("never imports Obsidian", () => {
    expect(CODE).not.toMatch(/["']obsidian["']/);
    expect(CODE).not.toMatch(/\bTFile\b|\bnormalizePath\b|\bapp\.vault\b/);
  });

  it("never touches the filesystem", () => {
    expect(CODE).not.toMatch(/["'](?:node:)?fs(?:\/promises)?["']/);
    expect(CODE).not.toMatch(/\breadFileSync\b|\bwriteFileSync\b|\breadFile\b|\bwriteFile\b/);
  });

  it("reads no clock and no entropy", () => {
    expect(CODE).not.toMatch(/\bDate\s*\.\s*now\b/);
    expect(CODE).not.toMatch(/\bnew\s+Date\b/);
    expect(CODE).not.toMatch(/\bperformance\s*\.\s*now\b/);
    expect(CODE).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\bqueueMicrotask\b/);
    expect(CODE).not.toMatch(/\bMath\s*\.\s*random\b|\bcrypto\s*\.\s*randomUUID\b/);
  });

  it("touches no DOM and no host globals", () => {
    expect(CODE).not.toMatch(/\bdocument\b/);
    expect(CODE).not.toMatch(/\bwindow\b/);
    expect(CODE).not.toMatch(/\blocalStorage\b|\bnavigator\b/);
    expect(CODE).not.toMatch(/\bprocess\s*\./);
  });

  it("holds no module-level state — two shadows are fully independent", () => {
    const first = createSurfaceShadow();
    const second = createSurfaceShadow();

    advanceField(first, "A.canvas", "node", "n1", "x", 1);

    expect(listPaths(second)).toEqual([]);
    expect(getRecordFields(second, "A.canvas", "node", "n1")).toBeNull();
    expect(listPaths(first)).toEqual(["A.canvas"]);
  });
});
