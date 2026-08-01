// WP42 / C42 AC1 — the client emits a checkpoint frame carrying the FULL doc
// state as ONE update, on a documented trigger.
//
// The frame type and body layout are fixed by WP41 (the relay side): msgType
// MUX_CHECKPOINT = 11, body = varUint upToSeq followed by the opaque payload the
// relay never decodes.
//
// Staged to `plugin/src/__tests__/<dir>/`, so relative imports are `../../sync/...`.
// Pure: no WebSocket, no Obsidian, no clock, no wall-clock sleep.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CHECKPOINT_UPDATE_THRESHOLD,
  MUX_CHECKPOINT,
  decodeCheckpointBody,
  decodeCheckpointFrame,
  decodeMuxMessage,
  encodeCheckpointFrame,
  shouldEmitCheckpoint,
} from "../../sync/mux-protocol.js";

/** Deterministic, key-order-independent snapshot. State is the oracle — never a log string. */
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

/** Fixture: a small canvas doc with two nodes and one edge. */
function buildCanvasDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const nodes = doc.getMap("nodes");
    const a = new Y.Map<unknown>();
    a.set("pos", { x: 10, y: 20 });
    a.set("size", { width: 200, height: 100 });
    a.set("text", "alpha");
    nodes.set("node-a", a);
    const b = new Y.Map<unknown>();
    b.set("pos", { x: 300, y: 40 });
    b.set("size", { width: 180, height: 90 });
    b.set("text", "beta");
    nodes.set("node-b", b);
    const e = new Y.Map<unknown>();
    e.set("from", { node: "node-a", side: "right" });
    e.set("to", { node: "node-b", side: "left" });
    doc.getMap("edges").set("edge-1", e);
  });
  return doc;
}

describe("WP42 AC1 — checkpoint emission trigger", () => {
  it("fires on the documented sole-peer sync trigger", () => {
    expect(
      shouldEmitCheckpoint({
        reason: "sole-peer-sync",
        peerCount: 0,
        updatesSinceCheckpoint: 0,
        hasLocalState: true,
        relayBlobSupport: true,
      }),
    ).toBe(true);
  });

  it("does not fire on sole-peer sync while other peers are present", () => {
    expect(
      shouldEmitCheckpoint({
        reason: "sole-peer-sync",
        peerCount: 2,
        updatesSinceCheckpoint: 0,
        hasLocalState: true,
        relayBlobSupport: true,
      }),
    ).toBe(false);
  });

  it("fires once the update threshold is reached", () => {
    expect(
      shouldEmitCheckpoint({
        reason: "update-threshold",
        peerCount: 1,
        updatesSinceCheckpoint: CHECKPOINT_UPDATE_THRESHOLD,
        hasLocalState: true,
        relayBlobSupport: true,
      }),
    ).toBe(true);
    expect(
      shouldEmitCheckpoint({
        reason: "update-threshold",
        peerCount: 1,
        updatesSinceCheckpoint: CHECKPOINT_UPDATE_THRESHOLD - 1,
        hasLocalState: true,
        relayBlobSupport: true,
      }),
    ).toBe(false);
  });
});

describe("WP42 AC1 — the checkpoint frame carries the full state as one update", () => {
  it("wraps Y.encodeStateAsUpdate into a single MUX_CHECKPOINT frame with an upToSeq header", () => {
    const doc = buildCanvasDoc();
    const state = Y.encodeStateAsUpdate(doc);

    const frame = encodeCheckpointFrame("__canvas__:guid-1", 17, state);
    const generic = decodeMuxMessage(frame);

    expect(generic.docId).toBe("__canvas__:guid-1");
    expect(generic.msgType).toBe(MUX_CHECKPOINT);

    // The relay reads only the leading varUint and treats the tail as opaque.
    const body = decodeCheckpointBody(generic.payload);
    expect(body.upToSeq).toBe(17);
    expect(body.payload).toEqual(state);
  });

  it("decodes back to exactly one update and reproduces the source doc state", () => {
    const source = buildCanvasDoc();
    const frame = encodeCheckpointFrame("__canvas__:guid-1", 4, Y.encodeStateAsUpdate(source));

    const decoded = decodeCheckpointFrame(frame);
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.docId).toBe("__canvas__:guid-1");
    expect(decoded.upToSeq).toBe(4);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, decoded.update);

    expect(docSnapshot(restored)).toBe(docSnapshot(source));
    expect(restored.getMap("nodes").size).toBe(2);
  });

  it("collapses a multi-edit history into ONE update, not a stream of deltas", () => {
    const source = buildCanvasDoc();
    // Five further local edits produce five incremental updates ...
    const deltas: Uint8Array[] = [];
    const capture = (update: Uint8Array) => deltas.push(update);
    source.on("update", capture);
    for (let i = 0; i < 5; i++) {
      const node = source.getMap("nodes").get("node-a") as Y.Map<unknown>;
      node.set("pos", { x: 10 + i, y: 20 + i });
    }
    source.off("update", capture);
    expect(deltas.length).toBe(5);

    // ... but the checkpoint is a single frame that carries all of them.
    const decoded = decodeCheckpointFrame(
      encodeCheckpointFrame("__canvas__:guid-1", 5, Y.encodeStateAsUpdate(source)),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    const restored = new Y.Doc();
    Y.applyUpdate(restored, decoded.update);
    expect(docSnapshot(restored)).toBe(docSnapshot(source));
  });

  it("supersedes nothing when the client has replayed no stored frames (upToSeq 0)", () => {
    const source = buildCanvasDoc();
    const decoded = decodeCheckpointFrame(
      encodeCheckpointFrame("__canvas__:guid-1", 0, Y.encodeStateAsUpdate(source)),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.upToSeq).toBe(0);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, decoded.update);
    expect(docSnapshot(restored)).toBe(docSnapshot(source));
  });
});
