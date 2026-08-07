// WP49 / C49 AC1 — quiescence must observe document activity from ANY origin.
//
// This file covers the *user interaction* origin: a local mutation produced by the
// canvas view / the user's hands, applied straight to the shared doc and never
// routed through `canvas.simulateEdit`. On a real host this is the majority of the
// traffic, and it is invisible to the current control-only activity seam.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
// Deterministic: fake timers only, no wall-clock sleep. Single author per key, so no
// CRDT tie-break is ever asserted (T3 contract §10).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
} from "../../testing/e2e-control";

const SHORT_PROBE_MS = 30; // < the 50 ms quiet window

function makeFixture(paths: string[]) {
  const docs = new Map<string, Y.Doc>();
  for (const p of paths) docs.set(p, new Y.Doc());
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
  const host = buildPluginHost(plugin, { counters, bump: () => {} });
  return { docs, host };
}

/** A local edit as the canvas view produces it: a transaction with a view origin. */
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

async function probeQuiescent(
  host: { waitQuiescent(ms: number): Promise<{ quiescent: boolean }> },
  timeoutMs: number,
): Promise<{ quiescent: boolean }> {
  const pending = host.waitQuiescent(timeoutMs);
  await vi.advanceTimersByTimeAsync(timeoutMs + 40);
  return pending;
}

describe("WP49 AC1 — an update from a user interaction keeps the instance non-quiescent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a local view-origin edit blocks quiescence until it settles", async () => {
    const { docs, host } = makeFixture(["board.canvas"]);
    await host.canvasOpen("board.canvas");
    const doc = docs.get("board.canvas") as Y.Doc;

    await vi.advanceTimersByTimeAsync(200);
    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: true });

    userEdit(doc, "n1", { id: "n1", x: 0, y: 0, width: 250, height: 60, type: "text" });

    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: false });
    expect(await probeQuiescent(host, 1000)).toEqual({ quiescent: true });
  });

  it("a user drag (a burst of geometry writes) keeps it non-quiescent for the whole burst", async () => {
    const { docs, host } = makeFixture(["board.canvas"]);
    await host.canvasOpen("board.canvas");
    const doc = docs.get("board.canvas") as Y.Doc;
    userEdit(doc, "n1", { id: "n1", x: 0, y: 0, width: 250, height: 60 });
    await vi.advanceTimersByTimeAsync(300);

    const pending = host.waitQuiescent(200);
    for (let step = 1; step <= 10; step++) {
      userEdit(doc, "n1", { x: step * 12, y: step * 8 });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(await pending).toEqual({ quiescent: false });

    // Hands off the mouse → settled.
    expect(await probeQuiescent(host, 1000)).toEqual({ quiescent: true });
  });
});
