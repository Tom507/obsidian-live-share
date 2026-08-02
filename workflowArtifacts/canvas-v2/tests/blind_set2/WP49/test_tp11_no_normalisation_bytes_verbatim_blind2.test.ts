// WP49 AC3 (blind set 2) — a UTF-8 BOM and trailing whitespace.
// Angle: a BOM is the single most commonly stripped byte sequence in "read a text
// file" helpers, and trailing whitespace is the most commonly trimmed. Both would
// change the digest and make two genuinely different files look identical, which is
// exactly how a file oracle turns into a rubber stamp.
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

const BOM = "﻿";
const BODY = '{ "nodes": [ { "id": "n1", "x": 0, "y": 0 } ], "edges": [] }   \n\n';
const RAW = BOM + BODY;

describe("WP49 AC3 blind2 — BOM and trailing whitespace survive the read-back", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ls-wp49-bom-"));
    writeFileSync(join(root, "bom.canvas"), RAW, "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("the BOM is still there — no stripping", async () => {
    const { host } = makeHost(root);

    const result = await host.canvasFile("bom.canvas");

    expect(result.content?.startsWith(BOM)).toBe(true);
    expect(result.content).toBe(RAW);
  });

  it("trailing spaces and blank lines are still there — no trimming", async () => {
    const { host } = makeHost(root);

    const result = await host.canvasFile("bom.canvas");

    expect(result.content?.endsWith("   \n\n")).toBe(true);
    expect(result.content).not.toBe(RAW.trim());
  });

  it("the digest is over the bytes on disk, BOM included", async () => {
    const { adapter, host } = makeHost(root);
    const onDisk = readFileSync(join(root, "bom.canvas"));

    const result = await host.canvasFile("bom.canvas");

    expect(result.size).toBe(onDisk.byteLength);
    expect(result.sha256).toBe(createHash("sha256").update(onDisk).digest("hex"));
    // A BOM-stripping reader would report this instead.
    const stripped = Buffer.from(BODY, "utf8");
    expect(result.sha256).not.toBe(createHash("sha256").update(stripped).digest("hex"));
    expect(adapter.write).not.toHaveBeenCalled();
  });
});
