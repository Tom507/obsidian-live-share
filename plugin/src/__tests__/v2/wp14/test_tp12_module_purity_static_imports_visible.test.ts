// WP14 AC4 — "The module is pure and has no knowledge of Yjs, Obsidian or
// the filesystem."
//
// The oracle is the module SOURCE, not a runtime probe: under Vitest's
// default node environment `document`/`window` are already undefined, so a
// runtime check would pass vacuously for a module that never touches them
// only because the test harness itself lacks them. `wp1/test_tp02_headless_
// purity_visible` and `wp2/test_tp05_purity_visible` establish source
// scanning as the repo's pattern for exactly this claim, and this test
// follows it. A purity claim nothing tests is not a guarantee (TaskCharter
// rule).
//
// Only relative imports are permitted — importing `canvas-registers.ts` /
// `canvas-type-guard.ts` is fine (they are themselves pure, zero- or
// relative-only-import modules per their own purity contracts), but no
// package import (`yjs`, `obsidian`, `node:fs`, …) is.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SOURCE_URL = new URL("../../../canvas/canvas-ingest-schema.ts", import.meta.url);
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

describe("WP14 AC4 — canvas-ingest-schema.ts has no knowledge of Yjs, Obsidian or the filesystem", () => {
  it("imports no package — only relative modules are permitted", () => {
    for (const specifier of importSpecifiers(CODE)) {
      expect(specifier.startsWith("./") || specifier.startsWith("../")).toBe(true);
    }
  });

  it("never imports yjs", () => {
    expect(CODE).not.toMatch(/["']yjs["']/);
    expect(CODE).not.toMatch(/\bY\.Doc\b|\bY\.Map\b|\bY\.Text\b/);
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
});
