// WP51 AC3 — blind set 1 (rejection at the boundary).
//
// Angle: names that are dangerous rather than merely wrong. `__proto__`,
// `constructor` and `toString` are inherited members of every object, so an
// acceptance rule written as `name in settings` (instead of
// `Object.prototype.hasOwnProperty.call(settings, name)`) accepts all three and
// then writes through the prototype chain. The visible test uses plausible
// typos; this one uses the names that turn a lax rule into a corrupted plugin.
import { describe, expect, it } from "vitest";

import {
  STALE_VIEW_FLAG,
  type E2EPluginLike,
  buildPluginHost,
  isKnownRuntimeFlag,
  routeCommand,
} from "../../testing/e2e-control";

const INHERITED = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];
const SHAPED_LIKE_A_FLAG = [
  "canvas.staleView.mode",
  "canvas.staleview",
  "CANVAS.STALEVIEW",
  " canvas.staleView",
  "canvas.staleView​", // zero-width space
  "canvas.simulateEdit", // a real COMMAND name, not a flag
  "scratch.create",
];

function hostFor(settings: Record<string, unknown>) {
  const plugin = {
    settings,
    muxConnected: true,
    controlConnected: true,
    canvasSync: null,
    saveSettings: () => {},
  } as unknown as E2EPluginLike;
  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  return { host, plugin };
}

const base = () => ({ clientId: "b1", roomId: "canvas-v2-t3", role: "host", debug: false });

describe("WP51 AC3 (blind1) — inherited and look-alike names are refused", () => {
  it.each(INHERITED)("`%s` is refused and nothing is written through it", async (name) => {
    const { host, plugin } = hostFor(base());
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name, value: "polluted" },
    });
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
    expect(isKnownRuntimeFlag(name)).toBe(false);
    // Nothing reached the object, and nothing reached the prototype.
    expect(Object.getPrototypeOf(plugin.settings)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(plugin.settings)).toBe(JSON.stringify(base()));
  });

  it.each(SHAPED_LIKE_A_FLAG)("`%j` is not the real flag and is refused", async (name) => {
    const { host } = hostFor(base());
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name, value: "delayed" },
    });
    expect(out.status).toBe(400);
    expect(isKnownRuntimeFlag(name)).toBe(false);
  });

  it("the exact registered name is the only spelling that works", async () => {
    const { host } = hostFor(base());
    expect(isKnownRuntimeFlag(STALE_VIEW_FLAG)).toBe(true);
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: STALE_VIEW_FLAG, value: "live" },
    });
    expect(out.status).toBe(200);
  });

  it("an OWN settings key holding `undefined` is still a real key", async () => {
    // `hasOwnProperty` is the right question; `settings[name] !== undefined` is not.
    const settings = { ...base(), sharedFolder: undefined };
    const { host, plugin } = hostFor(settings);
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: "sharedFolder", value: "_e2e-rig" },
    });
    expect(out.status).toBe(200);
    expect((plugin.settings as Record<string, unknown>).sharedFolder).toBe("_e2e-rig");
  });

  it("a key that is NOT own, only inherited, is refused", async () => {
    const settings = Object.create({ inheritedOnly: true }) as Record<string, unknown>;
    Object.assign(settings, base());
    const { host } = hostFor(settings);
    const out = await routeCommand(host, {
      cmd: "canvas.setFlag",
      args: { name: "inheritedOnly", value: false },
    });
    expect(out.status).toBe(400);
    expect(settings.inheritedOnly).toBe(true);
  });

  it("a refusal never throws out of the router (US4 AC5)", async () => {
    const { host } = hostFor(base());
    for (const name of [...INHERITED, ...SHAPED_LIKE_A_FLAG]) {
      const out = await routeCommand(host, { cmd: "canvas.setFlag", args: { name } });
      expect(out.body).toHaveProperty("ok", false);
      expect(typeof out.status).toBe("number");
    }
  });
});
