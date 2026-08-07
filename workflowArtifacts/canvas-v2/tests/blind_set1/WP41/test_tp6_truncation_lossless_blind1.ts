// WP41 / AC3 — the in-flight race: an update reaches the relay *after* the
// checkpointing client had already snapshotted, but *before* the checkpoint
// frame itself arrives.
//
// That update is provably not inside the checkpoint payload, yet it sits below
// the checkpoint frame's own sequence number. A store that truncates
// "everything before the checkpoint frame" instead of "everything up to
// upToSeq" silently eats it — and nothing else in the system would notice,
// because the frame count still looks plausible.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "race-room";
const DOC = "__canvas__:race";

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

function sortedNodes(doc: Y.Doc): [string, unknown][] {
  return Object.entries(doc.getMap("nodes").toJSON()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

describe("WP41 AC3 — the in-flight update survives truncation", () => {
  it("keeps a frame whose seq is above upToSeq but below the checkpoint frame", async () => {
    const store = createMemoryBlobStore();
    const alice = new Y.Doc();
    alice.clientID = 8101;
    const bob = new Y.Doc();
    bob.clientID = 8102;

    try {
      // Alice writes three updates; the relay stores them as seq 1..3.
      const aliceUpdates: Uint8Array[] = [];
      alice.on("update", (update: Uint8Array) => {
        aliceUpdates.push(update);
      });
      alice.getMap("nodes").set("a1", "v1");
      alice.getMap("nodes").set("a2", "v2");
      alice.getMap("nodes").set("a3", "v3");

      for (const update of aliceUpdates) {
        await store.append(ROOM, DOC, MUX_SYNC, syncPayload(update));
        Y.applyUpdate(bob, update, "remote");
      }
      expect((await store.read(ROOM, DOC)).map((f) => f.seq)).toEqual([1, 2, 3]);

      // Alice snapshots her state — this is exactly what her checkpoint
      // contains. She has not seen anything from Bob yet.
      const checkpointPayload = syncPayload(Y.encodeStateAsUpdate(alice));

      // Bob's edit reaches the relay first and becomes seq 4.
      const bobUpdates: Uint8Array[] = [];
      bob.on("update", (update: Uint8Array) => {
        bobUpdates.push(update);
      });
      bob.getMap("nodes").set("b1", "from-bob");
      expect(bobUpdates).toHaveLength(1);
      await store.append(ROOM, DOC, MUX_SYNC, syncPayload(bobUpdates[0]));

      // Only now does Alice's checkpoint land, superseding seq 1..3 only.
      const checkpointFrame = await store.checkpoint(ROOM, DOC, 3, checkpointPayload);
      expect(checkpointFrame.seq).toBe(5);

      const frames = await store.read(ROOM, DOC);
      expect(frames.map((f) => f.seq)).toEqual([4, 5]);

      // Reference: everything that ever happened, from both peers.
      const reference = new Y.Doc();
      reference.clientID = 8103;
      Y.applyUpdate(reference, Y.encodeStateAsUpdate(alice));
      Y.applyUpdate(reference, Y.encodeStateAsUpdate(bob));

      const rebuilt = new Y.Doc();
      rebuilt.clientID = 8104;
      for (const frame of frames) applySyncPayload(rebuilt, frame.payload);

      expect(sortedNodes(rebuilt)).toEqual(sortedNodes(reference));
      expect(rebuilt.getMap("nodes").get("b1")).toBe("from-bob");
      expect(rebuilt.getMap("nodes").get("a3")).toBe("v3");
      expect(stateSummary(rebuilt)).toBe(stateSummary(reference));

      reference.destroy();
      rebuilt.destroy();
    } finally {
      alice.destroy();
      bob.destroy();
      await store.close();
    }
  });

  it("survives the reverse arrival order of the same two frames", async () => {
    const store = createMemoryBlobStore();
    const alice = new Y.Doc();
    alice.clientID = 8201;
    const bob = new Y.Doc();
    bob.clientID = 8202;

    try {
      const aliceUpdates: Uint8Array[] = [];
      alice.on("update", (update: Uint8Array) => aliceUpdates.push(update));
      alice.getMap("nodes").set("a1", "v1");
      alice.getMap("nodes").set("a2", "v2");

      for (const update of aliceUpdates) {
        await store.append(ROOM, "reverse-doc", MUX_SYNC, syncPayload(update));
        Y.applyUpdate(bob, update, "remote");
      }

      const checkpointPayload = syncPayload(Y.encodeStateAsUpdate(alice));

      // Checkpoint lands first (seq 3), Bob's edit second (seq 4).
      await store.checkpoint(ROOM, "reverse-doc", 2, checkpointPayload);

      const bobUpdates: Uint8Array[] = [];
      bob.on("update", (update: Uint8Array) => bobUpdates.push(update));
      bob.getMap("nodes").set("b1", "late");
      await store.append(ROOM, "reverse-doc", MUX_SYNC, syncPayload(bobUpdates[0]));

      const reference = new Y.Doc();
      reference.clientID = 8203;
      Y.applyUpdate(reference, Y.encodeStateAsUpdate(alice));
      Y.applyUpdate(reference, Y.encodeStateAsUpdate(bob));

      const rebuilt = new Y.Doc();
      rebuilt.clientID = 8204;
      for (const frame of await store.read(ROOM, "reverse-doc")) {
        applySyncPayload(rebuilt, frame.payload);
      }

      expect(sortedNodes(rebuilt)).toEqual(sortedNodes(reference));
      expect(stateSummary(rebuilt)).toBe(stateSummary(reference));

      reference.destroy();
      rebuilt.destroy();
    } finally {
      alice.destroy();
      bob.destroy();
      await store.close();
    }
  });
});
