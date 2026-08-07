// WP51 AC1 — blind set 1 (observability).
//
// Angle: the read-back has to survive being asked at the wrong moments — before
// any session, after a refused command, from two independent hosts, and
// repeatedly. A `canvas.flags` that echoes the last accepted command rather than
// reading the gate passes the visible test and fails these.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STALE_VIEW_FLAG,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const PATH = "_e2e-rig/e2e-scratch-20260803T115959Z-b1-obs.canvas";

function rig(withSession = true) {
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
    deliver(x: number) {
      sync.onRemoteCanvasUpdate?.(PATH, { nodes: [{ id: "n1", x }], edges: [] });
    },
  };
  const host = buildPluginHost(
    {
      settings: { clientId: "obs", roomId: "canvas-v2-t3", role: "host", debug: false },
      canvasSync: withSession ? sync : null,
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
  if (withSession) sync.setOnRemoteCanvasUpdate(() => {});
  return { sync, host };
}

async function flags(host: ReturnType<typeof rig>["host"]) {
  const out = await routeCommand(host, { cmd: "canvas.flags" });
  expect(out.status).toBe(200);
  if (!out.body.ok) throw new Error(out.body.error);
  return out.body.result as { flags: Record<string, unknown>; staleView: string; withheld: number };
}

const setMode = (host: ReturnType<typeof rig>["host"], value: unknown) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name: STALE_VIEW_FLAG, value } });

describe("WP51 AC1 (blind1) — the read-back is honest at every moment", () => {
  it("answers before any canvas session exists", async () => {
    const { host } = rig(false);
    expect(await flags(host)).toMatchObject({ staleView: "live", withheld: 0 });
  });

  it("is unchanged by a REFUSED entry attempt", async () => {
    const { host } = rig();
    const before = await flags(host);
    expect((await setMode(host, "frozen")).status).toBe(400);
    expect((await setMode(host, true)).status).toBe(400);
    expect(await flags(host)).toEqual(before);
  });

  it("is unchanged by a refused flag NAME", async () => {
    const { host } = rig();
    const before = await flags(host);
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: "canvasStaleView", value: "delayed" },
    });
    expect(out.status).toBe(400);
    expect(await flags(host)).toEqual(before);
  });

  it("repeating the read does not move the counter", async () => {
    const { sync, host } = rig();
    await setMode(host, "delayed");
    sync.deliver(1);
    sync.deliver(2);
    const a = await flags(host);
    const b = await flags(host);
    const c = await flags(host);
    expect(a.withheld).toBe(2);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("two hosts answer for themselves", async () => {
    const one = rig();
    const two = rig();
    await setMode(one.host, "unavailable");
    one.sync.deliver(1);
    two.sync.deliver(1);

    expect(await flags(one.host)).toMatchObject({ staleView: "unavailable", withheld: 1 });
    expect(await flags(two.host)).toMatchObject({ staleView: "live", withheld: 0 });
  });

  it("the counter counts WITHHELD updates, not delivered ones", async () => {
    const { sync, host } = rig();
    sync.deliver(1);
    sync.deliver(2);
    sync.deliver(3);
    expect((await flags(host)).withheld).toBe(0);

    await setMode(host, "delayed");
    sync.deliver(4);
    expect((await flags(host)).withheld).toBe(1);
  });

  it("`canvas.flags` never mutates anything it reports", async () => {
    const { sync, host } = rig();
    await setMode(host, "delayed");
    sync.deliver(1);
    const first = await flags(host);
    for (let i = 0; i < 5; i++) await routeCommand(host, { cmd: "canvas.flags" });
    expect(await flags(host)).toEqual(first);
  });
});
