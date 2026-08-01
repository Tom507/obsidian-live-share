// WP42 / C42 AC1 (blind 1) — wire compatibility attacked from the DECODE side and
// through real production payload shapes: y-protocols sync/awareness bytes, an
// encrypted-frame layout (syncType byte + ciphertext), and mixed streams in which
// a checkpoint frame sits between two existing frames.
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MUX_AWARENESS,
  MUX_AWARENESS_ENCRYPTED,
  MUX_CHECKPOINT,
  MUX_PING,
  MUX_PONG,
  MUX_REPLAY_END,
  MUX_SUBSCRIBE,
  MUX_SUBSCRIBED,
  MUX_SYNC,
  MUX_SYNC_ENCRYPTED,
  MUX_SYNC_REQUEST,
  MUX_UNSUBSCRIBE,
  decodeMuxMessage,
  encodeMuxMessage,
} from "../../sync/mux-protocol.js";

/** A real MUX_SYNC payload: y-protocols sync step 1 over a populated doc. */
function realSyncPayload(): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap("nodes").set("n1", "value");
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A real MUX_AWARENESS payload. */
function realAwarenessPayload(): Uint8Array {
  const doc = new Y.Doc();
  const aw = new awarenessProtocol.Awareness(doc);
  aw.setLocalState({ canvasPath: "board.canvas", lockedNodes: ["n1"] });
  return awarenessProtocol.encodeAwarenessUpdate(aw, [doc.clientID]);
}

describe("WP42 AC1 (blind1) — real protocol payloads survive the new type unchanged", () => {
  it("round-trips a y-protocols sync payload on MUX_SYNC", () => {
    const payload = realSyncPayload();
    const decoded = decodeMuxMessage(encodeMuxMessage("__canvas__:g1", MUX_SYNC, payload));
    expect(decoded.msgType).toBe(MUX_SYNC);
    expect(decoded.payload).toEqual(payload);
  });

  it("round-trips a y-protocols awareness payload on MUX_AWARENESS", () => {
    const payload = realAwarenessPayload();
    const decoded = decodeMuxMessage(encodeMuxMessage("__canvas__:g1", MUX_AWARENESS, payload));
    expect(decoded.msgType).toBe(MUX_AWARENESS);
    expect(decoded.payload).toEqual(payload);

    // The payload is still a valid awareness update for a peer.
    const peerDoc = new Y.Doc();
    const peerAw = new awarenessProtocol.Awareness(peerDoc);
    peerAw.setLocalState(null);
    awarenessProtocol.applyAwarenessUpdate(peerAw, decoded.payload, "remote");
    expect([...peerAw.getStates().values()].length).toBe(1);
  });

  it("preserves the encrypted-frame layout (leading syncType byte + ciphertext)", () => {
    const cipher = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x10]);
    const framed = new Uint8Array(1 + cipher.length);
    framed[0] = 1; // SYNC_STEP2
    framed.set(cipher, 1);

    const syncDecoded = decodeMuxMessage(encodeMuxMessage("d", MUX_SYNC_ENCRYPTED, framed));
    expect(syncDecoded.msgType).toBe(MUX_SYNC_ENCRYPTED);
    expect(syncDecoded.payload[0]).toBe(1);
    expect(syncDecoded.payload.slice(1)).toEqual(cipher);

    const awDecoded = decodeMuxMessage(encodeMuxMessage("d", MUX_AWARENESS_ENCRYPTED, cipher));
    expect(awDecoded.msgType).toBe(MUX_AWARENESS_ENCRYPTED);
    expect(awDecoded.payload).toEqual(cipher);
  });
});

describe("WP42 AC1 (blind1) — a checkpoint frame in the stream changes nothing around it", () => {
  it("decodes a mixed stream frame-by-frame with the original semantics", () => {
    const syncPayload = realSyncPayload();
    const awarenessPayload = realAwarenessPayload();
    const checkpointPayload = Y.encodeStateAsUpdate((() => {
      const d = new Y.Doc();
      d.getMap("nodes").set("cp", 1);
      return d;
    })());

    const stream: Uint8Array[] = [
      encodeMuxMessage("doc-a", MUX_SUBSCRIBE),
      encodeMuxMessage("doc-a", MUX_SUBSCRIBED, new Uint8Array([2])),
      encodeMuxMessage("doc-a", MUX_CHECKPOINT, checkpointPayload),
      encodeMuxMessage("doc-a", MUX_REPLAY_END, new Uint8Array([3])),
      encodeMuxMessage("doc-a", MUX_SYNC, syncPayload),
      encodeMuxMessage("doc-a", MUX_AWARENESS, awarenessPayload),
      encodeMuxMessage("", MUX_PING),
      encodeMuxMessage("", MUX_PONG),
      encodeMuxMessage("doc-a", MUX_SYNC_REQUEST),
      encodeMuxMessage("doc-a", MUX_UNSUBSCRIBE),
    ];

    const decoded = stream.map((f) => decodeMuxMessage(f));
    expect(decoded.map((d) => d.msgType)).toEqual([
      MUX_SUBSCRIBE,
      MUX_SUBSCRIBED,
      MUX_CHECKPOINT,
      MUX_REPLAY_END,
      MUX_SYNC,
      MUX_AWARENESS,
      MUX_PING,
      MUX_PONG,
      MUX_SYNC_REQUEST,
      MUX_UNSUBSCRIBE,
    ]);
    expect(decoded[4].payload).toEqual(syncPayload);
    expect(decoded[5].payload).toEqual(awarenessPayload);
    expect(decoded[2].payload).toEqual(checkpointPayload);
    expect(decoded[6].docId).toBe("");
  });

  it("adds exactly the two P6 numbers and removes none", () => {
    const before = new Set([0, 1, 2, 3, 4, 6, 7, 8, 9, 10]);
    const after = new Set([
      MUX_SYNC,
      MUX_AWARENESS,
      MUX_SUBSCRIBE,
      MUX_UNSUBSCRIBE,
      MUX_SUBSCRIBED,
      MUX_SYNC_REQUEST,
      MUX_SYNC_ENCRYPTED,
      MUX_AWARENESS_ENCRYPTED,
      MUX_PING,
      MUX_PONG,
      MUX_CHECKPOINT,
      MUX_REPLAY_END,
    ]);
    const added = [...after].filter((v) => !before.has(v)).sort((a, b) => a - b);
    const removed = [...before].filter((v) => !after.has(v));
    expect(added).toEqual([MUX_CHECKPOINT, MUX_REPLAY_END]);
    expect(removed).toEqual([]);
  });
});
