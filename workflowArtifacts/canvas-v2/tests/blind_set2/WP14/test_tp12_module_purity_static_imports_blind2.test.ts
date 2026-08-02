// WP14 AC4 — same source-scan guarantee as TP12, attacked by asserting the
// POSITIVE side explicitly: the module's only permitted collaborators are
// `canvas-registers.ts` and, optionally, `canvas-type-guard.ts` (both
// themselves pure, per their own purity contracts and TaskCharter §3's
// dependency list of WP9/WP10/WP11). Any relative import outside this pair
// would be unexpected for a WP14-scoped module and is flagged rather than
// silently allowed just because it starts with "./" or "../".

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
  return [...found];
}

const ALLOWED_RELATIVE_MODULES = new Set([
  "./canvas-registers",
  "./canvas-type-guard",
]);

describe("WP14 AC4 — canvas-ingest-schema.ts only imports its declared P1-core dependencies", () => {
  it("every relative import specifier is one of the declared WP9/WP10/WP11 core modules", () => {
    const specifiers = importSpecifiers(CODE);
    for (const spec of specifiers) {
      expect(spec.startsWith(".")).toBe(true);
      expect(ALLOWED_RELATIVE_MODULES.has(spec)).toBe(true);
    }
  });

  it("imports at least canvas-registers (the owner of the V2 vocabulary this module validates)", () => {
    const specifiers = importSpecifiers(CODE);
    expect(specifiers).toContain("./canvas-registers");
  });
});
