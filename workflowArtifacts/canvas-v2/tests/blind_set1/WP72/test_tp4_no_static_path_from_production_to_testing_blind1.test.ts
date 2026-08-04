// WP72 / C72 AC4 (blind set 1) — "no production canvas module gains a branch, and
// the production bundle is unchanged".
//
// ANGLE (different mechanism from the visible set): the visible test greps four
// named canvas modules and the import line of `e2e-control.ts`. A file-by-file
// grep can only speak about the files it was told to look at, so it cannot see a
// branch added to `canvas-canonical.ts`, or a two-hop path
// `canvas-presence → some-helper → testing/e2e-control`. Here the oracle is the
// STATIC MODULE GRAPH: start at `src/main.ts`, follow every static
// `import … from "./…"` / `export … from "./…"` edge transitively, and assert
// that `src/testing/e2e-control.ts` is unreachable — while proving the walk
// really walked (it must reach dozens of files, including the canvas modules).
// Tree-shaking is a property of the graph, so this is the property AC4 actually
// depends on, measured directly rather than sampled.
//
// The one edge that DOES exist is the flag-gated dynamic `import()` in `main.ts`.
// A dynamic import is not a static edge — which is exactly why esbuild can fold
// it away when `__LS_E2E__` is `false` — so the walk must not find it, and the
// last case pins that it is still the ONLY reference and still inside the guard.
//
// WOULD REDDEN IF: any production module gained a static import of the testing
// surface, directly or through any chain; if the dynamic import in `main.ts` were
// turned into a static one (the whole module then rides into the bundle); if the
// `__LS_E2E__` guard around it were removed or renamed; or if a second reference
// to the testing module were added to `main.ts`.
//
// DATA SAFETY: reads only `plugin/src/**/*.ts` from the repository under test; no
// vault, no `data.json`, no temp file, no network.
//
// Staging: copy into `plugin/src/__tests__/wp72blind1/` (→ `../../testing/...`).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up until the `live-share` plugin package root is found. */
function pluginRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
      if (pkg.name === "live-share") return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the live-share plugin package root");
}

const ROOT = pluginRoot();
const SRC = join(ROOT, "src");
const TESTING_MODULE = join(SRC, "testing", "e2e-control.ts");

/** Source with block and line comments removed — prose must not create an edge. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * STATIC edges only. `from "…"` covers `import … from`, `import type … from` and
 * `export … from`; a bare `import("…")` expression is deliberately NOT matched,
 * because it is not a static edge and is precisely the construct the production
 * build folds away.
 */
function staticSpecifiers(path: string): string[] {
  return [...code(path).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Resolve a relative specifier to a `.ts` file, or `null` for anything external. */
function resolveTs(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every PRODUCTION `.ts` under `src/`: the test tree, the obsidian mock and any
 * `*.test.ts` / `*.spec.ts` are excluded wherever they sit, so the sweep does not
 * accuse a test file (this one included) of being production code.
 */
function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (/\.(test|spec)\.ts$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  walk(SRC);
  return out;
}

describe("WP72 AC4 blind1 — the testing surface is not in the production module graph", () => {
  it("the static graph reachable from main.ts never reaches src/testing/", () => {
    const entry = join(SRC, "main.ts");
    expect(existsSync(entry)).toBe(true);

    const seen = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const spec of staticSpecifiers(current)) {
        const target = resolveTs(current, spec);
        if (target === null || seen.has(target)) continue;
        seen.add(target);
        queue.push(target);
      }
    }

    // The walk really walked: a broken traversal that visited only the entry
    // point would trivially "prove" the property below.
    expect(seen.size).toBeGreaterThan(15);
    expect([...seen].some((p) => p.includes(join("src", "canvas")))).toBe(true);

    const testingReached = [...seen].filter((p) => p.includes(join("src", "testing")));
    expect(testingReached.map((p) => relative(ROOT, p))).toEqual([]);
    expect(seen.has(TESTING_MODULE)).toBe(false);
  });

  it("no production source anywhere under src/ statically imports the testing surface", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      if (file.startsWith(join(SRC, "testing"))) continue;
      for (const spec of staticSpecifiers(file)) {
        const target = resolveTs(file, spec);
        if (target !== null && target.startsWith(join(SRC, "testing"))) {
          offenders.push(`${relative(ROOT, file)} → ${spec}`);
        }
      }
    }
    // Exhaustive over the tree, not over a hand-written list of four modules.
    expect(offenders).toEqual([]);
    // Sanity: the sweep saw a real number of files.
    expect(productionSources().length).toBeGreaterThan(20);
  });

  it("the testing module is reachable only through the flag-gated dynamic import", () => {
    const main = code(join(SRC, "main.ts"));
    const references = [...main.matchAll(/testing\/e2e-control/g)];
    // Exactly one mention in code (comments are stripped above).
    expect(references).toHaveLength(1);
    // ...and it is a dynamic `import()` expression, not a static edge.
    expect(main).toMatch(/import\(\s*["']\.\/testing\/e2e-control["']\s*\)/);
    expect(main).not.toMatch(/from\s+["'][^"']*testing\/e2e-control["']/);
    // ...standing inside the build-time flag guard that folds it to dead code.
    expect(main).toMatch(/__LS_E2E__[\s\S]{0,240}?import\(\s*["']\.\/testing\/e2e-control["']\s*\)/);
  });

  it("no canvas module mentions the WP72 vocabulary at all", () => {
    // Exhaustive over `src/canvas/**`, not over four named files: a branch added
    // to any canvas module — including ones the visible list does not know —
    // fails here.
    const canvasDir = join(SRC, "canvas");
    const offenders: string[] = [];
    for (const file of productionSources()) {
      if (!file.startsWith(canvasDir)) continue;
      const src = code(file);
      if (/setFlag|clearFlags|flagConsumer|runtimeFlags|settingsOverrides|__LS_E2E__/.test(src)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
    expect(productionSources().filter((f) => f.startsWith(canvasDir)).length).toBeGreaterThan(5);
  });
});
