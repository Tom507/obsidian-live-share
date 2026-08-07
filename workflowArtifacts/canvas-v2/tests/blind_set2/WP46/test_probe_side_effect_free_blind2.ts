// WP46 AC1 — nothing else changed, blind set 2.
//
// Angle: a long burst of probes is fired and the rest of the control surface is
// then verified against its pre-WP46 behaviour, including the `sync.waitQuiescent`
// default and the malformed-input contract.
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type E2EControlHost,
  type E2EPluginLike,
  buildPluginHost,
  parseAndRoute,
  routeCommand,
} from "../../testing/e2e-control";

function plugin(doc: Y.Doc): E2EPluginLike {
  return {
    settings: { clientId: "e2e-a", roomId: "raum-üben-42", role: "host" },
    muxConnected: true,
    controlConnected: true,
    app: {
      appId: "0f9d3c11",
      vault: { getName: () => "Wissen Örga", adapter: { getBasePath: () => "H:\\v" } },
    },
    manifest: { version: "2.0.0-beta.3" },
    canvasSync: {
      subscribe: async () => {},
      isSubscribed: () => true,
      getCanvasSnapshot: () => ({ nodes: [], edges: [] }),
      getCanvasDocHandle: () => ({ doc }),
    },
  } as E2EPluginLike;
}

function build(doc: Y.Doc, bump: () => void = () => {}): E2EControlHost {
  return buildPluginHost(plugin(doc), {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump,
  });
}

describe("WP46 AC1 (blind2) — a probe burst leaves the surface untouched", () => {
  it("fires fifty probes without touching the document or bumping activity", async () => {
    const doc = new Y.Doc();
    const bump = vi.fn();
    const host = build(doc, bump);
    for (let i = 0; i < 50; i++) {
      const out = await parseAndRoute(host, '{"cmd":"session.info"}');
      expect(out.status).toBe(200);
    }
    expect(bump).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(doc).length).toBe(Y.encodeStateAsUpdate(new Y.Doc()).length);
  });

  it("returns a stable payload across the whole burst", async () => {
    const host = build(new Y.Doc());
    const first = host.sessionInfo();
    for (let i = 0; i < 10; i++) expect(host.sessionInfo()).toEqual(first);
  });

  it("keeps sync.waitQuiescent defaulting to 2000 ms", async () => {
    const spy = vi.fn(async () => ({ quiescent: true }));
    const host = { ...build(new Y.Doc()), waitQuiescent: spy } as E2EControlHost;
    await routeCommand(host, { cmd: "sync.waitQuiescent" });
    expect(spy).toHaveBeenCalledWith(2000);
    await routeCommand(host, { cmd: "sync.waitQuiescent", args: { timeoutMs: 25 } });
    expect(spy).toHaveBeenLastCalledWith(25);
  });

  it("keeps an edit working after the burst", async () => {
    const doc = new Y.Doc();
    const host = build(doc);
    for (let i = 0; i < 10; i++) await routeCommand(host, { cmd: "session.info" });
    const out = await routeCommand(host, {
      cmd: "canvas.simulateEdit",
      args: { path: "board.canvas", change: { nodes: [{ id: "n1", x: 3, y: 4 }] } },
    });
    expect(out).toEqual({ status: 200, body: { ok: true, result: { applied: true } } });
    expect(doc.getMap("nodes").size).toBe(1);
  });

  it("keeps the malformed-input contract intact", async () => {
    const host = build(new Y.Doc());
    expect((await parseAndRoute(host, "[]")).status).toBe(400);
    expect((await parseAndRoute(host, '{"cmd":123}')).status).toBe(400);
    expect((await parseAndRoute(host, '{"cmd":"session.info","args":"x"}')).status).toBe(400);
  });
});
