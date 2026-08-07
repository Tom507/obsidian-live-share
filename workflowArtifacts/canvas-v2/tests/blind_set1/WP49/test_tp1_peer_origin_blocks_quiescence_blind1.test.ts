// WP49 AC1 (blind set 1) — peer origin, edge records and a two-delta burst.
// Angle: the visible test uses one node delta; here the relay delivers two
// consecutive deltas (an edge, then a node re-parent) and the activity seam must
// register BOTH, with the bump hook firing each time.
// CRDT hygiene: the peer doc is seeded from host state first → single causal chain.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
} from "../../testing/e2e-control";

const SHORT_PROBE_MS = 25;

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
  const bump = vi.fn();
  return { doc, bump, host: buildPluginHost(plugin, { counters, bump }) };
}

function fromPeer(target: Y.Doc, mutate: (peer: Y.Doc) => void, origin: unknown): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(target));
  mutate(peer);
  Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), origin);
}

function put(doc: Y.Doc, collection: string, id: string, record: Record<string, unknown>): void {
  const map = doc.getMap<Y.Map<unknown>>(collection);
  let ymap = map.get(id);
  if (!ymap) {
    ymap = new Y.Map<unknown>();
    map.set(id, ymap);
  }
  for (const [k, v] of Object.entries(record)) ymap.set(k, v);
}

async function probe(
  host: { waitQuiescent(ms: number): Promise<{ quiescent: boolean }> },
  timeoutMs: number,
) {
  const pending = host.waitQuiescent(timeoutMs);
  await vi.advanceTimersByTimeAsync(timeoutMs + 40);
  return pending;
}

describe("WP49 AC1 blind1 — a peer edge delta and a second delta both count as activity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("each relay delta re-arms the quiet window and calls bump", async () => {
    const { doc, host, bump } = fixture();
    await host.canvasOpen("plan.canvas");
    fromPeer(doc, (p) => {
      put(p, "nodes", "n1", { id: "n1", x: 0, y: 0, width: 200, height: 80 });
      put(p, "nodes", "n2", { id: "n2", x: 400, y: 0, width: 200, height: 80 });
    }, "relay:init");
    await vi.advanceTimersByTimeAsync(400);
    expect(await probe(host, SHORT_PROBE_MS)).toEqual({ quiescent: true });

    const bumpsBefore = bump.mock.calls.length;

    fromPeer(doc, (p) => put(p, "edges", "e1", { id: "e1", fromNode: "n1", toNode: "n2" }), "relay:1");
    expect(await probe(host, SHORT_PROBE_MS)).toEqual({ quiescent: false });

    fromPeer(doc, (p) => put(p, "nodes", "n2", { x: 620 }), "relay:2");
    expect(await probe(host, SHORT_PROBE_MS)).toEqual({ quiescent: false });

    expect(bump.mock.calls.length).toBeGreaterThanOrEqual(bumpsBefore + 2);
    expect(await probe(host, 1000)).toEqual({ quiescent: true });
  });

  it("the edge really landed — the doc, not a log line, is the oracle", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("plan.canvas");
    fromPeer(doc, (p) => put(p, "edges", "e7", { id: "e7", fromNode: "a", toNode: "b" }), "relay:x");
    expect(doc.getMap<Y.Map<unknown>>("edges").get("e7")?.get("toNode")).toBe("b");
  });
});
