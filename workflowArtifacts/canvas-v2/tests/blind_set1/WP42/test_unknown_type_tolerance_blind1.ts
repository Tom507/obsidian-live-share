// WP42 / C42 AC1+AC3 (blind 1) — the old peer is fed a LONG interleaved stream
// containing three different unknown types, and the oracle is the resulting Yjs
// doc state (not a counter): dropping the unknown frames must leave the doc it
// builds from the known MUX_SYNC frames byte-identical to the reference.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MUX_AWARENESS,
  MUX_CHECKPOINT,
  MUX_REPLAY_END,
  MUX_SYNC,
  decodeCheckpointFrame,
  decodeMuxMessage,
  encodeCheckpointFrame,
  encodeMuxMessage,
  encodeReplayEndFrame,
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
  return JSON.stringify(stable({ nodes: mirror.getMap("nodes").toJSON() }));
}

/**
 * Old peer that actually applies MUX_SYNC payloads as raw Yjs updates, ignores
 * MUX_AWARENESS, and has no branch at all for anything else.
 */
function makeOldApplyingPeer() {
  const doc = new Y.Doc();
  const ignored: number[] = [];
  const errors: unknown[] = [];
  return {
    doc,
    ignored,
    errors,
    feed(frame: Uint8Array): void {
      try {
        const { msgType, payload } = decodeMuxMessage(frame);
        if (msgType === MUX_SYNC) {
          Y.applyUpdate(doc, payload);
        } else if (msgType === MUX_AWARENESS) {
          // known but irrelevant here
        } else {
          ignored.push(msgType);
        }
      } catch (err) {
        errors.push(err);
      }
    },
  };
}

describe("WP42 AC1/AC3 (blind1) — unknown types are transparent to state", () => {
  it("builds the same doc as a peer that never saw the unknown frames", () => {
    // Author twelve updates on a source doc.
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (u: Uint8Array) => updates.push(u));
    for (let i = 0; i < 12; i++) {
      const node = new Y.Map<unknown>();
      node.set("ord", `a${i}`);
      node.set("pos", { x: i * 7, y: i * 3 });
      source.getMap("nodes").set(`n${i}`, node);
    }
    expect(updates.length).toBe(12);

    const checkpoint = Y.encodeStateAsUpdate(source);

    // Interleave three unknown types (5 = checkpoint, 11 and 200 = future types).
    const stream: Uint8Array[] = [];
    updates.forEach((u, i) => {
      stream.push(encodeMuxMessage("doc", MUX_SYNC, u));
      if (i % 4 === 0) stream.push(encodeCheckpointFrame("doc", i, checkpoint));
      if (i % 5 === 0) stream.push(encodeReplayEndFrame("doc", i));
      if (i % 6 === 0) stream.push(encodeMuxMessage("doc", 200, new Uint8Array(0)));
      if (i % 3 === 0) stream.push(encodeMuxMessage("doc", MUX_AWARENESS, new Uint8Array([1, 2])));
    });

    const peer = makeOldApplyingPeer();
    for (const frame of stream) peer.feed(frame);

    const reference = new Y.Doc();
    for (const u of updates) Y.applyUpdate(reference, u);

    expect(peer.errors).toEqual([]);
    expect(docSnapshot(peer.doc)).toBe(docSnapshot(reference));
    expect(docSnapshot(peer.doc)).toBe(docSnapshot(source));
    expect(new Set(peer.ignored)).toEqual(new Set([MUX_CHECKPOINT, MUX_REPLAY_END, 200]));
  });

  it("does not let an unknown frame consume the bytes of the next frame", () => {
    // Frames are delivered as discrete WebSocket messages, so the property under
    // test is that decoding one never depends on decoding the previous one.
    const unknown = encodeMuxMessage("doc-a", MUX_REPLAY_END, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const known = encodeMuxMessage("doc-b", MUX_SYNC, new Uint8Array([42]));

    const first = decodeMuxMessage(unknown);
    const second = decodeMuxMessage(known);

    expect(first.msgType).toBe(MUX_REPLAY_END);
    expect(first.docId).toBe("doc-a");
    expect(second.msgType).toBe(MUX_SYNC);
    expect(second.docId).toBe("doc-b");
    expect(Array.from(second.payload)).toEqual([42]);
  });

  it("rejects a checkpoint decode of the other types the old peer also ignores", () => {
    for (const type of [MUX_REPLAY_END, 13, 200]) {
      expect(decodeCheckpointFrame(encodeMuxMessage("doc", type, new Uint8Array([1])))).toBeNull();
    }
  });
});
