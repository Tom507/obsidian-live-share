// WP42 / C42 AC1 (blind 1) — same behaviour, different attack angle:
// the checkpoint is taken over a doc whose history was produced by THREE
// concurrent clients (never reason from two peers only) and whose payload is
// Y.Text rather than Y.Map registers, on a unicode doc id.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CHECKPOINT_UPDATE_THRESHOLD,
  MUX_CHECKPOINT,
  decodeCheckpointFrame,
  decodeMuxMessage,
  encodeCheckpointFrame,
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
      edges: mirror.getMap("edges").toJSON(),
      content: mirror.getText("content").toString(),
    }),
  );
}

/**
 * Deterministic generator: three replicas edit in isolation, then every update
 * is merged into replica 1. No randomness, no clock.
 */
function buildThreeWayMergedDoc(): Y.Doc {
  const replicas = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
  const updates: Uint8Array[] = [];
  for (const r of replicas) r.on("update", (u: Uint8Array) => updates.push(u));

  const labels = ["rot", "grün", "blau"];
  replicas.forEach((r, i) => {
    r.transact(() => {
      const node = new Y.Map<unknown>();
      node.set("pos", { x: i * 111, y: i * 37 });
      node.set("color", labels[i]);
      r.getMap("nodes").set(`n${i}`, node);
      r.getText("content").insert(0, `${labels[i]}-`);
    });
  });

  const merged = new Y.Doc();
  for (const u of updates) Y.applyUpdate(merged, u);
  return merged;
}

describe("WP42 AC1 (blind1) — trigger on release and on threshold overshoot", () => {
  it("fires on the release trigger whenever unsaved updates exist", () => {
    expect(
      shouldEmitCheckpoint({
        reason: "release",
        peerCount: 3,
        updatesSinceCheckpoint: 1,
        hasLocalState: true,
        relayBlobSupport: true,
      }),
    ).toBe(true);
  });

  it("does not fire on release when nothing changed since the last checkpoint", () => {
    expect(
      shouldEmitCheckpoint({
        reason: "release",
        peerCount: 3,
        updatesSinceCheckpoint: 0,
        hasLocalState: true,
        relayBlobSupport: true,
      }),
    ).toBe(false);
  });

  it("still fires when the update counter overshoots the threshold", () => {
    expect(
      shouldEmitCheckpoint({
        reason: "update-threshold",
        peerCount: 4,
        updatesSinceCheckpoint: CHECKPOINT_UPDATE_THRESHOLD * 9 + 3,
        hasLocalState: true,
        relayBlobSupport: true,
      }),
    ).toBe(true);
  });
});

describe("WP42 AC1 (blind1) — three-way merged state survives one checkpoint frame", () => {
  it("round-trips a unicode doc id and a Y.Text payload", () => {
    const source = buildThreeWayMergedDoc();
    const docId = "__canvas__:Übersicht — Ordner/Karte (1).canvas";

    const wire = encodeCheckpointFrame(docId, 12, Y.encodeStateAsUpdate(source));
    expect(decodeMuxMessage(wire).msgType).toBe(MUX_CHECKPOINT);

    const decoded = decodeCheckpointFrame(wire);
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.docId).toBe(docId);
    expect(decoded.upToSeq).toBe(12);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, decoded.update);

    expect(docSnapshot(restored)).toBe(docSnapshot(source));
    expect(restored.getMap("nodes").size).toBe(3);
    expect(restored.getText("content").toString().length).toBe(
      source.getText("content").toString().length,
    );
  });

  it("is equivalent to replaying every individual update from all three replicas", () => {
    const replicas = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    const updates: Uint8Array[] = [];
    for (const r of replicas) r.on("update", (u: Uint8Array) => updates.push(u));
    replicas.forEach((r, i) => {
      const node = new Y.Map<unknown>();
      node.set("ord", `a${i}`);
      r.getMap("nodes").set(`n${i}`, node);
    });

    const viaUpdates = new Y.Doc();
    for (const u of updates) Y.applyUpdate(viaUpdates, u);

    const viaCheckpoint = new Y.Doc();
    const decoded = decodeCheckpointFrame(
      encodeCheckpointFrame("doc", 3, Y.encodeStateAsUpdate(viaUpdates)),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    Y.applyUpdate(viaCheckpoint, decoded.update);

    expect(docSnapshot(viaCheckpoint)).toBe(docSnapshot(viaUpdates));
  });
});
