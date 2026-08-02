// WP24 / AC1 blind1 — the copy-before-await rule, attacked with a real ring
// buffer instead of a single recycled array.
//
// Different angle: the visible test mutates one array between the call and the
// await. Here a fixed-size pool of three slots is cycled through TWELVE
// appends, so every slot is overwritten four times while earlier appends are
// still in flight — and none of the twelve promises is awaited until all twelve
// have been issued. The oracle is the whole file at the end: twelve frames, in
// order, each equal to the payload as it was at ITS call.
//
// A store that keeps a reference produces twelve frames of the last three
// payloads. Frame count, frame lengths and file size are all still plausible,
// which is why the assertion has to be on the contents.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-snapshot";

function makeIO() {
  const disk = new Map<string, Uint8Array>();
  return {
    disk,
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => Uint8Array.from(disk.get(p) ?? []),
    write: async (p: string, d: Uint8Array): Promise<void> => {
      disk.set(p, Uint8Array.from(d));
    },
    append: async (p: string, d: Uint8Array): Promise<void> => {
      // A real disk reads the caller's bytes HERE, after the await — copying
      // eagerly in the fake would hide the very bug this test exists for.
      await Promise.resolve();
      const prev = disk.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      disk.set(p, out);
    },
    truncate: async (p: string): Promise<void> => {
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      disk.delete(p);
    },
  };
}

function twelveUpdates(): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => out.push(Uint8Array.from(u)));
  for (let i = 0; i < 12; i++) doc.getMap("nodes").set(`ring-${i}`, { i, tag: `t${i % 5}` });
  return out;
}

function decodeFrames(history: Uint8Array): Uint8Array[] {
  const view = new DataView(history.buffer, history.byteOffset, history.byteLength);
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < history.length) {
    const n = view.getUint32(at, false);
    out.push(history.slice(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return out;
}

describe("WP24 AC1 blind1 — a three-slot ring buffer feeding twelve appends", () => {
  it("every frame holds the payload as it was at its own call", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const updates = twelveUpdates();
    expect(updates).toHaveLength(12);

    const width = Math.max(...updates.map((u) => u.length));
    const pool = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];

    const pending: Promise<void>[] = [];
    for (const [index, update] of updates.entries()) {
      const slot = pool[index % pool.length];
      slot.fill(0);
      slot.set(update, 0);
      pending.push(store.append(GUID, slot.subarray(0, update.length)));
    }
    // Every slot is now overwritten three more times than it was read.
    for (const slot of pool) slot.fill(0xcd);
    await Promise.all(pending);

    const frames = decodeFrames(io.disk.get(sidecarHistoryPath(GUID)) as Uint8Array);
    expect(frames).toHaveLength(12);
    for (const [index, expected] of updates.entries()) {
      expect(frames[index], `frame ${index}`).toEqual(expected);
    }
  });

  it("the recycled content really differs from the payloads", () => {
    const updates = twelveUpdates();
    expect(new Set(updates.map((u) => u.join(","))).size).toBe(12);
    expect(updates.every((u) => u.some((b) => b !== 0xcd))).toBe(true);
  });

  it("the reconstructed doc from those frames is the original doc", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const updates = twelveUpdates();

    const scratch = new Uint8Array(Math.max(...updates.map((u) => u.length)));
    const pending: Promise<void>[] = [];
    for (const update of updates) {
      scratch.fill(0);
      scratch.set(update, 0);
      pending.push(store.append(GUID, scratch.subarray(0, update.length)));
    }
    scratch.fill(0x11);
    await Promise.all(pending);

    const revived = new Y.Doc();
    await store.load(GUID, revived);

    const expectedKeys = Array.from({ length: 12 }, (_v, i) => `ring-${i}`).sort();
    expect(Object.keys(revived.getMap("nodes").toJSON()).sort()).toEqual(expectedKeys);
  });
});
