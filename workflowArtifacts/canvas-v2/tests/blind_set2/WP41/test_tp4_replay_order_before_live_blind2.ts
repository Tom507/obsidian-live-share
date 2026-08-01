// WP41 / AC2 — the replay batch as a wire artefact.
//
// Angle here: the encoded batch must be self-describing and lossless for a
// consumer that only has decodeMuxMessage — the same decoder the existing
// relay and the existing ws-handler suite already use. Ordering is asserted
// through the decoded stream, not through the store's own bookkeeping.
import { describe, expect, it } from "vitest";
import {
  MUX_CHECKPOINT,
  MUX_REPLAY_END,
  MUX_SYNC,
  MUX_SYNC_ENCRYPTED,
  decodeMuxMessage,
  decodeReplayEndBody,
  encodeReplay,
  encodeReplayEndBody,
} from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "wire-room";
const DOC = "notes/deeply/nested/path.md";

function sizedPayload(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (seed * 31 + i * 17) & 0xff;
  return out;
}

describe("WP41 AC2 — the encoded replay batch is lossless and ordered", () => {
  it("round-trips a 20-frame batch of mixed types and sizes", async () => {
    const store = createMemoryBlobStore();
    try {
      const expected: { msgType: number; payload: Uint8Array }[] = [];
      for (let i = 0; i < 20; i++) {
        const msgType = i % 4 === 0 ? MUX_SYNC_ENCRYPTED : MUX_SYNC;
        const payload = sizedPayload(i, 1 + i * 13);
        expected.push({ msgType, payload });
        await store.append(ROOM, DOC, msgType, payload);
      }

      const wire = encodeReplay(DOC, await store.read(ROOM, DOC));
      expect(wire).toHaveLength(21);

      for (let i = 0; i < 20; i++) {
        const decoded = decodeMuxMessage(wire[i]);
        expect(decoded.docId).toBe(DOC);
        expect(decoded.msgType).toBe(expected[i].msgType);
        expect(Array.from(decoded.payload)).toEqual(Array.from(expected[i].payload));
      }

      const marker = decodeMuxMessage(wire[20]);
      expect(marker.msgType).toBe(MUX_REPLAY_END);
      expect(decodeReplayEndBody(marker.payload).lastSeq).toBe(20);
    } finally {
      await store.close();
    }
  });

  it("preserves the checkpoint frame type through the wire", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, sizedPayload(1, 8));
      await store.checkpoint(ROOM, DOC, 1, sizedPayload(2, 64));
      await store.append(ROOM, DOC, MUX_SYNC_ENCRYPTED, sizedPayload(3, 8));

      const wire = encodeReplay(DOC, await store.read(ROOM, DOC));
      const types = wire.map((msg) => decodeMuxMessage(msg).msgType);

      expect(types).toEqual([MUX_CHECKPOINT, MUX_SYNC_ENCRYPTED, MUX_REPLAY_END]);
    } finally {
      await store.close();
    }
  });

  it("encodes and decodes the boundary body symmetrically for large sequences", () => {
    for (const lastSeq of [0, 1, 127, 128, 16383, 16384, 1_000_000]) {
      const body = encodeReplayEndBody(lastSeq);
      expect(decodeReplayEndBody(body).lastSeq).toBe(lastSeq);
    }
  });

  it("does not mutate the frames it was given", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, sizedPayload(5, 40));
      const frames = await store.read(ROOM, DOC);
      const before = frames.map((f) => ({
        seq: f.seq,
        msgType: f.msgType,
        payload: Array.from(f.payload),
      }));

      encodeReplay(DOC, frames);

      const after = frames.map((f) => ({
        seq: f.seq,
        msgType: f.msgType,
        payload: Array.from(f.payload),
      }));
      expect(after).toEqual(before);
    } finally {
      await store.close();
    }
  });
});
