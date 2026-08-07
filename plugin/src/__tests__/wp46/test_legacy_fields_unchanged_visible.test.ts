// WP46 / C46 AC1 — "the added fields change nothing": the four pre-existing
// `session.info` fields (T3_SharedContract §6.2) keep their NAMES and their
// SEMANTICS. This is the regression half of AC1; the bundle-level tree-shake
// guard is INTEGRATION_SCOPE and lives in charter section 7b.
//
// Staging: copy into `plugin/src/__tests__/wp46/` (one level deep → `../../`).
import { describe, expect, it } from "vitest";

import { type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function hostFor(plugin: E2EPluginLike) {
  const counters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return buildPluginHost(plugin, { counters, bump: () => {} });
}

function legacyOnly(info: Record<string, unknown>) {
  return {
    clientId: info.clientId,
    role: info.role,
    roomId: info.roomId,
    connected: info.connected,
  };
}

describe("WP46 AC1 — the four pre-existing session.info fields are untouched", () => {
  it("keeps clientId / role / roomId / connected as top-level keys", () => {
    const info = hostFor({ settings: {} } as E2EPluginLike).sessionInfo() as Record<
      string,
      unknown
    >;
    for (const key of ["clientId", "role", "roomId", "connected"]) {
      expect(Object.prototype.hasOwnProperty.call(info, key)).toBe(true);
    }
  });

  it("keeps the pre-WP46 defaults: clientId '' , role null, roomId '' , connected false", () => {
    const info = hostFor({ settings: {} } as E2EPluginLike).sessionInfo();
    expect(legacyOnly(info as unknown as Record<string, unknown>)).toEqual({
      clientId: "",
      role: null,
      roomId: "",
      connected: false,
    });
  });

  it("keeps clientId / roomId string-coerced and role passed through verbatim", () => {
    const info = hostFor({
      settings: { clientId: "e2e-b", roomId: "room-t3", role: "guest" },
    } as E2EPluginLike).sessionInfo();
    expect(info.clientId).toBe("e2e-b");
    expect(info.roomId).toBe("room-t3");
    expect(info.role).toBe("guest");
  });

  it("keeps `connected` as the conjunction of muxConnected and controlConnected", () => {
    const combos: Array<[boolean, boolean, boolean]> = [
      [false, false, false],
      [true, false, false],
      [false, true, false],
      [true, true, true],
    ];
    for (const [mux, control, expected] of combos) {
      const info = hostFor({
        settings: {},
        muxConnected: mux,
        controlConnected: control,
      } as E2EPluginLike).sessionInfo();
      expect(info.connected).toBe(expected);
    }
  });

  it("produces identical legacy values with and without the new identity sources", () => {
    const settings = { clientId: "e2e-a", roomId: "room-t3", role: "host" };
    const withoutIdentity = hostFor({
      settings: { ...settings },
      muxConnected: true,
      controlConnected: true,
    } as E2EPluginLike).sessionInfo();
    const withIdentity = hostFor({
      settings: { ...settings },
      muxConnected: true,
      controlConnected: true,
      app: {
        appId: "app-id-vault-a",
        vault: {
          getName: () => "ObsidianOrga",
          adapter: { getBasePath: () => "H:\\Developement\\_NeuralAngels\\ObsidianOrga" },
        },
      },
      manifest: { version: "1.4.2" },
    } as E2EPluginLike).sessionInfo();

    expect(legacyOnly(withIdentity as unknown as Record<string, unknown>)).toEqual(
      legacyOnly(withoutIdentity as unknown as Record<string, unknown>),
    );
  });
});
