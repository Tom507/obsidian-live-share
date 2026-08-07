// WP41 / AC2 — replay equals presence, with three concurrent writers.
//
// "Never reason from two peers only": with three peers the interleaving
// classes are genuinely different. Here the three peers converge among
// themselves first, the relay keeps every frame it saw, and a fourth client
// that arrives afterwards must land on exactly the converged state.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MUX_SYNC } from "../../mux-protocol.js";
import { createMemoryBlobStore } from "../../persistence.js";

const ROOM = "three-peer-room";
const DOC = "__canvas__:7c31-multi";

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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
      a[0] < b[0] ? -1 : 1,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("WP41 AC2 — three writers, one late reader", () => {
  it("replays a fully converged three-peer state to a fourth client", async () => {
    const store = createMemoryBlobStore();
    const peers: Y.Doc[] = [];
    const pending: Promise<unknown>[] = [];

    try {
      for (let i = 0; i < 3; i++) {
        const doc = new Y.Doc();
        doc.clientID = 5100 + i;
        peers.push(doc);
      }

      // The relay is the fan-out point: every local update is stored and
      // forwarded to the other two peers.
      for (const origin of peers) {
        origin.on("update", (update: Uint8Array, updateOrigin: unknown) => {
          if (updateOrigin === "fanout") return;
          pending.push(store.append(ROOM, DOC, MUX_SYNC, syncPayload(update)));
          for (const other of peers) {
            if (other !== origin) Y.applyUpdate(other, update, "fanout");
          }
        });
      }

      // Interleaved edits across all three peers, including a same-key race.
      peers[0].getMap("nodes").set("card-a", { pos: [0, 0], color: "1" });
      peers[1].getMap("nodes").set("card-b", { pos: [200, 0], color: "2" });
      peers[2].getMap("nodes").set("card-c", { pos: [400, 0], color: "3" });
      peers[1].getMap("nodes").set("card-a", { pos: [10, 10], color: "1" });
      peers[2].getMap("edges").set("e1", { from: "card-a", to: "card-b" });
      peers[0].getArray("order").insert(0, ["card-a", "card-b"]);
      peers[2].getArray("order").insert(0, ["card-c"]);
      peers[0].getMap("nodes").delete("card-b");

      const fingerprint = (doc: Y.Doc) =>
        canonicalJson({
          nodes: doc.getMap("nodes").toJSON(),
          edges: doc.getMap("edges").toJSON(),
          order: doc.getArray("order").toJSON(),
        });

      // The three live peers agree.
      expect(fingerprint(peers[1])).toBe(fingerprint(peers[0]));
      expect(fingerprint(peers[2])).toBe(fingerprint(peers[0]));

      await Promise.all(pending);
      const frames = await store.read(ROOM, DOC);
      expect(frames.length).toBeGreaterThanOrEqual(8);

      const lateJoiner = new Y.Doc();
      lateJoiner.clientID = 5199;
      for (const frame of frames) applySyncPayload(lateJoiner, frame.payload);

      expect(fingerprint(lateJoiner)).toBe(fingerprint(peers[0]));
      expect(stateSummary(lateJoiner)).toBe(stateSummary(peers[0]));

      lateJoiner.destroy();
    } finally {
      for (const doc of peers) doc.destroy();
      await store.close();
    }
  });

  it("replays a doc whose only content is a deletion of everything", async () => {
    const store = createMemoryBlobStore();
    const producer = new Y.Doc();
    producer.clientID = 5301;
    const pending: Promise<unknown>[] = [];

    try {
      producer.on("update", (update: Uint8Array) => {
        pending.push(store.append(ROOM, "empty-again", MUX_SYNC, syncPayload(update)));
      });

      const nodes = producer.getMap<string>("nodes");
      nodes.set("only", "value");
      nodes.delete("only");

      await Promise.all(pending);
      const frames = await store.read(ROOM, "empty-again");
      const lateJoiner = new Y.Doc();
      lateJoiner.clientID = 5302;
      for (const frame of frames) applySyncPayload(lateJoiner, frame.payload);

      expect(lateJoiner.getMap("nodes").toJSON()).toEqual({});
      expect(stateSummary(lateJoiner)).toBe(stateSummary(producer));

      lateJoiner.destroy();
    } finally {
      producer.destroy();
      await store.close();
    }
  });
});
