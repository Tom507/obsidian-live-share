// WP41 / AC1 — opaque storage, attacked from the aliasing side.
//
// "Stored as received" also means the store must not keep a live reference to
// the caller's buffer: the relay hands it a view into a shared socket buffer
// that is recycled immediately afterwards. If the store aliases it, the blob
// silently mutates into whatever the next frame happened to be.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MUX_SYNC, MUX_SYNC_ENCRYPTED } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "aliasing-room";
const DOC = "notes/ciphertext.md";

// Deterministic, high-entropy bytes: SHA-256 chained from a fixed seed.
function digestBytes(seed: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let block = createHash("sha256").update(seed).digest();
  let offset = 0;
  while (offset < length) {
    const take = Math.min(block.length, length - offset);
    out.set(block.subarray(0, take), offset);
    offset += take;
    block = createHash("sha256").update(block).digest();
  }
  return out;
}

describe("WP41 AC1 — stored bytes are decoupled from the caller's buffer", () => {
  it("does not change stored bytes when the caller mutates its buffer after append", async () => {
    const store = createMemoryBlobStore();
    try {
      const buffer = digestBytes("frame-a", 128);
      const expected = Uint8Array.from(buffer);

      await store.append(ROOM, DOC, MUX_SYNC_ENCRYPTED, buffer);

      // The relay recycles the socket buffer for the next frame.
      buffer.fill(0x5a);

      const [frame] = await store.read(ROOM, DOC);
      expect(Array.from(frame.payload)).toEqual(Array.from(expected));
    } finally {
      await store.close();
    }
  });

  it("stores a payload that is a view into a larger ArrayBuffer without dragging in the rest", async () => {
    const store = createMemoryBlobStore();
    try {
      const backing = digestBytes("shared-backing", 512);
      const view = backing.subarray(100, 148); // 48 bytes in the middle
      const expected = Uint8Array.from(view);

      await store.append(ROOM, DOC, MUX_SYNC, view);
      backing.fill(0x00);

      const [frame] = await store.read(ROOM, DOC);
      expect(frame.payload.length).toBe(48);
      expect(Array.from(frame.payload)).toEqual(Array.from(expected));
    } finally {
      await store.close();
    }
  });

  it("keeps degenerate byte patterns intact", async () => {
    const store = createMemoryBlobStore();
    try {
      const cases: Uint8Array[] = [
        new Uint8Array(64).fill(0x00),
        new Uint8Array(64).fill(0xff),
        new Uint8Array([0x00]),
        // 16-byte aligned, AES-block shaped ciphertext.
        digestBytes("aes-shaped", 256),
      ];

      for (const payload of cases) {
        await store.append(ROOM, DOC, MUX_SYNC_ENCRYPTED, payload);
      }

      const frames = await store.read(ROOM, DOC);
      expect(frames).toHaveLength(cases.length);
      for (let i = 0; i < cases.length; i++) {
        expect(frames[i].payload.length).toBe(cases[i].length);
        expect(Array.from(frames[i].payload)).toEqual(Array.from(cases[i]));
      }
    } finally {
      await store.close();
    }
  });
});
