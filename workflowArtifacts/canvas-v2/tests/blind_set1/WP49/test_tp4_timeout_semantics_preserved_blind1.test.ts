// WP49 AC1 (blind set 1) — the timeoutMs boundary values.
// Angle: the visible test covers the default and a normal value. Here the edge is
// `timeoutMs: 0`, which is a legal value (`t >= 0`) and must NOT collapse to the
// 2000 default: with zero budget the answer is "true if already idle, false
// otherwise", decided without waiting.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EControlHost,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

function fixture() {
  const doc = new Y.Doc();
  const subscribed = new Set<string>();
  const plugin: E2EPluginLike = {
    settings: { clientId: "cid", roomId: "room", role: "guest" },
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

function userEdit(doc: Y.Doc, id: string, record: Record<string, unknown>): void {
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    let ymap = nodes.get(id);
    if (!ymap) {
      ymap = new Y.Map<unknown>();
      nodes.set(id, ymap);
    }
    for (const [k, v] of Object.entries(record)) ymap.set(k, v);
  }, "view");
}

describe("WP49 AC1 blind1 — timeoutMs boundary values", () => {
  it("timeoutMs 0 is forwarded as 0, not replaced by the default", async () => {
    const spy = vi.fn(async () => ({ quiescent: true }));
    const host: E2EControlHost = {
      sessionInfo: () => ({ clientId: "c", role: null, roomId: "r", connected: false }),
      canvasOpen: async () => ({ opened: false, subscribed: false }),
      canvasState: () => ({ nodes: [], edges: [] }),
      bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
      simulateEdit: async () => ({ applied: true }),
      setFlag: () => ({ set: true }),
      waitQuiescent: spy,
      canvasFile: async () => ({ exists: false, sha256: "", size: 0, content: null }),
    };
    await routeCommand(host, { cmd: "sync.waitQuiescent", args: { timeoutMs: 0 } });
    expect(spy).toHaveBeenCalledWith(0);
  });

  describe("live host", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("timeoutMs 0 answers true when already idle and false immediately after activity", async () => {
      const { doc, host } = fixture();
      await host.canvasOpen("a.canvas");
      await vi.advanceTimersByTimeAsync(500);

      const whenIdle = host.waitQuiescent(0);
      await vi.advanceTimersByTimeAsync(10);
      expect(await whenIdle).toEqual({ quiescent: true });

      userEdit(doc, "n1", { id: "n1", x: 3, y: 4 });
      const whenBusy = host.waitQuiescent(0);
      await vi.advanceTimersByTimeAsync(10);
      expect(await whenBusy).toEqual({ quiescent: false });
    });

    it("a generous timeout still resolves true rather than running to the deadline", async () => {
      const { doc, host } = fixture();
      await host.canvasOpen("a.canvas");
      userEdit(doc, "n1", { id: "n1", x: 1, y: 1 });

      const pending = host.waitQuiescent(5000);
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toEqual({ quiescent: true });
    });
  });
});
