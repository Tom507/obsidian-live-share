// WP51 AC2 — blind set 1 (the instance is the writer).
//
// Angle: bytes, not characters. The board carries an umlaut and an emoji, so
// `size` measured in JavaScript string length is wrong and only a byte-accurate
// read-back agrees with the digest. The adapter offers `readBinary` and NO
// `read`, which is the shape the real desktop `DataAdapter` has — an oracle that
// only knows the text reader cannot see this vault at all.
//
// Second angle: the file starts ABSENT. `sha256Before` must be `""` and not the
// digest of the empty string, because absent and empty are different states
// (WP49's contract) and a save that created the file is not a save that
// overwrote one.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  type CanvasSaveChannelLike,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const PATH = "_e2e-rig/e2e-scratch-20260803T130000Z-b1-utf8.canvas";
const shaBytes = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const BOARD = JSON.stringify({
  nodes: [{ id: "n1", type: "text", text: "Größenänderung 🎯 vor dem Speichern", x: 0, y: 0 }],
  edges: [],
});

function rig(seed?: string) {
  const files = new Map<string, Buffer>();
  if (seed !== undefined) files.set(PATH, Buffer.from(seed, "utf8"));

  const reads: string[] = [];
  const adapter = {
    exists: async (p: string) => files.has(p),
    // Binary only — exactly the desktop `FileSystemAdapter` shape.
    readBinary: async (p: string) => {
      reads.push(p);
      const b = files.get(p);
      if (!b) throw new Error(`no such file: ${p}`);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    write: vi.fn(),
    writeBinary: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
    trashLocal: vi.fn(),
  };

  let saves = 0;
  const channel: CanvasSaveChannelLike = {
    path: () => PATH,
    requestSave: async () => {
      saves++;
      files.set(PATH, Buffer.from(BOARD, "utf8"));
      return BOARD;
    },
  };

  const host = buildPluginHost(
    {
      settings: { clientId: "utf8", roomId: "canvas-v2-t3", role: "host" },
      canvasSync: null,
      app: { vault: { adapter } },
      canvasSaveChannel: (p: string) => (p === PATH ? channel : null),
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
  return { host, files, adapter, reads, saveCount: () => saves };
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

describe("WP51 AC2 (blind1) — bytes on a binary-only adapter", () => {
  it("`size` is bytes, not characters", async () => {
    const { host } = rig("{}");
    const result = await save(host);
    const bytes = Buffer.from(BOARD, "utf8");
    expect(result.size).toBe(bytes.byteLength);
    expect(result.size).toBeGreaterThan(BOARD.length); // multi-byte content
  });

  it("the digest is over the raw bytes the instance wrote", async () => {
    const { host, files } = rig("{}");
    const result = await save(host);
    expect(result.sha256After).toBe(shaBytes(files.get(PATH) as Buffer));
    expect(result.byInstance).toBe(true);
  });

  it("an absent file gives `sha256Before: \"\"`, never the digest of empty", async () => {
    const { host } = rig(); // no seed → absent
    const result = await save(host);
    expect(result.sha256Before).toBe("");
    expect(result.sha256Before).not.toBe(shaBytes(Buffer.alloc(0)));
    expect(result.byInstance).toBe(true);
  });

  it("the read-back never reaches a mutator on the adapter", async () => {
    const { host, adapter } = rig("{}");
    await save(host);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.writeBinary).not.toHaveBeenCalled();
    expect(adapter.mkdir).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
    expect(adapter.trashLocal).not.toHaveBeenCalled();
  });

  it("the instance's own channel is invoked exactly once per command", async () => {
    const { host, saveCount } = rig("{}");
    await save(host);
    expect(saveCount()).toBe(1);
    await save(host);
    expect(saveCount()).toBe(2);
  });

  it("the read-back only ever asks for the path it was given", async () => {
    const { host, reads } = rig("{}");
    await save(host);
    expect(new Set(reads)).toEqual(new Set([PATH]));
  });

  it("an instance with no file adapter is a structured 400, not a silent success", async () => {
    const channel: CanvasSaveChannelLike = { path: () => PATH, requestSave: async () => BOARD };
    const host = buildPluginHost(
      {
        settings: { clientId: "x", roomId: "r", role: "host" },
        canvasSync: null,
        app: { vault: {} },
        canvasSaveChannel: () => channel,
      } as unknown as E2EPluginLike,
      { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
    );
    const out = await routeCommand(host, { cmd: "canvas.save", args: { path: PATH } });
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
    // Positive control: a host that DOES have the adapter answers 200.
    expect((await save(rig("{}").host)).byInstance).toBe(true);
  });
});
