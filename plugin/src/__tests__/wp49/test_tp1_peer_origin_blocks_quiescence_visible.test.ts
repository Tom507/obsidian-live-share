// WP49 / C49 AC1 — quiescence must observe document activity from ANY origin.
//
// This file covers the *peer* origin: an update that arrives over the relay and is
// applied with a foreign origin (never through `canvas.simulateEdit`). Today
// `buildPluginHost` bumps `lastActivity` only inside `simulateEdit`, so on a real
// instance `sync.waitQuiescent` reports `quiescent:true` while remote deltas are
// still landing. That is the defect this AC closes.
//
// Required surface (WP49): `buildPluginHost` observes updates on the Y.Doc of every
// canvas opened through `canvasOpen`, whatever the update origin.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
// Deterministic: fake timers only, no wall-clock sleep. CRDT hygiene (T3 contract §10):
// the peer doc is seeded from the host state before it writes, so every value in this
// file has a single author with a causal predecessor chain — no concurrent same-key
// writes, no clientID coin flip.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
} from "../../testing/e2e-control";

/** Strictly below the 50 ms quiet window: this probe can only return true when already idle. */
const SHORT_PROBE_MS = 30;

function makeFixture(paths: string[]) {
  const docs = new Map<string, Y.Doc>();
  for (const p of paths) docs.set(p, new Y.Doc());
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
      getCanvasDocHandle: (p: string) => {
        const doc = docs.get(p);
        return subscribed.has(p) && doc ? { doc } : null;
      },
    },
  };
  const counters: BindingCounters = {
    applyRemote: 0,
    captureLocal: 0,
    rePush: 0,
    originUpdates: 0,
  };
  const bumps: number[] = [];
  const host = buildPluginHost(plugin, { counters, bump: () => bumps.push(Date.now()) });
  return { docs, host, bumps };
}

/**
 * Apply an update that originated at the peer. The peer doc is seeded from the
 * current host state first, so its writes are causally after everything the host
 * already holds (T3 contract §10).
 */
function applyFromPeer(target: Y.Doc, mutate: (peer: Y.Doc) => void, origin = "peer-relay"): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(target));
  mutate(peer);
  Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), origin);
}

function setNode(doc: Y.Doc, id: string, record: Record<string, unknown>): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  let ymap = nodes.get(id);
  if (!ymap) {
    ymap = new Y.Map<unknown>();
    nodes.set(id, ymap);
  }
  for (const [k, v] of Object.entries(record)) ymap.set(k, v);
}

async function probeQuiescent(
  host: { waitQuiescent(ms: number): Promise<{ quiescent: boolean }> },
  timeoutMs: number,
): Promise<{ quiescent: boolean }> {
  const pending = host.waitQuiescent(timeoutMs);
  await vi.advanceTimersByTimeAsync(timeoutMs + 40);
  return pending;
}

describe("WP49 AC1 — an update from the peer keeps the instance non-quiescent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is quiescent while idle, non-quiescent right after a peer update, quiescent again once it settles", async () => {
    const { docs, host } = makeFixture(["a.canvas"]);
    await host.canvasOpen("a.canvas");

    // Control: nothing has happened for longer than the quiet window.
    await vi.advanceTimersByTimeAsync(200);
    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: true });

    // A delta lands from the relay — NOT via the control channel.
    const doc = docs.get("a.canvas") as Y.Doc;
    applyFromPeer(doc, (peer) =>
      setNode(peer, "n1", { id: "n1", x: 10, y: 20, width: 100, height: 60 }),
    );

    // The instance must now report itself as still moving.
    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: false });

    // ...and must settle once the peer stops.
    expect(await probeQuiescent(host, 1000)).toEqual({ quiescent: true });
  });

  it("the peer update really reached the doc (the oracle is not reacting to nothing)", async () => {
    const { docs, host } = makeFixture(["a.canvas"]);
    await host.canvasOpen("a.canvas");
    const doc = docs.get("a.canvas") as Y.Doc;
    // Settle first, so a `false` below can only come from the peer delta and never
    // from the instance simply having been constructed a moment ago.
    await vi.advanceTimersByTimeAsync(500);

    applyFromPeer(doc, (peer) => setNode(peer, "n1", { id: "n1", x: 10, y: 20 }));

    expect(doc.getMap<Y.Map<unknown>>("nodes").get("n1")?.get("x")).toBe(10);
    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: false });
  });
});
