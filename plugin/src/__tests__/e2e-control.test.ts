import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  E2E_BUILD_MARKER,
  type E2EControlHost,
  type E2EPluginLike,
  buildPluginHost,
  parseAndRoute,
  routeCommand,
} from "../testing/e2e-control";

// ===========================================================================
// WP4 — control-server command routing + error handling, NO live socket.
// Exercises the pure router (`routeCommand` / `parseAndRoute`) against a fake
// host, plus the concrete plugin-host adapter against a fake plugin + Y.Doc.
// ===========================================================================

function fakeHost(overrides: Partial<E2EControlHost> = {}): E2EControlHost {
  return {
    sessionInfo: () => ({ clientId: "c1", role: "host", roomId: "r1", connected: true }),
    canvasOpen: async (path) => ({ opened: true, subscribed: path === "a.canvas" }),
    canvasState: () => ({ nodes: [{ id: "n1" }], edges: [] }),
    bindingCounters: () => ({ applyRemote: 1, captureLocal: 2, rePush: 3, originUpdates: 4 }),
    simulateEdit: async () => ({ applied: true }),
    setFlag: () => ({ set: true }),
    waitQuiescent: async () => ({ quiescent: true }),
    ...overrides,
  };
}

describe("routeCommand — happy paths (US4 AC3)", () => {
  it("session.info returns 200 ok with the host result", async () => {
    const out = await routeCommand(fakeHost(), { cmd: "session.info" });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({
      ok: true,
      result: { clientId: "c1", role: "host", roomId: "r1", connected: true },
    });
  });

  it("canvas.open forwards the path arg and returns the host result", async () => {
    const spy = vi.fn(async (path: string) => ({ opened: true, subscribed: true }));
    const out = await routeCommand(fakeHost({ canvasOpen: spy }), {
      cmd: "canvas.open",
      args: { path: "a.canvas" },
    });
    expect(spy).toHaveBeenCalledWith("a.canvas");
    expect(out).toEqual({ status: 200, body: { ok: true, result: { opened: true, subscribed: true } } });
  });

  it("canvas.state returns the snapshot", async () => {
    const out = await routeCommand(fakeHost(), { cmd: "canvas.state", args: { path: "a.canvas" } });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, result: { nodes: [{ id: "n1" }], edges: [] } });
  });

  it("canvas.binding returns the four counters", async () => {
    const out = await routeCommand(fakeHost(), { cmd: "canvas.binding", args: { path: "a.canvas" } });
    expect(out.body).toEqual({
      ok: true,
      result: { applyRemote: 1, captureLocal: 2, rePush: 3, originUpdates: 4 },
    });
  });

  it("canvas.simulateEdit forwards path + change", async () => {
    const spy = vi.fn(async () => ({ applied: true }));
    const change = { nodes: [{ id: "n1", x: 5 }] };
    const out = await routeCommand(fakeHost({ simulateEdit: spy }), {
      cmd: "canvas.simulateEdit",
      args: { path: "a.canvas", change },
    });
    expect(spy).toHaveBeenCalledWith("a.canvas", change);
    expect(out).toEqual({ status: 200, body: { ok: true, result: { applied: true } } });
  });

  it("canvas.setFlag forwards name + value", async () => {
    const spy = vi.fn(() => ({ set: true }));
    const out = await routeCommand(fakeHost({ setFlag: spy }), {
      cmd: "canvas.setFlag",
      args: { name: "debug", value: true },
    });
    expect(spy).toHaveBeenCalledWith("debug", true);
    expect(out.status).toBe(200);
  });

  it("sync.waitQuiescent defaults timeoutMs when absent and passes it when present", async () => {
    const spy = vi.fn(async () => ({ quiescent: true }));
    await routeCommand(fakeHost({ waitQuiescent: spy }), { cmd: "sync.waitQuiescent" });
    expect(spy).toHaveBeenCalledWith(2000);
    await routeCommand(fakeHost({ waitQuiescent: spy }), {
      cmd: "sync.waitQuiescent",
      args: { timeoutMs: 500 },
    });
    expect(spy).toHaveBeenCalledWith(500);
  });
});

describe("routeCommand — structured errors, never throws (US4 AC5)", () => {
  it("unknown cmd → 400 ok:false", async () => {
    const out = await routeCommand(fakeHost(), { cmd: "does.notExist" });
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ ok: false, error: "unknown cmd: does.notExist" });
  });

  it("non-object body → 400", async () => {
    for (const bad of [null, 42, "str", [], true]) {
      const out = await routeCommand(fakeHost(), bad);
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ ok: false });
    }
  });

  it("missing/invalid cmd → 400", async () => {
    const out = await routeCommand(fakeHost(), { args: { path: "a" } });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("cmd") });
  });

  it("non-object args → 400", async () => {
    const out = await routeCommand(fakeHost(), { cmd: "canvas.open", args: "nope" });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("args") });
  });

  it("missing required path arg → 400", async () => {
    const out = await routeCommand(fakeHost(), { cmd: "canvas.open", args: {} });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("path") });
  });

  it("a throwing host method is converted to a 400, never propagated", async () => {
    const out = await routeCommand(
      fakeHost({
        simulateEdit: async () => {
          throw new Error("canvas not open: x.canvas");
        },
      }),
      { cmd: "canvas.simulateEdit", args: { path: "x.canvas" } },
    );
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ ok: false, error: "canvas not open: x.canvas" });
  });
});

describe("parseAndRoute — raw body parsing", () => {
  it("valid JSON routes normally", async () => {
    const out = await parseAndRoute(fakeHost(), JSON.stringify({ cmd: "session.info" }));
    expect(out.status).toBe(200);
  });

  it("invalid JSON → 400", async () => {
    const out = await parseAndRoute(fakeHost(), "{not json");
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false, error: expect.stringContaining("JSON") });
  });

  it("empty body is treated as {} → missing cmd → 400", async () => {
    const out = await parseAndRoute(fakeHost(), "   ");
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
  });
});

// ===========================================================================
// buildPluginHost — concrete adapter over a fake plugin (no socket).
// ===========================================================================

function fakePlugin(doc: Y.Doc): { plugin: E2EPluginLike; counters: BindingCounters } {
  const counters: BindingCounters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  const subscribed = new Set<string>();
  const plugin: E2EPluginLike = {
    settings: { clientId: "cid", roomId: "room", role: "guest" },
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: {
      subscribe: async (path) => {
        subscribed.add(path);
      },
      isSubscribed: (path) => subscribed.has(path),
      getCanvasSnapshot: () => null,
      getCanvasDocHandle: (path) => (subscribed.has(path) ? { doc } : null),
    },
  };
  // A pre-existing settings key the setFlag test can flip (added post-literal to
  // avoid an excess-property check against the typed settings shape).
  (plugin.settings as Record<string, unknown>).debug = false;
  return { plugin, counters };
}

describe("buildPluginHost", () => {
  it("sessionInfo maps settings + connection state", () => {
    const doc = new Y.Doc();
    const { plugin, counters } = fakePlugin(doc);
    const host = buildPluginHost(plugin, { counters, bump: () => {} });
    // WP46 (BUILD_SPEC §7 amendment ledger) — `session.info` now reports vault,
    // build and canvas-surface identity alongside the legacy quartet. Still an
    // exact whole-object `toEqual` over all nine keys: this fixture has
    // `canvasSync` but neither `app` nor `manifest`, so it additionally pins the
    // AC3 honest-degradation values (`vaultId: ""`, `vaultPath: null`).
    expect(host.sessionInfo()).toEqual({
      clientId: "cid",
      role: "guest",
      roomId: "room",
      connected: true,
      vaultId: "",
      vaultName: "",
      vaultPath: null,
      pluginBuild: `0.0.0+${E2E_BUILD_MARKER}`,
      canvasSurface: true,
    });
  });

  it("canvasState returns empty snapshot when none available", () => {
    const doc = new Y.Doc();
    const { plugin, counters } = fakePlugin(doc);
    const host = buildPluginHost(plugin, { counters, bump: () => {} });
    expect(host.canvasState("a.canvas")).toEqual({ nodes: [], edges: [] });
  });

  it("simulateEdit throws (→ router 400) when the canvas is not open", async () => {
    const doc = new Y.Doc();
    const { plugin, counters } = fakePlugin(doc);
    const host = buildPluginHost(plugin, { counters, bump: () => {} });
    await expect(host.simulateEdit("a.canvas", { nodes: [] })).rejects.toThrow(/not open/);
  });

  it("simulateEdit applies node/edge upserts + removals to the shared doc", async () => {
    const doc = new Y.Doc();
    const { plugin, counters } = fakePlugin(doc);
    const host = buildPluginHost(plugin, { counters, bump: () => {} });
    await host.canvasOpen("a.canvas"); // subscribes → handle available

    const res = await host.simulateEdit("a.canvas", {
      nodes: [{ id: "n1", x: 10, y: 20 }],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n1" }],
    });
    expect(res).toEqual({ applied: true });

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    expect(nodes.get("n1")?.get("x")).toBe(10);
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    expect(edges.get("e1")?.get("fromNode")).toBe("n1");

    // Removal path.
    await host.simulateEdit("a.canvas", { removeNodes: ["n1"], removeEdges: ["e1"] });
    expect(nodes.has("n1")).toBe(false);
    expect(edges.has("e1")).toBe(false);
  });

  it("setFlag writes a known setting and stashes unknown flags without touching settings", () => {
    const doc = new Y.Doc();
    const { plugin, counters } = fakePlugin(doc);
    const host = buildPluginHost(plugin, { counters, bump: () => {} });
    expect(host.setFlag("debug", true)).toEqual({ set: true });
    expect((plugin.settings as Record<string, unknown>).debug).toBe(true);
    // Unknown flag does not create a settings key.
    expect(host.setFlag("madeUpFlag", 1)).toEqual({ set: true });
    expect("madeUpFlag" in (plugin.settings as Record<string, unknown>)).toBe(false);
  });

  it("waitQuiescent resolves quiescent:true once idle", async () => {
    const doc = new Y.Doc();
    const { plugin, counters } = fakePlugin(doc);
    const host = buildPluginHost(plugin, { counters, bump: () => {} });
    const res = await host.waitQuiescent(1000);
    expect(res).toEqual({ quiescent: true });
  });
});
