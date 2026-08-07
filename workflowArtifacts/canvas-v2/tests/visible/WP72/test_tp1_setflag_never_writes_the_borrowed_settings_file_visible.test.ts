// WP72 / C72 AC1 — "a control command cannot rewrite the borrowed settings file".
//
// `setFlag` used to call `plugin.saveSettings?.()` for any name that was an
// existing settings key. `saveSettings` rewrites the whole of
// `<vault>/.obsidian/plugins/live-share/data.json` from the LIVE IN-MEMORY copy —
// the file C70 AC1 borrows byte-exactly and C50 AC6 / C7 AC6 re-hash against an
// independent baseline after teardown, where a mismatch fails the run.
//
// The oracle is sha256-of-bytes ONLY. `data.json` holds live credentials
// (`encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`, `token`);
// no byte, key value or credential is read, printed, logged or fixtured here.
// The fixture below is a throwaway file this test creates in the OS temp dir with
// deliberately non-secret contents, and no real vault is touched.
//
// Staging: copy into `plugin/src/__tests__/wp72/` (one level deep → `../../`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import * as Y from "yjs";

import { type E2EPluginLike, buildPluginHost, routeCommand } from "../../testing/e2e-control";

/** sha256 of a file's BYTES. Never its content. */
function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

let dir: string;
let dataJson: string;

/**
 * A plugin whose `saveSettings` really does serialise its live in-memory settings
 * over a file, exactly as the production one does. That is what makes the AC1
 * oracle able to fail: if `setFlag` reaches persistence by ANY path, the file's
 * sha256 changes.
 */
function fixture() {
  const doc = new Y.Doc();
  const subscribed = new Set<string>();
  const settings: Record<string, unknown> = {
    clientId: "e2e-a",
    roomId: "canvas-v2-t3",
    role: "host",
    serverUrl: "ws://127.0.0.1:1234",
    sharedFolder: "_e2e-rig",
    useCanvasBinding: false,
    showCanvasPresence: true,
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
      subscribe: async (path: string) => {
        subscribed.add(path);
      },
      isSubscribed: (path: string) => subscribed.has(path),
      getCanvasSnapshot: () => null,
      getCanvasDocHandle: (path: string) => (subscribed.has(path) ? { doc } : null),
    },
  } as unknown as E2EPluginLike;
  // Seed the "borrowed" file from the same in-memory state, then forget how.
  saveSettings();
  saveSettings.mockClear();
  return { plugin, settings, saveSettings };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wp72-"));
  dataJson = join(dir, "data.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("WP72 AC1 — setFlag performs no write to data.json, for any name", () => {
  it("an existing settings key: the file's sha256 is unchanged and saveSettings is never called", () => {
    const { plugin, settings, saveSettings } = fixture();
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });

    const before = sha256OfFile(dataJson);

    // Every canvas-relevant key the gate actually cares about takes the branch
    // that used to persist. All of them, not one representative.
    host.setFlag("useCanvasBinding", true);
    host.setFlag("showCanvasPresence", false);
    host.setFlag("sharedFolder", "somewhere-else");
    host.setFlag("roomId", "another-room");
    host.setFlag("serverUrl", "ws://127.0.0.1:9999");

    expect(saveSettings).not.toHaveBeenCalled();
    expect(sha256OfFile(dataJson)).toBe(before);
    // ...and the in-memory effect DID happen, so the check above is not passing
    // because nothing occurred at all.
    expect(settings.useCanvasBinding).toBe(true);
    expect(settings.roomId).toBe("another-room");
  });

  it("FALSIFICATION: the same oracle reddens when persistence IS reached", () => {
    const { plugin, saveSettings } = fixture();
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });

    const before = sha256OfFile(dataJson);
    host.setFlag("roomId", "another-room");
    expect(sha256OfFile(dataJson)).toBe(before);

    // The exact call the old `setFlag` made, made explicitly. If the sha256 does
    // not move here, the assertion above is unfalsifiable and proves nothing —
    // a perturbation that changes nothing is a finding, not a null result.
    plugin.saveSettings?.();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(sha256OfFile(dataJson)).not.toBe(before);
  });

  it("an unknown name reaches no persistence either", () => {
    const { plugin, settings, saveSettings } = fixture();
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    const before = sha256OfFile(dataJson);
    host.setFlag("madeUpFlag", 1);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(sha256OfFile(dataJson)).toBe(before);
    expect("madeUpFlag" in settings).toBe(false);
  });

  it("the whole command path — router included — leaves the file byte-identical", async () => {
    const { plugin, saveSettings } = fixture();
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    const before = sha256OfFile(dataJson);
    for (const name of ["useCanvasBinding", "sharedFolder", "madeUpFlag", "clientId"]) {
      await routeCommand(host, { cmd: "canvas.setFlag", args: { name, value: "x" } });
    }
    await routeCommand(host, { cmd: "canvas.clearFlags" });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(sha256OfFile(dataJson)).toBe(before);
  });

  it("a caller that ASKS for persistence is refused at the boundary, by name", async () => {
    const { plugin, settings, saveSettings } = fixture();
    const setFlag = vi.fn(() => ({ set: true }));
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    const spied = { ...host, setFlag };

    const before = sha256OfFile(dataJson);
    const out = await routeCommand(spied, {
      cmd: "canvas.setFlag",
      args: { name: "roomId", value: "x", persist: true },
    });

    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false });
    expect((out.body as { error: string }).error).toContain("refused:");
    expect((out.body as { error: string }).error).toContain("persistence-requires-file-write");
    // I11 REFUSAL NEVER DESTROYS: the refusal reached neither the host nor the file.
    expect(setFlag).not.toHaveBeenCalled();
    expect(settings.roomId).toBe("canvas-v2-t3");
    expect(saveSettings).not.toHaveBeenCalled();
    expect(sha256OfFile(dataJson)).toBe(before);

    // `persist: false` is refused too — the behaviour is REMOVED, not gated, so
    // there is no value of the argument that turns persistence on or off.
    const off = await routeCommand(spied, {
      cmd: "canvas.setFlag",
      args: { name: "roomId", value: "x", persist: false },
    });
    expect(off.status).toBe(400);
  });

  it("STRUCTURAL: no saveSettings call remains anywhere in the control host", () => {
    let root = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12 && !existsSync(join(root, "src/testing/e2e-control.ts")); i++) {
      root = dirname(root);
    }
    const src = readFileSync(join(root, "src/testing/e2e-control.ts"), "utf8");
    // Strip block comments and line comments: the module documents the removed
    // call at length, and a prose mention must not satisfy or break this oracle.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect([...code.matchAll(/saveSettings\s*\?\.\s*\(/g)]).toHaveLength(0);
    expect([...code.matchAll(/\.saveSettings\s*\(/g)]).toHaveLength(0);
    // The interface field itself survives — the plugin still HAS the API; this
    // host simply never calls it.
    expect(code).toContain("saveSettings?");
  });
});
