// WP41 / AC1 — the relay stores frames opaquely.
//
// The store must accept arbitrary bytes it cannot interpret, keep them
// byte-for-byte, preserve the envelope msgType exactly as received, and expose
// no field that could only exist if the payload had been decoded.
import { describe, expect, it } from "vitest";
import { MUX_SYNC, MUX_SYNC_ENCRYPTED } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "room-opaque";
const DOC = "__canvas__:board.canvas";

// Deterministic PRNG (mulberry32) — no Math.random anywhere in this suite.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicBytes(seed: number, length: number): Uint8Array {
  const rand = mulberry32(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

describe("WP41 AC1 — opaque frame storage", () => {
  it("round-trips high-entropy, non-Yjs payloads byte-for-byte", async () => {
    const store = createMemoryBlobStore();
    try {
      const payloads = [
        deterministicBytes(0x1a2b, 64),
        deterministicBytes(0x51ce, 4096),
        new Uint8Array(0),
        // A varUint that never terminates within the frame: any attempt to
        // decode this as a lib0 message would fail or read out of bounds.
        new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]),
      ];

      for (const payload of payloads) {
        await store.append(ROOM, DOC, MUX_SYNC_ENCRYPTED, payload);
      }

      const frames = await store.read(ROOM, DOC);
      expect(frames).toHaveLength(payloads.length);
      for (let i = 0; i < payloads.length; i++) {
        expect(frames[i].payload.length).toBe(payloads[i].length);
        expect(Array.from(frames[i].payload)).toEqual(Array.from(payloads[i]));
      }
    } finally {
      await store.close();
    }
  });

  it("preserves the envelope msgType exactly as received", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, deterministicBytes(7, 32));
      await store.append(ROOM, DOC, MUX_SYNC_ENCRYPTED, deterministicBytes(8, 32));
      await store.append(ROOM, DOC, MUX_SYNC, deterministicBytes(9, 32));

      const frames = await store.read(ROOM, DOC);
      expect(frames.map((f) => f.msgType)).toEqual([MUX_SYNC, MUX_SYNC_ENCRYPTED, MUX_SYNC]);
    } finally {
      await store.close();
    }
  });

  it("exposes no decoded field on a stored frame", async () => {
    const store = createMemoryBlobStore();
    try {
      const stored = await store.append(ROOM, DOC, MUX_SYNC_ENCRYPTED, deterministicBytes(11, 96));

      // seq + msgType + payload and nothing else: the store carries no
      // interpretation of the bytes it was handed.
      expect(Object.keys(stored).sort()).toEqual(["msgType", "payload", "seq"]);
      expect(typeof stored.seq).toBe("number");
      expect(stored.payload).toBeInstanceOf(Uint8Array);

      const [readBack] = await store.read(ROOM, DOC);
      expect(Object.keys(readBack).sort()).toEqual(["msgType", "payload", "seq"]);
      expect(readBack.seq).toBe(stored.seq);
    } finally {
      await store.close();
    }
  });

  it("accepts a payload that is a truncated, undecodable lib0 message", async () => {
    const store = createMemoryBlobStore();
    try {
      // varUint8Array header claiming 200 bytes followed by only 3.
      const truncated = new Uint8Array([0xc8, 0x01, 0x01, 0x02, 0x03]);
      await expect(store.append(ROOM, DOC, MUX_SYNC, truncated)).resolves.toBeDefined();

      const frames = await store.read(ROOM, DOC);
      expect(Array.from(frames[0].payload)).toEqual([0xc8, 0x01, 0x01, 0x02, 0x03]);
    } finally {
      await store.close();
    }
  });
});
