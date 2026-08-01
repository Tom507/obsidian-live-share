// WP41 / AC4 — replay must not disturb the neighbours, and it must survive
// being interleaved with checkpointing.
//
// Angle: the destructive-read failure mode does not always look like an empty
// store. It can also look like "replaying doc A reset doc B's sequence
// counter", or "a replay taken before a checkpoint is still valid after it".
// Both are checked from state alone.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC, encodeReplay } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "interleaved-room";

function syncPayload(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function applySyncPayload(doc: Y.Doc, payload: Uint8Array): void {
  const decoder = decoding.createDecoder(payload);
  const encoder = encoding.createEncoder();
  syncProtocol.readSyncMessage(decoder, encoder, doc, "replay");
}

function stateSummary(doc: Y.Doc): string {
  const sv = Y.decodeStateVector(Y.encodeStateVector(doc));
  return [...sv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([client, clock]) => `${client}:${clock}`)
    .join(",");
}

describe("WP41 AC4 — replay does not disturb neighbouring state", () => {
  it("replaying one doc leaves every other doc's frames and counters untouched", async () => {
    const store = createMemoryBlobStore();
    try {
      const docs = ["doc-a", "doc-b", "doc-c"];
      for (const docId of docs) {
        for (let i = 0; i < 3; i++) {
          await store.append(ROOM, docId, MUX_SYNC, new Uint8Array([i]));
        }
      }

      // Replay doc-a five times over.
      for (let i = 0; i < 5; i++) {
        encodeReplay("doc-a", await store.read(ROOM, "doc-a"));
      }

      for (const docId of docs) {
        const frames = await store.read(ROOM, docId);
        expect(frames.map((f) => f.seq)).toEqual([1, 2, 3]);
        const next = await store.append(ROOM, docId, MUX_SYNC, new Uint8Array([9]));
        expect(next.seq).toBe(4);
      }
    } finally {
      await store.close();
    }
  });

  it("a replay snapshot taken before a checkpoint still rebuilds the same document", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 17001;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, "cp-doc", MUX_SYNC, syncPayload(update)));
      });

      producer.getText("content").insert(0, "aa");
      producer.getText("content").insert(2, "bb");
      producer.getText("content").insert(4, "cc");
      await Promise.all(pending);

      // Joiner 1 takes its replay now.
      const snapshotBefore = await store.read(ROOM, "cp-doc");

      // Meanwhile the store gets compacted.
      await store.checkpoint(ROOM, "cp-doc", 3, syncPayload(Y.encodeStateAsUpdate(producer)));

      // Joiner 2 takes its replay after the compaction.
      const snapshotAfter = await store.read(ROOM, "cp-doc");
      expect(snapshotAfter.length).toBeLessThan(snapshotBefore.length);

      const docOne = new Y.Doc();
      docOne.clientID = 17002;
      for (const frame of snapshotBefore) applySyncPayload(docOne, frame.payload);

      const docTwo = new Y.Doc();
      docTwo.clientID = 17003;
      for (const frame of snapshotAfter) applySyncPayload(docTwo, frame.payload);

      expect(docTwo.getText("content").toString()).toBe(docOne.getText("content").toString());
      expect(docOne.getText("content").toString()).toBe("aabbcc");
      expect(stateSummary(docTwo)).toBe(stateSummary(docOne));

      docOne.destroy();
      docTwo.destroy();
    } finally {
      producer.destroy();
      await store.close();
    }
  });

  it("close() does not require a prior replay and leaves close idempotent", async () => {
    const store = createMemoryBlobStore();
    await store.append(ROOM, "close-doc", MUX_SYNC, new Uint8Array([1, 2, 3]));
    await expect(store.close()).resolves.toBeUndefined();
    await expect(store.close()).resolves.toBeUndefined();
  });
});
