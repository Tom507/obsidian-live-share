// WP51 AC2 — blind set 1 (attribution).
//
// Angle: the hard cases for a byte-equality oracle, driven as a table.
//
//   - the foreign writer produces the SAME bytes → indistinguishable, and the
//     honest answer is `byInstance:true`: what is on disk IS what the instance
//     saved. An oracle that tried to be cleverer here would be guessing.
//   - the foreign writer adds a UTF-8 BOM → same text, different bytes, and the
//     answer must flip. This is the case a `read()`-then-compare-strings oracle
//     gets wrong.
//   - the foreign writer only reorders keys → same board, different bytes.
//   - the foreign writer DELETES the file → the instance's save must not be
//     reported as having landed.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  type CanvasSaveChannelLike,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const PATH = "_e2e-rig/e2e-scratch-20260803T133000Z-b1-attr.canvas";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const INSTANCE = '{"nodes":[{"id":"n1","x":10}],"edges":[]}';
const BOM = `﻿${INSTANCE}`;
const REORDERED = '{"edges":[],"nodes":[{"x":10,"id":"n1"}]}';
const TRAILING_NEWLINE = `${INSTANCE}\n`;

/** What `lan-vault-sync` leaves behind, or `null` for "it deleted the file". */
type Foreign = string | null | undefined;

function rig(foreign: Foreign) {
  const files = new Map<string, Buffer>([[PATH, Buffer.from("{}", "utf8")]]);
  const channel: CanvasSaveChannelLike = {
    path: () => PATH,
    requestSave: async () => {
      files.set(PATH, Buffer.from(INSTANCE, "utf8"));
      if (foreign === null) files.delete(PATH);
      else if (foreign !== undefined) files.set(PATH, Buffer.from(foreign, "utf8"));
      return INSTANCE;
    },
  };
  const host = buildPluginHost(
    {
      settings: { clientId: "attr", roomId: "canvas-v2-t3", role: "guest" },
      canvasSync: null,
      app: {
        vault: {
          adapter: {
            exists: async (p: string) => files.has(p),
            readBinary: async (p: string) => {
              const b = files.get(p) as Buffer;
              return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
            },
          },
        },
      },
      canvasSaveChannel: () => channel,
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
  return { host, files };
}

async function save(host: ReturnType<typeof rig>["host"]) {
  const out = await routeCommand(host, { cmd: "canvas.save", args: { path: PATH } });
  expect(out.status).toBe(200);
  if (!out.body.ok) throw new Error(out.body.error);
  return out.body.result as {
    saved: boolean;
    sha256Before: string;
    sha256After: string;
    size: number;
    byInstance: boolean;
  };
}

const CASES: Array<[string, Foreign, boolean]> = [
  ["nobody else wrote", undefined, true],
  ["identical bytes", INSTANCE, true],
  ["a UTF-8 BOM was prepended", BOM, false],
  ["the keys were reordered", REORDERED, false],
  ["a trailing newline was added", TRAILING_NEWLINE, false],
  ["the file was deleted", null, false],
];

describe("WP51 AC2 (blind1) — attribution under a second sync engine", () => {
  it.each(CASES)("%s → byInstance:%s", async (_label, foreign, expected) => {
    const { host } = rig(foreign);
    expect((await save(host)).byInstance).toBe(expected);
  });

  it("a deleted file is reported as absent, not as an empty save", async () => {
    const { host, files } = rig(null);
    const result = await save(host);
    expect(files.has(PATH)).toBe(false);
    expect(result.sha256After).toBe("");
    expect(result.size).toBe(0);
    expect(result.byInstance).toBe(false);
  });

  it("the BOM case is invisible to a text comparison and visible to this one", async () => {
    // Same JSON, same parsed board, different bytes.
    expect(JSON.parse(BOM.slice(1))).toEqual(JSON.parse(INSTANCE));
    expect(Buffer.from(BOM, "utf8").byteLength).toBeGreaterThan(
      Buffer.from(INSTANCE, "utf8").byteLength,
    );
    const { host } = rig(BOM);
    const result = await save(host);
    expect(result.sha256After).toBe(sha(Buffer.from(BOM, "utf8")));
    expect(result.byInstance).toBe(false);
  });

  it("the reported size matches the bytes that are actually there", async () => {
    for (const [, foreign] of CASES) {
      const { host, files } = rig(foreign);
      const result = await save(host);
      const onDisk = files.get(PATH);
      expect(result.size).toBe(onDisk ? onDisk.byteLength : 0);
    }
  });

  it("no case ever reports a save the instance did not request", async () => {
    for (const [, foreign] of CASES) {
      const { host } = rig(foreign);
      expect((await save(host)).saved).toBe(true); // the channel WAS invoked
    }
  });
});
