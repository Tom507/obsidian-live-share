// WP51 AC1 — blind set 2 (observability).
//
// Angle: the envelope, not the value. A driver reads this over HTTP, so the
// result must survive `JSON.stringify` unchanged, must have exactly the keys the
// protocol promises (no stray internals, no leaked buffer), and must go through
// the SAME `POST /command` envelope as every other command — no second endpoint
// and no new dependency (WP49 AC4's rule, still in force).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STALE_VIEW_FLAG,
  type E2EPluginLike,
  buildPluginHost,
  parseAndRoute,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

const PATH = "_e2e-rig/e2e-scratch-20260803T120101Z-b2-env.canvas";

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
    deliver(x: number) {
      sync.onRemoteCanvasUpdate?.(PATH, { nodes: [{ id: "n1", x }], edges: [] });
    },
  };
  const host = buildPluginHost(
    {
      settings: { clientId: "env", roomId: "canvas-v2-t3", role: "guest" },
      canvasSync: sync,
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
  sync.setOnRemoteCanvasUpdate(() => {});
  return { sync, host };
}

describe("WP51 AC1 (blind2) — the read-back travels over the existing envelope", () => {
  it("has exactly the three promised keys and nothing else", async () => {
    const { host } = rig();
    const out = await routeCommand(host, { cmd: "canvas.flags" });
    if (!out.body.ok) throw new Error("canvas.flags failed");
    expect(Object.keys(out.body.result as object).sort()).toEqual([
      "flags",
      "staleView",
      "withheld",
    ]);
  });

  it("survives the JSON round trip a driver actually performs", async () => {
    const { sync, host } = rig();
    await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "delayed" },
    });
    sync.deliver(1);
    sync.deliver(2);

    const wire = await parseAndRoute(host, JSON.stringify({ cmd: "canvas.flags" }));
    expect(wire.status).toBe(200);
    const decoded = JSON.parse(JSON.stringify(wire.body));
    expect(decoded).toEqual({
      ok: true,
      result: { flags: { [STALE_VIEW_FLAG]: "delayed" }, staleView: "delayed", withheld: 2 },
    });
  });

  it("leaks no buffered payload into the answer", async () => {
    const { sync, host } = rig();
    await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "delayed" },
    });
    sync.deliver(4242);
    const wire = await parseAndRoute(host, '{"cmd":"canvas.flags"}');
    expect(wire.status).toBe(200); // the read-back really answered
    // The counter, never the contents — an answer carrying the withheld frames
    // would grow without bound on a long stale run.
    expect(JSON.stringify(wire.body)).not.toContain("4242");
  });

  it("is reached through `POST /command`, not a new endpoint", async () => {
    const { host } = rig();
    // Same envelope as every other command: malformed input is still a 400.
    expect((await parseAndRoute(host, "{not json")).status).toBe(400);
    expect((await parseAndRoute(host, "")).status).toBe(400); // empty → {} → no cmd
    expect((await routeCommand(host, { cmd: "canvas.flag" })).status).toBe(400);
    expect((await routeCommand(host, { cmd: "canvas.Flags" })).status).toBe(400);
    expect((await parseAndRoute(host, '{"cmd":"canvas.flags"}')).status).toBe(200);
  });

  it("the pinned `canvas.setFlag` result shape is unchanged by this WP", async () => {
    const { host } = rig();
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "unavailable" },
    });
    // T3 contract §6 pins `{set}` — the entry command must not start returning
    // replay bookkeeping in place of it.
    expect(out.body).toEqual({ ok: true, result: { set: true } });
  });

  it("a refusal carries a reason a driver can act on, and never a 200", async () => {
    const { host } = rig();
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: "nonesuch.flag", value: 1 },
    });
    expect(out.status).toBe(400);
    if (out.body.ok) throw new Error("unknown flag was accepted");
    expect(out.body.error).toContain("nonesuch.flag");
  });
});
