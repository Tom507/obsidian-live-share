// WP42 / C42 AC1+AC3 — an OLDER peer or relay that does not know the checkpoint
// frame type must be unaffected: the unknown msgType is ignored, nothing throws,
// no error is surfaced, and the frames around it keep their meaning.
//
// The "old peer" is modelled as the pre-WP42 dispatcher switch (the exact shape
// of SyncManager.handleMessage before this WP), so no live socket is needed.
import { describe, expect, it } from "vitest";
import {
  MUX_AWARENESS,
  MUX_CHECKPOINT,
  MUX_PONG,
  MUX_REPLAY_END,
  MUX_SUBSCRIBED,
  MUX_SYNC,
  MUX_SYNC_REQUEST,
  decodeCheckpointFrame,
  decodeMuxMessage,
  encodeCheckpointFrame,
  encodeMuxMessage,
  encodeReplayEndFrame,
} from "../../sync/mux-protocol.js";

interface OldPeerLog {
  handled: { type: number; docId: string }[];
  ignored: number[];
  errors: unknown[];
}

/** Pre-WP42 dispatcher: a switch over the ten types that existed before this WP. */
function makeOldPeer(): { feed(frame: Uint8Array): void; log: OldPeerLog } {
  const log: OldPeerLog = { handled: [], ignored: [], errors: [] };
  return {
    log,
    feed(frame: Uint8Array): void {
      try {
        const { docId, msgType } = decodeMuxMessage(frame);
        switch (msgType) {
          case MUX_SUBSCRIBED:
          case MUX_SYNC:
          case MUX_SYNC_REQUEST:
          case MUX_AWARENESS:
          case MUX_PONG:
            log.handled.push({ type: msgType, docId });
            break;
          default:
            // No default branch existed before WP42 either — an unknown type
            // simply falls off the end of the switch.
            log.ignored.push(msgType);
        }
      } catch (err) {
        log.errors.push(err);
      }
    },
  };
}

describe("WP42 AC1/AC3 — an old peer ignores the checkpoint frame", () => {
  it("does not throw and surfaces no error when a checkpoint frame arrives", () => {
    const peer = makeOldPeer();
    peer.feed(encodeCheckpointFrame("__canvas__:g1", 3, new Uint8Array([1, 2, 3, 4])));
    peer.feed(encodeReplayEndFrame("__canvas__:g1", 3));

    expect(peer.log.errors).toEqual([]);
    expect(peer.log.handled).toEqual([]);
    expect(peer.log.ignored).toEqual([MUX_CHECKPOINT, MUX_REPLAY_END]);
  });

  it("keeps processing the frames that follow an ignored checkpoint frame", () => {
    const peer = makeOldPeer();
    peer.feed(encodeMuxMessage("doc-a", MUX_SUBSCRIBED, new Uint8Array([0])));
    peer.feed(encodeCheckpointFrame("doc-a", 7, new Uint8Array([9, 9, 9])));
    peer.feed(encodeReplayEndFrame("doc-a", 7));
    peer.feed(encodeMuxMessage("doc-a", MUX_SYNC, new Uint8Array([0, 1])));
    peer.feed(encodeMuxMessage("doc-a", MUX_AWARENESS, new Uint8Array([5])));

    expect(peer.log.errors).toEqual([]);
    expect(peer.log.ignored).toEqual([MUX_CHECKPOINT, MUX_REPLAY_END]);
    expect(peer.log.handled).toEqual([
      { type: MUX_SUBSCRIBED, docId: "doc-a" },
      { type: MUX_SYNC, docId: "doc-a" },
      { type: MUX_AWARENESS, docId: "doc-a" },
    ]);
  });
});

describe("WP42 AC1 — decodeCheckpointFrame never misreads another frame type", () => {
  it("returns null for every existing frame type", () => {
    const others = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10];
    for (const type of others) {
      expect(decodeCheckpointFrame(encodeMuxMessage("doc", type, new Uint8Array([1, 2]))), `type ${type}`).toBeNull();
    }
  });

  it("returns null for the replay-boundary marker and for a future type", () => {
    expect(decodeCheckpointFrame(encodeReplayEndFrame("doc", 1))).toBeNull();
    expect(decodeCheckpointFrame(encodeMuxMessage("doc", 200, new Uint8Array([1])))).toBeNull();
  });

  it("accepts only the checkpoint type", () => {
    const decoded = decodeCheckpointFrame(encodeCheckpointFrame("doc", 2, new Uint8Array([7])));
    expect(decoded).not.toBeNull();
    expect(decoded?.docId).toBe("doc");
    expect(decoded?.upToSeq).toBe(2);
    expect(Array.from(decoded?.update ?? [])).toEqual([7]);
  });
});
