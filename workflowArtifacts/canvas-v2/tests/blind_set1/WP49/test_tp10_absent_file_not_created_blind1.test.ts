// WP49 AC3 (blind set 1) — the file disappears between two reads.
// Angle: the visible test asks for a path that never existed. Here the path existed
// a moment ago (teardown removed it), which is the shape that tempts an oracle to
// cache, resurrect or fall back to a remembered value instead of reporting absence.
// DATA SAFETY: OS temp dir only, removed afterwards — no vault path is opened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
    settings: { clientId: "cid", roomId: "room", role: "host" },
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: null,
    app: { vault: { adapter } },
  } as unknown as E2EPluginLike;
  const counters: BindingCounters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  return { adapter, host: buildPluginHost(plugin, { counters, bump: () => {} }) };
}

describe("WP49 AC3 blind1 — a file removed between reads is reported absent", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-gone-"));
    writeFileSync(join(root, "scratch.canvas"), '{"nodes":[],"edges":[]}', "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("first read exists, second read after removal reports exists:false and recreates nothing", async () => {
    const { adapter, host } = makeHost(root);

    const first = await host.canvasFile("scratch.canvas");
    expect(first.exists).toBe(true);
    expect(first.size).toBeGreaterThan(0);

    unlinkSync(join(root, "scratch.canvas"));
    const listing = readdirSync(root).sort();

    const second = await host.canvasFile("scratch.canvas");

    expect(second).toEqual({ exists: false, sha256: "", size: 0, content: null });
    expect(readdirSync(root).sort()).toEqual(listing);
    expect(existsSync(join(root, "scratch.canvas"))).toBe(false);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("an absent path never rejects — the oracle answers, it does not crash the view", async () => {
    const { host } = makeHost(root);
    await expect(host.canvasFile("no/such/file.canvas")).resolves.toMatchObject({ exists: false });
  });
});
