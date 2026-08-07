// WP41 / AC4 — replaying does not consume the store, and replaying twice is a
// no-op.
//
// The relay serves the same blob to every late subscriber. If read() drained
// the stream, or if a second replay changed anything, the second joiner of a
// room would get a different document than the first.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC, decodeMuxMessage, encodeReplay } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "nondestructive-room";
const DOC = "notes/nondestructive.md";

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

describe("WP41 AC4 — replay is non-destructive and repeatable", () => {
  it("returns the same frames on a second read", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 0; i < 4; i++) {
        await store.append(ROOM, DOC, MUX_SYNC, new Uint8Array([i, i + 1, i + 2]));
      }

      const first = await store.read(ROOM, DOC);
      const second = await store.read(ROOM, DOC);

      expect(second.map((f) => f.seq)).toEqual(first.map((f) => f.seq));
      expect(second.map((f) => f.msgType)).toEqual(first.map((f) => f.msgType));
      expect(second.map((f) => Array.from(f.payload))).toEqual(
        first.map((f) => Array.from(f.payload)),
      );
    } finally {
      await store.close();
    }
  });

  it("leaves the document unchanged when the whole replay is applied a second time", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 15001;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, DOC, MUX_SYNC, syncPayload(update)));
      });

      producer.getText("content").insert(0, "first");
      producer.getMap("nodes").set("n1", "value");
      producer.getText("content").insert(5, " second");
      await Promise.all(pending);

      const frames = await store.read(ROOM, DOC);

      const doc = new Y.Doc();
      doc.clientID = 15002;
      for (const frame of frames) applySyncPayload(doc, frame.payload);

      const afterFirst = {
        text: doc.getText("content").toString(),
        nodes: JSON.stringify(doc.getMap("nodes").toJSON()),
        sv: stateSummary(doc),
      };

      for (const frame of frames) applySyncPayload(doc, frame.payload);

      expect({
        text: doc.getText("content").toString(),
        nodes: JSON.stringify(doc.getMap("nodes").toJSON()),
        sv: stateSummary(doc),
      }).toEqual(afterFirst);

      doc.destroy();
    } finally {
      producer.destroy();
      await store.close();
    }
  });

  it("keeps the store byte-identical across a replay", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.append(ROOM, DOC, MUX_SYNC, new Uint8Array([i * 3, i * 7, i * 11]));
      }

      const before = (await store.read(ROOM, DOC)).map((f) => ({
        seq: f.seq,
        msgType: f.msgType,
        payload: Array.from(f.payload),
      }));

      const wire = encodeReplay(DOC, await store.read(ROOM, DOC));
      expect(wire.length).toBe(before.length + 1);
      wire.map(decodeMuxMessage); // consume the batch as a subscriber would

      const after = (await store.read(ROOM, DOC)).map((f) => ({
        seq: f.seq,
        msgType: f.msgType,
        payload: Array.from(f.payload),
      }));

      expect(after).toEqual(before);
    } finally {
      await store.close();
    }
  });

  it("continues numbering after a replay", async () => {
    const store = createMemoryBlobStore();
    try {
      await store.append(ROOM, DOC, MUX_SYNC, new Uint8Array([1]));
      await store.append(ROOM, DOC, MUX_SYNC, new Uint8Array([2]));

      encodeReplay(DOC, await store.read(ROOM, DOC));

      const next = await store.append(ROOM, DOC, MUX_SYNC, new Uint8Array([3]));
      expect(next.seq).toBe(3);
      expect((await store.read(ROOM, DOC)).map((f) => f.seq)).toEqual([1, 2, 3]);
    } finally {
      await store.close();
    }
  });
});
