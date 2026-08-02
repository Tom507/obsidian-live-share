// WP44 / AC4 (blind 2) — "gains no new dependency", taken literally.
//
// Angle: the visible set checks that every imported package is already declared.
// The claim WP44 actually makes is that the module acquires no new *runtime*
// dependency: one runtime package (`yjs`), the sanctioned node builtins
// (`node:http` for the control server, `node:crypto` for the `canvas.file`
// sha256 that T3_SharedContract §6.1 mandates), and relative imports inside the
// plugin. Anything else — a settings reader, a path helper, a filesystem module
// pulled in "just to find the vault" — would mean `resolvePort` acquired a
// dependency, which AC4 forbids.
//
// WP60 amendment: this pin previously read `node:http` alone. That was a
// self-imposed tightening beyond AC4, whose subject is `resolvePort` and whose
// dependency language is about runtime packages; the visible counterpart's
// allow-list already skips every `node:` specifier. The pin stays an exact
// whole-set toEqual, so `node:net` or `node:child_process` still fails it.
//
// Paired with the behavioural half: repeatedly starting an unprovisioned plugin
// creates no server, whatever shape its settings object has.

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
  vi.restoreAllMocks();
});

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

function source(): string {
  return readFileSync(join(pluginRoot(), "src", "testing", "e2e-control.ts"), "utf8");
}

function specifiers(): string[] {
  return [...source().matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
}

describe("WP44 AC4 (blind 2) — the import list does not grow", () => {
  it("imports exactly one runtime package: yjs", () => {
    const bare = specifiers().filter((s) => !s.startsWith(".") && !s.startsWith("node:"));
    expect(new Set(bare)).toEqual(new Set(["yjs"]));
  });

  it("imports exactly the sanctioned node builtins: node:crypto, node:http", () => {
    const builtins = specifiers().filter((s) => s.startsWith("node:"));
    expect(new Set(builtins)).toEqual(new Set(["node:crypto", "node:http"]));
  });

  it("pulls in no filesystem, path, child_process or os module by any spelling", () => {
    const text = source();
    for (const forbidden of ["fs", "path", "child_process", "os", "net", "worker_threads"]) {
      expect(text).not.toMatch(new RegExp(`from\\s+"(node:)?${forbidden}"`));
      expect(text).not.toMatch(new RegExp(`require\\(\\s*"(node:)?${forbidden}"`));
    }
  });

  it("starts no server however often an unprovisioned plugin is bootstrapped", () => {
    const shapes: Record<string, unknown>[] = [
      {},
      { clientId: "c" },
      { clientId: "c", roomId: "r", role: "host" },
      { e2eControlPort: undefined },
      { e2eControlPort: "" },
      { nested: { e2eControlPort: 39431 } },
    ];

    for (const settings of shapes) {
      const handle = maybeStartE2EControlServer({
        settings: settings as E2EPluginLike["settings"],
        canvasSync: null,
      });
      handle.close();
    }

    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("a plugin object with nothing but settings is enough — no other field is read", () => {
    // resolvePort must not acquire a dependency on the plugin's other members.
    expect(() =>
      maybeStartE2EControlServer({ settings: {} as E2EPluginLike["settings"] }),
    ).not.toThrow();
    expect(createServerMock).not.toHaveBeenCalled();
  });
});
