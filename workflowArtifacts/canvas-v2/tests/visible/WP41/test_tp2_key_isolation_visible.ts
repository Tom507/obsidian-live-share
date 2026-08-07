// WP41 / AC1 — frames are appended *per `roomId:docId`*.
//
// Four independent streams (two docs in one room, the same doc in two rooms)
// must not see each other's frames, and each stream numbers its own frames
// from 1.
import { describe, expect, it } from "vitest";
import { MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

function tag(label: string): Uint8Array {
  return new TextEncoder().encode(label);
}

function labels(payloads: Uint8Array[]): string[] {
  const dec = new TextDecoder();
  return payloads.map((p) => dec.decode(p));
}

describe("WP41 AC1 — per roomId:docId keying", () => {
  it("keeps four room/doc combinations independent", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append("roomA", "doc1", MUX_SYNC, tag("A1-first"));
      await store.append("roomA", "doc2", MUX_SYNC, tag("A2-first"));
      await store.append("roomB", "doc1", MUX_SYNC, tag("B1-first"));
      await store.append("roomA", "doc1", MUX_SYNC, tag("A1-second"));
      await store.append("roomB", "doc2", MUX_SYNC, tag("B2-first"));
      await store.append("roomA", "doc2", MUX_SYNC, tag("A2-second"));

      expect(labels((await store.read("roomA", "doc1")).map((f) => f.payload))).toEqual([
        "A1-first",
        "A1-second",
      ]);
      expect(labels((await store.read("roomA", "doc2")).map((f) => f.payload))).toEqual([
        "A2-first",
        "A2-second",
      ]);
      expect(labels((await store.read("roomB", "doc1")).map((f) => f.payload))).toEqual([
        "B1-first",
      ]);
      expect(labels((await store.read("roomB", "doc2")).map((f) => f.payload))).toEqual([
        "B2-first",
      ]);
    } finally {
      await store.close();
    }
  });

  it("numbers each stream from 1 and strictly ascending", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.append("roomA", "doc1", MUX_SYNC, tag(`a${i}`));
      }
      for (let i = 0; i < 3; i++) {
        await store.append("roomB", "doc1", MUX_SYNC, tag(`b${i}`));
      }

      const a = await store.read("roomA", "doc1");
      const b = await store.read("roomB", "doc1");

      expect(a.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(b.map((f) => f.seq)).toEqual([1, 2, 3]);
    } finally {
      await store.close();
    }
  });

  it("returns an empty list for a room/doc that was never written", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append("roomA", "doc1", MUX_SYNC, tag("only-one"));

      expect(await store.read("roomA", "unknown-doc")).toEqual([]);
      expect(await store.read("unknown-room", "doc1")).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("clears one stream without touching its siblings", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append("roomA", "doc1", MUX_SYNC, tag("keep-me"));
      await store.append("roomA", "doc2", MUX_SYNC, tag("drop-me"));

      await store.clear("roomA", "doc2");

      expect(await store.read("roomA", "doc2")).toEqual([]);
      expect(labels((await store.read("roomA", "doc1")).map((f) => f.payload))).toEqual(["keep-me"]);
    } finally {
      await store.close();
    }
  });
});
