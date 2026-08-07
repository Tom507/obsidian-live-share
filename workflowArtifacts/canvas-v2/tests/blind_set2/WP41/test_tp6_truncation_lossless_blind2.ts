// WP41 / AC3 — losslessness across repeated compaction rounds.
//
// One checkpoint is easy to get right by accident. This drives three rounds of
// "edit, checkpoint, edit" from two peers and demands both properties at once:
// the store really shrinks (compaction happened at all) and the document that
// comes back out is still bit-for-bit the same document.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "compaction-room";
const DOC = "__canvas__:compaction";

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

function fingerprint(doc: Y.Doc): string {
  return JSON.stringify({
    nodes: Object.entries(doc.getMap("nodes").toJSON()).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    text: doc.getText("content").toString(),
    sv: stateSummary(doc),
  });
}

describe("WP41 AC3 — repeated compaction stays lossless", () => {
  it("survives three checkpoint rounds with two writers", async () => {
    const store = createMemoryBlobStore();
    const peerA = new Y.Doc();
    peerA.clientID = 9001;
    const peerB = new Y.Doc();
    peerB.clientID = 9002;

    try {
      const relay = async (other: Y.Doc, update: Uint8Array) => {
        await store.append(ROOM, DOC, MUX_SYNC, syncPayload(update));
        Y.applyUpdate(other, update, "remote");
      };

      const captured: { doc: Y.Doc; update: Uint8Array }[] = [];
      peerA.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin !== "remote") captured.push({ doc: peerA, update });
      });
      peerB.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin !== "remote") captured.push({ doc: peerB, update });
      });

      const drain = async () => {
        while (captured.length > 0) {
          const item = captured.shift();
          if (!item) break;
          await relay(item.doc === peerA ? peerB : peerA, item.update);
        }
      };

      let frameCountPeak = 0;

      for (let round = 0; round < 3; round++) {
        peerA.getMap("nodes").set(`a-${round}`, round);
        peerB.getMap("nodes").set(`b-${round}`, round * 10);
        peerA.getText("content").insert(peerA.getText("content").length, `A${round}`);
        peerB.getText("content").insert(peerB.getText("content").length, `B${round}`);
        await drain();

        frameCountPeak = Math.max(frameCountPeak, (await store.read(ROOM, DOC)).length);

        // Peer A checkpoints everything it has seen so far.
        const beforeCheckpoint = await store.read(ROOM, DOC);
        const upToSeq = beforeCheckpoint[beforeCheckpoint.length - 1].seq;
        await store.checkpoint(ROOM, DOC, upToSeq, syncPayload(Y.encodeStateAsUpdate(peerA)));

        expect((await store.read(ROOM, DOC)).length).toBe(1);
      }

      // A few more edits after the last compaction.
      peerB.getMap("nodes").set("tail", "final");
      await drain();

      expect(fingerprint(peerB)).toBe(fingerprint(peerA));
      expect(frameCountPeak).toBeGreaterThan(1);

      const frames = await store.read(ROOM, DOC);
      expect(frames.length).toBe(2); // last checkpoint + the tail update

      const rebuilt = new Y.Doc();
      rebuilt.clientID = 9003;
      for (const frame of frames) applySyncPayload(rebuilt, frame.payload);

      expect(fingerprint(rebuilt)).toBe(fingerprint(peerA));

      rebuilt.destroy();
    } finally {
      peerA.destroy();
      peerB.destroy();
      await store.close();
    }
  });
});
