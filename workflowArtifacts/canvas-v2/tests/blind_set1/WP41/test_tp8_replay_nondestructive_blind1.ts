// WP41 / AC4 — many subscribers, one blob.
//
// A room can be joined by several clients in a row. Each of them gets its own
// replay from the same store; all of them must end up on the same document,
// and the encoded batch must be byte-stable across calls (no per-call
// timestamp, counter or nonce leaking into the wire form).
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC, encodeReplay } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "many-joiners-room";
const DOC = "__canvas__:many-joiners";

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

describe("WP41 AC4 — one blob serves every joiner", () => {
  it("gives five successive joiners the same document", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 16001;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, DOC, MUX_SYNC, syncPayload(update)));
      });

      const nodes = producer.getMap<unknown>("nodes");
      nodes.set("card", { pos: [4, 4] });
      nodes.set("other", { pos: [40, 40] });
      nodes.set("card", { pos: [8, 8] });
      await Promise.all(pending);

      const fingerprints: string[] = [];
      for (let joiner = 0; joiner < 5; joiner++) {
        const frames = await store.read(ROOM, DOC);
        const doc = new Y.Doc();
        doc.clientID = 16100 + joiner;
        for (const frame of frames) applySyncPayload(doc, frame.payload);
        fingerprints.push(
          JSON.stringify({
            nodes: Object.entries(doc.getMap("nodes").toJSON()).sort((a, b) =>
              a[0] < b[0] ? -1 : 1,
            ),
            sv: stateSummary(doc),
          }),
        );
        doc.destroy();
      }

      expect(new Set(fingerprints).size).toBe(1);
      expect(fingerprints[0]).toContain("8,8");
    } finally {
      producer.destroy();
      await store.close();
    }
  });

  it("produces a byte-stable replay batch across repeated calls", async () => {
    const store = createMemoryBlobStore();
    try {
      for (let i = 0; i < 6; i++) {
        await store.append(ROOM, "stable-doc", MUX_SYNC, new Uint8Array([i, 255 - i]));
      }

      const first = encodeReplay("stable-doc", await store.read(ROOM, "stable-doc"));
      const second = encodeReplay("stable-doc", await store.read(ROOM, "stable-doc"));
      const third = encodeReplay("stable-doc", await store.read(ROOM, "stable-doc"));

      expect(second.map((m) => Array.from(m))).toEqual(first.map((m) => Array.from(m)));
      expect(third.map((m) => Array.from(m))).toEqual(first.map((m) => Array.from(m)));
    } finally {
      await store.close();
    }
  });

  it("serves a joiner correctly while new frames keep arriving between joins", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 16501;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, "growing-doc", MUX_SYNC, syncPayload(update)));
      });

      const seen: number[] = [];
      for (let round = 0; round < 3; round++) {
        producer.getMap("nodes").set(`r${round}`, round);
        await Promise.all(pending);

        const frames = await store.read(ROOM, "growing-doc");
        seen.push(frames.length);

        const doc = new Y.Doc();
        doc.clientID = 16600 + round;
        for (const frame of frames) applySyncPayload(doc, frame.payload);
        expect(Object.keys(doc.getMap("nodes").toJSON()).sort()).toEqual(
          Array.from({ length: round + 1 }, (_, i) => `r${i}`),
        );
        doc.destroy();
      }

      expect(seen).toEqual([1, 2, 3]);
    } finally {
      producer.destroy();
      await store.close();
    }
  });
});
