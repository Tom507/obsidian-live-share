// WP49 / C49 AC1 — quiescence is an *instance* property, not a per-command one.
//
// `sync.waitQuiescent` takes no `path` (T3 contract §6), so it must answer for the
// whole instance: activity on ANY canvas the instance has open blocks it. The
// negative control matters just as much — a doc the instance never opened is not
// this instance's business and must not block it forever.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
// Deterministic: fake timers only, no wall-clock sleep.
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
  const untracked = new Y.Doc(); // never handed out through canvasSync
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
  const host = buildPluginHost(plugin, { counters, bump: () => {} });
  return { docs, untracked, host };
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

describe("WP49 AC1 — activity on any open canvas blocks instance quiescence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an edit on the second open canvas blocks quiescence just like the first", async () => {
    const { docs, host } = makeFixture(["one.canvas", "two.canvas"]);
    await host.canvasOpen("one.canvas");
    await host.canvasOpen("two.canvas");
    await vi.advanceTimersByTimeAsync(200);
    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: true });

    userEdit(docs.get("two.canvas") as Y.Doc, "n9", { id: "n9", x: 5, y: 5 });
    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: false });
    expect(await probeQuiescent(host, 1000)).toEqual({ quiescent: true });
  });

  it("a doc the instance never opened does not block it (negative control)", async () => {
    const { untracked, host } = makeFixture(["one.canvas"]);
    await host.canvasOpen("one.canvas");
    await vi.advanceTimersByTimeAsync(200);

    userEdit(untracked, "ghost", { id: "ghost", x: 1, y: 1 });

    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: true });
  });
});
