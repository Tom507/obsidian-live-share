// WP49 AC1 (blind set 2) — widening the seam must not contaminate the counters.
// Angle: `canvas.binding` counters and the quiescence seam share the same `hooks`
// object. If the new any-origin activity tracking increments a binding counter, the
// binding instrumentation stops meaning what WP4 said it means. So: a control edit
// still marks activity, and NEITHER a control edit nor a peer delta touches
// `bindingCounters`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
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
  return { doc, counters, host: buildPluginHost(plugin, { counters, bump: () => {} }) };
}

describe("WP49 AC1 blind2 — the activity seam is not the counter seam", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a control edit marks activity without moving any binding counter", async () => {
    const { host, counters } = fixture();
    await host.canvasOpen("a.canvas");
    await vi.advanceTimersByTimeAsync(400);

    await host.simulateEdit("a.canvas", { nodes: [{ id: "n1", x: 5, y: 5 }] });

    const busy = host.waitQuiescent(25);
    await vi.advanceTimersByTimeAsync(80);
    expect(await busy).toEqual({ quiescent: false });
    expect(host.bindingCounters("a.canvas")).toEqual({
      applyRemote: 0,
      captureLocal: 0,
      rePush: 0,
      originUpdates: 0,
    });
    expect(counters).toEqual({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 });
  });

  it("a peer delta marks activity without moving any binding counter either", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("a.canvas");
    await vi.advanceTimersByTimeAsync(400);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const rec = new Y.Map<unknown>();
    peer.getMap<Y.Map<unknown>>("nodes").set("nRemote", rec);
    rec.set("id", "nRemote");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), "relay");

    const busy = host.waitQuiescent(25);
    await vi.advanceTimersByTimeAsync(80);
    expect(await busy).toEqual({ quiescent: false });
    expect(host.bindingCounters("a.canvas")).toEqual({
      applyRemote: 0,
      captureLocal: 0,
      rePush: 0,
      originUpdates: 0,
    });
  });

  it("session.info is untouched by the new seam", async () => {
    const { host } = fixture();
    await host.canvasOpen("a.canvas");
    await host.simulateEdit("a.canvas", { nodes: [{ id: "n1", x: 1, y: 1 }] });
    expect(host.sessionInfo()).toEqual({
      clientId: "cid",
      role: "host",
      roomId: "room",
      connected: true,
    });
  });
});
