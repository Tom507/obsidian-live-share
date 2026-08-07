// WP49 AC4 (blind set 1) — the error envelope of the new command.
// Angle: the visible test proves the happy path plus the frozen dependency set.
// Here the focus is the failure surface: a new command must not be able to crash the
// canvas view, so every bad input and every host rejection comes back as the same
// structured `400 {ok:false,error}` the protocol already uses, and no new HTTP route
// is added alongside `/command` and `/events`.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type E2EControlHost, parseAndRoute, routeCommand } from "../../testing/e2e-control";

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

function host(overrides: Partial<E2EControlHost> = {}): E2EControlHost {
  return {
    sessionInfo: () => ({ clientId: "c1", role: "guest", roomId: "r1", connected: false }),
    canvasOpen: async () => ({ opened: true, subscribed: true }),
    canvasState: () => ({ nodes: [], edges: [] }),
    bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
    simulateEdit: async () => ({ applied: true }),
    setFlag: () => ({ set: true }),
    waitQuiescent: async () => ({ quiescent: true }),
    canvasFile: async () => ({ exists: false, sha256: "", size: 0, content: null }),
    ...overrides,
  };
}

describe("WP49 AC4 blind1 — canvas.file cannot crash the control surface", () => {
  it("a non-string path is a 400 naming the arg", async () => {
    for (const bad of [42, null, [], {}, ""]) {
      const out = await routeCommand(host(), { cmd: "canvas.file", args: { path: bad } });
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("path") });
    }
  });

  it("a rejecting host method becomes a 400, never a propagated throw", async () => {
    const out = await routeCommand(
      host({
        canvasFile: async () => {
          throw new Error("adapter unavailable");
        },
      }),
      { cmd: "canvas.file", args: { path: "a.canvas" } },
    );
    expect(out).toEqual({ status: 400, body: { ok: false, error: "adapter unavailable" } });
  });

  it("malformed JSON around a canvas.file call is still the JSON error, not a crash", async () => {
    const out = await parseAndRoute(host(), '{"cmd":"canvas.file","args":{');
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("JSON") });
  });

  it("an unrelated unknown command is unaffected by the new case", async () => {
    const out = await routeCommand(host(), { cmd: "canvas.files" });
    expect(out.body).toEqual({ ok: false, error: "unknown cmd: canvas.files" });
  });

  it("no third HTTP route was added next to /command and /events", () => {
    const src = readFileSync(join(pluginRoot(), "src/testing/e2e-control.ts"), "utf8");
    const routes = [...src.matchAll(/url\.startsWith\(["']([^"']+)["']\)/g)].map((m) => m[1]).sort();
    expect(routes).toEqual(["/command", "/events"]);
  });
});
