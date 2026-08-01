// WP42 / C42 AC2 — the client's resulting state is IDENTICAL whether it received
// a relay replay or synced from a live peer.
//
// Real Yjs on both sides; the oracle is the encoded doc state, never a log line.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MUX_REPLAY_END,
  MUX_SYNC,
  createReplayGate,
  decodeCheckpointFrame,
  encodeCheckpointFrame,
  encodeReplayEndBody,
} from "../../sync/mux-protocol.js";
import type { GatedFrame } from "../../sync/mux-protocol.js";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stable(src[k]);
    return out;
  }
  return value;
}

function docSnapshot(doc: Y.Doc): string {
  const mirror = new Y.Doc();
  Y.applyUpdate(mirror, Y.encodeStateAsUpdate(doc));
  return JSON.stringify(
    stable({
      nodes: mirror.getMap("nodes").toJSON(),
      edges: mirror.getMap("edges").toJSON(),
      content: mirror.getText("content").toString(),
    }),
  );
}

/** Author a deterministic history on one peer and capture every update. */
function authorHistory(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));

  doc.transact(() => {
    const nodes = doc.getMap("nodes");
    const a = new Y.Map<unknown>();
    a.set("pos", { x: 0, y: 0 });
    a.set("text", "root");
    nodes.set("node-a", a);
  });
  doc.transact(() => {
    const nodes = doc.getMap("nodes");
    const b = new Y.Map<unknown>();
    b.set("pos", { x: 240, y: 60 });
    b.set("text", "child");
    nodes.set("node-b", b);
  });
  doc.transact(() => {
    const edge = new Y.Map<unknown>();
    edge.set("from", { node: "node-a", side: "right" });
    edge.set("to", { node: "node-b", side: "left" });
    doc.getMap("edges").set("edge-1", edge);
  });
  doc.transact(() => {
    (doc.getMap("nodes").get("node-a") as Y.Map<unknown>).set("pos", { x: 5, y: 5 });
  });

  return { doc, updates };
}

const DOC = "__canvas__:g";

function replayEnd(lastSeq: number): GatedFrame {
  return { docId: DOC, msgType: MUX_REPLAY_END, payload: encodeReplayEndBody(lastSeq) };
}

/** Drive a batch of stored frames through the gate into a target doc. */
function replayInto(target: Y.Doc, blobs: Uint8Array[]): void {
  const gate = createReplayGate();
  gate.beginReplay(DOC);
  for (const blob of blobs) {
    for (const out of gate.accept({ docId: DOC, msgType: MUX_SYNC, payload: blob })) {
      Y.applyUpdate(target, out.payload);
    }
  }
  for (const out of gate.accept(replayEnd(blobs.length))) {
    Y.applyUpdate(target, out.payload);
  }
}

describe("WP42 AC2 — replay state equals live-peer state", () => {
  it("brings a brand-new client to the same state via relay replay as via a live peer", () => {
    const { doc: peerA, updates } = authorHistory();

    // Client L: was present throughout — every update arrived live.
    const clientLive = new Y.Doc();
    for (const u of updates) Y.applyUpdate(clientLive, u);

    // Client R: brand-new, enters an empty room; the relay replays the stored batch.
    const clientReplay = new Y.Doc();
    replayInto(clientReplay, updates);

    expect(docSnapshot(clientReplay)).toBe(docSnapshot(peerA));
    expect(docSnapshot(clientReplay)).toBe(docSnapshot(clientLive));
  });

  it("stays identical when the batch is a single compacted checkpoint", () => {
    const { doc: peerA, updates } = authorHistory();

    const clientLive = new Y.Doc();
    for (const u of updates) Y.applyUpdate(clientLive, u);

    const clientReplay = new Y.Doc();
    replayInto(clientReplay, [Y.encodeStateAsUpdate(peerA)]);

    expect(docSnapshot(clientReplay)).toBe(docSnapshot(clientLive));
  });

  it("converges when live traffic follows the replay barrier", () => {
    const { updates } = authorHistory();

    // A third peer edits after the newcomer's replay batch closed.
    const peerC = new Y.Doc();
    for (const u of updates) Y.applyUpdate(peerC, u);
    const liveUpdates: Uint8Array[] = [];
    peerC.on("update", (u: Uint8Array) => liveUpdates.push(u));
    (peerC.getMap("nodes").get("node-b") as Y.Map<unknown>).set("text", "child edited live");

    const newcomer = new Y.Doc();
    const gate = createReplayGate();
    gate.beginReplay(DOC);

    const order: GatedFrame[] = [];
    for (const u of updates) {
      order.push(...gate.accept({ docId: DOC, msgType: MUX_SYNC, payload: u }));
    }
    expect(order).toEqual([]); // nothing applied mid-batch
    order.push(...gate.accept(replayEnd(updates.length)));
    const replayedCount = order.length;
    order.push(...gate.accept({ docId: DOC, msgType: MUX_SYNC, payload: liveUpdates[0] }));

    for (const f of order) Y.applyUpdate(newcomer, f.payload);

    expect(replayedCount).toBe(updates.length);
    expect(order.length).toBe(updates.length + 1);
    expect(docSnapshot(newcomer)).toBe(docSnapshot(peerC));
  });

  it("survives the checkpoint frame's own wire round-trip", () => {
    const { doc: peerA, updates } = authorHistory();

    const clientLive = new Y.Doc();
    for (const u of updates) Y.applyUpdate(clientLive, u);

    const wire = encodeCheckpointFrame(DOC, 4, Y.encodeStateAsUpdate(peerA));
    const decoded = decodeCheckpointFrame(wire);
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.upToSeq).toBe(4);

    const clientReplay = new Y.Doc();
    Y.applyUpdate(clientReplay, decoded.update);
    expect(docSnapshot(clientReplay)).toBe(docSnapshot(clientLive));
  });
});
