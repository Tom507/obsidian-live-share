// WP46 AC1 — added session.info identity fields, blind set 2.
//
// Angle: one golden object comparison for the whole payload (so a renamed,
// dropped or extra field all fail the same way), with a unicode vault name and
// an instance that is connected on one transport only.
import { describe, expect, it } from "vitest";

import {
  E2E_BUILD_MARKER,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const VAULT_ID = "0f9d3c11-2b7e-4a05-9c31-6d8e2f4a1b00";
const VAULT_NAME = "Wissen Örga";
const VAULT_PATH = "H:\\Developement\\_NeuralAngels\\Wissen Örga";

function instance(): E2EPluginLike {
  return {
    settings: { clientId: "e2e-a", roomId: "raum-üben-42", role: "host" },
    muxConnected: true,
    controlConnected: false,
    app: {
      appId: VAULT_ID,
      vault: { getName: () => VAULT_NAME, adapter: { getBasePath: () => VAULT_PATH } },
    },
    manifest: { version: "2.0.0-beta.3" },
    hasCanvasSurface: () => true,
  } as E2EPluginLike;
}

function info() {
  return buildPluginHost(instance(), {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  }).sessionInfo() as unknown as Record<string, unknown>;
}

describe("WP46 AC1 (blind2) — the whole session.info payload is pinned", () => {
  it("matches the golden payload exactly", () => {
    expect(info()).toEqual({
      clientId: "e2e-a",
      role: "host",
      roomId: "raum-üben-42",
      connected: false,
      vaultId: VAULT_ID,
      vaultName: VAULT_NAME,
      vaultPath: VAULT_PATH,
      pluginBuild: `2.0.0-beta.3+${E2E_BUILD_MARKER}`,
      canvasSurface: true,
    });
  });

  it("uses none of the plausible alternative field spellings", () => {
    const keys = Object.keys(info());
    for (const wrong of ["vault", "vault_id", "vaultID", "build", "plugin_build", "canvas"]) {
      expect(keys).not.toContain(wrong);
    }
  });

  it("keeps a unicode vault name intact through the router", async () => {
    const host = buildPluginHost(instance(), {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });
    const out = await routeCommand(host, { cmd: "session.info" });
    const result = (out.body as { ok: true; result: Record<string, unknown> }).result;
    expect(result.vaultName).toBe(VAULT_NAME);
    expect(String(result.vaultPath)).toContain("Örga");
  });

  it("reports an identity even while the instance is not fully connected", () => {
    const payload = info();
    expect(payload.connected).toBe(false);
    expect(payload.vaultId).toBe(VAULT_ID);
  });
});
