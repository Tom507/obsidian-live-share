// WP41 / AC3 — "truncation never loses an update that the checkpoint does not
// contain."
//
// The oracle is the document, not the frame count: whatever the store holds
// after a checkpoint must still rebuild the producer's exact state.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "lossless-room";
const DOC = "__canvas__:lossless";

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

function nodesJson(doc: Y.Doc): string {
  return JSON.stringify(Object.entries(doc.getMap("nodes").toJSON()).sort());
}

describe("WP41 AC3 — truncation is lossless", () => {
  it("rebuilds the full state from checkpoint plus the frames it did not cover", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 7001;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, DOC, MUX_SYNC, syncPayload(update)));
      });

      const nodes = producer.getMap<string>("nodes");
      nodes.set("a", "1"); // seq 1
      nodes.set("b", "2"); // seq 2
      nodes.set("c", "3"); // seq 3
      await Promise.all(pending);

      // The client has applied 1..3 and folds them into one checkpoint frame.
      const checkpointPayload = syncPayload(Y.encodeStateAsUpdate(producer));
      await store.checkpoint(ROOM, DOC, 3, checkpointPayload); // seq 4

      // Work continues afterwards.
      nodes.set("d", "4"); // seq 5
      nodes.set("a", "11"); // seq 6
      await Promise.all(pending);

      const frames = await store.read(ROOM, DOC);
      expect(frames.map((f) => f.seq)).toEqual([4, 5, 6]);

      const rebuilt = new Y.Doc();
      rebuilt.clientID = 7002;
      for (const frame of frames) applySyncPayload(rebuilt, frame.payload);

      expect(nodesJson(rebuilt)).toBe(nodesJson(producer));
      expect(nodesJson(rebuilt)).toBe(
        JSON.stringify([
          ["a", "11"],
          ["b", "2"],
          ["c", "3"],
          ["d", "4"],
        ]),
      );
      expect(stateSummary(rebuilt)).toBe(stateSummary(producer));

      rebuilt.destroy();
    } finally {
      producer.destroy();
      await store.close();
    }
  });

  it("keeps text edits that landed after the checkpoint's supersede point", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 7101;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, "notes/lossless.md", MUX_SYNC, syncPayload(update)));
      });

      const text = producer.getText("content");
      text.insert(0, "alpha ");
      text.insert(6, "beta ");
      await Promise.all(pending);

      await store.checkpoint(
        ROOM,
        "notes/lossless.md",
        2,
        syncPayload(Y.encodeStateAsUpdate(producer)),
      );

      text.insert(text.length, "gamma");
      await Promise.all(pending);

      const rebuilt = new Y.Doc();
      rebuilt.clientID = 7102;
      for (const frame of await store.read(ROOM, "notes/lossless.md")) {
        applySyncPayload(rebuilt, frame.payload);
      }

      expect(rebuilt.getText("content").toString()).toBe("alpha beta gamma");
      expect(stateSummary(rebuilt)).toBe(stateSummary(producer));

      rebuilt.destroy();
    } finally {
      producer.destroy();
      await store.close();
    }
  });
});
