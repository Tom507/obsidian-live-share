// WP49 AC1 (blind set 1) — user origin with NO explicit transaction origin.
// Angle: the visible test tags the transaction "canvas-view-user". A real view
// mutation frequently carries no origin at all (a bare `Y.Map.set` outside an
// explicit transact). An activity seam keyed on a known origin string would miss it;
// activity must be keyed on "an update happened", full stop.
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

async function probe(
  host: { waitQuiescent(ms: number): Promise<{ quiescent: boolean }> },
  timeoutMs: number,
) {
  const pending = host.waitQuiescent(timeoutMs);
  await vi.advanceTimersByTimeAsync(timeoutMs + 40);
  return pending;
}

describe("WP49 AC1 blind1 — an origin-less local mutation still counts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a bare Y.Map.set with no transact origin blocks quiescence", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("notes.canvas");
    await vi.advanceTimersByTimeAsync(300);
    expect(await probe(host, 25)).toEqual({ quiescent: true });

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set("n1", record);
    record.set("id", "n1");
    record.set("x", 40);

    expect(await probe(host, 25)).toEqual({ quiescent: false });
    expect(await probe(host, 1000)).toEqual({ quiescent: true });
  });

  it("a text-content edit (not geometry) counts too", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("notes.canvas");
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set("n1", record);
    record.set("id", "n1");
    await vi.advanceTimersByTimeAsync(300);
    expect(await probe(host, 25)).toEqual({ quiescent: true });

    record.set("text", "the user typed something");

    expect(await probe(host, 25)).toEqual({ quiescent: false });
  });
});
