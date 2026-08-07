// WP42 / C42 AC2 (blind 2) — replay-vs-live equality on the awkward histories:
// a replay that OVERLAPS itself (checkpoint plus the deltas it already
// supersedes), a history that ends in a deletion/tombstone, an empty room whose
// replay is empty, and a replay delivered in reverse order.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MUX_REPLAY_END,
  MUX_SYNC,
  createReplayGate,
  encodeReplayEndBody,
} from "../../sync/mux-protocol.js";

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
      deleted: mirror.getMap("deleted").toJSON(),
    }),
  );
}

/** History whose last act is a tombstone (I7: deletion is a flag, not key absence). */
function historyEndingInTombstone(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));

  doc.transact(() => {
    for (const id of ["n1", "n2", "n3"]) {
      const node = new Y.Map<unknown>();
      node.set("text", id);
      node.set("pos", { x: 0, y: 0 });
      doc.getMap("nodes").set(id, node);
    }
  });
  doc.transact(() => {
    (doc.getMap("nodes").get("n2") as Y.Map<unknown>).set("pos", { x: 99, y: 99 });
  });
  doc.transact(() => {
    doc.getMap("deleted").set("n3", { at: 7, by: "peer-a" });
  });

  return { doc, updates };
}

function replayInto(target: Y.Doc, docId: string, blobs: Uint8Array[]): void {
  const gate = createReplayGate();
  gate.beginReplay(docId);
  for (const blob of blobs) {
    for (const out of gate.accept({ docId, msgType: MUX_SYNC, payload: blob })) {
      Y.applyUpdate(target, out.payload);
    }
  }
  // WP41 always terminates the batch, even when nothing was stored.
  for (const out of gate.accept({
    docId,
    msgType: MUX_REPLAY_END,
    payload: encodeReplayEndBody(blobs.length),
  })) {
    Y.applyUpdate(target, out.payload);
  }
}

describe("WP42 AC2 (blind2) — overlapping and reordered replays", () => {
  it("matches the live peer when the replay repeats what the checkpoint already contains", () => {
    const { doc: peer, updates } = historyEndingInTombstone();

    const liveClient = new Y.Doc();
    for (const u of updates) Y.applyUpdate(liveClient, u);

    // Relay stored a checkpoint AND kept the deltas it supersedes.
    const overlapping = [Y.encodeStateAsUpdate(peer), ...updates];
    const replayClient = new Y.Doc();
    replayInto(replayClient, "__canvas__:overlap", overlapping);

    expect(docSnapshot(replayClient)).toBe(docSnapshot(liveClient));
    expect(docSnapshot(replayClient)).toBe(docSnapshot(peer));
    expect(replayClient.getMap("nodes").size).toBe(3);
    expect(replayClient.getMap("deleted").get("n3")).toEqual({ at: 7, by: "peer-a" });
  });

  it("matches the live peer when the stored blobs are replayed in reverse order", () => {
    const { doc: peer, updates } = historyEndingInTombstone();

    const liveClient = new Y.Doc();
    for (const u of updates) Y.applyUpdate(liveClient, u);

    const reversedClient = new Y.Doc();
    replayInto(reversedClient, "__canvas__:reverse", [...updates].reverse());

    expect(docSnapshot(reversedClient)).toBe(docSnapshot(liveClient));
    expect(docSnapshot(reversedClient)).toBe(docSnapshot(peer));
  });

  it("matches the live peer when the same blob is replayed three times", () => {
    const { doc: peer } = historyEndingInTombstone();
    const checkpoint = Y.encodeStateAsUpdate(peer);

    const once = new Y.Doc();
    replayInto(once, "__canvas__:once", [checkpoint]);
    const thrice = new Y.Doc();
    replayInto(thrice, "__canvas__:thrice", [checkpoint, checkpoint, checkpoint]);

    expect(docSnapshot(thrice)).toBe(docSnapshot(once));
    expect(docSnapshot(thrice)).toBe(docSnapshot(peer));
  });
});

describe("WP42 AC2 (blind2) — a brand-new client in a genuinely empty room", () => {
  it("ends up equal to a live peer that also has nothing", () => {
    const emptyPeer = new Y.Doc();
    const newcomer = new Y.Doc();
    replayInto(newcomer, "__canvas__:empty", []);

    expect(docSnapshot(newcomer)).toBe(docSnapshot(emptyPeer));
    expect(newcomer.getMap("nodes").size).toBe(0);
  });

  it("ends up equal after a replay consisting only of an empty doc's checkpoint", () => {
    const emptyPeer = new Y.Doc();
    const newcomer = new Y.Doc();
    replayInto(newcomer, "__canvas__:empty2", [Y.encodeStateAsUpdate(emptyPeer)]);

    expect(docSnapshot(newcomer)).toBe(docSnapshot(emptyPeer));
  });
});
