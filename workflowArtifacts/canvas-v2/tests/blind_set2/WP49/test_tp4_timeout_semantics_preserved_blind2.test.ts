// WP49 AC1 (blind set 2) — overlapping waits and a long busy period.
// Angle: the driver may have more than one wait in flight (a per-step wait and an
// outer guard). Two concurrent `waitQuiescent` calls must each answer on their own
// budget, and neither may consume or reset the other's view of activity.
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

describe("WP49 AC1 blind2 — concurrent waits, each on its own budget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a short wait gives up while a long wait still succeeds", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("a.canvas");

    const shortWait = host.waitQuiescent(60);
    const longWait = host.waitQuiescent(2000);

    // Keep the doc busy past the short budget, then stop.
    for (let step = 0; step < 5; step++) {
      userEdit(doc, "n1", { id: "n1", x: step, y: step });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(await shortWait).toEqual({ quiescent: false });

    await vi.advanceTimersByTimeAsync(400);
    expect(await longWait).toEqual({ quiescent: true });
  });

  it("neither wait swallows the other's activity signal", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("a.canvas");
    await vi.advanceTimersByTimeAsync(400);

    const first = host.waitQuiescent(40);
    const second = host.waitQuiescent(40);
    userEdit(doc, "n2", { id: "n2", x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(120);

    expect(await first).toEqual({ quiescent: false });
    expect(await second).toEqual({ quiescent: false });
  });

  it("sustained activity for longer than the timeout never reports quiescent", async () => {
    const { doc, host } = fixture();
    await host.canvasOpen("a.canvas");

    const pending = host.waitQuiescent(300);
    for (let step = 0; step < 20; step++) {
      userEdit(doc, "n3", { id: "n3", x: step });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(await pending).toEqual({ quiescent: false });
  });
});
