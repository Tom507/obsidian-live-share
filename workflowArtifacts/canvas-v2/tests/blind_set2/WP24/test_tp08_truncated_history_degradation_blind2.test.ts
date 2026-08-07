// WP24 / AC3 (truncated) blind2 — the multi-byte length field and the
// checkpoint/history asymmetry.
//
// Two things neither the visible test nor blind1 reaches:
//
//  1. A payload longer than 255 bytes puts real information in the HIGH bytes
//     of the u32 length. A parser that reads the length as a single byte, or
//     little-endian, or that uses a signed 32-bit read, is correct for every
//     small frame and wrong here. Tearing inside such a header is where it
//     shows: the wrong parser computes a length that happens to fit inside the
//     file and then reports NONE over a torn log.
//
//  2. TRUNCATED is a *framing* verdict and belongs to the history alone. The
//     checkpoint has no length prefix, so a checkpoint whose tail was lost is
//     indistinguishable from one whose middle was scrambled: both are CORRUPT.
//     Pinning that asymmetry is the point of the second describe block — a
//     store that reports TRUNCATED for a short checkpoint is guessing.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-torn";

function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** One tiny update and one deliberately large one (> 255 bytes encoded). */
function smallAndLarge(): { small: Uint8Array; large: Uint8Array; doc: Y.Doc } {
  const doc = new Y.Doc();
  const captured: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => captured.push(Uint8Array.from(u)));
  doc.getMap("nodes").set("tiny", { v: 1 });
  doc.getMap("nodes").set("bulky", { text: "L".repeat(900) });
  return { small: captured[0], large: captured[1], doc };
}

function storeOver(files: Record<string, Uint8Array>) {
  const disk = new Map(Object.entries(files).map(([p, b]) => [p, Uint8Array.from(b)]));
  return createSidecarStore({
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (): Promise<void> => undefined,
    append: async (): Promise<void> => undefined,
    truncate: async (): Promise<void> => undefined,
    remove: async (): Promise<void> => undefined,
  });
}

describe("WP24 AC3 blind2 — the length field is a real 32-bit big-endian number", () => {
  const { small, large } = smallAndLarge();

  it("PREMISE: the large payload needs more than one length byte", () => {
    expect(large.length).toBeGreaterThan(255);
    const header = frame(large).slice(0, 4);
    expect(header[0]).toBe(0);
    expect(header[1]).toBe(0);
    expect(header[2]).toBeGreaterThan(0); // the byte a single-byte parser ignores
  });

  it("a large frame round-trips intact", async () => {
    const doc = new Y.Doc();
    const result = await storeOver({
      [sidecarHistoryPath(GUID)]: join([frame(small), frame(large)]),
    }).load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.historyEntriesApplied).toBe(2);
    expect((doc.getMap("nodes").get("bulky") as { text: string }).text).toHaveLength(900);
  });

  it("losing the last 200 bytes of the large frame is TRUNCATED, applying nothing", async () => {
    const whole = join([frame(small), frame(large)]);
    const doc = new Y.Doc();
    const result = await storeOver({
      [sidecarHistoryPath(GUID)]: whole.slice(0, whole.length - 200),
    }).load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.TRUNCATED);
    expect(result.historyEntriesApplied).toBe(0);
    expect(doc.getMap("nodes").toJSON()).toEqual({});
  });

  it("a tear INSIDE the large frame's header is TRUNCATED, never NONE", async () => {
    const whole = join([frame(small), frame(large)]);
    const headerStart = frame(small).length;
    for (const offset of [1, 2, 3]) {
      const result = await storeOver({
        [sidecarHistoryPath(GUID)]: whole.slice(0, headerStart + offset),
      }).load(GUID, new Y.Doc());
      expect(result.degradation, `header cut +${offset}`).toBe(SIDECAR_DEGRADATION.TRUNCATED);
    }
  });

  it("a frame declaring a length far beyond the file is TRUNCATED, not a crash", async () => {
    const forged = new Uint8Array(4 + 10);
    new DataView(forged.buffer).setUint32(0, 0x7fffffff, false);
    const result = await storeOver({ [sidecarHistoryPath(GUID)]: forged }).load(GUID, new Y.Doc());
    expect(result.degradation).toBe(SIDECAR_DEGRADATION.TRUNCATED);
  });
});

describe("WP24 AC3 blind2 — a short checkpoint is CORRUPT, because it cannot be told apart", () => {
  it("a checkpoint missing its tail reports CORRUPT and applies nothing", async () => {
    const doc = new Y.Doc();
    doc.getMap("nodes").set("state", { text: "M".repeat(300) });
    const checkpoint = Y.encodeStateAsUpdate(doc);
    const chopped = checkpoint.slice(0, checkpoint.length - 40);
    expect(() => Y.applyUpdate(new Y.Doc(), chopped)).toThrow();

    const target = new Y.Doc();
    const result = await storeOver({ [sidecarCheckpointPath(GUID)]: chopped }).load(GUID, target);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.checkpointApplied).toBe(false);
    expect(target.getMap("nodes").toJSON()).toEqual({});
  });

  it("the intact checkpoint of the same doc loads cleanly", async () => {
    const doc = new Y.Doc();
    doc.getMap("nodes").set("state", { text: "M".repeat(300) });

    const target = new Y.Doc();
    const result = await storeOver({
      [sidecarCheckpointPath(GUID)]: Y.encodeStateAsUpdate(doc),
    }).load(GUID, target);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.checkpointApplied).toBe(true);
    expect((target.getMap("nodes").get("state") as { text: string }).text).toHaveLength(300);
  });
});
