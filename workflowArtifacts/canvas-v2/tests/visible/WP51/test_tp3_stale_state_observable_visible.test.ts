// WP51 / C51 AC1 — "the current state is observable through the protocol".
//
// A rig that can enter a state it cannot read is a rig that reports a stale-view
// run it never established. `canvas.flags` is the read-back: it answers with the
// mode in force and with how many remote updates are being withheld, and those
// numbers must MOVE with the traffic rather than echo the last command.
//
// Deliberately not asserted through a log line: state is the oracle.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  RUNTIME_FLAG_READERS,
  STALE_VIEW_FLAG,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const PATH = "_e2e-rig/e2e-scratch-20260803T093000Z-3-c.canvas";

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
    deliver(data: RemoteData) {
      sync.onRemoteCanvasUpdate?.(PATH, data);
    },
  };
  const plugin = {
    settings: { clientId: "e2e-a", roomId: "canvas-v2-t3", role: "host", debug: false },
    muxConnected: true,
    controlConnected: true,
    canvasSync: sync,
  } as unknown as E2EPluginLike;
  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  sync.setOnRemoteCanvasUpdate(vi.fn<RemoteHandler>());
  return { sync, host, plugin };
}

const geo = (x: number): RemoteData => ({ nodes: [{ id: "n1", x, y: 0 }], edges: [] });

async function flags(host: ReturnType<typeof harness>["host"]) {
  const out = await routeCommand(host, { cmd: "canvas.flags" });
  expect(out.status).toBe(200);
  if (!out.body.ok) throw new Error(`canvas.flags failed: ${out.body.error}`);
  return out.body.result as {
    flags: Record<string, unknown>;
    staleView: string;
    withheld: number;
  };
}

const setMode = (host: ReturnType<typeof harness>["host"], value: unknown) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

describe("WP51 AC1 — the stale state is readable over the protocol", () => {
  it("reports `live` before anything is entered", async () => {
    const { host } = harness();
    const before = await flags(host);
    expect(before.staleView).toBe("live");
    expect(before.withheld).toBe(0);
    expect(before.flags[STALE_VIEW_FLAG]).toBe("live");
  });

  it("reports the mode in force and the withheld count as traffic arrives", async () => {
    const { sync, host } = harness();
    await setMode(host, "delayed");
    expect(await flags(host)).toMatchObject({ staleView: "delayed", withheld: 0 });

    sync.deliver(geo(1));
    expect((await flags(host)).withheld).toBe(1);
    sync.deliver(geo(2));
    sync.deliver(geo(3));
    expect((await flags(host)).withheld).toBe(3);

    await setMode(host, "live");
    const after = await flags(host);
    expect(after.staleView).toBe("live");
    expect(after.withheld).toBe(0);
  });

  it("the withheld count does not move while live — it is not a delta counter", async () => {
    const { sync, host } = harness();
    sync.deliver(geo(1));
    sync.deliver(geo(2));
    expect(await flags(host)).toMatchObject({ staleView: "live", withheld: 0 });
  });

  it("distinguishes the two non-live modes by name, not only by behaviour", async () => {
    const { host } = harness();
    await setMode(host, "unavailable");
    expect((await flags(host)).staleView).toBe("unavailable");
    await setMode(host, "delayed");
    expect((await flags(host)).staleView).toBe("delayed");
  });

  it("`canvas.flags` reports every registered runtime flag and takes no args", async () => {
    const { host } = harness();
    const bare = await flags(host);
    for (const name of Object.keys(RUNTIME_FLAG_READERS)) {
      expect(Object.keys(bare.flags), `flag '${name}' is not observable`).toContain(name);
    }
    const noisy = await routeCommand(host, {
      cmd: "canvas.flags",
      args: { path: PATH, name: "spoofed" },
    });
    expect(noisy.status).toBe(200);
    expect(noisy.body).toEqual({ ok: true, result: bare });
  });

  it("a host without the read-back gives a structured 400, never a crash", async () => {
    const bare = {
      sessionInfo: () => ({ clientId: "c", role: "host", roomId: "r", connected: true }),
      canvasOpen: async () => ({ opened: false, subscribed: false }),
      canvasState: () => ({ nodes: [], edges: [] }),
      bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
      simulateEdit: async () => ({ applied: true }),
      setFlag: () => ({ set: true }),
      waitQuiescent: async () => ({ quiescent: true }),
    };
    const out = await routeCommand(bare, { cmd: "canvas.flags" });
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);

    // Positive control: a real plugin host answers the same command with 200.
    const { host } = harness();
    expect((await routeCommand(host, { cmd: "canvas.flags" })).status).toBe(200);
  });
});
