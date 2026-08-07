// WP51 AC1/AC4 — blind set 1.
//
// Angle: volume and exhaustive transition coverage. The visible test uses three
// updates and a hand-written pair of transitions; this one buffers fifty, then
// walks every ordered pair of modes as a table and pins the outcome of each.
//
// A gate that keeps only the LAST withheld payload (a very natural
// implementation shortcut) passes a three-item test by luck and fails here.
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

const PATH = "_e2e-rig/e2e-scratch-20260803T113000Z-b1-bulk.canvas";

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
    deliver(seq: number) {
      sync.onRemoteCanvasUpdate?.(PATH, { nodes: [{ id: "n1", seq }], edges: [] });
    },
  };
  const host = buildPluginHost(
    {
      settings: { clientId: "bulk", roomId: "canvas-v2-t3", role: "host" },
      canvasSync: sync,
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
  const applied = vi.fn<RemoteHandler>();
  sync.setOnRemoteCanvasUpdate(applied);
  const seqs = () => applied.mock.calls.map((c) => c[1].nodes[0].seq as number);
  return { sync, host, applied, seqs };
}

/**
 * Enter/leave a mode. A value from the pinned set MUST be accepted — asserting
 * that here is what stops every case below from passing on a surface that
 * refuses the flag outright and therefore never gates anything.
 */
async function setMode(host: ReturnType<typeof rig>["host"], value: string) {
  const out = await routeCommand(host, {
    cmd: "canvas.setFlag",
    args: { name: STALE_VIEW_FLAG, value },
  });
  if ((STALE_VIEW_MODES as readonly string[]).includes(value)) {
    expect(out.status, `mode '${value}' was refused`).toBe(200);
  }
  return out;
}

/** `from` → `to`: how many of the 50 withheld payloads reach the view. */
const TRANSITIONS: Array<[StaleViewMode, StaleViewMode, number]> = [
  ["delayed", "live", 50],
  ["delayed", "delayed", 0],
  ["delayed", "unavailable", 0],
  ["unavailable", "live", 0],
  ["unavailable", "delayed", 0],
  ["unavailable", "unavailable", 0],
];

describe("WP51 AC1 (blind1) — fifty withheld payloads, every transition", () => {
  it.each(TRANSITIONS)("%s → %s delivers %i of 50", async (from, to, expected) => {
    const { sync, host, seqs } = rig();
    await setMode(host, from);
    for (let i = 1; i <= 50; i++) sync.deliver(i);
    await setMode(host, to);

    expect(seqs()).toHaveLength(expected);
    if (expected > 0) {
      // Order and completeness, not just the count.
      expect(seqs()).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    }
  });

  it("a `delayed` run that is never left delivers nothing at all", async () => {
    const { sync, host, applied } = rig();
    await setMode(host, "delayed");
    for (let i = 0; i < 50; i++) sync.deliver(i);
    expect(applied).not.toHaveBeenCalled();
  });

  it("`live` → `live` changes nothing and buffers nothing", async () => {
    const { sync, host, seqs } = rig();
    await setMode(host, "live");
    sync.deliver(1);
    await setMode(host, "live");
    sync.deliver(2);
    expect(seqs()).toEqual([1, 2]);
  });

  it("the catch-up happens exactly once — leaving twice does not replay twice", async () => {
    const { sync, host, seqs } = rig();
    await setMode(host, "delayed");
    sync.deliver(7);
    sync.deliver(8);
    await setMode(host, "live");
    await setMode(host, "live");
    expect(seqs()).toEqual([7, 8]);
  });

  it("STALE_VIEW_MODES is the closed set the command accepts", async () => {
    const { host } = rig();
    expect(new Set(STALE_VIEW_MODES)).toEqual(new Set(["live", "delayed", "unavailable"]));
    for (const mode of STALE_VIEW_MODES) {
      expect((await setMode(host, mode)).status, `${mode} rejected`).toBe(200);
    }
    for (const bad of ["Delayed", "delayed ", "frozen", "off", "true"]) {
      expect((await setMode(host, bad)).status, `${bad} accepted`).toBe(400);
    }
  });
});
