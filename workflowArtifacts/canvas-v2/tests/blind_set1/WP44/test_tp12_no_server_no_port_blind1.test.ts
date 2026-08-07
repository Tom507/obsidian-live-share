// WP44 / AC4 (blind 1) — an unprovisioned vault leaves the machine untouched.
//
// Angle: the visible set proves "no server" by counting createServer calls with
// a module mock. Here nothing is mocked: real ports are reserved, decoy settings
// keys are planted with those port numbers in them, and every one of them is
// probed afterwards. A control server that reads the wrong key — `controlPort`,
// `port`, `e2ePort`, a nested `e2e.controlPort` — would answer on one of them.

import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type E2EPluginLike,
  maybeStartE2EControlServer,
} from "../../../testing/e2e-control";

const PROBE_TIMEOUT_MS = 4000; // failure guard only
const savedEnv = process.env.LIVESHARE_E2E;
const openHandles: { close(): void }[] = [];

afterEach(() => {
  while (openHandles.length > 0) openHandles.pop()?.close();
  if (savedEnv === undefined) delete process.env.LIVESHARE_E2E;
  else process.env.LIVESHARE_E2E = savedEnv;
  vi.restoreAllMocks();
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function isRefused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    sock.setTimeout(PROBE_TIMEOUT_MS, () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("connect", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => resolve(true));
  });
}

function plugin(settings: Record<string, unknown>): E2EPluginLike {
  return {
    settings: settings as E2EPluginLike["settings"],
    muxConnected: false,
    controlConnected: false,
    canvasSync: null,
  };
}

describe("WP44 AC4 (blind 1) — nothing listens for an unprovisioned vault", () => {
  it("no decoy settings key is mistaken for the provisioned port", async () => {
    delete process.env.LIVESHARE_E2E;
    const decoys = {
      controlPort: await freePort(),
      port: await freePort(),
      e2ePort: await freePort(),
      E2EControlPort: await freePort(),
      e2econtrolport: await freePort(),
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    openHandles.push(
      maybeStartE2EControlServer(
        plugin({ clientId: "e2e-a", roomId: "r", role: "host", ...decoys }),
      ),
    );

    for (const [key, port] of Object.entries(decoys)) {
      expect(await isRefused(port), `something answered on the '${key}' port`).toBe(true);
    }
    expect(
      logSpy.mock.calls.some((call) => String(call[0] ?? "").includes("listening")),
    ).toBe(false);
  });

  it("an empty env flag does not enable an ephemeral server", async () => {
    process.env.LIVESHARE_E2E = "";
    const unused = await freePort();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    openHandles.push(maybeStartE2EControlServer(plugin({ clientId: "c", roomId: "r" })));

    expect(await isRefused(unused)).toBe(true);
    expect(
      logSpy.mock.calls.some((call) => String(call[0] ?? "").includes("listening")),
    ).toBe(false);
  });

  it("the no-op handle can be closed repeatedly without side effects", async () => {
    delete process.env.LIVESHARE_E2E;
    const handle = maybeStartE2EControlServer(plugin({ clientId: "c", roomId: "r" }));

    expect(() => {
      handle.close();
      handle.close();
      handle.close();
    }).not.toThrow();
  });

  it("a provisioned vault does start one — the negative tests are not vacuous", async () => {
    delete process.env.LIVESHARE_E2E;
    const port = await freePort();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    openHandles.push(
      maybeStartE2EControlServer(
        plugin({ clientId: "e2e-a", roomId: "r", role: "host", e2eControlPort: port }),
      ),
    );

    // wait for the bind the module itself reports, then prove it is really there
    await vi.waitFor(() =>
      expect(
        logSpy.mock.calls.some((call) => String(call[0] ?? "").includes(`127.0.0.1:${port}`)),
      ).toBe(true),
    );
    expect(await isRefused(port)).toBe(false);
  });

  it("every module e2e-control.ts imports already exists in the checkout", () => {
    // AC4's "gains no new dependency", checked by resolution rather than by an
    // allow-list: a relative import must point at a file that is really there,
    // and a bare one must be a node builtin or a package the plugin already has.
    let dir = dirname(fileURLToPath(import.meta.url));
    while (!existsSync(join(dir, "src", "testing", "e2e-control.ts"))) {
      const parent = dirname(dir);
      expect(parent, "walked past the filesystem root").not.toBe(dir);
      dir = parent;
    }
    const sourcePath = join(dir, "src", "testing", "e2e-control.ts");
    const source = readFileSync(sourcePath, "utf8");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const declared = new Set(Object.keys(pkg.dependencies ?? {}));

    const found = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(found.length).toBeGreaterThan(0);

    for (const spec of found) {
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) {
        const base = resolve(dirname(sourcePath), spec);
        const exists = [".ts", ".tsx", "/index.ts", ".js"].some((ext) =>
          existsSync(`${base}${ext}`),
        );
        expect(exists, `relative import '${spec}' resolves to nothing`).toBe(true);
        continue;
      }
      expect(declared, `'${spec}' is not a declared plugin dependency`).toContain(spec);
    }
  });
});
