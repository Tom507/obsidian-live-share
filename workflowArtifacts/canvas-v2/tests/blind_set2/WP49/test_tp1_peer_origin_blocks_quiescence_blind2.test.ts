// WP49 AC1 (blind set 2) — a peer DELETION is activity too.
// Angle: both other sets deliver additive peer deltas. A tombstone carries no new
// value, so an activity seam that watches "did a value appear" instead of "did an
// update arrive" misses it — and a delete racing a read is precisely the window this
// oracle exists to close.
// CRDT hygiene: the peer doc is seeded from host state, so the delete is causally
// after the insert. No concurrent same-key writes anywhere in this file.
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
  return { doc, host: buildPluginHost(plugin, { counters, bump: () => {} }) };
}

function fromPeer(target: Y.Doc, mutate: (peer: Y.Doc) => void): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(target));
  mutate(peer);
  Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), "relay");
}

describe("WP49 AC1 blind2 — a peer tombstone keeps the instance non-quiescent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a remote node removal blocks a zero-budget quiescence probe", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("a.canvas");
    fromPeer(doc, (p) => {
      const nodes = p.getMap<Y.Map<unknown>>("nodes");
      const rec = new Y.Map<unknown>();
      nodes.set("n1", rec);
      rec.set("id", "n1");
      rec.set("x", 0);
    });
    await vi.advanceTimersByTimeAsync(500);

    const idle = host.waitQuiescent(0);
    // WP61 amendment (class A): one full 20 ms poll interval. A zero budget
    // expires at the earliest opportunity, which is the first poll —
    // `waitQuiescent` sleeps before it evaluates (WP49 AC1), so the previous
    // 5 ms advance never let this promise settle. Verdict unchanged.
    await vi.advanceTimersByTimeAsync(20);
    expect(await idle).toEqual({ quiescent: true });

    fromPeer(doc, (p) => p.getMap<Y.Map<unknown>>("nodes").delete("n1"));
    expect(doc.getMap<Y.Map<unknown>>("nodes").has("n1")).toBe(false);

    const busy = host.waitQuiescent(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(await busy).toEqual({ quiescent: false });
  });

  it("settles again once the relay goes quiet after the deletion", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("a.canvas");
    fromPeer(doc, (p) => {
      const rec = new Y.Map<unknown>();
      p.getMap<Y.Map<unknown>>("nodes").set("n1", rec);
      rec.set("id", "n1");
    });
    fromPeer(doc, (p) => p.getMap<Y.Map<unknown>>("nodes").delete("n1"));

    const pending = host.waitQuiescent(2000);
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toEqual({ quiescent: true });
  });
});
