// WP41 / AC3 — checkpoint truncation at its boundary values.
//
// Off-by-one here is the whole failure mode: upToSeq is inclusive, 0 means
// "supersede nothing", and a checkpoint must never be able to delete itself,
// no matter what the client claims to supersede.
import { describe, expect, it } from "vitest";
import { MUX_CHECKPOINT, MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "boundary-room";
const DOC = "boundary-doc";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function seed(store: ReturnType<typeof createMemoryBlobStore>, count: number) {
  for (let i = 1; i <= count; i++) {
    await store.append(ROOM, DOC, MUX_SYNC, enc.encode(`u${i}`));
  }
}

describe("WP41 AC3 — truncation boundaries", () => {
  it("supersedes nothing at upToSeq = 0", async () => {
    const store = createMemoryBlobStore();
    try {
      await seed(store, 3);
      await store.checkpoint(ROOM, DOC, 0, enc.encode("cp0"));

      const frames = await store.read(ROOM, DOC);
      expect(frames.map((f) => dec.decode(f.payload))).toEqual(["u1", "u2", "u3", "cp0"]);
    } finally {
      await store.close();
    }
  });

  it("treats upToSeq as inclusive of exactly that frame", async () => {
    const store = createMemoryBlobStore();
    try {
      await seed(store, 4);
      await store.checkpoint(ROOM, DOC, 1, enc.encode("cp1"));

      const frames = await store.read(ROOM, DOC);
      expect(frames.map((f) => dec.decode(f.payload))).toEqual(["u2", "u3", "u4", "cp1"]);
    } finally {
      await store.close();
    }
  });

  it("never truncates the checkpoint itself when upToSeq overshoots", async () => {
    const store = createMemoryBlobStore();
    try {
      await seed(store, 3);
      // A confused or malicious client claims to supersede far past reality.
      const checkpointFrame = await store.checkpoint(ROOM, DOC, 9999, enc.encode("cp-overshoot"));

      const frames = await store.read(ROOM, DOC);
      expect(frames).toHaveLength(1);
      expect(frames[0].seq).toBe(checkpointFrame.seq);
      expect(frames[0].msgType).toBe(MUX_CHECKPOINT);
      expect(dec.decode(frames[0].payload)).toBe("cp-overshoot");
    } finally {
      await store.close();
    }
  });

  it("lets a second checkpoint supersede the first", async () => {
    const store = createMemoryBlobStore();
    try {
      await seed(store, 2); // seq 1,2
      const first = await store.checkpoint(ROOM, DOC, 2, enc.encode("cp-a")); // seq 3
      await store.append(ROOM, DOC, MUX_SYNC, enc.encode("u3")); // seq 4
      const second = await store.checkpoint(ROOM, DOC, first.seq, enc.encode("cp-b")); // seq 5

      const frames = await store.read(ROOM, DOC);
      expect(frames.map((f) => dec.decode(f.payload))).toEqual(["u3", "cp-b"]);
      expect(frames.map((f) => f.seq)).toEqual([4, second.seq]);
      expect(second.seq).toBe(5);
    } finally {
      await store.close();
    }
  });

  it("checkpoints a doc that has no frames yet", async () => {
    const store = createMemoryBlobStore();
    try {
      const checkpointFrame = await store.checkpoint(ROOM, "brand-new", 0, enc.encode("cp-fresh"));

      expect(checkpointFrame.seq).toBe(1);
      const frames = await store.read(ROOM, "brand-new");
      expect(frames).toHaveLength(1);
      expect(dec.decode(frames[0].payload)).toBe("cp-fresh");
    } finally {
      await store.close();
    }
  });
});
