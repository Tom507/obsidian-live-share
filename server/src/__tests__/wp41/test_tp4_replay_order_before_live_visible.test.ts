// WP41 / AC2 — the replay is an ordered batch that ends with an explicit
// boundary marker, so "stored frames before any live traffic" is an observable
// property and not a hopeful comment.
//
// encodeReplay() is the pure core of the subscribe path: given the stored
// frames it produces the exact wire messages, in order, terminated by
// MUX_REPLAY_END carrying the highest replayed sequence number.
import { describe, expect, it } from "vitest";
import {
  MUX_REPLAY_END,
  MUX_SYNC,
  MUX_SYNC_ENCRYPTED,
  decodeMuxMessage,
  decodeReplayEndBody,
  encodeReplay,
} from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "replay-order-room";
const DOC = "notes/order.md";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("WP41 AC2 — replay ordering and boundary marker", () => {
  it("emits every stored frame in ascending seq order, then the marker", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, bytes(1));
      await store.append(ROOM, DOC, MUX_SYNC_ENCRYPTED, bytes(2));
      await store.append(ROOM, DOC, MUX_SYNC, bytes(3));

      const frames = await store.read(ROOM, DOC);
      const wire = encodeReplay(DOC, frames);

      expect(wire).toHaveLength(frames.length + 1);

      const decoded = wire.map(decodeMuxMessage);
      expect(decoded.map((m) => m.docId)).toEqual([DOC, DOC, DOC, DOC]);
      expect(decoded.slice(0, 3).map((m) => Array.from(m.payload))).toEqual([[1], [2], [3]]);
      expect(decoded.slice(0, 3).map((m) => m.msgType)).toEqual([
        MUX_SYNC,
        MUX_SYNC_ENCRYPTED,
        MUX_SYNC,
      ]);
      expect(decoded[3].msgType).toBe(MUX_REPLAY_END);
    } finally {
      await store.close();
    }
  });

  it("carries the highest replayed seq in the boundary marker", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 0; i < 6; i++) {
        await store.append(ROOM, DOC, MUX_SYNC, bytes(i));
      }

      const frames = await store.read(ROOM, DOC);
      const wire = encodeReplay(DOC, frames);
      const marker = decodeMuxMessage(wire[wire.length - 1]);

      expect(marker.msgType).toBe(MUX_REPLAY_END);
      expect(decodeReplayEndBody(marker.payload).lastSeq).toBe(frames[frames.length - 1].seq);
      expect(decodeReplayEndBody(marker.payload).lastSeq).toBe(6);
    } finally {
      await store.close();
    }
  });

  it("still emits the marker for a doc with no stored frames", async () => {
    const store = createMemoryBlobStore();
    try {
      const wire = encodeReplay("fresh-doc", await store.read(ROOM, "fresh-doc"));

      expect(wire).toHaveLength(1);
      const marker = decodeMuxMessage(wire[0]);
      expect(marker.docId).toBe("fresh-doc");
      expect(marker.msgType).toBe(MUX_REPLAY_END);
      expect(decodeReplayEndBody(marker.payload).lastSeq).toBe(0);
    } finally {
      await store.close();
    }
  });

  it("emits the marker exactly once and strictly last", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, bytes(9));
      await store.append(ROOM, DOC, MUX_SYNC, bytes(8));

      const wire = encodeReplay(DOC, await store.read(ROOM, DOC));
      const markerIndexes = wire
        .map((msg, index) => (decodeMuxMessage(msg).msgType === MUX_REPLAY_END ? index : -1))
        .filter((index) => index >= 0);

      expect(markerIndexes).toEqual([wire.length - 1]);
    } finally {
      await store.close();
    }
  });
});
