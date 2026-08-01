// WP46 AC1 — the four pre-existing fields are unchanged, blind set 1.
//
// Angle: non-string settings values (number, boolean) and an explicitly null
// role, asserted against a golden legacy projection built before WP46 existed.
import { describe, expect, it } from "vitest";

import { type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function info(plugin: E2EPluginLike) {
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  }).sessionInfo() as unknown as Record<string, unknown>;
}

/** The pre-WP46 `sessionInfo` implementation, kept as the oracle. */
function preWp46(plugin: E2EPluginLike) {
  return {
    clientId: String(plugin.settings.clientId ?? ""),
    role: plugin.settings.role ?? null,
    roomId: String(plugin.settings.roomId ?? ""),
    connected: Boolean(plugin.muxConnected) && Boolean(plugin.controlConnected),
  };
}

const CASES: E2EPluginLike[] = [
  { settings: {} } as E2EPluginLike,
  { settings: { clientId: "e2e-a", roomId: "canvas-v2-t3", role: null } } as E2EPluginLike,
  {
    settings: { clientId: 42 as unknown as string, roomId: 7 as unknown as string, role: "host" },
    muxConnected: true,
    controlConnected: true,
  } as E2EPluginLike,
  {
    settings: { clientId: "e2e-b", roomId: "canvas-v2-t3", role: "guest" },
    muxConnected: true,
    controlConnected: false,
  } as E2EPluginLike,
];

describe("WP46 AC1 (blind1) — legacy fields match the pre-WP46 oracle", () => {
  it("agrees with the pre-WP46 projection on every case", () => {
    for (const plugin of CASES) {
      const actual = info(plugin);
      const expected = preWp46(plugin);
      expect({
        clientId: actual.clientId,
        role: actual.role,
        roomId: actual.roomId,
        connected: actual.connected,
      }).toEqual(expected);
    }
  });

  it("still string-coerces numeric ids", () => {
    const actual = info(CASES[2]);
    expect(actual.clientId).toBe("42");
    expect(actual.roomId).toBe("7");
  });

  it("keeps an explicit null role as null, not as the empty string", () => {
    expect(info(CASES[1]).role).toBeNull();
  });

  it("keeps connected false unless both transports are up", () => {
    expect(info(CASES[3]).connected).toBe(false);
  });

  it("does not let a rich identity change a legacy value", () => {
    const settings = { clientId: "e2e-a", roomId: "canvas-v2-t3", role: "host" };
    const plain = info({ settings: { ...settings } } as E2EPluginLike);
    const rich = info({
      settings: { ...settings },
      app: {
        appId: "8f2c19aa4b7e",
        vault: { getName: () => "ObsidianOrga", adapter: { getBasePath: () => "H:\\v" } },
      },
      manifest: { version: "0.9.7" },
      hasCanvasSurface: () => true,
    } as E2EPluginLike);
    expect(rich.clientId).toBe(plain.clientId);
    expect(rich.role).toBe(plain.role);
    expect(rich.roomId).toBe(plain.roomId);
    expect(rich.connected).toBe(plain.connected);
  });
});
