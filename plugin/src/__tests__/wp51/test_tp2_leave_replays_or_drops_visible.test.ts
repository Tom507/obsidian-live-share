// WP51 / C51 AC1 + AC4 — leaving the stale state, and the two WP6 seams it
// reuses rather than duplicates.
//
// C6 AC1 is "view apply artificially delayed": the pass is LATE, so when it
// finally runs the view catches up. C6 AC2 is "adapter unavailable": the surface
// was gone, so what was aimed at it is not delivered later — a remount reloads
// from scratch. The stale-view flag therefore has exactly those two non-live
// modes, and they are told apart by what LEAVING does:
//
//   delayed      → the withheld updates are replayed, the view catches up
//   unavailable  → the withheld updates are dropped, the view does not
//
// A state that cannot be left is out of scope by charter §2, so every mode
// returns to `live`.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  STALE_VIEW_FLAG,
  STALE_VIEW_MODES,
  type E2EPluginLike,
  type StaleViewMode,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const PATH = "_e2e-rig/e2e-scratch-20260803T091500Z-2-b.canvas";

function harness() {
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
    settings: { clientId: "e2e-b", roomId: "canvas-v2-t3", role: "guest" },
    muxConnected: true,
    controlConnected: true,
    canvasSync: sync,
  } as unknown as E2EPluginLike;
  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  const viewApply = vi.fn<RemoteHandler>();
  sync.setOnRemoteCanvasUpdate(viewApply);
  return { doc, sync, host, viewApply };
}

const setMode = (host: ReturnType<typeof harness>["host"], value: unknown) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

const geo = (x: number): RemoteData => ({ nodes: [{ id: "n1", x, y: 0 }], edges: [] });

describe("WP51 AC1/AC4 — leaving the stale state", () => {
  it("`delayed` replays every withheld update, in arrival order, on the way out", async () => {
    const { sync, host, viewApply } = harness();
    await setMode(host, "delayed");

    sync.deliver(PATH, geo(100));
    sync.deliver(PATH, geo(200));
    sync.deliver(PATH, geo(300));
    expect(viewApply).not.toHaveBeenCalled();

    await setMode(host, "live");

    expect(viewApply).toHaveBeenCalledTimes(3);
    expect(viewApply.mock.calls.map((c) => c[1].nodes[0].x)).toEqual([100, 200, 300]);
    expect(viewApply.mock.calls.map((c) => c[0])).toEqual([PATH, PATH, PATH]);
  });

  it("`unavailable` drops every withheld update — the surface was gone, not late", async () => {
    const { sync, host, viewApply } = harness();
    await setMode(host, "unavailable");

    sync.deliver(PATH, geo(100));
    sync.deliver(PATH, geo(200));
    expect(viewApply).not.toHaveBeenCalled();

    await setMode(host, "live");
    expect(viewApply).not.toHaveBeenCalled();

    // …and the path is genuinely open again afterwards.
    sync.deliver(PATH, geo(999));
    expect(viewApply).toHaveBeenCalledTimes(1);
    expect(viewApply.mock.calls[0][1].nodes[0].x).toBe(999);
  });

  it("the two seams are DIFFERENT — same input, different outcome on leaving", async () => {
    const delayed = harness();
    await setMode(delayed.host, "delayed");
    delayed.sync.deliver(PATH, geo(42));
    await setMode(delayed.host, "live");

    const unavailable = harness();
    await setMode(unavailable.host, "unavailable");
    unavailable.sync.deliver(PATH, geo(42));
    await setMode(unavailable.host, "live");

    expect(delayed.viewApply.mock.calls.length).not.toBe(
      unavailable.viewApply.mock.calls.length,
    );
    expect(delayed.viewApply).toHaveBeenCalledTimes(1);
    expect(unavailable.viewApply).not.toHaveBeenCalled();
  });

  it("switching directly between the two non-live modes keeps the buffer honest", async () => {
    const { sync, host, viewApply } = harness();
    await setMode(host, "delayed");
    sync.deliver(PATH, geo(1));
    // Moving to `unavailable` means the surface is gone: what was buffered for a
    // late pass can no longer be delivered to it.
    await setMode(host, "unavailable");
    sync.deliver(PATH, geo(2));
    await setMode(host, "live");
    expect(viewApply).not.toHaveBeenCalled();
  });

  it("every mode in STALE_VIEW_MODES can be entered and left, and `live` is the default", async () => {
    expect([...STALE_VIEW_MODES]).toEqual(["live", "delayed", "unavailable"]);
    for (const mode of STALE_VIEW_MODES as readonly StaleViewMode[]) {
      const { sync, host, viewApply } = harness();
      expect((await setMode(host, mode)).status).toBe(200);
      expect((await setMode(host, "live")).status).toBe(200);
      sync.deliver(PATH, geo(5));
      expect(viewApply, `mode ${mode} did not return to normal`).toHaveBeenCalledTimes(1);
    }
  });

  it("a value outside the mode set is refused at the command boundary", async () => {
    const { sync, host, viewApply } = harness();
    for (const bad of [true, 1, "stale", "LIVE", null, { mode: "delayed" }]) {
      const out = await setMode(host, bad);
      expect(out.status, `value ${JSON.stringify(bad)} was accepted`).toBe(400);
      expect(out.body.ok).toBe(false);
    }
    // Nothing was entered, so the view is still live.
    sync.deliver(PATH, geo(5));
    expect(viewApply).toHaveBeenCalledTimes(1);

    // Positive control: a value INSIDE the set is accepted on the same host.
    expect((await setMode(host, "delayed")).status).toBe(200);
    sync.deliver(PATH, geo(6));
    expect(viewApply).toHaveBeenCalledTimes(1);
  });
});
