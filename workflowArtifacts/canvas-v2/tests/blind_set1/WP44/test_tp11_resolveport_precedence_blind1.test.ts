// WP44 / AC4 (blind 1) — precedence read off the bind request itself.
//
// Angle: the visible set proves precedence with live sockets and a session.info
// round trip. Here `node:http` is replaced by a fake server, so nothing is ever
// bound and the oracle is the exact argument list handed to `listen()`. That
// makes two things observable that a socket cannot show: the ephemeral case
// (port 0, before the OS assigns anything) and the fact that the bind host is
// always 127.0.0.1.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rig = vi.hoisted(() => {
  const listens: { port: number; host: string }[] = [];
  let created = 0;
  const makeServer = () => {
    let bound: number | null = null;
    const server = {
      listen(port: number, host: string, cb?: () => void) {
        bound = port === 0 ? 54321 : port;
        listens.push({ port, host });
        cb?.();
        return server;
      },
      close() {
        /* no socket to close */
      },
      address() {
        return bound === null ? null : { port: bound, address: "127.0.0.1", family: "IPv4" };
      },
    };
    created += 1;
    return server;
  };
  return {
    listens,
    makeServer,
    count: () => created,
    reset: () => {
      listens.length = 0;
      created = 0;
    },
  };
});

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    default: actual,
    createServer: () => rig.makeServer(),
  } as unknown as typeof actual;
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

function plugin(extra: Record<string, unknown> = {}): E2EPluginLike {
  return {
    settings: { clientId: "e2e-b", roomId: "r", role: "guest", ...extra } as
      E2EPluginLike["settings"],
    muxConnected: true,
    controlConnected: true,
    canvasSync: null,
  };
}

describe("WP44 AC4 (blind 1) — which port is requested from listen()", () => {
  it("order 1: a numeric env is bound verbatim, on loopback", () => {
    process.env.LIVESHARE_E2E = "40100";

    maybeStartE2EControlServer(plugin({ e2eControlPort: 40200 }));

    expect(rig.count()).toBe(1);
    expect(rig.listens).toEqual([{ port: 40100, host: "127.0.0.1" }]);
  });

  it("order 2: the setting is bound when the env is absent", () => {
    maybeStartE2EControlServer(plugin({ e2eControlPort: 40200 }));
    maybeStartE2EControlServer(plugin({ e2eControlPort: "40201" }));

    expect(rig.listens.map((l) => l.port)).toEqual([40200, 40201]);
    expect(rig.listens.every((l) => l.host === "127.0.0.1")).toBe(true);
  });

  it("order 3: a truthy non-numeric env with no setting asks for port 0", () => {
    process.env.LIVESHARE_E2E = "please";

    maybeStartE2EControlServer(plugin());

    expect(rig.listens).toEqual([{ port: 0, host: "127.0.0.1" }]);
  });

  it("order 3 never outranks order 2", () => {
    process.env.LIVESHARE_E2E = "please";

    maybeStartE2EControlServer(plugin({ e2eControlPort: 40300 }));

    expect(rig.listens).toEqual([{ port: 40300, host: "127.0.0.1" }]);
    expect(rig.listens.map((l) => l.port)).not.toContain(0);
  });

  it("order 4: nothing at all is requested when neither flag is set", () => {
    maybeStartE2EControlServer(plugin());

    expect(rig.count()).toBe(0);
    expect(rig.listens).toEqual([]);
  });

  it("two instances in one process ask for two different ports", () => {
    // The whole point of D14, expressed at the only layer that can show it.
    maybeStartE2EControlServer(plugin({ e2eControlPort: 40401 }));
    maybeStartE2EControlServer(plugin({ e2eControlPort: 40402 }));

    expect(rig.listens.map((l) => l.port)).toEqual([40401, 40402]);
    expect(new Set(rig.listens.map((l) => l.port)).size).toBe(2);
  });
});
