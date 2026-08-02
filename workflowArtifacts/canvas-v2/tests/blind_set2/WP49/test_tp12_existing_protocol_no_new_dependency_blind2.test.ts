// WP49 AC4 (blind set 2) — the zero-production-footprint side of "no new transport".
// Angle: the visible test freezes the dependency list; this one guards the two
// structural properties that make that list meaningful — the control module is still
// reachable only through the `__LS_E2E__` dead-code branch in `main.ts`, and the
// module still uses the Node built-in HTTP server and nothing else. A new oracle
// that quietly pulled in a socket library or leaked an unguarded import would keep
// `package.json` looking innocent for a while.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type E2EControlHost, routeCommand } from "../../testing/e2e-control";

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

function read(rel: string): string {
  return readFileSync(join(pluginRoot(), rel), "utf8");
}

describe("WP49 AC4 blind2 — zero production footprint is unchanged", () => {
  it("main.ts still reaches the control module only through the __LS_E2E__ branch", () => {
    const src = read("src/main.ts");
    const imports = [...src.matchAll(/import\(\s*["']\.\/testing\/e2e-control["']\s*\)/g)];
    expect(imports).toHaveLength(1);
    expect(src).toMatch(/typeof __LS_E2E__ !== "undefined" && __LS_E2E__/);
    // Never a static import of the testing module from production code.
    expect(src).not.toMatch(/^import .* from "\.\/testing\/e2e-control";/m);
  });

  it("the control module still uses the node:http built-in server and no socket library", () => {
    const src = read("src/testing/e2e-control.ts");
    expect(src).toMatch(/from "node:http"/);
    for (const banned of ["\"ws\"", "'ws'", "socket.io", "node:net", "node:tls", "node:dgram", "express"]) {
      expect(src).not.toContain(banned);
    }
  });

  it("package.json still declares exactly the five runtime dependencies", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "lib0",
      "minimatch",
      "y-codemirror.next",
      "y-protocols",
      "yjs",
    ]);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([
      "@biomejs/biome",
      "@types/node",
      "@typescript-eslint/parser",
      "esbuild",
      "eslint",
      "eslint-plugin-obsidianmd",
      "obsidian",
      "tslib",
      "typescript",
      "vitest",
    ]);
  });

  it("both oracles answer over the same router — no second entry point", async () => {
    const host: E2EControlHost = {
      sessionInfo: () => ({ clientId: "c", role: "host", roomId: "r", connected: true }),
      canvasOpen: async () => ({ opened: true, subscribed: true }),
      canvasState: () => ({ nodes: [{ id: "n1" }], edges: [] }),
      bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
      simulateEdit: async () => ({ applied: true }),
      setFlag: () => ({ set: true }),
      waitQuiescent: async () => ({ quiescent: true }),
      canvasFile: async () => ({ exists: true, sha256: "0".repeat(64), size: 3, content: "{}\n" }),
    };

    const quiescent = await routeCommand(host, { cmd: "sync.waitQuiescent" });
    const state = await routeCommand(host, { cmd: "canvas.state", args: { path: "a.canvas" } });
    const file = await routeCommand(host, { cmd: "canvas.file", args: { path: "a.canvas" } });

    for (const out of [quiescent, state, file]) {
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ ok: true });
    }
    expect(file.body).toEqual({
      ok: true,
      result: { exists: true, sha256: "0".repeat(64), size: 3, content: "{}\n" },
    });
  });
});
