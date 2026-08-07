// WP51 AC3 — blind set 2 (rejection at the boundary).
//
// Angle: the refusal must be a property of the RUN, not of one call. A driver
// script sets a handful of flags in sequence and reads the answers; the failure
// mode this guards against is a surface that refuses the first unknown name and
// then, once a legitimate flag has been accepted, starts letting everything
// through — or that refuses but leaves the instance in a half-entered state.
//
// Second angle: the refusal must not have collateral. A rejected `canvas.setFlag`
// may not disturb the stale state already in force, the settings, or the doc.
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

const PATH = "_e2e-rig/e2e-scratch-20260803T121500Z-b2-seq.canvas";

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
  const plugin = {
    settings: {
      clientId: "b2",
      roomId: "canvas-v2-t3",
      role: "host",
      useCanvasBinding: false,
      debug: false,
    },
    muxConnected: true,
    controlConnected: true,
    canvasSync: sync,
    saveSettings: vi.fn(),
  } as unknown as E2EPluginLike;
  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  const applied = vi.fn<RemoteHandler>();
  sync.setOnRemoteCanvasUpdate(applied);
  return { doc, sync, host, plugin, applied };
}

const set = (host: ReturnType<typeof rig>["host"], name: string, value: unknown) =>
  routeCommand(host, { cmd: "canvas.setFlag", args: { name, value } });

/** The sequence a driver script actually issues, with the expected status. */
const SCRIPT: Array<[string, unknown, number]> = [
  ["debug", true, 200],
  ["canvas.stale", "delayed", 400],
  [STALE_VIEW_FLAG, "delayed", 200],
  ["canvas.staleViewMode", "delayed", 400],
  ["useCanvasBinding", false, 200],
  ["stale", true, 400],
  [STALE_VIEW_FLAG, "live", 200],
  ["", "live", 400],
];

describe("WP51 AC3 (blind2) — the refusal holds for a whole driver run", () => {
  it("every step of the script gets the status it deserves, in order", async () => {
    const { host } = rig();
    const got: number[] = [];
    for (const [name, value] of SCRIPT) got.push((await set(host, name, value)).status);
    expect(got).toEqual(SCRIPT.map(([, , status]) => status));
  });

  it("accepting a legitimate flag does not open the gate for the next unknown one", async () => {
    const { host } = rig();
    expect((await set(host, STALE_VIEW_FLAG, "delayed")).status).toBe(200);
    expect((await set(host, "canvas.stale", "delayed")).status).toBe(400);
    expect((await set(host, "debug", true)).status).toBe(200);
    expect((await set(host, "madeUpFlag", 1)).status).toBe(400);
  });

  it("a refused command leaves the stale state exactly where it was", async () => {
    const { sync, host, applied } = rig();
    await set(host, STALE_VIEW_FLAG, "delayed");
    sync.deliver(1);

    expect((await set(host, "canvas.stale", "live")).status).toBe(400);
    expect((await set(host, "__proto__", "live")).status).toBe(400);

    sync.deliver(2);
    expect(applied).not.toHaveBeenCalled(); // still stale — no accidental release

    await set(host, STALE_VIEW_FLAG, "live");
    expect(applied).toHaveBeenCalledTimes(2);
  });

  it("a refused command persists no settings and calls no save", async () => {
    const { host, plugin } = rig();
    const before = JSON.stringify(plugin.settings);
    expect((await set(host, "notASetting", "x")).status).toBe(400);
    expect((await set(host, "canvas.staleViewMode", "delayed")).status).toBe(400);
    expect(JSON.stringify(plugin.settings)).toBe(before);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    // Positive control: an accepted settings flag DOES persist and DOES save.
    expect((await set(host, "debug", true)).status).toBe(200);
    expect((plugin.settings as Record<string, unknown>).debug).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it("a refused command touches no shared doc", async () => {
    const { doc, host } = rig();
    await routeCommand(host, { cmd: "canvas.open", args: { path: PATH } });
    expect((await set(host, "canvas.stale", "delayed")).status).toBe(400);
    expect(doc.getMap("nodes").size).toBe(0);
    expect(doc.getMap("edges").size).toBe(0);
    // Positive control: the accepted flag is accepted on the same host…
    expect((await set(host, STALE_VIEW_FLAG, "delayed")).status).toBe(200);
    // …and it, too, writes nothing into the shared doc.
    expect(doc.getMap("nodes").size).toBe(0);
  });

  it("only names in the registry or in settings are ever accepted", async () => {
    const { host, plugin } = rig();
    const settingsKeys = Object.keys(plugin.settings as Record<string, unknown>);
    const registered = Object.keys(RUNTIME_FLAG_READERS);
    const accepted: string[] = [];
    for (const name of [...settingsKeys, ...registered, "phantom", "canvas.phantom"]) {
      const value = registered.includes(name) ? "live" : "x";
      if ((await set(host, name, value)).status === 200) accepted.push(name);
    }
    expect(new Set(accepted)).toEqual(new Set([...settingsKeys, ...registered]));
  });
});
