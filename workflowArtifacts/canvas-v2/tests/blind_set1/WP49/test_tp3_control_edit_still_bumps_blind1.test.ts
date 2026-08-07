// WP49 AC1 (blind set 1) — the control path exercised end-to-end through the router.
// Angle: the visible test calls the host method directly. Here the edit and the wait
// both go through `routeCommand`, i.e. exactly the way the MCP driver drives it, and
// the edit is the REMOVAL path rather than the upsert path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

function fixture() {
  const doc = new Y.Doc();
  const subscribed = new Set<string>();
  const plugin: E2EPluginLike = {
    settings: { clientId: "cid", roomId: "room", role: "host" },
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: {
      subscribe: async (p: string) => {
        subscribed.add(p);
      },
      isSubscribed: (p: string) => subscribed.has(p),
      getCanvasSnapshot: () => null,
      getCanvasDocHandle: (p: string) => (subscribed.has(p) ? { doc } : null),
    },
  };
  const counters: BindingCounters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return { doc, host: buildPluginHost(plugin, { counters, bump: () => {} }) };
}

describe("WP49 AC1 blind1 — control-driven removal still marks activity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("canvas.simulateEdit removal via the router blocks the next sync.waitQuiescent", async () => {
    const { doc, host } = fixture();
    await routeCommand(host, { cmd: "canvas.open", args: { path: "a.canvas" } });
    await routeCommand(host, {
      cmd: "canvas.simulateEdit",
      args: { path: "a.canvas", change: { nodes: [{ id: "n1", x: 1, y: 1 }] } },
    });
    await vi.advanceTimersByTimeAsync(400);

    const idle = routeCommand(host, { cmd: "sync.waitQuiescent", args: { timeoutMs: 25 } });
    await vi.advanceTimersByTimeAsync(80);
    expect(await idle).toEqual({ status: 200, body: { ok: true, result: { quiescent: true } } });

    await routeCommand(host, {
      cmd: "canvas.simulateEdit",
      args: { path: "a.canvas", change: { removeNodes: ["n1"] } },
    });
    expect(doc.getMap<Y.Map<unknown>>("nodes").has("n1")).toBe(false);

    const busy = routeCommand(host, { cmd: "sync.waitQuiescent", args: { timeoutMs: 25 } });
    await vi.advanceTimersByTimeAsync(80);
    expect(await busy).toEqual({ status: 200, body: { ok: true, result: { quiescent: false } } });
  });

  it("the simulateEdit result envelope is unchanged", async () => {
    const { host } = fixture();
    await routeCommand(host, { cmd: "canvas.open", args: { path: "a.canvas" } });
    const out = await routeCommand(host, {
      cmd: "canvas.simulateEdit",
      args: { path: "a.canvas", change: { edges: [{ id: "e1", fromNode: "a", toNode: "b" }] } },
    });
    expect(out).toEqual({ status: 200, body: { ok: true, result: { applied: true } } });
  });
});
