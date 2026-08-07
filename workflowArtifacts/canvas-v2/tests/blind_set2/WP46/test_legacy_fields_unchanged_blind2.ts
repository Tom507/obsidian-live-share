// WP46 AC1 — the four pre-existing fields are unchanged, blind set 2.
//
// Angle: the legacy projection is compared across a matrix of identity-source
// configurations. Whatever the identity does, the legacy quartet is a pure
// function of `settings` + the two transport booleans, exactly as before.
import { describe, expect, it } from "vitest";

import { type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

const SETTINGS = { clientId: "e2e-a", roomId: "raum-üben-42", role: "host" } as const;

const IDENTITY_SOURCES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["none", {}],
  ["appId only", { app: { appId: "0f9d3c11" } }],
  [
    "full app",
    {
      app: {
        appId: "0f9d3c11",
        vault: { getName: () => "Wissen Örga", adapter: { getBasePath: () => "H:\\v" } },
      },
    },
  ],
  ["manifest only", { manifest: { version: "2.0.0-beta.3" } }],
  ["canvas surface hook", { hasCanvasSurface: () => true }],
];

function legacy(extra: Record<string, unknown>) {
  const plugin = {
    settings: { ...SETTINGS },
    muxConnected: true,
    controlConnected: true,
    ...extra,
  } as E2EPluginLike;
  const info = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  }).sessionInfo();
  return {
    clientId: info.clientId,
    role: info.role,
    roomId: info.roomId,
    connected: info.connected,
  };
}

describe("WP46 AC1 (blind2) — legacy quartet is invariant under identity sources", () => {
  it("produces the same four values for every identity configuration", () => {
    const expected = {
      clientId: "e2e-a",
      role: "host",
      roomId: "raum-üben-42",
      connected: true,
    };
    for (const [label, extra] of IDENTITY_SOURCES) {
      expect(legacy(extra), label).toEqual(expected);
    }
  });

  it("keeps role null-by-default rather than adopting an identity default", () => {
    const info = buildPluginHost(
      { settings: {}, app: { appId: "0f9d3c11" } } as E2EPluginLike,
      {
        counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
        bump: () => {},
      },
    ).sessionInfo();
    expect(info.role).toBeNull();
    expect(info.clientId).toBe("");
    expect(info.roomId).toBe("");
  });

  it("keeps connected independent of canvas-surface availability", () => {
    const noSurface = buildPluginHost(
      {
        settings: { ...SETTINGS },
        muxConnected: true,
        controlConnected: true,
        hasCanvasSurface: () => false,
      } as E2EPluginLike,
      {
        counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
        bump: () => {},
      },
    ).sessionInfo();
    expect(noSurface.connected).toBe(true);
  });

  it("keeps the legacy field types unchanged", () => {
    const info = legacy({});
    expect(typeof info.clientId).toBe("string");
    expect(typeof info.roomId).toBe("string");
    expect(typeof info.connected).toBe("boolean");
    expect(typeof info.role === "string" || info.role === null).toBe(true);
  });
});
