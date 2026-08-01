// WP46 AC1 (feeding AC3) — degraded identity, blind set 1.
//
// Angle: the app object exists but is progressively hollowed out, one level at a
// time. Every stage must answer, never throw, and never fill a gap with a guess.
import { describe, expect, it } from "vitest";

import { type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function info(plugin: E2EPluginLike) {
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  }).sessionInfo() as unknown as Record<string, unknown>;
}

const STAGES: ReadonlyArray<readonly [string, E2EPluginLike]> = [
  ["no app at all", { settings: {} } as E2EPluginLike],
  ["empty app", { settings: {}, app: {} } as E2EPluginLike],
  ["app without vault", { settings: {}, app: { appId: "" } } as E2EPluginLike],
  ["vault without adapter", { settings: {}, app: { vault: { getName: () => "" } } } as E2EPluginLike],
  [
    "adapter without base path",
    { settings: {}, app: { vault: { getName: () => "V", adapter: {} } } } as E2EPluginLike,
  ],
];

describe("WP46 AC1 (blind1) — a hollow instance answers honestly", () => {
  it("never throws at any hollowing stage", () => {
    for (const [label, plugin] of STAGES) {
      expect(() => info(plugin), label).not.toThrow();
    }
  });

  it("reports vaultPath as null at every stage that has no path", () => {
    for (const [label, plugin] of STAGES) {
      expect(info(plugin).vaultPath, label).toBeNull();
    }
  });

  it("never invents a vault id it cannot prove", () => {
    for (const [label, plugin] of STAGES) {
      expect(info(plugin).vaultId, label).toBe("");
    }
  });

  it("still answers with all nine fields while degraded", () => {
    for (const [label, plugin] of STAGES) {
      expect(Object.keys(info(plugin)).length, label).toBe(9);
    }
  });

  it("reports canvasSurface false while no canvas surface exists", () => {
    for (const [label, plugin] of STAGES) {
      expect(info(plugin).canvasSurface, label).toBe(false);
    }
  });

  it("recovers a full identity as soon as the sources appear", () => {
    const restored = info({
      settings: {},
      app: {
        appId: "8f2c19aa4b7e",
        vault: {
          getName: () => "ObsidianOrga",
          adapter: { getBasePath: () => "H:\\Developement\\_NeuralAngels\\ObsidianOrga" },
        },
      },
      hasCanvasSurface: () => true,
    } as E2EPluginLike);
    expect(restored.vaultId).toBe("8f2c19aa4b7e");
    expect(restored.vaultPath).toBe("H:\\Developement\\_NeuralAngels\\ObsidianOrga");
    expect(restored.canvasSurface).toBe(true);
  });
});
