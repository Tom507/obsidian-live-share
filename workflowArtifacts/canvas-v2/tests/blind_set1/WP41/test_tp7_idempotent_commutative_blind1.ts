// WP41 / AC4 — commutativity where it actually hurts: concurrent writes to the
// same register from three independent peers, replayed in adversarial orders.
//
// Same-key races are the only case where "any order gives the same result" is
// not obvious. Yjs resolves them by clientID, so a replay in reverse order or
// in a hostile permutation must still land on the same winner — otherwise the
// relay's persistence layer would be a divergence source, not a recovery one.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC } from "../../mux-protocol.js";
import { type StoredFrame, createMemoryBlobStore } from "../../persistence.js";

const ROOM = "same-key-room";
const DOC = "__canvas__:same-key";

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
    edges: Object.entries(doc.getMap("edges").toJSON()).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    sv: stateSummary(doc),
  });
}

function replay(frames: readonly StoredFrame[], clientId: number): string {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  for (const frame of frames) applySyncPayload(doc, frame.payload);
  const result = fingerprint(doc);
  doc.destroy();
  return result;
}

// Deterministic "rotate by k" permutations — structurally different from a
// Fisher-Yates shuffle, and they systematically break causal order.
function rotate<T>(items: readonly T[], k: number): T[] {
  const n = items.length;
  const offset = ((k % n) + n) % n;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

describe("WP41 AC4 — commutativity under same-key races", () => {
  it("resolves a three-way race identically in every replay order", async () => {
    const store = createMemoryBlobStore();
    const peers: Y.Doc[] = [];

    try {
      for (let i = 0; i < 3; i++) {
        const doc = new Y.Doc();
        doc.clientID = 21000 + i * 7;
        peers.push(doc);
      }

      const captured: Uint8Array[] = [];
      for (const peer of peers) {
        peer.on("update", (update: Uint8Array, origin: unknown) => {
          if (origin !== "remote") captured.push(update);
        });
      }

      // Three peers write the SAME key while unaware of each other.
      peers[0].getMap("nodes").set("contested", "from-peer-0");
      peers[1].getMap("nodes").set("contested", "from-peer-1");
      peers[2].getMap("nodes").set("contested", "from-peer-2");
      peers[0].getMap("edges").set("e1", { from: "a", to: "b" });
      peers[1].getMap("edges").set("e1", { from: "a", to: "c" });
      peers[2].getMap("nodes").set("uncontested", "solo");

      for (const update of captured) {
        await store.append(ROOM, DOC, MUX_SYNC, syncPayload(update));
      }

      const frames = await store.read(ROOM, DOC);
      expect(frames.length).toBe(6);

      const baseline = replay(frames, 21500);
      for (const k of [1, 2, 3, 4, 5]) {
        expect(replay(rotate(frames, k), 21500 + k)).toBe(baseline);
      }
      expect(replay([...frames].reverse(), 21600)).toBe(baseline);

      // The winner must be a real candidate, and it must be stable.
      const winnerDoc = new Y.Doc();
      winnerDoc.clientID = 21700;
      for (const frame of [...frames].reverse()) applySyncPayload(winnerDoc, frame.payload);
      expect(["from-peer-0", "from-peer-1", "from-peer-2"]).toContain(
        winnerDoc.getMap("nodes").get("contested"),
      );
      expect(winnerDoc.getMap("nodes").get("uncontested")).toBe("solo");
      winnerDoc.destroy();
    } finally {
      for (const doc of peers) doc.destroy();
      await store.close();
    }
  });

  it("is unchanged when the reversed order is also duplicated", async () => {
    const store = createMemoryBlobStore();
    const peers: Y.Doc[] = [];

    try {
      for (let i = 0; i < 3; i++) {
        const doc = new Y.Doc();
        doc.clientID = 22000 + i * 13;
        peers.push(doc);
      }

      const captured: Uint8Array[] = [];
      for (const peer of peers) {
        peer.on("update", (update: Uint8Array, origin: unknown) => {
          if (origin !== "remote") captured.push(update);
        });
      }

      for (let round = 0; round < 3; round++) {
        peers[round].getMap("nodes").set("shared", `round-${round}`);
        peers[round].getMap("nodes").set(`own-${round}`, round);
      }

      for (const update of captured) {
        await store.append(ROOM, "dup-doc", MUX_SYNC, syncPayload(update));
      }
      const frames = await store.read(ROOM, "dup-doc");

      const baseline = replay(frames, 22500);
      const reversedAndDoubled = [...frames].reverse().flatMap((f) => [f, f]);
      expect(replay(reversedAndDoubled, 22501)).toBe(baseline);

      const interleavedDuplicates = frames.flatMap((f, i) =>
        i % 2 === 0 ? [f, frames[0], f] : [f],
      );
      expect(replay(interleavedDuplicates, 22502)).toBe(baseline);
    } finally {
      for (const doc of peers) doc.destroy();
      await store.close();
    }
  });
});
