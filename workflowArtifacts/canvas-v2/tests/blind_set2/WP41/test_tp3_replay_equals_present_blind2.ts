// WP41 / AC2 — replay equals presence across a relay restart and across
// several docs of one room at once.
//
// The Definition of Done is "an empty room retains its docs". This drives that
// literally: all peers leave, every doc of the room is rebuilt from the store,
// and the result must match the merged update stream for that doc — not just
// for one doc, but for each doc independently.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC, MUX_SYNC_ENCRYPTED } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "restart-room";
const DOCS = ["__canvas__:one", "__canvas__:two", "notes/three.md"];

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

describe("WP41 AC2 — an emptied room retains every doc", () => {
  it("rebuilds each doc of the room independently and correctly", async () => {
    const store = createMemoryBlobStore();
    const producers = new Map<string, Y.Doc>();
    const references = new Map<string, string>();
    const pending: Promise<unknown>[] = [];

    try {
      DOCS.forEach((docId, index) => {
        const doc = new Y.Doc();
        doc.clientID = 6200 + index;
        doc.on("update", (update: Uint8Array) => {
          // Two of the three docs run in the encrypted transport mode; the
          // relay stores whichever envelope type it received.
          const msgType = index === 0 ? MUX_SYNC : MUX_SYNC_ENCRYPTED;
          pending.push(store.append(ROOM, docId, msgType, syncPayload(update)));
        });
        producers.set(docId, doc);
      });

      producers.get(DOCS[0])!.getMap("nodes").set("a", 1);
      producers.get(DOCS[1])!.getMap("nodes").set("b", 2);
      producers.get(DOCS[2])!.getText("content").insert(0, "third doc");
      producers.get(DOCS[0])!.getMap("nodes").set("a", 11);
      producers.get(DOCS[1])!.getMap("nodes").set("c", 3);
      producers.get(DOCS[2])!.getText("content").insert(9, " body");

      // Every peer disconnects; the room is empty. Only the store survives.
      for (const [docId, doc] of producers) {
        references.set(
          docId,
          JSON.stringify({
            nodes: Object.entries(doc.getMap("nodes").toJSON()).sort(),
            text: doc.getText("content").toString(),
            sv: stateSummary(doc),
          }),
        );
      }

      await Promise.all(pending);

      for (const docId of DOCS) {
        const frames = await store.read(ROOM, docId);
        expect(frames.length).toBe(2);

        const revived = new Y.Doc();
        revived.clientID = 6299;
        for (const frame of frames) applySyncPayload(revived, frame.payload);

        const actual = JSON.stringify({
          nodes: Object.entries(revived.getMap("nodes").toJSON()).sort(),
          text: revived.getText("content").toString(),
          sv: stateSummary(revived),
        });
        expect(actual).toBe(references.get(docId));
        revived.destroy();
      }
    } finally {
      for (const doc of producers.values()) doc.destroy();
      await store.close();
    }
  });

  it("matches a merged single-update seed for the same doc", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 6401;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, "merge-check", MUX_SYNC, syncPayload(update)));
      });

      const text = producer.getText("content");
      for (let i = 0; i < 12; i++) {
        text.insert(text.length, `chunk${i} `);
      }
      text.delete(0, 7);

      await Promise.all(pending);
      const frames = await store.read(ROOM, "merge-check");

      // Path A: frame-by-frame replay out of the store.
      const fromReplay = new Y.Doc();
      fromReplay.clientID = 6402;
      for (const frame of frames) applySyncPayload(fromReplay, frame.payload);

      // Path B: one merged update, as a checkpointing client would produce.
      const fromMerged = new Y.Doc();
      fromMerged.clientID = 6403;
      Y.applyUpdate(fromMerged, Y.encodeStateAsUpdate(producer));

      expect(fromReplay.getText("content").toString()).toBe(
        fromMerged.getText("content").toString(),
      );
      expect(stateSummary(fromReplay)).toBe(stateSummary(fromMerged));

      fromReplay.destroy();
      fromMerged.destroy();
    } finally {
      producer.destroy();
      await store.close();
    }
  });
});
