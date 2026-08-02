// WP49 / C49 AC3 — the oracle reports what the plugin's own writer produced.
//
// This is the test that proves the read-back is a witness and not a second writer.
// The fixture is deliberately in a shape the plugin's canonical serialiser would
// rewrite: keys out of the file-schema order, records NOT id-sorted, ragged
// whitespace, and no trailing newline. If `canvas.file` re-serialised or normalised
// anything, `content` and `sha256` would drift away from the bytes on disk — and a
// convergence verdict built on a normalised read is worthless, because normalisation
// is exactly what hides a real divergence.
//
// DATA SAFETY: temp directory only, removed afterwards. No vault path is opened.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  return { host: buildPluginHost(plugin, { counters, bump: () => {} }) };
}

// Odd key order, reverse-sorted ids, ragged indentation, NO trailing newline.
const RAW =
  '{"edges":[],   "nodes":[{"height":60,"width":250,"y":0,"x":400,"id":"n2","type":"text"},\n' +
  '        {"id":"n1","type":"text","x":0,"y":0,"width":250,"height":60}]}';

describe("WP49 AC3 — canvas.file does not normalise", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-raw-"));
    writeFileSync(join(root, "odd.canvas"), RAW, "utf8");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("content is the file byte-for-byte, not a re-serialised form", async () => {
    const { host } = makeVaultDouble(root);
    const onDisk = readFileSync(join(root, "odd.canvas"));

    const result = await host.canvasFile("odd.canvas");

    expect(result.content).toBe(onDisk.toString("utf8"));
    expect(result.content).toBe(RAW);
    // A normalising reader would have produced this instead — it must not.
    expect(result.content).not.toBe(JSON.stringify(JSON.parse(RAW)));
    expect(result.content?.endsWith("\n")).toBe(false);
  });

  it("sha256 and size are taken over the bytes on disk", async () => {
    const { host } = makeVaultDouble(root);
    const onDisk = readFileSync(join(root, "odd.canvas"));

    const result = await host.canvasFile("odd.canvas");

    expect(result.sha256).toBe(createHash("sha256").update(onDisk).digest("hex"));
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.size).toBe(onDisk.byteLength);
  });

  it("record and key order survive — the reader does not id-sort or reorder", async () => {
    const { host } = makeVaultDouble(root);

    const result = await host.canvasFile("odd.canvas");
    const content = result.content as string;

    // "n2" is written before "n1" on disk; a canonicalising reader would swap them.
    expect(content.indexOf('"id":"n2"')).toBeLessThan(content.indexOf('"id":"n1"'));
    expect(content.indexOf('"height":60')).toBeLessThan(content.indexOf('"width":250'));
    expect(content).toContain('"edges":[],   "nodes"');
  });
});
