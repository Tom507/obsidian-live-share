// WP44 / AC4 — a vault with no provisioned port starts NO control server at all,
// and `resolvePort` gains no new dependency.
//
// "No server" has to mean no socket was ever created, not "a server that nobody
// happens to talk to". The decisive, synchronous oracle is therefore whether
// `node:http.createServer` was called at all: the module calls it exactly once
// per started server, before any listen happens.
//
//   ├── T1 no env flag and no setting → createServer is never called.
//   ├── T2 every non-port setting value (0, "", "abc", -1, null, true, absent)
//   │      leaves the server unstarted.
//   ├── T3 the returned handle's close() is safe, and safe twice.
//   └── T4 no new dependency: every bare import specifier in e2e-control.ts is a
//          node: builtin or a package already in plugin/package.json.
//
// Data safety: no socket is bound, no vault is read.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, default: actual, createServer: vi.fn(actual.createServer) };
});

import * as http from "node:http";

import {
  type E2EPluginLike,
  maybeStartE2EControlServer,
} from "../../../testing/e2e-control";

const createServerMock = http.createServer as unknown as ReturnType<typeof vi.fn>;
const savedEnv = process.env.LIVESHARE_E2E;

beforeEach(() => {
  delete process.env.LIVESHARE_E2E;
  createServerMock.mockClear();
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.LIVESHARE_E2E;
  else process.env.LIVESHARE_E2E = savedEnv;
});

function fakePlugin(extra: Record<string, unknown> = {}): E2EPluginLike {
  return {
    settings: {
      clientId: "e2e-b",
      roomId: "fixture-room",
      role: "guest",
      ...extra,
    } as E2EPluginLike["settings"],
    muxConnected: false,
    controlConnected: false,
    canvasSync: null,
  };
}

/** Walk up from this file to the plugin package root (holds package.json + src/). */
function pluginRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === "live-share") return dir;
    } catch {
      /* keep walking */
    }
    dir = dirname(dir);
  }
  throw new Error("could not locate the plugin package root");
}

describe("WP44 AC4 — no provisioned port means no control server", () => {
  it("starts nothing when neither the env flag nor the setting is present", () => {
    const handle = maybeStartE2EControlServer(fakePlugin());

    expect(createServerMock).not.toHaveBeenCalled();
    expect(typeof handle.close).toBe("function");
  });

  it.each([
    ["zero", 0],
    ["empty string", ""],
    ["non-numeric string", "abc"],
    ["negative", -1],
    ["null", null],
    ["boolean true", true],
    ["float-ish string", "12.5"],
  ])("starts nothing for e2eControlPort = %s", (_label, value) => {
    maybeStartE2EControlServer(fakePlugin({ e2eControlPort: value }));

    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("the returned handle is safe to close, twice, when nothing was started", () => {
    const handle = maybeStartE2EControlServer(fakePlugin());

    expect(() => {
      handle.close();
      handle.close();
    }).not.toThrow();
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("e2e-control.ts introduces no dependency outside package.json + node builtins", () => {
    const root = pluginRoot();
    const source = readFileSync(join(root, "src", "testing", "e2e-control.ts"), "utf8");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const known = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);

    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);

    for (const spec of specifiers) {
      if (spec.startsWith(".") || spec.startsWith("node:")) continue;
      const pkgName = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0];
      expect(known, `unknown dependency '${spec}' imported by e2e-control.ts`).toContain(
        pkgName,
      );
    }
  });
});
