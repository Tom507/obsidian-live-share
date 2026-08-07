// WP72 / C72 AC4 — "no production canvas module gains a branch, and the
// production bundle is unchanged".
//
// The whole of `src/testing/` still tree-shakes out of the production `main.js`
// (`__LS_E2E__` false) and no file outside `plugin/src/testing/` is modified. The
// bundle half is measured on a freshly built bundle and recorded in
// `ImplementationReport_WP72.md`; what is asserted HERE is the structural half —
// no canvas module gained a branch, no import was added, and the command surface
// still rides one socket.
//
// Staging: copy into `plugin/src/__tests__/wp72/` (one level deep → `../../`).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// The same allow-list WP49 froze. WP72 adds nothing to it.
const ALLOWED_IMPORTS = new Set([
  "node:http",
  "node:crypto",
  "yjs",
  "../canvas/canvas-binding",
  "../utils",
]);

const CANVAS_MODULES = [
  "src/canvas/canvas-presence.ts",
  "src/canvas/canvas-binding.ts",
  "src/canvas/canvas-sync.ts",
  "src/canvas/canvas-model-bridge.ts",
];

describe("WP72 AC4 — the production surface is untouched", () => {
  it("e2e-control.ts imports nothing outside the frozen allow-list", () => {
    const src = readFileSync(join(pluginRoot(), "src/testing/e2e-control.ts"), "utf8");
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(ALLOWED_IMPORTS.has(spec)).toBe(true);
    }
  });

  it("still exactly one listening socket, no second transport", () => {
    const src = readFileSync(join(pluginRoot(), "src/testing/e2e-control.ts"), "utf8");
    expect([...src.matchAll(/\.listen\(/g)]).toHaveLength(1);
    expect([...src.matchAll(/createServer\(/g)]).toHaveLength(1);
    expect(src).not.toMatch(/new\s+WebSocket|WebSocketServer/);
  });

  it("no canvas module knows this WP exists", () => {
    const root = pluginRoot();
    for (const rel of CANVAS_MODULES) {
      const path = join(root, rel);
      if (!existsSync(path)) continue;
      const src = readFileSync(path, "utf8");
      expect(src).not.toMatch(/setFlag|clearFlags|flagConsumer|runtimeFlags|settingsOverrides/);
      expect(src).not.toMatch(/e2e-control|__LS_E2E__/);
    }
  });

  it("no canvas module imports the testing surface", () => {
    const root = pluginRoot();
    for (const rel of CANVAS_MODULES) {
      const path = join(root, rel);
      if (!existsSync(path)) continue;
      const src = readFileSync(path, "utf8");
      const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        expect(spec).not.toMatch(/testing\//);
      }
    }
  });

  it("main.ts is not where this WP landed", () => {
    const src = readFileSync(join(pluginRoot(), "src/main.ts"), "utf8");
    expect(src).not.toMatch(/clearFlags|flagConsumer|settingsOverrides/);
  });
});
