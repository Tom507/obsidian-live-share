// WP16 — the shared-constant hazard (Shared Ownership Contract §1, and the
// task brief's explicit design-against rule): "`ord` ordering is WP13's and
// only WP13's." WP16's conservative reassignment policy compares `ord`
// values to decide "has the relative order demonstrably changed", and MUST
// do so via WP13's `compareOrd` / `compareOrdId` (`canvas-ord.ts`) — never a
// re-implementation with `<` on raw strings, `localeCompare`, or (worse
// here) trusting the caller's array order for a set of `{ord, id}` pairs.
//
// Two independent checks:
//  1. STATIC — canvas-sync.ts's source imports `compareOrd`/`compareOrdId`
//     from `../canvas/canvas-ord` rather than re-deriving comparison.
//  2. BEHAVIOURAL — the actual discriminator. Two entries are constructed
//     with an IDENTICAL `ord` (a collision) and handed to
//     `deriveOrdAssignments` in the "wrong" array order (not matching what
//     `compareOrdId`'s id-tiebreak would produce). The `nextOrder` passed in
//     IS exactly what `compareOrdId` says the canonical order already is. An
//     implementation that recomputes the canonical order via `compareOrdId`
//     (rather than trusting `previous`'s array position) must see this as
//     "no change" and reassign nothing; one that reimplements comparison
//     naively (or trusts array order) is exposed by a spurious reassignment.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../canvas/canvas-ord";
import { deriveOrdAssignments } from "../../../files/canvas-sync";

const SOURCE_URL = new URL("../../../files/canvas-sync.ts", import.meta.url);
const RAW = readFileSync(SOURCE_URL, "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(RAW);

function importSpecifiers(code: string): Map<string, string> {
  // Maps each imported binding name -> the module specifier it came from,
  // for every `import { a, b as c } from "specifier"` in the file.
  const bindings = new Map<string, string>();
  for (const match of code.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)) {
    const names = match[1]
      .split(",")
      .map((piece) => piece.trim())
      .filter(Boolean)
      .map((piece) => piece.split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim());
    for (const name of names) bindings.set(name, match[2]);
  }
  return bindings;
}

describe("WP16 — must import ord comparison from canvas-ord.ts, never re-derive it", () => {
  it("canvas-sync.ts imports compareOrd or compareOrdId from ../canvas/canvas-ord", () => {
    const bindings = importSpecifiers(CODE);
    const importsCompareOrd = bindings.get("compareOrd") === "../canvas/canvas-ord";
    const importsCompareOrdId = bindings.get("compareOrdId") === "../canvas/canvas-ord";

    expect(importsCompareOrd || importsCompareOrdId).toBe(true);
  });

  it("two ord-colliding entries already in (ord,id) canonical order are NOT reassigned", () => {
    // Both entries share the SAME ord; compareOrdId breaks the tie on id, so
    // the canonical order for {ord:"same-ord", id:"aaa"} vs
    // {ord:"same-ord", id:"zzz"} is "aaa" before "zzz". `previous` is built
    // in the OPPOSITE array order on purpose, so a naive "diff previous's
    // array position against nextOrder" implementation would misfire.
    const previous: OrdIdEntry[] = [
      { id: "zzz", ord: "same-ord" },
      { id: "aaa", ord: "same-ord" },
    ];
    const nextOrder = ["aaa", "zzz"]; // exactly the canonical (ord,id) order

    const reassignments = deriveOrdAssignments(previous, nextOrder, "client-collide");

    expect(reassignments.size).toBe(0);
  });
});
