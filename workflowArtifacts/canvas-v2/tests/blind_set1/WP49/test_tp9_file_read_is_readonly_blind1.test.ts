// WP49 AC3 (blind set 1) — the oracle must not "repair" a non-canonical file.
// Angle: the visible test reads a well-formed canvas. Here the file on disk is in a
// shape the plugin's own canonical serialiser would rewrite (unsorted ids, compact
// spacing). The temptation to fix it up is exactly the single-writer violation.
// DATA SAFETY: OS temp dir only, removed afterwards — no vault path is opened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BindingCounters, type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makeHost(root: string) {
  const fatal = (name: string) =>
    vi.fn(async () => {
      throw new Error(`WP49 AC3 violation: adapter.${name}`);
    });
  const adapter = {
    exists: vi.fn(async (p: string) => existsSync(join(root, p))),
    read: vi.fn(async (p: string) => readFileSync(join(root, p), "utf8")),
    readBinary: vi.fn(async (p: string) => toArrayBuffer(readFileSync(join(root, p)))),
    write: fatal("write"),
    writeBinary: fatal("writeBinary"),
    append: fatal("append"),
    remove: fatal("remove"),
    rename: fatal("rename"),
    mkdir: fatal("mkdir"),
    trashLocal: fatal("trashLocal"),
  };
  const plugin = {
    settings: { clientId: "cid", roomId: "room", role: "guest" },
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: null,
    app: { vault: { adapter } },
  } as unknown as E2EPluginLike;
  const counters: BindingCounters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return { adapter, host: buildPluginHost(plugin, { counters, bump: () => {} }) };
}

const NON_CANONICAL = '{"nodes":[{"id":"z9","x":1,"y":2},{"id":"a1","x":3,"y":4}],"edges":[]}';

describe("WP49 AC3 blind1 — a non-canonical file is observed, not corrected", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-b1-"));
    writeFileSync(join(root, "messy.canvas"), NON_CANONICAL, "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("leaves the bytes and the mtime exactly as they were", async () => {
    const target = join(root, "messy.canvas");
    const before = readFileSync(target);
    const mtime = statSync(target).mtimeMs;
    const { adapter, host } = makeHost(root);

    const result = await host.canvasFile("messy.canvas");

    expect(result.content).toBe(NON_CANONICAL);
    expect(readFileSync(target).equals(before)).toBe(true);
    expect(statSync(target).mtimeMs).toBe(mtime);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.rename).not.toHaveBeenCalled();
  });

  it("reading twenty times in a row is still a read", async () => {
    const target = join(root, "messy.canvas");
    const before = readFileSync(target);
    const { adapter, host } = makeHost(root);

    for (let i = 0; i < 20; i++) {
      const result = await host.canvasFile("messy.canvas");
      expect(result.exists).toBe(true);
    }

    expect(readFileSync(target).equals(before)).toBe(true);
    for (const name of ["write", "writeBinary", "append", "remove", "rename", "mkdir"] as const) {
      expect(adapter[name]).not.toHaveBeenCalled();
    }
  });
});
