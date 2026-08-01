// WP49 / C49 AC3 — THE most important test in this WP.
//
// `CanvasPersistence` is the single CRDT→disk writer. An oracle that writes, touches
// or "repairs" the file weakens that invariant and destroys the very property the
// run is meant to prove. `canvas.file` is a read-back ONLY (T3 contract §6.1).
//
// Proven structurally, not by inspection:
//   - every mutating adapter method is a spy that also throws → any write is fatal
//   - mtime and the bytes on disk are captured before and compared after
//
// DATA SAFETY: this test never goes near a real vault. It creates its own directory
// under the OS temp dir and removes it again; no path in `H:\Developement\...` and
// nothing under `%APPDATA%\obsidian\` is opened at all.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BindingCounters, type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * A vault adapter double over a real temp directory. Readers work; every mutator is
 * a spy that throws, so an accidental write shows up twice: as a failed call count
 * assertion and as a rejected read-back.
 */
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

const CANVAS = `{
  "nodes": [
    { "id": "n1", "type": "text", "x": 0, "y": 0, "width": 250, "height": 60, "text": "alpha" }
  ],
  "edges": []
}
`;

describe("WP49 AC3 — canvas.file reads back and never writes", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-ro-"));
    writeFileSync(join(root, "board.canvas"), CANVAS, "utf8");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports the bytes on disk without touching them", async () => {
    const target = join(root, "board.canvas");
    const before = readFileSync(target);
    const mtimeBefore = statSync(target).mtimeMs;
    const { adapter, host } = makeVaultDouble(root);

    const result = await host.canvasFile("board.canvas");

    expect(result.exists).toBe(true);
    expect(result.content).toBe(CANVAS);
    expect(result.size).toBe(before.byteLength);
    expect(result.sha256).toBe(sha256Hex(before));

    // Nothing on disk moved.
    expect(readFileSync(target).equals(before)).toBe(true);
    expect(statSync(target).mtimeMs).toBe(mtimeBefore);

    // No mutating adapter method was reached at all.
    for (const name of ["write", "writeBinary", "append", "remove", "rename", "mkdir", "trashLocal"] as const) {
      expect(adapter[name]).not.toHaveBeenCalled();
    }
  });

  it("repeated reads are pure — same answer, still no writes, still the same mtime", async () => {
    const target = join(root, "board.canvas");
    const mtimeBefore = statSync(target).mtimeMs;
    const { adapter, host } = makeVaultDouble(root);

    const first = await host.canvasFile("board.canvas");
    const second = await host.canvasFile("board.canvas");

    expect(second).toEqual(first);
    expect(statSync(target).mtimeMs).toBe(mtimeBefore);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.writeBinary).not.toHaveBeenCalled();
  });
});
