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
  E2E_BUILD_MARKER,
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
    // WP61 amendment (class B): this pinned the pre-WP46 four keys. WP46
    // deliberately replaced the payload with nine (T3_SharedContract §6.2), so
    // the pin was stale, not violated. Amended to the full nine-key payload with
    // this fixture's honest-degradation values — no `app` and no `manifest`, so
    // vaultId/vaultName degrade to "", vaultPath to null and the build to 0.0.0;
    // `canvasSync` is present, so the canvas surface is true. Still a whole-object
    // exact toEqual: a tenth key, a missing key or a changed value all fail it.
    expect(host.sessionInfo()).toEqual({
      clientId: "cid",
      role: "host",
      roomId: "room",
      connected: true,
      vaultId: "",
      vaultName: "",
      vaultPath: null,
      pluginBuild: `0.0.0+${E2E_BUILD_MARKER}`,
      canvasSurface: true,
    });
  });
});
