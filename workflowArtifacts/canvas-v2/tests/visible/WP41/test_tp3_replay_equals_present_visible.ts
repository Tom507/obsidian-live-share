// WP41 / AC2 — a client that arrives late and gets the stored frames ends up
// in exactly the state of a client that was present the whole time.
//
// The "present throughout" peer receives every update live as it is produced.
// The late joiner sees nothing live and is rebuilt purely from what the relay
// kept. Both must agree.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "late-join-room";
const DOC = "notes/session.md";

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

// Order-insensitive structural fingerprint: clientID -> clock, sorted.
function stateSummary(doc: Y.Doc): string {
  const sv = Y.decodeStateVector(Y.encodeStateVector(doc));
  return [...sv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([client, clock]) => `${client}:${clock}`)
    .join(",");
}

describe("WP41 AC2 — replay equals presence", () => {
  it("brings a late joiner to the state of a peer present throughout", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 4001;
    const present = new Y.Doc();
    present.clientID = 4002;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        // The live peer gets it immediately; the relay keeps a copy.
        Y.applyUpdate(present, update, "live");
        pending.push(store.append(ROOM, DOC, MUX_SYNC, syncPayload(update)));
      });

      producer.getText("content").insert(0, "hello ");
      producer.getText("content").insert(6, "canvas");
      producer.getText("content").delete(0, 6);

      // Everything the producer emitted is now in the store.
      await Promise.all(pending);
      const frames = await store.read(ROOM, DOC);
      expect(frames.length).toBe(3);

      const lateJoiner = new Y.Doc();
      lateJoiner.clientID = 4003;
      for (const frame of frames) {
        applySyncPayload(lateJoiner, frame.payload);
      }

      expect(lateJoiner.getText("content").toString()).toBe("canvas");
      expect(lateJoiner.getText("content").toString()).toBe(
        present.getText("content").toString(),
      );
      expect(stateSummary(lateJoiner)).toBe(stateSummary(present));

      lateJoiner.destroy();
    } finally {
      producer.destroy();
      present.destroy();
      await store.close();
    }
  });

  it("reproduces a canvas-shaped Y.Map document from the stored frames alone", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 4101;
    const present = new Y.Doc();
    present.clientID = 4102;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        Y.applyUpdate(present, update, "live");
        pending.push(store.append(ROOM, "__canvas__:board", MUX_SYNC, syncPayload(update)));
      });

      const nodes = producer.getMap<string>("nodes");
      nodes.set("n1", "pos:0,0");
      nodes.set("n2", "pos:120,40");
      nodes.set("n1", "pos:10,10"); // LWW overwrite
      nodes.delete("n2");
      nodes.set("n3", "pos:300,300");

      await Promise.all(pending);
      const frames = await store.read(ROOM, "__canvas__:board");
      const lateJoiner = new Y.Doc();
      lateJoiner.clientID = 4103;
      for (const frame of frames) {
        applySyncPayload(lateJoiner, frame.payload);
      }

      const canonical = (doc: Y.Doc) =>
        JSON.stringify(
          Object.entries(doc.getMap("nodes").toJSON()).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
        );

      expect(canonical(lateJoiner)).toBe(canonical(present));
      expect(canonical(lateJoiner)).toBe(
        JSON.stringify([
          ["n1", "pos:10,10"],
          ["n3", "pos:300,300"],
        ]),
      );
      expect(stateSummary(lateJoiner)).toBe(stateSummary(present));

      lateJoiner.destroy();
    } finally {
      producer.destroy();
      present.destroy();
      await store.close();
    }
  });

  it("gives an empty replay for a doc nobody ever wrote", async () => {
    const store = createMemoryBlobStore();
    try {
      const frames = await store.read(ROOM, "never-touched");
      expect(frames).toEqual([]);

      const lateJoiner = new Y.Doc();
      for (const frame of frames) applySyncPayload(lateJoiner, frame.payload);
      expect(lateJoiner.getText("content").toString()).toBe("");
      lateJoiner.destroy();
    } finally {
      await store.close();
    }
  });
});
