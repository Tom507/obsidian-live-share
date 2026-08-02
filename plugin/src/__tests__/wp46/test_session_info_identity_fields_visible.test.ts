// WP46 / C46 AC1 — `session.info` additionally reports the vault identity the
// instance serves, the plugin build identity and whether a canvas view surface
// is available.
//
// Field names are PINNED by T3_SharedContract §6.2 and appear here verbatim:
//   vaultId · vaultName · vaultPath · pluginBuild · canvasSurface
// The build marker is imported from the owning module (never re-declared).
//
// Staging: copy into `plugin/src/__tests__/wp46/` (one level deep → `../../`).
import { describe, expect, it } from "vitest";

import {
  E2E_BUILD_MARKER,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const LEGACY_FIELDS = ["clientId", "role", "roomId", "connected"] as const;
const ADDED_FIELDS = [
  "vaultId",
  "vaultName",
  "vaultPath",
  "pluginBuild",
  "canvasSurface",
] as const;

const VAULT_PATH_A = "H:\\Developement\\_NeuralAngels\\ObsidianOrga";

function canvasSyncStub() {
  return {
    subscribe: async () => {},
    isSubscribed: () => true,
    getCanvasSnapshot: () => ({ nodes: [], edges: [] }),
    getCanvasDocHandle: () => null,
  };
}

/** A fully initialised instance: vault known, build known, canvas surface up. */
function realisticPlugin(): E2EPluginLike {
  return {
    settings: { clientId: "e2e-a", roomId: "room-t3", role: "host" },
    muxConnected: true,
    controlConnected: true,
    app: {
      appId: "app-id-vault-a",
      vault: {
        getName: () => "ObsidianOrga",
        adapter: { getBasePath: () => VAULT_PATH_A },
      },
    },
    manifest: { version: "1.4.2" },
    canvasSync: canvasSyncStub(),
  } as E2EPluginLike;
}

function hostFor(plugin: E2EPluginLike) {
  const counters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return buildPluginHost(plugin, { counters, bump: () => {} });
}

describe("WP46 AC1 — session.info carries a positive instance identity", () => {
  it("reports exactly the four legacy fields plus the five pinned added fields", () => {
    const info = hostFor(realisticPlugin()).sessionInfo() as Record<string, unknown>;
    expect(Object.keys(info).sort()).toEqual(
      [...LEGACY_FIELDS, ...ADDED_FIELDS].slice().sort(),
    );
  });

  it("identifies which vault the instance serves", () => {
    const info = hostFor(realisticPlugin()).sessionInfo() as Record<string, unknown>;
    expect(info.vaultId).toBe("app-id-vault-a");
    expect(info.vaultId).not.toBe("");
    expect(info.vaultName).toBe("ObsidianOrga");
    expect(info.vaultPath).toBe(VAULT_PATH_A);
  });

  it("identifies which build is answering, marked as the e2e-capable build", () => {
    const info = hostFor(realisticPlugin()).sessionInfo() as Record<string, unknown>;
    expect(typeof info.pluginBuild).toBe("string");
    expect(info.pluginBuild as string).toContain("1.4.2");
    expect(info.pluginBuild as string).toContain(E2E_BUILD_MARKER);
  });

  it("reports canvas-surface availability as a boolean", () => {
    const info = hostFor(realisticPlugin()).sessionInfo() as Record<string, unknown>;
    expect(info.canvasSurface).toBe(true);
    expect(typeof info.canvasSurface).toBe("boolean");
  });

  it("declares the pinned types for every added field", () => {
    const info = hostFor(realisticPlugin()).sessionInfo() as Record<string, unknown>;
    expect(typeof info.vaultId).toBe("string");
    expect(typeof info.vaultName).toBe("string");
    expect(typeof info.vaultPath === "string" || info.vaultPath === null).toBe(true);
    expect(typeof info.pluginBuild).toBe("string");
    expect(typeof info.canvasSurface).toBe("boolean");
  });

  it("surfaces the identity through the control protocol unchanged", async () => {
    const host = hostFor(realisticPlugin());
    const out = await routeCommand(host, { cmd: "session.info" });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, result: host.sessionInfo() });
    const result = (out.body as { ok: true; result: Record<string, unknown> }).result;
    for (const key of ADDED_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
    }
  });
});
