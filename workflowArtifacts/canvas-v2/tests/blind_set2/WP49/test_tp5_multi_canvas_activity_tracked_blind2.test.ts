// WP49 AC1 (blind set 2) — three canvases, activity walking between them.
// Angle: the visible test checks two canvases and one negative control. Here the
// activity moves canvas → canvas → canvas, which catches the implementation that
// tracks only the most recently opened doc (a single-slot seam looks correct in a
// two-canvas test and fails here).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
} from "../../testing/e2e-control";

function fixture(paths: string[]) {
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
  const counters: BindingCounters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return { docs, host: buildPluginHost(plugin, { counters, bump: () => {} }) };
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

async function probe(
  host: { waitQuiescent(ms: number): Promise<{ quiescent: boolean }> },
  timeoutMs: number,
) {
  const pending = host.waitQuiescent(timeoutMs);
  await vi.advanceTimersByTimeAsync(timeoutMs + 40);
  return pending;
}

describe("WP49 AC1 blind2 — every open canvas stays tracked, not just the newest", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("activity on the FIRST-opened canvas still blocks after two more were opened", async () => {
    const { docs, host } = fixture(["one.canvas", "two.canvas", "three.canvas"]);
    await host.canvasOpen("one.canvas");
    await host.canvasOpen("two.canvas");
    await host.canvasOpen("three.canvas");
    await vi.advanceTimersByTimeAsync(400);
    expect(await probe(host, 25)).toEqual({ quiescent: true });

    userEdit(docs.get("one.canvas") as Y.Doc, "n1", { id: "n1", x: 1, y: 1 });
    expect(await probe(host, 25)).toEqual({ quiescent: false });
  });

  it("each canvas in turn re-arms the window", async () => {
    const { docs, host } = fixture(["one.canvas", "two.canvas", "three.canvas"]);
    for (const p of ["one.canvas", "two.canvas", "three.canvas"]) await host.canvasOpen(p);

    for (const p of ["three.canvas", "two.canvas", "one.canvas"]) {
      await vi.advanceTimersByTimeAsync(400);
      expect(await probe(host, 25)).toEqual({ quiescent: true });
      userEdit(docs.get(p) as Y.Doc, `n-${p}`, { id: `n-${p}`, x: 2, y: 2 });
      expect(await probe(host, 25)).toEqual({ quiescent: false });
    }
  });
});
