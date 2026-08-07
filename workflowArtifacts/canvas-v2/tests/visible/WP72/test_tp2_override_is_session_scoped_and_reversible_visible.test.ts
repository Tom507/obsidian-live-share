// WP72 / C72 AC2 — "an in-memory settings override is explicitly scoped to the
// session and is reversible".
//
// Any value the command applies to the live instance is applied to the in-memory
// state ONLY, is recorded so the instance can be returned to its prior in-memory
// value through the protocol, and does not survive the instance. The last clause
// of AC2 is the sharpest: "a plugin whose `saveSettings` is invoked by an
// unrelated code path must still restore to the borrowed bytes" — i.e. the
// override must be reversed in memory, not merely prevented from reaching disk,
// because anything else leaves the live copy poisoned for the next writer.
//
// sha256-of-bytes only; no credential is read, printed or fixtured.
//
// Staging: copy into `plugin/src/__tests__/wp72/` (one level deep → `../../`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";

import {
  type E2EControlHost,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

let dir: string;
let dataJson: string;

function fixture() {
  const doc = new Y.Doc();
  const settings: Record<string, unknown> = {
    clientId: "e2e-a",
    roomId: "canvas-v2-t3",
    role: "host",
    sharedFolder: "_e2e-rig",
    useCanvasBinding: false,
  };
  const saveSettings = vi.fn(() => {
    writeFileSync(dataJson, JSON.stringify(settings, null, 2), "utf8");
  });
  const plugin = {
    settings,
    muxConnected: true,
    controlConnected: true,
    saveSettings,
    canvasSync: {
      subscribe: async () => {},
      isSubscribed: () => true,
      getCanvasSnapshot: () => null,
      getCanvasDocHandle: () => ({ doc }),
    },
  } as unknown as E2EPluginLike;
  saveSettings();
  saveSettings.mockClear();
  return { plugin, settings, saveSettings };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wp72b-"));
  dataJson = join(dir, "data.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("WP72 AC2 — session-scoped, reversible, in-memory only", () => {
  it("the override is applied in memory and reversed to the value the instance loaded", async () => {
    const { plugin, settings } = fixture();
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });

    expect(settings.useCanvasBinding).toBe(false);
    host.setFlag("useCanvasBinding", true);
    host.setFlag("sharedFolder", "elsewhere");
    expect(settings.useCanvasBinding).toBe(true);
    expect(settings.sharedFolder).toBe("elsewhere");

    const out = await routeCommand(host, { cmd: "canvas.clearFlags" });
    expect(out.status).toBe(200);
    expect((out.body as { result: { restored: string[] } }).result.restored.sort()).toEqual([
      "sharedFolder",
      "useCanvasBinding",
    ]);
    expect(settings.useCanvasBinding).toBe(false);
    expect(settings.sharedFolder).toBe("_e2e-rig");
  });

  it("the prior value is captured on the FIRST override, not on the last", () => {
    const { plugin, settings } = fixture();
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    host.setFlag("roomId", "first-override");
    host.setFlag("roomId", "second-override");
    host.setFlag("roomId", "third-override");
    expect(settings.roomId).toBe("third-override");
    host.clearFlags();
    // Not "second-override": a journal that recaptures on every call restores the
    // previous override and silently loses the loaded value.
    expect(settings.roomId).toBe("canvas-v2-t3");
  });

  it("AC2's sharpest clause: an unrelated saveSettings still writes the borrowed bytes", () => {
    const { plugin, saveSettings } = fixture();
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    const borrowed = sha256OfFile(dataJson);

    host.setFlag("roomId", "poisoned");
    host.setFlag("useCanvasBinding", true);
    host.clearFlags();

    // Some other code path in the plugin persists, for its own reasons. Because
    // the override was reversed IN MEMORY, what it writes is the borrowed state.
    plugin.saveSettings?.();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(sha256OfFile(dataJson)).toBe(borrowed);
  });

  it("FALSIFICATION: without the reversal, that same unrelated save poisons the file", () => {
    const { plugin } = fixture();
    const borrowed = sha256OfFile(dataJson);
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    host.setFlag("roomId", "poisoned");
    // clearFlags deliberately NOT called.
    plugin.saveSettings?.();
    expect(sha256OfFile(dataJson)).not.toBe(borrowed);
  });

  it("an override does not survive the instance", () => {
    const { plugin, settings } = fixture();
    const first = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    first.setFlag("roomId", "from-the-old-host");

    // A new host over the same plugin holds no journal — the override is scoped
    // to the session that made it, and cannot be reversed from a later one.
    const second = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    expect(second.clearFlags()).toEqual({ restored: [], cleared: [] });
    expect(settings.roomId).toBe("from-the-old-host");
    // ...and the ORIGINAL host can still put it back, because it owns the record.
    first.clearFlags();
    expect(settings.roomId).toBe("canvas-v2-t3");
  });

  it("clearFlags is idempotent and also drops the runtime-flag stash", () => {
    const { plugin, settings } = fixture();
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    host.setFlag("roomId", "x");
    host.setFlag("madeUpFlag", 1);
    expect(host.clearFlags()).toEqual({ restored: ["roomId"], cleared: ["madeUpFlag"] });
    expect(host.clearFlags()).toEqual({ restored: [], cleared: [] });
    expect(settings.roomId).toBe("canvas-v2-t3");
    expect("madeUpFlag" in settings).toBe(false);
  });

  it("a host that cannot reverse answers a structured 400, never a crash", async () => {
    const legacy: E2EControlHost = {
      sessionInfo: () => ({ clientId: "c", role: "host", roomId: "r", connected: true }),
      canvasOpen: async () => ({ opened: true, subscribed: true }),
      canvasState: () => ({ nodes: [], edges: [] }),
      bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
      simulateEdit: async () => ({ applied: true }),
      setFlag: () => ({ set: true }),
      waitQuiescent: async () => ({ quiescent: true }),
    };
    const out = await routeCommand(legacy, { cmd: "canvas.clearFlags" });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
  });
});
