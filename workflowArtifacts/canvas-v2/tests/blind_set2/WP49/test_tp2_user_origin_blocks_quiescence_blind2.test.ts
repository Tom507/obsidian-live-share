// WP49 AC1 (blind set 2) — user activity interleaved with relay activity.
// Angle: on a real host the three origins are mixed, and the quiet window must be
// re-armed by whichever one moved last. The writes here are strictly ORDERED — the
// peer writes, the host observes it, then the user writes — so no assertion in this
// file depends on a Yjs clientID tie-break (T3 contract §10).
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

function fromPeer(target: Y.Doc, mutate: (peer: Y.Doc) => void): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(target));
  mutate(peer);
  Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), "relay");
}

function put(doc: Y.Doc, id: string, record: Record<string, unknown>, origin?: unknown): void {
  const apply = () => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    let ymap = nodes.get(id);
    if (!ymap) {
      ymap = new Y.Map<unknown>();
      nodes.set(id, ymap);
    }
    for (const [k, v] of Object.entries(record)) ymap.set(k, v);
  };
  if (origin === undefined) apply();
  else doc.transact(apply, origin);
}

describe("WP49 AC1 blind2 — the quiet window is re-armed by whichever origin moved last", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("peer first, then the user: ordered writes, and the last one still blocks", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("mixed.canvas");

    // 1. The peer creates the node — sole author of "n1".
    fromPeer(doc, (p) => put(p, "n1", { id: "n1", x: 0, y: 0, width: 200, height: 80 }));
    // The host observes it before anyone else writes: causal chain, no concurrency.
    expect(doc.getMap<Y.Map<unknown>>("nodes").get("n1")?.get("x")).toBe(0);
    await vi.advanceTimersByTimeAsync(400);

    const afterPeer = host.waitQuiescent(25);
    await vi.advanceTimersByTimeAsync(80);
    expect(await afterPeer).toEqual({ quiescent: true });

    // 2. Only now does the local user move it — sole author of this value.
    put(doc, "n1", { x: 320 }, "canvas-view-user");
    expect(doc.getMap<Y.Map<unknown>>("nodes").get("n1")?.get("x")).toBe(320);

    const afterUser = host.waitQuiescent(25);
    await vi.advanceTimersByTimeAsync(80);
    expect(await afterUser).toEqual({ quiescent: false });
  });

  it("a user edit landing during a pending wait pushes the answer to false", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("mixed.canvas");
    await vi.advanceTimersByTimeAsync(400);

    const pending = host.waitQuiescent(120);
    await vi.advanceTimersByTimeAsync(20);
    put(doc, "n2", { id: "n2", x: 7, y: 7 }, "canvas-view-user");
    await vi.advanceTimersByTimeAsync(160);

    expect(await pending).toEqual({ quiescent: false });
  });
});
