// WP49 / C49 AC1 — regression guard.
//
// Widening the activity seam to every origin must not lose the origin it already
// had: a control-initiated `canvas.simulateEdit` still marks activity, still calls
// the `bump` hook, and still returns `{applied:true}`.
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

function makeFixture() {
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
  const counters: BindingCounters = {
    applyRemote: 0,
    captureLocal: 0,
    rePush: 0,
    originUpdates: 0,
  };
  const bump = vi.fn();
  const host = buildPluginHost(plugin, { counters, bump });
  return { doc, host, bump };
}

async function probeQuiescent(
  host: { waitQuiescent(ms: number): Promise<{ quiescent: boolean }> },
  timeoutMs: number,
): Promise<{ quiescent: boolean }> {
  const pending = host.waitQuiescent(timeoutMs);
  await vi.advanceTimersByTimeAsync(timeoutMs + 40);
  return pending;
}

describe("WP49 AC1 — the control-initiated edit path is unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("simulateEdit still returns applied:true and still blocks quiescence", async () => {
    const { doc, host } = makeFixture();
    await host.canvasOpen("a.canvas");
    await vi.advanceTimersByTimeAsync(200);
    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: true });

    const res = await host.simulateEdit("a.canvas", {
      nodes: [{ id: "n1", x: 10, y: 20, width: 100, height: 60 }],
    });
    expect(res).toEqual({ applied: true });
    expect(doc.getMap<Y.Map<unknown>>("nodes").get("n1")?.get("y")).toBe(20);

    expect(await probeQuiescent(host, SHORT_PROBE_MS)).toEqual({ quiescent: false });
    expect(await probeQuiescent(host, 1000)).toEqual({ quiescent: true });
  });

  it("the bump hook still fires for a control-initiated edit", async () => {
    const { host, bump } = makeFixture();
    await host.canvasOpen("a.canvas");
    const before = bump.mock.calls.length;

    await host.simulateEdit("a.canvas", { nodes: [{ id: "n2", x: 1, y: 2 }] });

    expect(bump.mock.calls.length).toBeGreaterThan(before);
  });

  it("simulateEdit on a canvas that was never opened still throws (router → 400)", async () => {
    const { host } = makeFixture();
    await expect(host.simulateEdit("never-opened.canvas", { nodes: [] })).rejects.toThrow(
      /not open/,
    );
  });
});
