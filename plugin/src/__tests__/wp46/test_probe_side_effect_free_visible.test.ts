// WP46 / C46 AC1 — "the added fields change nothing": no other control command
// changes shape or behaviour, and the identity probe itself is read-only — it
// mutates no setting and marks no canvas activity. The read-only property is
// the TypeScript-side mirror of AC2's "no edit is issued".
//
// Staging: copy into `plugin/src/__tests__/wp46/` (one level deep → `../../`).
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type E2EPluginLike,
  buildPluginHost,
  parseAndRoute,
  routeCommand,
} from "../../testing/e2e-control";

function pluginWithDoc(doc: Y.Doc): E2EPluginLike {
  return {
    settings: { clientId: "e2e-a", roomId: "room-t3", role: "host", debugFlag: false },
    muxConnected: true,
    controlConnected: true,
    app: {
      appId: "app-id-vault-a",
      vault: {
        getName: () => "LiveShare-E2E-A",
        adapter: { getBasePath: () => "C:\\ObsidianVaults\\LiveShare-E2E-A" },
      },
    },
    manifest: { version: "1.4.2" },
    canvasSync: {
      subscribe: async () => {},
      isSubscribed: () => true,
      getCanvasSnapshot: () => ({ nodes: [{ id: "n1" }], edges: [] }),
      getCanvasDocHandle: () => ({ doc }),
    },
  } as E2EPluginLike;
}

describe("WP46 AC1 — the identity probe is read-only and collateral-free", () => {
  it("returns an equal result on repeated calls and mutates no setting", () => {
    const plugin = pluginWithDoc(new Y.Doc());
    const before = JSON.stringify(plugin.settings);
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    const first = host.sessionInfo();
    const second = host.sessionInfo();
    expect(second).toEqual(first);
    expect(JSON.stringify(plugin.settings)).toBe(before);
  });

  it("never marks canvas activity — a readiness probe issues no edit", async () => {
    const bump = vi.fn();
    const doc = new Y.Doc();
    const host = buildPluginHost(pluginWithDoc(doc), {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump,
    });
    await routeCommand(host, { cmd: "session.info" });
    await routeCommand(host, { cmd: "session.info" });
    expect(bump).not.toHaveBeenCalled();
    expect(doc.getMap("nodes").size).toBe(0);
    expect(doc.getMap("edges").size).toBe(0);
  });

  it("still ignores args on session.info", async () => {
    const host = buildPluginHost(pluginWithDoc(new Y.Doc()), {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    const bare = await routeCommand(host, { cmd: "session.info" });
    const noisy = await routeCommand(host, {
      cmd: "session.info",
      args: { path: "board.canvas", vaultId: "spoofed" },
    });
    expect(noisy).toEqual(bare);
  });

  it("leaves every other command's routing and result shape unchanged", async () => {
    const doc = new Y.Doc();
    const host = buildPluginHost(pluginWithDoc(doc), {
      counters: { applyRemote: 1, captureLocal: 2, rePush: 3, originUpdates: 4 },
      bump: () => {},
    });

    expect(await routeCommand(host, { cmd: "canvas.open", args: { path: "a.canvas" } })).toEqual({
      status: 200,
      body: { ok: true, result: { opened: true, subscribed: true } },
    });
    expect(await routeCommand(host, { cmd: "canvas.state", args: { path: "a.canvas" } })).toEqual({
      status: 200,
      body: { ok: true, result: { nodes: [{ id: "n1" }], edges: [] } },
    });
    expect(
      await routeCommand(host, { cmd: "canvas.binding", args: { path: "a.canvas" } }),
    ).toEqual({
      status: 200,
      body: {
        ok: true,
        result: { applyRemote: 1, captureLocal: 2, rePush: 3, originUpdates: 4 },
      },
    });
    expect(
      await routeCommand(host, {
        cmd: "canvas.simulateEdit",
        args: { path: "a.canvas", change: { nodes: [{ id: "n1", x: 5 }] } },
      }),
    ).toEqual({ status: 200, body: { ok: true, result: { applied: true } } });
    expect(
      await routeCommand(host, { cmd: "canvas.setFlag", args: { name: "debugFlag", value: true } }),
    ).toEqual({ status: 200, body: { ok: true, result: { set: true } } });
    expect(await routeCommand(host, { cmd: "sync.waitQuiescent", args: { timeoutMs: 0 } })).toEqual(
      { status: 200, body: { ok: true, result: { quiescent: false } } },
    );
  });

  it("keeps the malformed-input contract: structured 400, never a throw", async () => {
    const host = buildPluginHost(pluginWithDoc(new Y.Doc()), {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    expect((await routeCommand(host, { cmd: "session.INFO" })).status).toBe(400);
    expect((await parseAndRoute(host, "{not json")).status).toBe(400);
    expect((await routeCommand(host, { cmd: "canvas.open", args: {} })).status).toBe(400);
  });
});
