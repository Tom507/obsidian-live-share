// WP41 / AC3 — a checkpoint is scoped to one roomId:docId.
//
// Truncation is the only destructive operation the relay performs. If its
// blast radius leaks across docs or across rooms, a single checkpoint on one
// canvas silently deletes another room's history — the worst possible failure
// for "an empty room retains its docs".
import { describe, expect, it } from "vitest";
import { MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

const LAYOUT: [string, string][] = [
  ["room-1", "__canvas__:alpha"],
  ["room-1", "__canvas__:beta"],
  ["room-2", "__canvas__:alpha"],
  ["room-2", "notes/gamma.md"],
];

describe("WP41 AC3 — truncation blast radius", () => {
  it("truncates only the checkpointed room/doc pair", async () => {
    const store = createMemoryBlobStore();
    try {
      for (const [room, doc] of LAYOUT) {
        for (let i = 1; i <= 4; i++) {
          await store.append(room, doc, MUX_SYNC, enc.encode(`${room}/${doc}/u${i}`));
        }
      }

      await store.checkpoint("room-1", "__canvas__:alpha", 4, enc.encode("cp"));

      const target = await store.read("room-1", "__canvas__:alpha");
      expect(target.map((f) => dec.decode(f.payload))).toEqual(["cp"]);

      for (const [room, doc] of LAYOUT.slice(1)) {
        const frames = await store.read(room, doc);
        expect(frames.map((f) => f.seq)).toEqual([1, 2, 3, 4]);
        expect(frames.map((f) => dec.decode(f.payload))).toEqual([
          `${room}/${doc}/u1`,
          `${room}/${doc}/u2`,
          `${room}/${doc}/u3`,
          `${room}/${doc}/u4`,
        ]);
      }
    } finally {
      await store.close();
    }
  });

  it("keeps sequence counters independent after a truncation", async () => {
    const store = createMemoryBlobStore();
    try {
      for (const [room, doc] of LAYOUT) {
        for (let i = 1; i <= 3; i++) {
          await store.append(room, doc, MUX_SYNC, enc.encode("x"));
        }
      }

      await store.checkpoint("room-2", "__canvas__:alpha", 3, enc.encode("cp"));

      // The truncated stream continues from its own counter...
      const afterTruncate = await store.append("room-2", "__canvas__:alpha", MUX_SYNC, enc.encode("next"));
      expect(afterTruncate.seq).toBe(5);

      // ...and every untouched stream continues from its own.
      const sibling = await store.append("room-1", "__canvas__:alpha", MUX_SYNC, enc.encode("next"));
      expect(sibling.seq).toBe(4);
    } finally {
      await store.close();
    }
  });

  it("does not resurrect truncated frames on a later read", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 1; i <= 6; i++) {
        await store.append("room-3", "doc", MUX_SYNC, enc.encode(`u${i}`));
      }
      await store.checkpoint("room-3", "doc", 5, enc.encode("cp"));

      const first = await store.read("room-3", "doc");
      const second = await store.read("room-3", "doc");

      expect(first.map((f) => dec.decode(f.payload))).toEqual(["u6", "cp"]);
      expect(second.map((f) => dec.decode(f.payload))).toEqual(["u6", "cp"]);
      expect(second.map((f) => f.seq)).toEqual(first.map((f) => f.seq));
    } finally {
      await store.close();
    }
  });
});
