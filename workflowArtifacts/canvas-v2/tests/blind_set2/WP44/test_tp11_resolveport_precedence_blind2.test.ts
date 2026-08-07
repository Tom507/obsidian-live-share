// WP44 / AC4 (blind 2) — the precedence table, including the values that look
// like ports and are not.
//
// Angle: the earlier sets exercise well-formed flags. The rule that is actually
// frozen is narrower than "looks numeric": the env must match /^\d+$/, and the
// setting must be a positive number or a string of digits — nothing else. A
// padded string, a signed one, a float, a boolean or an empty env each fall
// through to the NEXT rule, and getting that wrong is invisible until a real run
// silently drives one vault twice.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rig = vi.hoisted(() => {
  const listens: number[] = [];
  const makeServer = () => {
    let bound: number | null = null;
    const server = {
      listen(port: number, _host: string, cb?: () => void) {
        bound = port === 0 ? 61234 : port;
        listens.push(port);
        cb?.();
        return server;
      },
      close() {},
      address() {
        return bound === null ? null : { port: bound, address: "127.0.0.1", family: "IPv4" };
      },
    };
    return server;
  };
  return { listens, makeServer, reset: () => void (listens.length = 0) };
});

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, default: actual, createServer: () => rig.makeServer() } as unknown as
    typeof actual;
});

import {
  type E2EPluginLike,
  maybeStartE2EControlServer,
} from "../../../testing/e2e-control";

const savedEnv = process.env.LIVESHARE_E2E;

beforeEach(() => {
  rig.reset();
  delete process.env.LIVESHARE_E2E;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.LIVESHARE_E2E;
  else process.env.LIVESHARE_E2E = savedEnv;
  vi.restoreAllMocks();
});

function plugin(setting?: unknown): E2EPluginLike {
  const settings: Record<string, unknown> = { clientId: "e2e-a", roomId: "r", role: "host" };
  if (setting !== undefined) settings.e2eControlPort = setting;
  return {
    settings: settings as E2EPluginLike["settings"],
    muxConnected: true,
    controlConnected: true,
    canvasSync: null,
  };
}

// [label, env value (undefined = unset), setting value (undefined = absent),
//  expected requested port | null for "no server"]
const TABLE: [string, string | undefined, unknown, number | null][] = [
  ["numeric env alone", "41000", undefined, 41000],
  ["numeric env over a setting", "41000", 41001, 41000],
  ["padded env falls through to the setting", " 41000 ", 41001, 41001],
  ["signed env falls through to the setting", "+41000", 41001, 41001],
  ["padded env with no setting is ephemeral", " 41000 ", undefined, 0],
  ["env '0' is a numeric env, meaning ephemeral", "0", undefined, 0],
  ["empty env is no env at all", "", 41002, 41002],
  ["empty env and no setting means no server", "", undefined, null],
  ["numeric-string setting", undefined, "41003", 41003],
  ["leading-zero string setting is still digits", undefined, "0041004", 41004],
  ["padded string setting is not a port", undefined, " 41005 ", null],
  ["suffixed string setting is not a port", undefined, "41006abc", null],
  ["float string setting is not a port", undefined, "41007.5", null],
  ["zero setting is not a port", undefined, 0, null],
  ["negative setting is not a port", undefined, -41008, null],
  ["boolean setting is not a port", undefined, true, null],
  ["null setting is not a port", undefined, null, null],
  ["object setting is not a port", undefined, { port: 41009 }, null],
];

describe("WP44 AC4 (blind 2) — the frozen precedence table", () => {
  it.each(TABLE)("%s", (_label, envValue, setting, expected) => {
    if (envValue === undefined) delete process.env.LIVESHARE_E2E;
    else process.env.LIVESHARE_E2E = envValue;

    maybeStartE2EControlServer(plugin(setting));

    if (expected === null) expect(rig.listens).toEqual([]);
    else expect(rig.listens).toEqual([expected]);
  });

  it("the table really does cover all four precedence rules", () => {
    const outcomes = TABLE.map(([, , , expected]) => expected);
    expect(outcomes).toContain(null); // rule 4 — no server
    expect(outcomes).toContain(0); // rule 3 — ephemeral
    expect(outcomes.filter((o) => typeof o === "number" && o > 0).length).toBeGreaterThan(3);
  });

  it("changing the env between two starts changes only the later one", () => {
    process.env.LIVESHARE_E2E = "42000";
    maybeStartE2EControlServer(plugin(42001));
    delete process.env.LIVESHARE_E2E;
    maybeStartE2EControlServer(plugin(42001));

    expect(rig.listens).toEqual([42000, 42001]);
  });
});
