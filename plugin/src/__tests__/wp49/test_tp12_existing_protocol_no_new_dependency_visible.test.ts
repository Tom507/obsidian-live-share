// WP49 / C49 AC4 — both oracles ride the transport that already exists.
//
// `canvas.file` must be reachable through the existing `POST /command` router with
// the existing `{ok, result}` / `{ok, error}` envelope, and adding it must not add a
// runtime dependency or a second server/socket. Asserted structurally rather than by
// reading the diff: the frozen dependency sets in `plugin/package.json`, the import
// allow-list of the module itself, and the single `.listen(` call site.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
// The repo lookup walks up from this file, so the test works from either location.
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type E2EControlHost,
  parseAndRoute,
  routeCommand,
} from "../../testing/e2e-control";

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

const FROZEN_DEPENDENCIES = [
  "lib0",
  "minimatch",
  "y-codemirror.next",
  "y-protocols",
  "yjs",
];

const ALLOWED_IMPORTS = new Set([
  "node:http",
  "node:crypto",
  "yjs",
  "../canvas/canvas-binding",
  "../utils",
  // §7 AMENDMENT (WP123, ledger entry A-123-4). The convergence oracle's records
  // clause reads a `.canvas` with THE PRODUCTION PARSER (`parseCanvasReport` +
  // `decodeCanvasDataToFlat`). The alternative is a second `.canvas` parser
  // living inside the rig, which is the defect class this freeze exists to
  // prevent, one file over. No new PACKAGE dependency and no new transport: the
  // two assertions either side of this list are untouched.
  "../files/canvas-sync",
]);

const FORBIDDEN_TRANSPORTS = ["ws", "socket.io", "node:net", "node:tls", "node:dgram", "express"];

function fakeHost(overrides: Partial<E2EControlHost> = {}): E2EControlHost {
  return {
    sessionInfo: () => ({ clientId: "c1", role: "host", roomId: "r1", connected: true }),
    canvasOpen: async () => ({ opened: true, subscribed: true }),
    canvasState: () => ({ nodes: [], edges: [] }),
    bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
    simulateEdit: async () => ({ applied: true }),
    setFlag: () => ({ set: true }),
    waitQuiescent: async () => ({ quiescent: true }),
    canvasFile: async () => ({
      exists: true,
      sha256: "e".repeat(64),
      size: 12,
      content: '{"nodes":[]}',
    }),
    ...overrides,
  };
}

describe("WP49 AC4 — canvas.file on the existing POST /command protocol", () => {
  it("routes through the existing ok envelope with the pinned result fields", async () => {
    const spy = vi.fn(async () => ({
      exists: true,
      sha256: "f".repeat(64),
      size: 42,
      content: '{"nodes":[],"edges":[]}',
    }));
    const out = await routeCommand(fakeHost({ canvasFile: spy }), {
      cmd: "canvas.file",
      args: { path: "board.canvas" },
    });

    expect(spy).toHaveBeenCalledWith("board.canvas");
    expect(out.status).toBe(200);
    expect(out.body).toEqual({
      ok: true,
      result: { exists: true, sha256: "f".repeat(64), size: 42, content: '{"nodes":[],"edges":[]}' },
    });
  });

  it("a missing path arg is the existing structured 400, never a throw", async () => {
    const out = await routeCommand(fakeHost(), { cmd: "canvas.file", args: {} });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("path") });
  });

  it("works through parseAndRoute on a raw body, like every other command", async () => {
    const out = await parseAndRoute(
      fakeHost(),
      JSON.stringify({ cmd: "canvas.file", args: { path: "board.canvas" } }),
    );
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true });
  });
});

describe("WP49 AC4 — no new runtime dependency, no new transport", () => {
  it("plugin/package.json dependency sets are unchanged", () => {
    const pkg = JSON.parse(readFileSync(join(pluginRoot(), "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...FROZEN_DEPENDENCIES].sort());
    for (const name of FORBIDDEN_TRANSPORTS) {
      expect(pkg.dependencies).not.toHaveProperty(name);
      expect(pkg.devDependencies).not.toHaveProperty(name);
    }
  });

  it("e2e-control.ts imports nothing outside the allow-list", () => {
    const src = readFileSync(join(pluginRoot(), "src/testing/e2e-control.ts"), "utf8");
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(ALLOWED_IMPORTS.has(spec)).toBe(true);
    }
  });

  it("still opens exactly one listening socket", () => {
    const src = readFileSync(join(pluginRoot(), "src/testing/e2e-control.ts"), "utf8");
    expect([...src.matchAll(/\.listen\(/g)]).toHaveLength(1);
    expect([...src.matchAll(/createServer\(/g)]).toHaveLength(1);
    expect(src).not.toMatch(/new\s+WebSocket|WebSocketServer/);
  });
});
