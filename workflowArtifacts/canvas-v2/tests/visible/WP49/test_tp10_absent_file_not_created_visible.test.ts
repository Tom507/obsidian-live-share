// WP49 / C49 AC3 — an absent file stays absent.
//
// The most seductive way for an oracle to "help" is to create what it went looking
// for. `canvas.file` on a path that is not on disk must report `exists:false` and
// leave the directory exactly as it found it — no file, no parent folder, no
// placeholder. `content` is `null` (not `""`), which is what distinguishes a missing
// file from an empty one; `sha256` is `""` because there are no bytes to digest.
//
// DATA SAFETY: temp directory only, removed afterwards. No vault path is opened.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BindingCounters, type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makeVaultDouble(root: string) {
  const fatal = (name: string) =>
    vi.fn(async () => {
      throw new Error(`WP49 AC3 violation: the oracle called adapter.${name}`);
    });
  const adapter = {
    exists: vi.fn(async (p: string) => existsSync(join(root, p))),
    read: vi.fn(async (p: string) => readFileSync(join(root, p), "utf8")),
    readBinary: vi.fn(async (p: string) => toArrayBuffer(readFileSync(join(root, p)))),
    stat: vi.fn(async (p: string) => {
      const s = statSync(join(root, p));
      return { type: "file" as const, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
    }),
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
  const counters: BindingCounters = {
    applyRemote: 0,
    captureLocal: 0,
    rePush: 0,
    originUpdates: 0,
  };
  return { adapter, host: buildPluginHost(plugin, { counters, bump: () => {} }) };
}

describe("WP49 AC3 — canvas.file on a missing path creates nothing", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-absent-"));
    writeFileSync(join(root, "kept.canvas"), "{}\n", "utf8");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports exists:false, content:null, size:0, sha256:'' and never resolves to a throw", async () => {
    const { host } = makeVaultDouble(root);

    const result = await host.canvasFile("not-there.canvas");

    expect(result).toEqual({ exists: false, sha256: "", size: 0, content: null });
  });

  it("the directory listing is unchanged — no file appeared", async () => {
    const before = readdirSync(root).sort();
    const { adapter, host } = makeVaultDouble(root);

    await host.canvasFile("not-there.canvas");

    expect(readdirSync(root).sort()).toEqual(before);
    expect(existsSync(join(root, "not-there.canvas"))).toBe(false);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.mkdir).not.toHaveBeenCalled();
  });

  it("a missing file inside a missing folder does not create the folder either", async () => {
    const { adapter, host } = makeVaultDouble(root);

    const result = await host.canvasFile("nested/deeper/none.canvas");

    expect(result.exists).toBe(false);
    expect(result.content).toBeNull();
    expect(existsSync(join(root, "nested"))).toBe(false);
    expect(adapter.mkdir).not.toHaveBeenCalled();
  });
});
