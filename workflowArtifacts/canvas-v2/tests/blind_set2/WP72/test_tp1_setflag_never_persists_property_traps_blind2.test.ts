// WP72 / C72 AC1 (blind set 2) — "a control command cannot rewrite the borrowed
// settings file".
//
// ANGLE (different mechanism from both the visible set and blind set 1): those
// watch the FILE and the `saveSettings` spy. This one watches the SETTINGS OBJECT
// itself, through `Object.defineProperty` accessor traps that count reads and
// writes per key — so persistence is detected without a filesystem at all, and
// without knowing the name of whatever function does it. The observation that
// makes this work: any serializer must READ EVERY KEY. `setFlag("roomId", …)`
// legitimately reads one key (the journal's prior value) and writes one key; a
// `saveSettings` on that path would light up every key on the object. A rename of
// the persistence API, a persistence call reached through a helper, or a hand-
// rolled `JSON.stringify(settings)` written inline all fail this oracle, and none
// of them would be caught by spying on a named method.
//
// The second half widens the file oracle instead of narrowing it: rather than
// hashing `data.json`, it snapshots the WHOLE plugin directory (every entry,
// name → sha256). That catches what a single-file hash cannot — an atomic
// `write .tmp + rename`, a `data.json.bak` sidecar, a lockfile — i.e. exactly the
// forms a "careful" persistence implementation takes. The last case proves the
// widening is not decorative by exhibiting a writer the single-file hash misses.
//
// WOULD REDDEN IF: anything on the `canvas.setFlag` / `canvas.clearFlags` path
// enumerated the settings object (the read tally stops being exactly the touched
// keys), or wrote any file anywhere in the plugin directory (the directory
// snapshot moves), or touched a key it was not asked about (the write tally).
//
// DATA SAFETY: sha256-of-bytes only. Every file here is a throwaway created under
// the OS temp dir with obviously non-secret placeholder contents; no real vault,
// no real `data.json`.
//
// Staging: copy into `plugin/src/__tests__/wp72blind2/` (→ `../../testing/...`).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  type E2EFileControlHost,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const LOADED: Record<string, unknown> = {
  clientId: "blind2-client",
  roomId: "blind2-room",
  role: "host",
  serverUrl: "ws://127.0.0.1:1234",
  sharedFolder: "_e2e-rig",
  useCanvasBinding: false,
  showCanvasPresence: true,
  showCanvasCursors: true,
  debug: false,
};

/** Per-key read/write tallies over an object that behaves exactly like a plain one. */
function trappedSettings(initial: Record<string, unknown>) {
  const store: Record<string, unknown> = { ...initial };
  const reads = new Map<string, number>();
  const writes = new Map<string, number>();
  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(initial)) {
    Object.defineProperty(settings, key, {
      enumerable: true,
      configurable: true,
      get(): unknown {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return store[key];
      },
      set(value: unknown): void {
        writes.set(key, (writes.get(key) ?? 0) + 1);
        store[key] = value;
      },
    });
  }
  const tally = (m: Map<string, number>): Record<string, number> =>
    Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return {
    settings,
    store,
    reset: () => {
      reads.clear();
      writes.clear();
    },
    reads: () => tally(reads),
    writes: () => tally(writes),
  };
}

/** Every entry under `dir`, relative path → sha256 of its bytes. */
function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[relative(dir, full).split("\\").join("/")] =
        createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

let pluginDir: string;
let dataJson: string;

beforeEach(() => {
  pluginDir = join(mkdtempSync(join(tmpdir(), "wp72-b2-")), "live-share");
  mkdirSync(pluginDir, { recursive: true });
  dataJson = join(pluginDir, "data.json");
  // A throwaway stand-in for the borrowed plugin directory: placeholder contents
  // invented for this test, nothing copied from anywhere.
  writeFileSync(dataJson, JSON.stringify(LOADED, null, 2), "utf8");
  writeFileSync(join(pluginDir, "styles.css"), "/* placeholder */\n", "utf8");
});

afterEach(() => {
  rmSync(pluginDir, { recursive: true, force: true });
});

function hostOver(settings: Record<string, unknown>, saveSettings: () => void) {
  const plugin = {
    settings,
    muxConnected: true,
    controlConnected: true,
    saveSettings,
    canvasSync: null,
  } as unknown as E2EPluginLike;
  const host: E2EFileControlHost = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  return { plugin, host };
}

describe("WP72 AC1 blind2 — persistence detected at the object, and at the whole directory", () => {
  it("one setFlag touches exactly one key: one read, one write, and nothing enumerated", async () => {
    const t = trappedSettings(LOADED);
    const { host } = hostOver(t.settings, () => {
      throw new Error("unreachable in this case");
    });

    t.reset();
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: "roomId", value: "overridden" },
    });

    expect(out.status).toBe(200);
    // The journal reads the prior value once; the override writes once. Any
    // serialization of the settings object would read all nine keys, so these
    // two whole-object comparisons are the persistence oracle.
    expect(t.reads()).toEqual({ roomId: 1 });
    expect(t.writes()).toEqual({ roomId: 1 });
    expect(t.store.roomId).toBe("overridden");
  });

  it("a whole sweep of settings keys reads and writes only the keys it was asked about", async () => {
    const t = trappedSettings(LOADED);
    const { host } = hostOver(t.settings, () => {
      throw new Error("unreachable in this case");
    });
    const names = ["useCanvasBinding", "showCanvasPresence", "sharedFolder", "serverUrl", "debug"];

    t.reset();
    for (const name of names) {
      await routeCommand(host, { cmd: "canvas.setFlag", args: { name, value: `v-${name}` } });
    }
    // Repeats must NOT re-read: the journal captures on the first override only.
    for (const name of names) {
      await routeCommand(host, { cmd: "canvas.setFlag", args: { name, value: `w-${name}` } });
    }

    const expectedReads = Object.fromEntries(names.map((n) => [n, 1]));
    const expectedWrites = Object.fromEntries(names.map((n) => [n, 2]));
    expect(t.reads()).toEqual(expectedReads);
    expect(t.writes()).toEqual(expectedWrites);
    // Untouched keys were never even looked at.
    expect(Object.keys(t.reads())).not.toContain("clientId");
    expect(Object.keys(t.reads())).not.toContain("roomId");
  });

  it("an unknown name generates no accessor traffic whatsoever", async () => {
    const t = trappedSettings(LOADED);
    const { host } = hostOver(t.settings, () => {
      throw new Error("unreachable in this case");
    });

    t.reset();
    for (const name of ["madeUpFlag", "canvasStale", "staleView"]) {
      const out = await routeCommand(host, { cmd: "canvas.setFlag", args: { name, value: 1 } });
      expect(out.status).toBe(200);
    }
    expect(t.reads()).toEqual({});
    expect(t.writes()).toEqual({});
  });

  it("the reversal writes back only what it overrode, and reads nothing", async () => {
    const t = trappedSettings(LOADED);
    const { host } = hostOver(t.settings, () => {
      throw new Error("unreachable in this case");
    });

    await routeCommand(host, { cmd: "canvas.setFlag", args: { name: "roomId", value: "x" } });
    await routeCommand(host, { cmd: "canvas.setFlag", args: { name: "debug", value: true } });
    await routeCommand(host, { cmd: "canvas.setFlag", args: { name: "unknownOne", value: 1 } });

    t.reset();
    const out = await routeCommand(host, { cmd: "canvas.clearFlags" });
    expect(out.status).toBe(200);
    // A restore that serialised the object on its way out would read all nine.
    expect(t.reads()).toEqual({});
    expect(t.writes()).toEqual({ debug: 1, roomId: 1 });
    expect(t.store.roomId).toBe(LOADED.roomId);
    expect(t.store.debug).toBe(LOADED.debug);
  });

  it("FALSIFICATION: a serializer lights up every key, which is why the tallies are an oracle", () => {
    const t = trappedSettings(LOADED);
    const { plugin } = hostOver(t.settings, () => {
      // The shape any persistence implementation has, whatever it is called.
      writeFileSync(dataJson, JSON.stringify(t.settings, null, 2), "utf8");
    });

    t.reset();
    plugin.saveSettings?.();
    // Every key read exactly once — the unmistakable fingerprint the assertions
    // above assert never appears on the setFlag path.
    expect(t.reads()).toEqual(Object.fromEntries(Object.keys(LOADED).map((k) => [k, 1])));
    expect(t.writes()).toEqual({});
  });

  it("the whole plugin directory is byte-identical after the entire command surface is driven", async () => {
    const t = trappedSettings(LOADED);
    const { host } = hostOver(t.settings, () => {
      throw new Error("unreachable in this case");
    });

    const before = snapshotDir(pluginDir);
    expect(Object.keys(before).sort()).toEqual(["data.json", "styles.css"]);

    for (const name of [...Object.keys(LOADED), "madeUpFlag", "canvasStale"]) {
      await routeCommand(host, { cmd: "canvas.setFlag", args: { name, value: "sweep" } });
    }
    await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: "roomId", value: "x", persist: true },
    });
    await routeCommand(host, { cmd: "canvas.clearFlags" });

    // No file created, removed or changed — anywhere in the directory, not just
    // at `data.json`.
    expect(snapshotDir(pluginDir)).toEqual(before);
  });

  it("FALSIFICATION: the directory snapshot catches a writer the single-file hash misses", () => {
    const before = snapshotDir(pluginDir);
    const dataHashBefore = before["data.json"];

    // A "careful" persister that leaves `data.json` alone for the moment and
    // stages its work beside it. A `sha256(data.json)` oracle sees nothing here;
    // the directory snapshot sees it immediately.
    writeFileSync(`${dataJson}.tmp`, '{"staged":"placeholder"}', "utf8");
    writeFileSync(join(pluginDir, "data.json.bak"), '{"backup":"placeholder"}', "utf8");

    const after = snapshotDir(pluginDir);
    expect(after["data.json"]).toBe(dataHashBefore); // the narrow oracle: silent
    expect(after).not.toEqual(before); // the wide oracle: loud
    expect(Object.keys(after).sort()).toEqual([
      "data.json",
      "data.json.bak",
      "data.json.tmp",
      "styles.css",
    ]);
  });
});
