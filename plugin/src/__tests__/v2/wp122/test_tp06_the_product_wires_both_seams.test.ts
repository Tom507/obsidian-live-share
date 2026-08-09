// WP122 — THE PRODUCTION WIRING, PINNED STRUCTURALLY.
//
// 🔴 THIS FILE EXISTS BECAUSE OF A MEASURED GAP, not because of a convention.
// Two plants in WP122's break table reddened NOTHING:
//
//   ├── P8 — delete `bindHostWriter: (path) => this.attachCanvasWriter(path)`
//   │        from `main.ts`'s mirror deps. The entire fix is then absent from
//   │        the product and the whole suite stays green.
//   └── P9 — delete `armMirrorPass: () => this.armCanvasMirrorPass()` from
//            `main.ts`'s canvas-create env. `S170` is then not closed and the
//            whole suite stays green.
//
// Both seams are OPTIONAL by design, and they have to be: every pre-WP122
// caller and every fixture in this suite omits them, and each must keep
// behaving exactly as it did (that degradation is itself an acceptance
// criterion, `tp01d` / `tp04b`). Optionality and "the product must wire it" are
// satisfiable at once only if something other than the type system asserts the
// second. That is this file — the same move WP117's `tp06` and WP121's `tp05`
// make, for the same reason.
//
// 🔴 THE POSITIVE CONTROL HAS TWO HALVES (`S53`). After a repair, "the class is
// empty" and "the deriver went blind" produce identical output, so:
//   ├── HALF A — it can find an unwired site. Run against a literal of the
//   │   PRE-WP122 call site, the deriver reports it UNWIRED.
//   └── HALF B — it refuses to answer on nothing. An input with no call site at
//       all THROWS rather than reporting "all sites wired".
//
// CAVEAT, stated rather than discovered (`S88`'s shape): this test reads the
// LIVE WORKING COPY of `main.ts`. A batch editing that file makes this row
// transiently red, and that redness is not attributable to WP122.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { findPluginSrc, stripComments } from "../wp92/census";

interface Site {
  readonly line: number;
  readonly wired: boolean;
}

/** Balanced read of one call's whole argument list. */
function callArguments(code: string, openParen: number, what: string): string {
  let depth = 0;
  for (let i = openParen; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(openParen + 1, i);
    }
  }
  throw new Error(`WP122 census: unbalanced ${what}( call`);
}

/**
 * Every call site of `callee` in `source`, and whether its argument list carries
 * `key:`. THROWS on an input with no call site — half B of the control.
 */
export function deriveSites(source: string, callee: string, key: string): Site[] {
  const code = stripComments(source);
  const sites: Site[] = [];
  const scan = new RegExp(`(?:^|[^\\w.])${callee}\\s*\\(`, "g");
  let match = scan.exec(code);
  while (match !== null) {
    const openParen = code.indexOf("(", match.index);
    const args = callArguments(code, openParen, callee);
    sites.push({
      line: code.slice(0, match.index).split("\n").length,
      wired: new RegExp(`(^|[^\\w.])${key}\\s*:`).test(args),
    });
    match = scan.exec(code);
  }
  if (sites.length === 0) throw new Error(`WP122 census: no ${callee}( call site found`);
  return sites;
}

const MAIN = readFileSync(`${findPluginSrc()}/main.ts`, "utf8");

describe("WP122 — every mirror pass the product runs binds the host's writer", () => {
  it("tp06a: every `mirrorSharedCanvases(` site in main.ts carries `bindHostWriter:`", () => {
    const sites = deriveSites(MAIN, "mirrorSharedCanvases", "bindHostWriter");
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.filter((s) => !s.wired)).toStrictEqual([]);
  });

  it("tp06b: and it points at `attachCanvasWriter` — the ONE route, not a second one", () => {
    // `hasCanvasWriter` is the single definition of "already attached" and it is
    // consulted inside `attachCanvasWriter`. A bind seam pointing anywhere else
    // would be a second attach route with its own idea of re-entrancy, which is
    // exactly how a double attach gets in.
    const code = stripComments(MAIN);
    expect(code).toMatch(/bindHostWriter:\s*\(path\)\s*=>\s*this\.attachCanvasWriter\(path\)/);
    // And the guest seam still points at the same one, unchanged.
    expect(code).toMatch(/materialise:\s*\(path\)\s*=>\s*this\.attachCanvasWriter\(path\)/);
  });

  it("tp06c: HALF A — the deriver reports the PRE-WP122 call site as unwired", () => {
    const preWp122 = `
      this.lastCanvasMirrorReport = await mirrorSharedCanvases({
        role: "host",
        listManifestPaths: () => this.manifestManager.getEntries().keys(),
        materialise: (path) => this.attachCanvasWriter(path),
        watchForRecords: (path) => this.watchCanvasForRecords(path),
      });
    `;
    const sites = deriveSites(preWp122, "mirrorSharedCanvases", "bindHostWriter");
    expect(sites).toHaveLength(1);
    expect(sites[0].wired).toBe(false);
  });

  it("tp06d: HALF B — an input with no call site THROWS, it never reports 'all wired'", () => {
    expect(() => deriveSites("const x = 1;\n", "mirrorSharedCanvases", "bindHostWriter")).toThrow(
      /no mirrorSharedCanvases\( call site found/,
    );
  });
});

describe("WP122 `S170` — the product arms the pass from the create coordinator", () => {
  it("tp06e: every `new CanvasCreateCoordinator(` site in main.ts carries `armMirrorPass:`", () => {
    const sites = deriveSites(MAIN, "CanvasCreateCoordinator", "armMirrorPass");
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.filter((s) => !s.wired)).toStrictEqual([]);
  });

  it("tp06f: and it points at `armCanvasMirrorPass` — the pass main.ts already owns", () => {
    expect(stripComments(MAIN)).toMatch(
      /armMirrorPass:\s*\(\)\s*=>\s*this\.armCanvasMirrorPass\(\)/,
    );
  });

  it("tp06g: HALF A — the deriver reports the PRE-WP122 env as unwired", () => {
    const preWp122 = `
      const c = new CanvasCreateCoordinator({
        role: () => this.settings.role,
        attachWriter: (path) => this.attachCanvasWriter(path),
        identityFor: (path) => this.manifestManager.getCanvasGuid(path),
      });
    `;
    const sites = deriveSites(preWp122, "CanvasCreateCoordinator", "armMirrorPass");
    expect(sites).toHaveLength(1);
    expect(sites[0].wired).toBe(false);
  });

  it("tp06h: HALF B — no call site THROWS", () => {
    expect(() => deriveSites("const y = 2;\n", "CanvasCreateCoordinator", "armMirrorPass")).toThrow(
      /no CanvasCreateCoordinator\( call site found/,
    );
  });
});

describe("WP122 — the call-site census the charter asked for, measured", () => {
  it("tp06i: `armCanvasMirrorPass()` call sites in main.ts, counted rather than remembered", () => {
    // The charter cites ten call sites at ten specific line numbers and warns
    // that `main.ts` numbers WILL have moved. They had. This row asserts the
    // COUNT, which is what a later reader can act on, and the report names the
    // lines this run measured. Workflow §3.4: this is a directly-called private
    // method, not a callback, so the textual occurrences inside this one file
    // ARE the call sites — the one shape where the method is sound.
    const code = stripComments(MAIN);
    const calls = [...code.matchAll(/this\.armCanvasMirrorPass\(\)/g)];
    // Ten before WP122; the eleventh is R5's, wired through the create env.
    expect(calls).toHaveLength(11);
    // …and exactly one declaration, so "the pass" is one thing.
    expect([...code.matchAll(/private armCanvasMirrorPass\(\)/g)]).toHaveLength(1);
  });
});
