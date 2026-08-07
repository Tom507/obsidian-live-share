// WP24 / AC4 — "All file I/O is injected; the module imports neither Obsidian
// nor `node:fs` directly."
//
// The oracle is the module SOURCE, following the repo's established pattern for
// this class of claim (`wp1/test_tp02_headless_purity`, `wp2/test_tp05_purity`,
// `wp14/test_tp12_module_purity_static_imports`). A runtime probe is worthless
// here: under Vitest's node environment `require("fs")` would actually succeed,
// and under the plugin's esbuild bundle an accidental `import { normalizePath }
// from "obsidian"` resolves through vitest.config's alias to a MOCK and
// therefore never fails a behavioural test. Only the import list can see it.
//
// The precedent for a zero-import pure core is `plugin/src/canvas/reconcile-plan.ts`.
// WP24 is not quite that — it is licensed to import `yjs`, because it must
// encode checkpoints — so the allowlist is exactly `yjs` plus relative modules.
//
// The second half of AC4 ("all file I/O is injected") is checked behaviourally:
// a store handed an IO whose every method throws must still perform no I/O of
// its own, which is only possible if `SidecarIO` really is the single seam.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createSidecarStore } from "../../../files/canvas-sidecar";

const SOURCE_URL = new URL("../../../files/canvas-sidecar.ts", import.meta.url);
const RAW = readFileSync(SOURCE_URL, "utf8");

/** Comments may legitimately NAME the forbidden things; code may not use them. */
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

describe("WP24 AC4 — canvas-sidecar.ts imports neither Obsidian nor node:fs", () => {
  it("imports nothing but `yjs` and relative modules", () => {
    for (const specifier of importSpecifiers(CODE)) {
      const permitted =
        specifier === "yjs" || specifier.startsWith("./") || specifier.startsWith("../");
      expect(permitted, `unexpected import: ${specifier}`).toBe(true);
    }
  });

  it("never imports Obsidian and never names its runtime surface", () => {
    expect(CODE).not.toMatch(/["']obsidian["']/);
    expect(CODE).not.toMatch(/\bTFile\b|\bTFolder\b|\bnormalizePath\b|\bVault\b|\bapp\s*\./);
  });

  it("never imports the filesystem, under any of its specifiers", () => {
    expect(CODE).not.toMatch(/["'](?:node:)?fs(?:\/promises)?["']/);
    expect(CODE).not.toMatch(/["'](?:node:)?path["']/);
    expect(CODE).not.toMatch(/\breadFileSync\b|\bwriteFileSync\b|\bappendFileSync\b/);
    expect(CODE).not.toMatch(/\bexistsSync\b|\bmkdirSync\b|\btruncateSync\b/);
    expect(CODE).not.toMatch(/\brequire\s*\(/);
  });

  it("touches no host globals that would smuggle I/O back in", () => {
    expect(CODE).not.toMatch(/\bprocess\s*\./);
    expect(CODE).not.toMatch(/\bwindow\b|\bdocument\b|\blocalStorage\b/);
    expect(CODE).not.toMatch(/\bfetch\s*\(/);
  });

  it("reads no clock: nothing in the sidecar format is time-derived", () => {
    // A timestamped frame header or checkpoint would make every byte-equality
    // oracle in this suite and in WP25's non-deterministic.
    expect(CODE).not.toMatch(/\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bperformance\s*\.\s*now\b/);
  });

  it("performs no I/O of its own: an IO whose every method throws is fatal to nothing else", async () => {
    const attempted: string[] = [];
    const explode = (op: string) => async (): Promise<never> => {
      attempted.push(op);
      throw new Error(`io.${op} refused`);
    };
    const store = createSidecarStore({
      ensureDir: explode("ensureDir"),
      exists: explode("exists"),
      read: explode("read"),
      write: explode("write"),
      append: explode("append"),
      truncate: explode("truncate"),
      remove: explode("remove"),
    });

    // Nothing may reach a real disk; every path the store wants must come
    // through the injected object, so every call must be recorded here.
    await expect(store.append("guid-x", Y.encodeStateAsUpdate(new Y.Doc()))).rejects.toThrow(
      /io\.(ensureDir|append) refused/,
    );
    expect(attempted.length).toBeGreaterThan(0);
  });
});
