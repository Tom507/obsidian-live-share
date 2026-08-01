// WP46 AC1 — added session.info identity fields, blind set 1.
//
// Angle: the instance is the *second* vault (path with spaces), the identity is
// read back through `parseAndRoute` (a raw JSON string, i.e. the actual wire
// path) rather than through the host object, and the field/type contract is
// asserted from a table.
import { describe, expect, it } from "vitest";

import {
  E2E_BUILD_MARKER,
  type E2EPluginLike,
  buildPluginHost,
  parseAndRoute,
} from "../../testing/e2e-control";

const VAULT_B_PATH = "H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie";

const FIELD_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["clientId", "string"],
  ["role", "string"],
  ["roomId", "string"],
  ["connected", "boolean"],
  ["vaultId", "string"],
  ["vaultName", "string"],
  ["vaultPath", "string"],
  ["pluginBuild", "string"],
  ["canvasSurface", "boolean"],
];

function vaultBInstance(): E2EPluginLike {
  return {
    settings: { clientId: "e2e-b", roomId: "canvas-v2-t3", role: "guest" },
    muxConnected: true,
    controlConnected: true,
    app: {
      appId: "8f2c19aa4b7e",
      vault: {
        getName: () => "ObsidianOrga - Kopie",
        adapter: { getBasePath: () => VAULT_B_PATH },
      },
    },
    manifest: { version: "0.9.7" },
    canvasSync: {
      subscribe: async () => {},
      isSubscribed: () => false,
      getCanvasSnapshot: () => null,
      getCanvasDocHandle: () => null,
    },
  } as E2EPluginLike;
}

async function wireInfo(plugin: E2EPluginLike): Promise<Record<string, unknown>> {
  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  const out = await parseAndRoute(host, JSON.stringify({ cmd: "session.info" }));
  expect(out.status).toBe(200);
  return (out.body as { ok: true; result: Record<string, unknown> }).result;
}

describe("WP46 AC1 (blind1) — identity over the wire", () => {
  it("returns every pinned field with the pinned type", async () => {
    const info = await wireInfo(vaultBInstance());
    for (const [field, type] of FIELD_TYPES) {
      expect(typeof info[field]).toBe(type);
    }
  });

  it("carries no field beyond the pinned nine", async () => {
    const info = await wireInfo(vaultBInstance());
    expect(Object.keys(info)).toHaveLength(FIELD_TYPES.length);
  });

  it("identifies the copy vault including the spaces in its name", async () => {
    const info = await wireInfo(vaultBInstance());
    expect(info.vaultId).toBe("8f2c19aa4b7e");
    expect(info.vaultName).toBe("ObsidianOrga - Kopie");
    expect(info.vaultPath).toBe(VAULT_B_PATH);
  });

  it("survives a JSON round trip unchanged", async () => {
    const info = await wireInfo(vaultBInstance());
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });

  it("marks the build as e2e-capable", async () => {
    const info = await wireInfo(vaultBInstance());
    expect(info.pluginBuild).toContain("0.9.7");
    expect(info.pluginBuild).toContain(E2E_BUILD_MARKER);
  });
});
