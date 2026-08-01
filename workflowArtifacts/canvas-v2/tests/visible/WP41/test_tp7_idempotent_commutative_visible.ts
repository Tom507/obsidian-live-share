// WP41 / AC4 — replay is idempotent and order-insensitive.
//
// This is the CRDT property the whole relay design rests on (BUILD_SPEC C41
// fuzzer link, WP23 "replay" op). The same stored frame set, applied to a fresh
// doc in the original order, in a deterministically shuffled order, and with
// duplicates mixed in, must produce one and the same document.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC } from "../../mux-protocol.js";
import { type StoredFrame, createMemoryBlobStore } from "../../persistence.js";

const ROOM = "commutativity-room";
const DOC = "__canvas__:commutative";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

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

function replayInto(frames: readonly StoredFrame[], clientId: number): string {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  for (const frame of frames) applySyncPayload(doc, frame.payload);
  const result = fingerprint(doc);
  doc.destroy();
  return result;
}

describe("WP41 AC4 — idempotent and commutative replay", () => {
  it("produces one state for original order, shuffled order and duplicates", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 3001;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, DOC, MUX_SYNC, syncPayload(update)));
      });

      const nodes = producer.getMap<unknown>("nodes");
      const text = producer.getText("content");
      for (let i = 0; i < 8; i++) {
        nodes.set(`node-${i}`, { pos: [i * 10, i * 5], size: [200, 60] });
        text.insert(text.length, `line${i} `);
      }
      nodes.set("node-3", { pos: [999, 999], size: [200, 60] });
      nodes.delete("node-5");

      await Promise.all(pending);
      const frames = await store.read(ROOM, DOC);
      expect(frames.length).toBeGreaterThanOrEqual(16);

      const inOrder = replayInto(frames, 3002);
      const shuffledOnce = replayInto(shuffled(frames, 0xc0ffee), 3003);
      const withDuplicates = replayInto([...frames, ...shuffled(frames, 0xbadf00d)], 3004);

      expect(shuffledOnce).toBe(inOrder);
      expect(withDuplicates).toBe(inOrder);

      // And the replayed state is the producer's state.
      expect(inOrder).toBe(fingerprint(producer));
    } finally {
      producer.destroy();
      await store.close();
    }
  });

  it("is unaffected by replaying every frame three times in a row", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 3101;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, "triple", MUX_SYNC, syncPayload(update)));
      });

      producer.getText("content").insert(0, "one");
      producer.getText("content").insert(3, " two");
      producer.getText("content").insert(7, " three");

      await Promise.all(pending);
      const frames = await store.read(ROOM, "triple");

      const tripled: StoredFrame[] = [];
      for (const frame of frames) {
        tripled.push(frame, frame, frame);
      }

      expect(replayInto(tripled, 3102)).toBe(replayInto(frames, 3103));
      expect(replayInto(frames, 3104)).toBe(fingerprint(producer));
    } finally {
      producer.destroy();
      await store.close();
    }
  });
});
