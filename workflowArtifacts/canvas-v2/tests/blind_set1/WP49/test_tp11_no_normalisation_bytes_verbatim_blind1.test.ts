// WP49 AC3 (blind set 1) — CRLF line endings and multi-byte characters.
// Angle: the visible test varies key order and whitespace. Here the file mixes CRLF
// with non-ASCII text, which separates the two ways a reader can be sloppy:
//   - line-ending normalisation would change the digest
//   - reporting `content.length` instead of the byte length would understate `size`
// The Biome/CRLF environment note in the charter makes this failure mode very live.
// DATA SAFETY: OS temp dir only, removed afterwards — no vault path is opened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BindingCounters, type E2EPluginLike, buildPluginHost } from "../../testing/e2e-control";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makeHost(root: string) {
  const adapter = {
    exists: vi.fn(async (p: string) => existsSync(join(root, p))),
    read: vi.fn(async (p: string) => readFileSync(join(root, p), "utf8")),
    readBinary: vi.fn(async (p: string) => toArrayBuffer(readFileSync(join(root, p)))),
    write: vi.fn(async () => {
      throw new Error("WP49 AC3 violation: adapter.write");
    }),
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

// CRLF endings + umlauts + an em dash: 3 characters that are >1 byte in UTF-8.
const RAW = [
  "{",
  '  "nodes": [',
  '    { "id": "n1", "type": "text", "x": 0, "y": 0, "width": 250, "height": 60, "text": "Größe — Übersicht" }',
  "  ],",
  '  "edges": []',
  "}",
].join("\r\n");

describe("WP49 AC3 blind1 — bytes, not characters, and no line-ending fixing", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-crlf-"));
    writeFileSync(join(root, "crlf.canvas"), RAW, "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("size is the byte length of the file, not the string length", async () => {
    const { host } = makeHost(root);
    const onDisk = readFileSync(join(root, "crlf.canvas"));

    const result = await host.canvasFile("crlf.canvas");

    expect(result.size).toBe(onDisk.byteLength);
    expect(result.size).toBeGreaterThan(RAW.length); // multi-byte characters present
  });

  it("CRLF survives — the reader does not rewrite line endings", async () => {
    const { host } = makeHost(root);

    const result = await host.canvasFile("crlf.canvas");

    expect(result.content).toBe(RAW);
    expect(result.content).toContain("\r\n");
    expect(result.content).toContain("Größe — Übersicht");
  });

  it("sha256 is the digest of the raw bytes", async () => {
    const { host, adapter } = makeHost(root);
    const onDisk = readFileSync(join(root, "crlf.canvas"));

    const result = await host.canvasFile("crlf.canvas");

    expect(result.sha256).toBe(createHash("sha256").update(onDisk).digest("hex"));
    // A digest over an LF-normalised copy would differ — guard against that shortcut.
    const lfOnly = Buffer.from(RAW.replace(/\r\n/g, "\n"), "utf8");
    expect(result.sha256).not.toBe(createHash("sha256").update(lfOnly).digest("hex"));
    expect(adapter.write).not.toHaveBeenCalled();
  });
});
