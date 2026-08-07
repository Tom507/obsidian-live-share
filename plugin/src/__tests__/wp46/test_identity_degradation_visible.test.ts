// WP46 / C46 AC1 (+ feeds AC3) — a partially initialised instance must still
// ANSWER, and must answer honestly: an unknown vault is reported as an empty
// identity and an unavailable path as `null`, never as a guess and never as a
// throw. This is what makes the Python-side "partially initialised is not
// ready" refusal possible (AC3).
//
// Staging: copy into `plugin/src/__tests__/wp46/` (one level deep → `../../`).
import { describe, expect, it } from "vitest";

import { type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function hostFor(plugin: E2EPluginLike) {
  const counters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return buildPluginHost(plugin, { counters, bump: () => {} });
}

function canvasSyncStub() {
  return {
    subscribe: async () => {},
    isSubscribed: () => true,
    getCanvasSnapshot: () => ({ nodes: [], edges: [] }),
    getCanvasDocHandle: () => null,
  };
}

describe("WP46 AC1 — identity degrades, it never throws and never guesses", () => {
  it("answers with an empty identity when nothing is initialised", () => {
    const info = hostFor({ settings: {} } as E2EPluginLike).sessionInfo() as Record<
      string,
      unknown
    >;
    expect(info.vaultId).toBe("");
    expect(info.vaultName).toBe("");
    expect(info.vaultPath).toBeNull();
    expect(info.canvasSurface).toBe(false);
    expect(typeof info.pluginBuild).toBe("string");
  });

  it("never throws while building the identity from a hostile plugin object", () => {
    const hostile = {
      settings: {},
      app: { vault: {} },
      manifest: {},
    } as E2EPluginLike;
    expect(() => hostFor(hostile).sessionInfo()).not.toThrow();
  });

  it("reports vaultPath as null (never '') when the adapter exposes no base path", () => {
    const noGetter = hostFor({
      settings: {},
      app: { appId: "a", vault: { getName: () => "V", adapter: {} } },
    } as E2EPluginLike).sessionInfo() as Record<string, unknown>;
    expect(noGetter.vaultPath).toBeNull();

    const emptyPath = hostFor({
      settings: {},
      app: {
        appId: "a",
        vault: { getName: () => "V", adapter: { getBasePath: () => "" } },
      },
    } as E2EPluginLike).sessionInfo() as Record<string, unknown>;
    expect(emptyPath.vaultPath).toBeNull();
  });

  it("falls back from appId to the absolute vault path as the stable vaultId", () => {
    const info = hostFor({
      settings: {},
      app: {
        vault: {
          getName: () => "LiveShare-E2E-B",
          adapter: {
            getBasePath: () => "C:\\ObsidianVaults\\LiveShare-E2E-B",
          },
        },
      },
    } as E2EPluginLike).sessionInfo() as Record<string, unknown>;
    expect(info.vaultId).toBe("C:\\ObsidianVaults\\LiveShare-E2E-B");
    expect(info.vaultName).toBe("LiveShare-E2E-B");
  });

  it("derives canvasSurface from the plugin surface, with the explicit hook winning", () => {
    const noSurface = hostFor({ settings: {}, canvasSync: null } as E2EPluginLike).sessionInfo();
    expect((noSurface as unknown as Record<string, unknown>).canvasSurface).toBe(false);

    const implicitSurface = hostFor({
      settings: {},
      canvasSync: canvasSyncStub(),
    } as E2EPluginLike).sessionInfo();
    expect((implicitSurface as unknown as Record<string, unknown>).canvasSurface).toBe(true);

    const hookSaysNo = hostFor({
      settings: {},
      canvasSync: canvasSyncStub(),
      hasCanvasSurface: () => false,
    } as E2EPluginLike).sessionInfo();
    expect((hookSaysNo as unknown as Record<string, unknown>).canvasSurface).toBe(false);

    const hookSaysYes = hostFor({
      settings: {},
      canvasSync: null,
      hasCanvasSurface: () => true,
    } as E2EPluginLike).sessionInfo();
    expect((hookSaysYes as unknown as Record<string, unknown>).canvasSurface).toBe(true);
  });
});
