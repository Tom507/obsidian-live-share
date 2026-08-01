// WP41 / AC2 — the replay batch after a truncation.
//
// Once a checkpoint has collapsed the history, the replay must start at the
// checkpoint frame, must not resurrect a truncated frame, and the boundary
// marker must advertise the surviving high-water mark — otherwise the next
// checkpoint the client sends would supersede frames it never saw.
import { describe, expect, it } from "vitest";
import {
  MUX_CHECKPOINT,
  MUX_REPLAY_END,
  MUX_SYNC,
  decodeMuxMessage,
  decodeReplayEndBody,
  encodeReplay,
} from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "post-checkpoint-room";
const DOC = "__canvas__:cp-order";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("WP41 AC2 — replay batch after truncation", () => {
  it("starts at the checkpoint and omits every superseded frame", async () => {
    const store = createMemoryBlobStore();
    try {
      for (const label of ["u1", "u2", "u3", "u4"]) {
        await store.append(ROOM, DOC, MUX_SYNC, enc.encode(label));
      }
      // The client has applied u1..u3 and folds them into one checkpoint.
      await store.checkpoint(ROOM, DOC, 3, enc.encode("checkpoint-of-u1-u3"));

      const wire = encodeReplay(DOC, await store.read(ROOM, DOC));
      const decoded = wire.map(decodeMuxMessage);
      const payloads = decoded.map((m) => dec.decode(m.payload));

      expect(payloads).not.toContain("u1");
      expect(payloads).not.toContain("u2");
      expect(payloads).not.toContain("u3");
      expect(payloads).toContain("u4");
      expect(payloads).toContain("checkpoint-of-u1-u3");

      const types = decoded.slice(0, -1).map((m) => m.msgType);
      expect(types).toContain(MUX_CHECKPOINT);
      expect(types).toContain(MUX_SYNC);
    } finally {
      await store.close();
    }
  });

  it("advertises the surviving high-water mark, not the pre-truncation one", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.append(ROOM, DOC, MUX_SYNC, enc.encode(`u${i}`));
      }
      const checkpointFrame = await store.checkpoint(ROOM, DOC, 4, enc.encode("cp"));

      const frames = await store.read(ROOM, DOC);
      const wire = encodeReplay(DOC, frames);
      const marker = decodeMuxMessage(wire[wire.length - 1]);

      expect(marker.msgType).toBe(MUX_REPLAY_END);
      // seq 5 (u4) survived, then the checkpoint got seq 6.
      expect(checkpointFrame.seq).toBe(6);
      expect(decodeReplayEndBody(marker.payload).lastSeq).toBe(6);
      expect(frames.map((f) => f.seq)).toEqual([5, 6]);
    } finally {
      await store.close();
    }
  });

  it("replays only the checkpoint when the checkpoint superseded everything", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 0; i < 3; i++) {
        await store.append(ROOM, DOC, MUX_SYNC, enc.encode(`u${i}`));
      }
      await store.checkpoint(ROOM, DOC, 3, enc.encode("full-state"));

      const wire = encodeReplay(DOC, await store.read(ROOM, DOC));
      expect(wire).toHaveLength(2);

      const first = decodeMuxMessage(wire[0]);
      expect(first.msgType).toBe(MUX_CHECKPOINT);
      expect(dec.decode(first.payload)).toBe("full-state");
      expect(decodeMuxMessage(wire[1]).msgType).toBe(MUX_REPLAY_END);
    } finally {
      await store.close();
    }
  });
});
