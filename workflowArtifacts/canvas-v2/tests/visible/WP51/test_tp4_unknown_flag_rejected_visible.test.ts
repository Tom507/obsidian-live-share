// WP51 / C51 AC3, first half — "a flag no path consults is REJECTED AT THE
// COMMAND BOUNDARY rather than silently stored".
//
// Today `canvas.setFlag` puts any unrecognised name into a per-host
// `runtimeFlags` map that nothing reads. A rig that sets `canvasStale` (typo of
// the real name) gets `{set:true}` and records a stale-view run it never
// entered. That is the whole defect: the answer is indistinguishable from a
// working flag.
//
// The boundary is `routeCommand` — the only path a driver can reach. The direct
// host method keeps its pre-WP51 behaviour, which `e2e-control.test.ts`
// ("setFlag writes a known setting and stashes unknown flags…") pins and which
// this WP holds no licence to change.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  RUNTIME_FLAG_READERS,
  STALE_VIEW_FLAG,
  type E2EControlHost,
  type E2EPluginLike,
  buildPluginHost,
  isKnownRuntimeFlag,
  routeCommand,
} from "../../testing/e2e-control";

type RemoteData = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type RemoteHandler = (path: string, data: RemoteData) => void;

/** Names that name nothing: no runtime reader, no settings key. */
const NO_READER = [
  "canvasStale", // the realistic typo
  "canvas.stale",
  "staleView",
  "canvas.staleview",
  "madeUpFlag",
  "useCanvasBinding ", // trailing space — a settings key it is NOT
  "",
];

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
  };
  const plugin = {
    // Two REAL settings keys. A settings key is consulted by production code, so
    // it stays a legal flag target — that branch is pre-WP51 and untouched.
    settings: {
      clientId: "e2e-a",
      roomId: "canvas-v2-t3",
      role: "host",
      debug: false,
      useCanvasBinding: false,
    },
    muxConnected: true,
    controlConnected: true,
    canvasSync: sync,
    saveSettings: () => {},
  } as unknown as E2EPluginLike;
  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  sync.setOnRemoteCanvasUpdate(() => {});
  return { host, plugin, sync };
}

describe("WP51 AC3 — an unconsulted flag name is refused, not stashed", () => {
  it.each(NO_READER)("`canvas.setFlag name=%j` → 400 ok:false", async (name) => {
    const { host } = harness();
    const out = await routeCommand(host, { cmd: "canvas.setFlag", args: { name, value: true } });
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
  });

  it("a refused name is not stored anywhere the protocol can see", async () => {
    const { host, plugin } = harness();
    const settingsBefore = JSON.stringify(plugin.settings);

    await routeCommand(host, { cmd: "canvas.setFlag", args: { name: "canvasStale", value: true } });

    expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
    const flags = await routeCommand(host, { cmd: "canvas.flags" });
    expect(flags.status).toBe(200);
    if (!flags.body.ok) throw new Error("canvas.flags failed");
    const result = flags.body.result as { flags: Record<string, unknown> };
    expect(Object.keys(result.flags)).not.toContain("canvasStale");
  });

  it("the two accepted classes still work: a registered runtime flag and a real settings key", async () => {
    const { host, plugin } = harness();

    const runtime = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "delayed" },
    });
    expect(runtime).toEqual({ status: 200, body: { ok: true, result: { set: true } } });

    const setting = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: "debug", value: true },
    });
    expect(setting).toEqual({ status: 200, body: { ok: true, result: { set: true } } });
    expect((plugin.settings as Record<string, unknown>).debug).toBe(true);
  });

  it("`isKnownRuntimeFlag` and `RUNTIME_FLAG_READERS` agree, and the registry is not empty", () => {
    const names = Object.keys(RUNTIME_FLAG_READERS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(isKnownRuntimeFlag(name)).toBe(true);
      // Every entry names the code path that reads it — a registry of bare names
      // is how an inert flag gets registered without anyone noticing.
      expect(typeof RUNTIME_FLAG_READERS[name]).toBe("string");
      expect(RUNTIME_FLAG_READERS[name].length).toBeGreaterThan(0);
    }
    for (const name of NO_READER) expect(isKnownRuntimeFlag(name)).toBe(false);
  });

  it("the missing-arg contract is unchanged: no `name` is still a 400", async () => {
    const { host } = harness();
    expect((await routeCommand(host, { cmd: "canvas.setFlag", args: {} })).status).toBe(400);
    expect((await routeCommand(host, { cmd: "canvas.setFlag", args: { name: 7 } })).status).toBe(
      400,
    );
  });

  it("a pre-WP51 fake host that declares no flag set keeps the legacy pass-through", async () => {
    // `routeCommand` is a pure function over `E2EControlHost`, and the hand-rolled
    // fake hosts in the existing suites do not declare a flag set. They must keep
    // routing exactly as before — the refusal is a property of a host that KNOWS
    // its flags, never of the router guessing.
    const legacy: E2EControlHost = {
      sessionInfo: () => ({ clientId: "c1", role: "host", roomId: "r1", connected: true }),
      canvasOpen: async () => ({ opened: true, subscribed: true }),
      canvasState: () => ({ nodes: [], edges: [] }),
      bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
      simulateEdit: async () => ({ applied: true }),
      setFlag: () => ({ set: true }),
      waitQuiescent: async () => ({ quiescent: true }),
    };
    const out = await routeCommand(legacy, {
      cmd: "canvas.setFlag",
      args: { name: "madeUpFlag", value: 1 },
    });
    expect(out).toEqual({ status: 200, body: { ok: true, result: { set: true } } });
  });
});
