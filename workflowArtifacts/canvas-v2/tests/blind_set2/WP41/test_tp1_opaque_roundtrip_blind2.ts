// WP41 / AC1 — opaque storage, attacked from the read side and through the wire.
//
// Two properties here: a caller that mutates what read() handed it must not be
// able to corrupt the store, and the bytes must survive the full
// store -> encodeReplay -> decodeMuxMessage path unchanged. If the store leaks
// its internal buffer, one badly behaved consumer poisons every later replay.
import { describe, expect, it } from "vitest";
import {
  MUX_SYNC,
  MUX_SYNC_ENCRYPTED,
  decodeMuxMessage,
  encodeReplay,
} from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "readside-room";
const DOC = "__canvas__:9f2c-8811";

function patternBytes(start: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (start + i * 37) & 0xff;
  return out;
}

describe("WP41 AC1 — read side cannot corrupt the store", () => {
  it("survives a consumer that overwrites the payload it received", async () => {
    const store = createMemoryBlobStore();
    try {
      const original = patternBytes(3, 200);
      await store.append(ROOM, DOC, MUX_SYNC_ENCRYPTED, original);

      const firstRead = await store.read(ROOM, DOC);
      firstRead[0].payload.fill(0xee);

      const secondRead = await store.read(ROOM, DOC);
      expect(Array.from(secondRead[0].payload)).toEqual(Array.from(original));
    } finally {
      await store.close();
    }
  });

  it("carries the exact bytes through encodeReplay and back out of decodeMuxMessage", async () => {
    const store = createMemoryBlobStore();
    try {
      const payloads = [patternBytes(11, 17), patternBytes(211, 1), patternBytes(97, 3000)];
      const types = [MUX_SYNC, MUX_SYNC_ENCRYPTED, MUX_SYNC_ENCRYPTED];

      for (let i = 0; i < payloads.length; i++) {
        await store.append(ROOM, DOC, types[i], payloads[i]);
      }

      const frames = await store.read(ROOM, DOC);
      const wire = encodeReplay(DOC, frames);

      // The last message is the replay boundary marker; the ones before it are
      // the stored frames, verbatim.
      for (let i = 0; i < payloads.length; i++) {
        const decoded = decodeMuxMessage(wire[i]);
        expect(decoded.docId).toBe(DOC);
        expect(decoded.msgType).toBe(types[i]);
        expect(decoded.payload.length).toBe(payloads[i].length);
        expect(Array.from(decoded.payload)).toEqual(Array.from(payloads[i]));
      }
    } finally {
      await store.close();
    }
  });

  it("keeps a zero-length payload distinguishable from a one-byte payload", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, new Uint8Array(0));
      await store.append(ROOM, DOC, MUX_SYNC, new Uint8Array([0x00]));

      const frames = await store.read(ROOM, DOC);
      expect(frames[0].payload.length).toBe(0);
      expect(frames[1].payload.length).toBe(1);
      expect(frames[1].payload[0]).toBe(0x00);
    } finally {
      await store.close();
    }
  });
});
