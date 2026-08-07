// WP41 / AC1 — per-key isolation attacked through the key separator itself.
//
// The relay's own room key is literally `${baseRoomId}:${docId}` (ws-handler),
// and V2 doc ids are `__canvas__:<guid>` — colons on both sides. A store that
// concatenates roomId and docId with ":" collides silently: room "a:b" + doc
// "c" lands in the same bucket as room "a" + doc "b:c", and one room starts
// replaying another room's frames.
import { describe, expect, it } from "vitest";
import { MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const dec = new TextDecoder();
const enc = new TextEncoder();

function payloadsOf(frames: { payload: Uint8Array }[]): string[] {
  return frames.map((f) => dec.decode(f.payload));
}

describe("WP41 AC1 — colon-bearing ids do not collide", () => {
  it("separates room 'a:b'/doc 'c' from room 'a'/doc 'b:c'", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append("a:b", "c", MUX_SYNC, enc.encode("left"));
      await store.append("a", "b:c", MUX_SYNC, enc.encode("right"));

      expect(payloadsOf(await store.read("a:b", "c"))).toEqual(["left"]);
      expect(payloadsOf(await store.read("a", "b:c"))).toEqual(["right"]);
    } finally {
      await store.close();
    }
  });

  it("separates canvas doc ids that share a path prefix", async () => {
    const store = createMemoryBlobStore();
    try {
      const room = "vault-room-1";
      await store.append(room, "__canvas__:notes/board.canvas", MUX_SYNC, enc.encode("canvas"));
      await store.append(room, "notes/board.canvas", MUX_SYNC, enc.encode("plain"));
      await store.append(room, "__canvas__:notes/board", MUX_SYNC, enc.encode("prefix"));

      expect(payloadsOf(await store.read(room, "__canvas__:notes/board.canvas"))).toEqual([
        "canvas",
      ]);
      expect(payloadsOf(await store.read(room, "notes/board.canvas"))).toEqual(["plain"]);
      expect(payloadsOf(await store.read(room, "__canvas__:notes/board"))).toEqual(["prefix"]);
    } finally {
      await store.close();
    }
  });

  it("handles empty and unicode doc ids as distinct keys", async () => {
    const store = createMemoryBlobStore();
    try {
      const room = "unicode-room";
      await store.append(room, "", MUX_SYNC, enc.encode("empty-doc"));
      await store.append(room, "Notizen/Übersicht.md", MUX_SYNC, enc.encode("umlaut"));
      await store.append(room, "Notizen/Ubersicht.md", MUX_SYNC, enc.encode("ascii"));

      expect(payloadsOf(await store.read(room, ""))).toEqual(["empty-doc"]);
      expect(payloadsOf(await store.read(room, "Notizen/Übersicht.md"))).toEqual(["umlaut"]);
      expect(payloadsOf(await store.read(room, "Notizen/Ubersicht.md"))).toEqual(["ascii"]);
    } finally {
      await store.close();
    }
  });

  it("numbers colliding-looking keys independently", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append("a:b", "c", MUX_SYNC, enc.encode("l1"));
      await store.append("a:b", "c", MUX_SYNC, enc.encode("l2"));
      await store.append("a", "b:c", MUX_SYNC, enc.encode("r1"));

      expect((await store.read("a:b", "c")).map((f) => f.seq)).toEqual([1, 2]);
      expect((await store.read("a", "b:c")).map((f) => f.seq)).toEqual([1]);
    } finally {
      await store.close();
    }
  });
});
