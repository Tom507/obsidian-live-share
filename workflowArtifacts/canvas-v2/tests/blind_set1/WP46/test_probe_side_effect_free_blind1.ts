// WP46 AC1 — nothing else changed, blind set 1.
//
// Angle: the probe is fired between real control operations. The surrounding
// commands must behave exactly as before, and the probe itself must leave no
// trace in the settings, in the Y.Doc, or in the binding counters.
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

function harness() {
  const doc = new Y.Doc();
  const plugin = {
    settings: { clientId: "e2e-b", roomId: "canvas-v2-t3", role: "guest", verboseLog: false },
    muxConnected: true,
    controlConnected: true,
    app: {
      appId: "8f2c19aa4b7e",
      vault: {
        getName: () => "ObsidianOrga - Kopie",
        adapter: {
          getBasePath: () => "H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie",
        },
      },
    },
    manifest: { version: "0.9.7" },
    canvasSync: {
      subscribe: async () => {},
      isSubscribed: () => true,
      getCanvasSnapshot: () => ({ nodes: [], edges: [] }),
      getCanvasDocHandle: () => ({ doc }),
    },
  } as E2EPluginLike;
  const bump = vi.fn();
  const counters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return { doc, plugin, bump, host: buildPluginHost(plugin, { counters, bump }), counters };
}

describe("WP46 AC1 (blind1) — the probe is inert between real operations", () => {
  it("does not disturb an edit that follows it", async () => {
    const { host, doc, bump } = harness();
    await routeCommand(host, { cmd: "session.info" });
    const edit = await routeCommand(host, {
      cmd: "canvas.simulateEdit",
      args: { path: "board.canvas", change: { nodes: [{ id: "n1", x: 1, y: 2 }] } },
    });
    expect(edit).toEqual({ status: 200, body: { ok: true, result: { applied: true } } });
    expect(doc.getMap("nodes").size).toBe(1);
    expect(bump).toHaveBeenCalledTimes(1); // the edit bumped, the probe did not
  });

  it("does not write to the doc when fired repeatedly", async () => {
    const { host, doc } = harness();
    for (let i = 0; i < 5; i++) await routeCommand(host, { cmd: "session.info" });
    expect(doc.getMap("nodes").size).toBe(0);
    expect(doc.getMap("edges").size).toBe(0);
  });

  it("does not touch settings, while setFlag still does", async () => {
    const { host, plugin } = harness();
    const before = JSON.stringify(plugin.settings);
    await routeCommand(host, { cmd: "session.info" });
    expect(JSON.stringify(plugin.settings)).toBe(before);

    await routeCommand(host, { cmd: "canvas.setFlag", args: { name: "verboseLog", value: true } });
    expect((plugin.settings as Record<string, unknown>).verboseLog).toBe(true);
  });

  it("does not move the binding counters", async () => {
    const { host, counters } = harness();
    await routeCommand(host, { cmd: "session.info" });
    const out = await routeCommand(host, { cmd: "canvas.binding", args: { path: "board.canvas" } });
    expect(out.body).toEqual({ ok: true, result: { ...counters } });
    expect(counters).toEqual({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 });
  });

  it("reflects a later settings change rather than caching the first answer", async () => {
    const { host, plugin } = harness();
    const first = host.sessionInfo();
    plugin.settings.roomId = "another-room";
    const second = host.sessionInfo();
    expect(first.roomId).toBe("canvas-v2-t3");
    expect(second.roomId).toBe("another-room");
  });

  it("keeps unknown commands at a structured 400", async () => {
    const { host } = harness();
    const out = await routeCommand(host, { cmd: "session.identity" });
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ ok: false, error: "unknown cmd: session.identity" });
  });
});
