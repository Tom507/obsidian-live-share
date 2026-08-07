// WP16 blind2 — same shared-constant hazard, complementary static check:
// canvas-sync.ts must not reimplement ord/(ord,id) comparison via
// `.localeCompare(`, a common-looking but WRONG alternative (its result
// depends on the host's ICU data, which is exactly the kind of
// host-dependent divergence `compareOrd`'s doc comment calls out by name).
// This complements the visible test's "must import" check with a "must not
// reimplement" check.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SOURCE_URL = new URL(
  "../../../../../plugin/src/files/canvas-sync.ts",
  import.meta.url,
);
const RAW = readFileSync(SOURCE_URL, "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(RAW);

describe("WP16 blind2 — canvas-sync.ts never reimplements ord comparison via localeCompare", () => {
  it("no localeCompare call appears anywhere in the module", () => {
    expect(CODE).not.toMatch(/\.localeCompare\s*\(/);
  });
});
