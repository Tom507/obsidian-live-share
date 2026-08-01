// WP49 / C49 AC1 — the existing `sync.waitQuiescent` timeout semantics survive.
//
// The command keeps its name and its `timeoutMs` default of 2000 (T3 contract §6),
// the router keeps forwarding an explicit value, and the host keeps returning
// `{quiescent:false}` at the deadline rather than hanging or throwing.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
// Deterministic: fake timers only, no wall-clock sleep.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EControlHost,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

function fakeHost(waitQuiescent: E2EControlHost["waitQuiescent"]): E2EControlHost {
  return {
    sessionInfo: () => ({ clientId: "c1", role: "host", roomId: "r1", connected: true }),
    canvasOpen: async () => ({ opened: true, subscribed: true }),
    canvasState: () => ({ nodes: [], edges: [] }),
    bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
    simulateEdit: async () => ({ applied: true }),
    setFlag: () => ({ set: true }),
    waitQuiescent,
    canvasFile: async () => ({ exists: false, sha256: "", size: 0, content: null }),
  };
}

function makeLiveHost() {
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
  const counters: BindingCounters = {
    applyRemote: 0,
    captureLocal: 0,
    rePush: 0,
    originUpdates: 0,
  };
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
  }, "canvas-view-user");
}

describe("WP49 AC1 — sync.waitQuiescent keeps its name and its timeout contract", () => {
  it("the router still defaults timeoutMs to 2000 and still forwards an explicit value", async () => {
    const spy = vi.fn(async () => ({ quiescent: true }));
    await routeCommand(fakeHost(spy), { cmd: "sync.waitQuiescent" });
    expect(spy).toHaveBeenCalledWith(2000);

    await routeCommand(fakeHost(spy), { cmd: "sync.waitQuiescent", args: { timeoutMs: 750 } });
    expect(spy).toHaveBeenCalledWith(750);
  });

  it("a non-numeric or negative timeoutMs still falls back to 2000", async () => {
    const spy = vi.fn(async () => ({ quiescent: true }));
    await routeCommand(fakeHost(spy), { cmd: "sync.waitQuiescent", args: { timeoutMs: "soon" } });
    expect(spy).toHaveBeenLastCalledWith(2000);
    await routeCommand(fakeHost(spy), { cmd: "sync.waitQuiescent", args: { timeoutMs: -5 } });
    expect(spy).toHaveBeenLastCalledWith(2000);
  });

  it("the result is still the {quiescent} envelope over the existing protocol", async () => {
    const out = await routeCommand(fakeHost(async () => ({ quiescent: true })), {
      cmd: "sync.waitQuiescent",
      args: { timeoutMs: 10 },
    });
    expect(out).toEqual({ status: 200, body: { ok: true, result: { quiescent: true } } });
  });

  describe("live host", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns quiescent:false at the deadline while activity continues, true once it stops", async () => {
      const { doc, host } = makeLiveHost();
      await host.canvasOpen("a.canvas");

      const pending = host.waitQuiescent(200);
      for (let step = 1; step <= 12; step++) {
        userEdit(doc, "n1", { id: "n1", x: step, y: step });
        await vi.advanceTimersByTimeAsync(20);
      }
      expect(await pending).toEqual({ quiescent: false });

      const settled = host.waitQuiescent(1000);
      await vi.advanceTimersByTimeAsync(1040);
      expect(await settled).toEqual({ quiescent: true });
    });
  });
});
