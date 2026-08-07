// WP41 / AC4 — the property stated as a property: over many deterministic
// seeds, every permutation-with-duplication of the stored frame set converges
// to the same document.
//
// One hand-picked shuffle can pass by luck. This sweeps 16 seeds, each with its
// own permutation and its own duplication pattern, and additionally checks the
// "partially synced client" case: a doc that already holds a random subset of
// the frames must land on the same state once the full replay arrives.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC, MUX_SYNC_ENCRYPTED } from "../../mux-protocol.js";
import { type StoredFrame, createMemoryBlobStore } from "../../persistence.js";

const ROOM = "property-room";
const DOC = "__canvas__:property";
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

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
    list: doc.getArray("order").toJSON(),
    text: doc.getText("content").toString(),
    sv: stateSummary(doc),
  });
}

// Permutation + duplication in one deterministic pass.
function perturb(frames: readonly StoredFrame[], seed: number): StoredFrame[] {
  const rand = mulberry32(seed);
  const permuted = [...frames];
  for (let i = permuted.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [permuted[i], permuted[j]] = [permuted[j], permuted[i]];
  }
  const out: StoredFrame[] = [];
  for (const frame of permuted) {
    const copies = 1 + Math.floor(rand() * 3); // 1..3 copies
    for (let c = 0; c < copies; c++) out.push(frame);
  }
  return out;
}

async function buildStore() {
  const store = createMemoryBlobStore();
  const peers: Y.Doc[] = [];
  for (let i = 0; i < 4; i++) {
    const doc = new Y.Doc();
    doc.clientID = 31000 + i * 101;
    peers.push(doc);
  }

  const captured: Uint8Array[] = [];
  for (const peer of peers) {
    peer.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") captured.push(update);
    });
  }

  const rand = mulberry32(0xfeed);
  for (let step = 0; step < 24; step++) {
    const peer = peers[Math.floor(rand() * peers.length)];
    const choice = step % 4;
    if (choice === 0) peer.getMap("nodes").set(`k${step % 7}`, step);
    else if (choice === 1) peer.getArray("order").insert(0, [`o${step}`]);
    else if (choice === 2) peer.getText("content").insert(0, `t${step}`);
    else peer.getMap("nodes").set(`k${step % 5}`, { pos: [step, step * 2] });
  }

  for (let i = 0; i < captured.length; i++) {
    await store.append(ROOM, DOC, i % 5 === 0 ? MUX_SYNC_ENCRYPTED : MUX_SYNC, syncPayload(captured[i]));
  }

  return { store, peers, frames: await store.read(ROOM, DOC) };
}

describe("WP41 AC4 — convergence as a property over seeds", () => {
  it("converges to the same document for 16 independent perturbations", async () => {
    const { store, peers, frames } = await buildStore();
    try {
      expect(frames.length).toBeGreaterThanOrEqual(20);

      const reference = new Y.Doc();
      reference.clientID = 39000;
      for (const frame of frames) applySyncPayload(reference, frame.payload);
      const expected = fingerprint(reference);
      reference.destroy();

      for (const seed of SEEDS) {
        const doc = new Y.Doc();
        doc.clientID = 39000 + seed;
        for (const frame of perturb(frames, seed)) applySyncPayload(doc, frame.payload);
        expect(fingerprint(doc)).toBe(expected);
        doc.destroy();
      }
    } finally {
      for (const doc of peers) doc.destroy();
      await store.close();
    }
  });

  it("lands on the same state for a client that already holds a subset", async () => {
    const { store, peers, frames } = await buildStore();
    try {
      const reference = new Y.Doc();
      reference.clientID = 38000;
      for (const frame of frames) applySyncPayload(reference, frame.payload);
      const expected = fingerprint(reference);
      reference.destroy();

      for (const seed of SEEDS.slice(0, 8)) {
        const rand = mulberry32(seed);
        const doc = new Y.Doc();
        doc.clientID = 38000 + seed;

        // The client already got a random subset live...
        for (const frame of frames) {
          if (rand() < 0.5) applySyncPayload(doc, frame.payload);
        }
        // ...and then the relay replays everything.
        for (const frame of frames) applySyncPayload(doc, frame.payload);

        expect(fingerprint(doc)).toBe(expected);
        doc.destroy();
      }
    } finally {
      for (const doc of peers) doc.destroy();
      await store.close();
    }
  });
});
