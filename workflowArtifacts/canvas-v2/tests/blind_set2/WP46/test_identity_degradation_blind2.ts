// WP46 AC1 (feeding AC3) — degraded identity, blind set 2.
//
// Angle: the identity sources exist but return junk — `undefined` from a getter,
// a non-string base path, `canvasSync` left `undefined` rather than `null`. The
// answer must stay well typed so the Python side can refuse it by value rather
// than by exception.
import { describe, expect, it } from "vitest";

import { type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function info(plugin: E2EPluginLike) {
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  }).sessionInfo() as unknown as Record<string, unknown>;
}

describe("WP46 AC1 (blind2) — junk identity sources still yield a typed answer", () => {
  it("treats a getter returning undefined as 'not known'", () => {
    const payload = info({
      settings: {},
      app: {
        appId: undefined,
        vault: {
          getName: () => undefined as unknown as string,
          adapter: { getBasePath: () => undefined as unknown as string },
        },
      },
    } as E2EPluginLike);
    expect(payload.vaultId).toBe("");
    expect(payload.vaultName).toBe("");
    expect(payload.vaultPath).toBeNull();
  });

  it("keeps vaultName a string even when the vault reports a non-string name", () => {
    const payload = info({
      settings: {},
      app: { appId: "0f9d3c11", vault: { getName: () => 7 as unknown as string } },
    } as E2EPluginLike);
    expect(typeof payload.vaultName).toBe("string");
  });

  it("keeps vaultPath null when the adapter returns a non-string", () => {
    const payload = info({
      settings: {},
      app: {
        appId: "0f9d3c11",
        vault: { getName: () => "V", adapter: { getBasePath: () => 0 as unknown as string } },
      },
    } as E2EPluginLike);
    expect(payload.vaultPath).toBeNull();
  });

  it("treats an undefined canvasSync exactly like a null one", () => {
    const undefinedSync = info({ settings: {} } as E2EPluginLike);
    const nullSync = info({ settings: {}, canvasSync: null } as E2EPluginLike);
    expect(undefinedSync.canvasSurface).toBe(nullSync.canvasSurface);
    expect(undefinedSync.canvasSurface).toBe(false);
  });

  it("keeps pluginBuild a non-empty string with no manifest at all", () => {
    const payload = info({ settings: {} } as E2EPluginLike);
    expect(typeof payload.pluginBuild).toBe("string");
    expect((payload.pluginBuild as string).length).toBeGreaterThan(0);
  });

  it("still answers with all nine fields, never a partial object", () => {
    const payload = info({ settings: {}, app: { vault: {} } } as E2EPluginLike);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "canvasSurface",
        "clientId",
        "connected",
        "pluginBuild",
        "role",
        "roomId",
        "vaultId",
        "vaultName",
        "vaultPath",
      ],
    );
  });
});
