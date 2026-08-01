// WP41 / AC3 — a client checkpoint truncates exactly what it supersedes.
//
// The supersede point rides in the checkpoint *envelope* (upToSeq), so the
// relay decides what to drop without ever looking inside the checkpoint
// payload.
import { describe, expect, it } from "vitest";
import { MUX_CHECKPOINT, MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "checkpoint-room";
const DOC = "__canvas__:cp-basic";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("WP41 AC3 — checkpoint truncation", () => {
  it("drops the superseded frames and keeps the rest", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 1; i <= 5; i++) {
        await store.append(ROOM, DOC, MUX_SYNC, enc.encode(`u${i}`));
      }

      await store.checkpoint(ROOM, DOC, 3, enc.encode("cp-through-3"));

      const frames = await store.read(ROOM, DOC);
      expect(frames.map((f) => dec.decode(f.payload))).toEqual(["u4", "u5", "cp-through-3"]);
    } finally {
      await store.close();
    }
  });

  it("gives the checkpoint its own sequence number and never reuses a dropped one", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 1; i <= 5; i++) {
        await store.append(ROOM, DOC, MUX_SYNC, enc.encode(`u${i}`));
      }

      const checkpointFrame = await store.checkpoint(ROOM, DOC, 3, enc.encode("cp"));
      expect(checkpointFrame.seq).toBe(6);
      expect(checkpointFrame.msgType).toBe(MUX_CHECKPOINT);

      const frames = await store.read(ROOM, DOC);
      expect(frames.map((f) => f.seq)).toEqual([4, 5, 6]);

      // A frame arriving after the checkpoint continues past it.
      const next = await store.append(ROOM, DOC, MUX_SYNC, enc.encode("u6"));
      expect(next.seq).toBe(7);
    } finally {
      await store.close();
    }
  });

  it("stores the checkpoint payload opaquely", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, enc.encode("u1"));

      // Not a Yjs update, not decodable: the relay must not care.
      const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xff, 0xff, 0xff, 0x7f]);
      const stored = await store.checkpoint(ROOM, DOC, 1, ciphertext);

      expect(Array.from(stored.payload)).toEqual(Array.from(ciphertext));
      expect(Object.keys(stored).sort()).toEqual(["msgType", "payload", "seq"]);

      const [frame] = await store.read(ROOM, DOC);
      expect(Array.from(frame.payload)).toEqual(Array.from(ciphertext));
    } finally {
      await store.close();
    }
  });

  it("returns the same frame that a later read returns", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, enc.encode("u1"));
      const returned = await store.checkpoint(ROOM, DOC, 1, enc.encode("cp-payload"));

      const frames = await store.read(ROOM, DOC);
      expect(frames).toHaveLength(1);
      expect(frames[0].seq).toBe(returned.seq);
      expect(frames[0].msgType).toBe(returned.msgType);
      expect(Array.from(frames[0].payload)).toEqual(Array.from(returned.payload));
    } finally {
      await store.close();
    }
  });
});
