// WP42 / C42 AC1 (blind 2) — degenerate and negative edge cases of the same
// behaviour: nothing to checkpoint, a relay that cannot store one, tombstoned
// (deleted) entries, and the separate MUX_REPLAY_END boundary marker which must
// never be confused with a checkpoint frame.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CHECKPOINT_UPDATE_THRESHOLD,
  MUX_CHECKPOINT,
  MUX_REPLAY_END,
  decodeCheckpointFrame,
  decodeMuxMessage,
  decodeReplayEndBody,
  encodeCheckpointFrame,
  encodeReplayEndFrame,
  shouldEmitCheckpoint,
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
      content: mirror.getText("content").toString(),
    }),
  );
}

describe("WP42 AC1 (blind2) — the trigger refuses to fire where a checkpoint is pointless", () => {
  it("never fires against a relay without blob support, whatever the reason", () => {
    for (const reason of ["sole-peer-sync", "update-threshold", "release"] as const) {
      expect(
        shouldEmitCheckpoint({
          reason,
          peerCount: 0,
          updatesSinceCheckpoint: CHECKPOINT_UPDATE_THRESHOLD * 4,
          hasLocalState: true,
          relayBlobSupport: false,
        }),
      ).toBe(false);
    }
  });

  it("never fires for a doc with no local state", () => {
    for (const reason of ["sole-peer-sync", "update-threshold", "release"] as const) {
      expect(
        shouldEmitCheckpoint({
          reason,
          peerCount: 0,
          updatesSinceCheckpoint: CHECKPOINT_UPDATE_THRESHOLD * 4,
          hasLocalState: false,
          relayBlobSupport: true,
        }),
      ).toBe(false);
    }
  });
});

describe("WP42 AC1 (blind2) — tombstones and empty docs survive the frame", () => {
  it("carries a tombstoned (deleted, not removed) entry through the checkpoint", () => {
    const source = new Y.Doc();
    source.transact(() => {
      const nodes = source.getMap("nodes");
      for (const id of ["k1", "k2", "k3"]) {
        const n = new Y.Map<unknown>();
        n.set("text", id.toUpperCase());
        nodes.set(id, n);
      }
    });
    // I7: deletion is a tombstone flag, never key absence.
    source.getMap("deleted").set("k2", { at: 1, by: "client-a" });

    const decoded = decodeCheckpointFrame(
      encodeCheckpointFrame("__canvas__:tombstones", 9, Y.encodeStateAsUpdate(source)),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.upToSeq).toBe(9);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, decoded.update);

    expect(docSnapshot(restored)).toBe(docSnapshot(source));
    expect(restored.getMap("nodes").size).toBe(3);
    expect(restored.getMap("deleted").get("k2")).toEqual({ at: 1, by: "client-a" });
  });

  it("round-trips a genuinely empty doc", () => {
    const empty = new Y.Doc();
    const decoded = decodeCheckpointFrame(
      encodeCheckpointFrame("doc-empty", 0, Y.encodeStateAsUpdate(empty)),
    );

    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.upToSeq).toBe(0);
    // An empty Yjs doc still encodes to a non-empty update.
    expect(decoded.update.byteLength).toBeGreaterThan(0);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, decoded.update);
    expect(docSnapshot(restored)).toBe(docSnapshot(empty));
  });
});

describe("WP42 AC1 (blind2) — the replay boundary marker is a DIFFERENT frame type", () => {
  it("uses MUX_REPLAY_END, never a degenerate checkpoint frame", () => {
    const marker = encodeReplayEndFrame("__canvas__:guid-9", 42);
    const generic = decodeMuxMessage(marker);

    expect(generic.msgType).toBe(MUX_REPLAY_END);
    expect(generic.msgType).not.toBe(MUX_CHECKPOINT);
    expect(generic.docId).toBe("__canvas__:guid-9");
    expect(decodeReplayEndBody(generic.payload).lastSeq).toBe(42);
  });

  it("is not decodable as a checkpoint frame", () => {
    expect(decodeCheckpointFrame(encodeReplayEndFrame("doc", 0))).toBeNull();
    expect(decodeCheckpointFrame(encodeReplayEndFrame("doc", 5000))).toBeNull();
  });

  it("carries lastSeq 0 for a doc the relay has nothing stored for", () => {
    const marker = encodeReplayEndFrame("__canvas__:fresh", 0);
    expect(decodeReplayEndBody(decodeMuxMessage(marker).payload).lastSeq).toBe(0);
  });
});
