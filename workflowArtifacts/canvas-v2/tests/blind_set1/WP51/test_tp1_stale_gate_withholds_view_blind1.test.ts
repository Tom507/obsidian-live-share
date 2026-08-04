// WP51 AC1 — blind set 1.
//
// Angle: the flag is an INSTANCE state, not a per-canvas one, and the payloads
// are edges rather than node geometry. Two canvases are open at once; entering
// the stale state must hold both back, and the withheld payloads must come out
// of the gate attributed to the right path.
//
// Edges are the harder case on a real host: a withheld edge reroute is exactly
// what leaves arrows looking detached, which is why the visible node-geometry
// version is not enough on its own.
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  STALE_VIEW_FLAG,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const BOARD_A = "_e2e-rig/e2e-scratch-20260803T110000Z-b1-alpha.canvas";
const BOARD_B = "_e2e-rig/e2e-scratch-20260803T110000Z-b1-beta.canvas";

function rig() {
  const doc = new Y.Doc();
  const sync = {
    onRemoteCanvasUpdate: null as RemoteHandler | null,
    setOnRemoteCanvasUpdate(cb: RemoteHandler) {
      sync.onRemoteCanvasUpdate = cb;
    },
    subscribe: async () => {},
    isSubscribed: () => true,
    getCanvasSnapshot: () => ({ nodes: [], edges: [] }) as RemoteData,
    getCanvasDocHandle: () => ({ doc }),
    deliver(path: string, data: RemoteData) {
      sync.onRemoteCanvasUpdate?.(path, data);
    },
  };
  const plugin = {
    settings: { clientId: "vault-kopie", roomId: "canvas-v2-t3", role: "guest" },
    muxConnected: true,
    controlConnected: true,
    canvasSync: sync,
  } as unknown as E2EPluginLike;
  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  const applied = vi.fn<RemoteHandler>();
  sync.setOnRemoteCanvasUpdate(applied);
  return { doc, sync, host, applied };
}

const edgeData = (side: string): RemoteData => ({
  nodes: [],
  edges: [{ id: "e1", fromNode: "n1", fromSide: side, toNode: "n2", toSide: "left" }],
});

const enter = (host: ReturnType<typeof rig>["host"], value: string) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

describe("WP51 AC1 (blind1) — the state is per instance and covers every open board", () => {
  it("edge reroutes reach both boards while live", () => {
    const { sync, applied } = rig();
    sync.deliver(BOARD_A, edgeData("right"));
    sync.deliver(BOARD_B, edgeData("top"));
    expect(applied.mock.calls.map((c) => c[0])).toEqual([BOARD_A, BOARD_B]);
    expect(applied.mock.calls[1][1].edges[0].fromSide).toBe("top");
  });

  it("one command holds BOTH boards back — the flag takes no path argument", async () => {
    const { sync, host, applied } = rig();
    await enter(host, "delayed");
    sync.deliver(BOARD_A, edgeData("right"));
    sync.deliver(BOARD_B, edgeData("top"));
    expect(applied).not.toHaveBeenCalled();
  });

  it("the replay keeps each payload with its own path", async () => {
    const { sync, host, applied } = rig();
    expect((await enter(host, "delayed")).status).toBe(200);
    sync.deliver(BOARD_A, edgeData("right"));
    sync.deliver(BOARD_B, edgeData("top"));
    sync.deliver(BOARD_A, edgeData("bottom"));
    await enter(host, "live");

    expect(applied.mock.calls.map((c) => [c[0], c[1].edges[0].fromSide])).toEqual([
      [BOARD_A, "right"],
      [BOARD_B, "top"],
      [BOARD_A, "bottom"],
    ]);
  });

  it("a control-initiated edit still reaches the shared doc while the view is stale", async () => {
    const { doc, host } = rig();
    await routeCommand(host, { cmd: "canvas.open", args: { path: BOARD_A } });
    expect((await enter(host, "delayed")).status).toBe(200);

    const edit = await routeCommand(host, {
      cmd: "canvas.simulateEdit",
      args: { path: BOARD_A, change: { nodes: [{ id: "local", x: 4, y: 5 }] } },
    });
    expect(edit).toEqual({ status: 200, body: { ok: true, result: { applied: true } } });
    expect(doc.getMap<Y.Map<unknown>>("nodes").get("local")?.get("x")).toBe(4);
    // The gate is on the view-apply path only; it must not become a sync freeze.
  });

  it("a payload that arrives EXACTLY at the moment of entry is on the withheld side", async () => {
    const { sync, host, applied } = rig();
    sync.deliver(BOARD_A, edgeData("right"));
    await enter(host, "delayed");
    sync.deliver(BOARD_A, edgeData("left"));
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied.mock.calls[0][1].edges[0].fromSide).toBe("right");
  });

  it("without a plugin-installed view-apply handler the gate refuses rather than swallowing", async () => {
    const doc = new Y.Doc();
    const sync = {
      onRemoteCanvasUpdate: null as RemoteHandler | null,
      setOnRemoteCanvasUpdate(cb: RemoteHandler) {
        sync.onRemoteCanvasUpdate = cb;
      },
      subscribe: async () => {},
      isSubscribed: () => true,
      getCanvasSnapshot: () => ({ nodes: [], edges: [] }) as RemoteData,
      getCanvasDocHandle: () => ({ doc }),
    };
    const host = buildPluginHost(
      { settings: { clientId: "x", roomId: "r", role: "guest" }, canvasSync: sync } as unknown as E2EPluginLike,
      { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
    );
    const out = await enter(host, "unavailable");
    expect(out.status).toBe(400);
    expect(sync.onRemoteCanvasUpdate).toBeNull();
  });

  it("a plugin with no canvasSync at all is a structured 400, never a crash", async () => {
    const host = buildPluginHost(
      { settings: { clientId: "x", roomId: "r", role: "guest" }, canvasSync: null } as unknown as E2EPluginLike,
      { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
    );
    const out = await enter(host, "delayed");
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
  });
});
