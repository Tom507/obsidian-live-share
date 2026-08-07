// WP49 AC3 (blind set 2) — a zero-byte file that exists.
// Angle: the empty file is where "absent" and "present" collapse if the reader is
// careless — and it is also the state a half-finished write leaves behind, which the
// oracle must report rather than hide by "helpfully" writing a valid empty canvas.
// DATA SAFETY: OS temp dir only, removed afterwards — no vault path is opened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
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

describe("WP49 AC3 blind2 — an empty file is present, not missing", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-empty-"));
    writeFileSync(join(root, "blank.canvas"), "", "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reports exists:true, size 0, content '' — distinguishable from absent", async () => {
    const { host } = makeHost(root);

    const result = await host.canvasFile("blank.canvas");

    expect(result.exists).toBe(true);
    expect(result.size).toBe(0);
    expect(result.content).toBe("");
    expect(result.content).not.toBeNull();
    expect(result.sha256).toBe(createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  });

  it("an absent sibling still reports the absent shape — the two are not confused", async () => {
    const { host } = makeHost(root);
    const present = await host.canvasFile("blank.canvas");
    const missing = await host.canvasFile("gone.canvas");

    expect(present.exists).toBe(true);
    expect(missing.exists).toBe(false);
    expect(missing.content).toBeNull();
    expect(missing.sha256).toBe("");
    expect(present.sha256).not.toBe(missing.sha256);
  });

  it("the empty file stays empty and untouched", async () => {
    const target = join(root, "blank.canvas");
    const mtime = statSync(target).mtimeMs;
    const { adapter, host } = makeHost(root);

    await host.canvasFile("blank.canvas");

    expect(statSync(target).size).toBe(0);
    expect(statSync(target).mtimeMs).toBe(mtime);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.writeBinary).not.toHaveBeenCalled();
  });
});
