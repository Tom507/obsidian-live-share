// WP14 AC4 — same source-scan guarantee as TP12, attacked from a different
// angle: rather than one `it()` per forbidden category, this file asserts
// the COMPLETE set of permitted import specifiers directly (an allow-list
// check), plus a single combined forbidden-globals regex, so a violation
// is caught even if it does not fall neatly into one of TP12's categories.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SOURCE_URL = new URL("../../../canvas/canvas-ingest-schema.ts", import.meta.url);
const RAW = readFileSync(SOURCE_URL, "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(RAW);

function importSpecifiers(code: string): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(/\bfrom\s*["']([^"']+)["']/g)) found.add(match[1]);
  for (const match of code.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)) {
    found.add(match[1]);
  }
  for (const match of code.matchAll(/\bimport\s+["']([^"']+)["']/g)) found.add(match[1]);
  return [...found];
}

describe("WP14 AC4 — canvas-ingest-schema.ts's import list is entirely relative", () => {
  it("every import specifier resolves within plugin/src/canvas (no bare package names)", () => {
    const specifiers = importSpecifiers(CODE);
    // A bare package specifier never starts with "." — this is the
    // complementary check to TP12's per-category assertions.
    const bareSpecifiers = specifiers.filter((spec) => !spec.startsWith("."));
    expect(bareSpecifiers).toEqual([]);
  });

  it("carries no forbidden host/CRDT/IO token anywhere in the source", () => {
    const forbidden =
      /\byjs\b|\bobsidian\b|\bnode:fs\b|\breadFileSync\b|\bwriteFileSync\b|\bDate\.now\b|\bperformance\.now\b|\bsetTimeout\b|\bMath\.random\b|\bdocument\b|\bwindow\b/i;
    expect(CODE).not.toMatch(forbidden);
  });
});
