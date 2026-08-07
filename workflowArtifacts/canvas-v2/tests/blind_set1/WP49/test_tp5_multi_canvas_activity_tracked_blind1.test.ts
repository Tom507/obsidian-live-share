// WP49 AC1 (blind set 1) — idempotent registration.
// Angle: the visible test opens two different canvases. Here the SAME canvas is
// opened repeatedly (the driver does this routinely). A naive `doc.on("update")`
// per `canvasOpen` call would attach the observer three times and bump three times
// per delta — harmless for the boolean answer, but a leak and a sign the seam is
// wired per call instead of per doc.
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
  const bump = vi.fn();
  return { doc, bump, host: buildPluginHost(plugin, { counters, bump }) };
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

describe("WP49 AC1 blind1 — opening the same canvas repeatedly registers it once", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("three canvas.open calls produce one activity observer, not three", async () => {
    const { doc, host, bump } = fixture();
    await host.canvasOpen("same.canvas");
    await host.canvasOpen("same.canvas");
    await host.canvasOpen("same.canvas");
    await vi.advanceTimersByTimeAsync(400);
    bump.mockClear();

    userEdit(doc, "n1", { id: "n1", x: 1, y: 2 });

    expect(bump).toHaveBeenCalledTimes(1);
    expect(await probe(host, 25)).toEqual({ quiescent: false });
  });

  it("re-opening after settling still tracks the doc", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("same.canvas");
    await vi.advanceTimersByTimeAsync(400);
    await host.canvasOpen("same.canvas");
    await vi.advanceTimersByTimeAsync(400);

    userEdit(doc, "n2", { id: "n2", x: 9, y: 9 });
    expect(await probe(host, 25)).toEqual({ quiescent: false });
  });
});
