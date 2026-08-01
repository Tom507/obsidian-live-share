// WP42 / C42 AC3 (blind 1) — the same graceful degradation, approached through
// the CONTRAST between a blob-capable relay that simply has nothing stored
// (marker present, lastSeq 0) and a legacy relay that cannot store anything at
// all (marker never arrives). The two must be distinguishable and both must work.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MUX_AWARENESS,
  MUX_REPLAY_END,
  MUX_SYNC,
  applyRecoveredUpdates,
  createReplayGate,
  decodeReplayEndBody,
  encodeReplayEndBody,
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
      content: mirror.getText("content").toString(),
    }),
  );
}

describe("WP42 AC3 (blind1) — 'no blobs stored' is not 'no blob support'", () => {
  it("distinguishes an empty blob store from a relay that has none", () => {
    const emptyStore = createReplayGate();
    emptyStore.beginReplay("__canvas__:empty-store");
    emptyStore.accept({
      docId: "__canvas__:empty-store",
      msgType: MUX_REPLAY_END,
      payload: encodeReplayEndBody(0),
    });
    expect(emptyStore.lastSeq("__canvas__:empty-store")).toBe(0);

    const legacy = createReplayGate();
    legacy.beginReplay("__canvas__:legacy-relay");
    const release = legacy.endReplay("__canvas__:legacy-relay", "unsupported");
    expect(legacy.lastSeq("__canvas__:legacy-relay")).toBeNull();
    expect(release.fallback).toBe(true);
  });

  it("reads lastSeq 0 out of the marker body without confusing it with an absent body", () => {
    expect(decodeReplayEndBody(encodeReplayEndBody(0)).lastSeq).toBe(0);
    expect(decodeReplayEndBody(encodeReplayEndBody(1)).lastSeq).toBe(1);
    expect(decodeReplayEndBody(encodeReplayEndBody(65_535)).lastSeq).toBe(65_535);
  });

  it("still permits a checkpoint against a blob-capable relay with an empty store", () => {
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
});

describe("WP42 AC3 (blind1) — the legacy relay path in a busy room", () => {
  it("falls back without losing or reordering the five frames it was holding", () => {
    const doc = "__canvas__:busy-legacy";
    const gate = createReplayGate();
    gate.beginReplay(doc);

    const arrivals = [11, 12, 13, 14, 15];
    for (const tag of arrivals) {
      gate.accept({
        docId: doc,
        msgType: tag % 2 === 0 ? MUX_AWARENESS : MUX_SYNC,
        payload: new Uint8Array([tag]),
      });
    }

    const release = gate.endReplay(doc, "unsupported");
    expect(release.fallback).toBe(true);
    expect(release.buffered).toBe(5);
    expect(release.lastSeq).toBeNull();
    expect(release.frames.map((f) => f.payload[0])).toEqual(arrivals);
    expect(release.frames.map((f) => f.msgType)).toEqual([
      MUX_SYNC,
      MUX_AWARENESS,
      MUX_SYNC,
      MUX_AWARENESS,
      MUX_SYNC,
    ]);
  });

  it("reconstructs the doc from sidecar history alone, exactly as a peer sync would", () => {
    const peer = new Y.Doc();
    const sidecar: Uint8Array[] = [];
    peer.on("update", (u: Uint8Array) => sidecar.push(u));
    peer.transact(() => {
      peer.getText("content").insert(0, "Notizen");
      const node = new Y.Map<unknown>();
      node.set("pos", { x: 12, y: 34 });
      peer.getMap("nodes").set("legacy-node", node);
    });
    peer.getMap("nodes").set("second", "value");
    peer.getText("content").insert(7, " — Fortsetzung");

    const viaSidecar = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(viaSidecar, u), { sidecar });

    const viaPeerSync = new Y.Doc();
    Y.applyUpdate(viaPeerSync, Y.encodeStateAsUpdate(peer));

    expect(report.recovered).toBe(true);
    expect(report.replayCount).toBe(0);
    expect(docSnapshot(viaSidecar)).toBe(docSnapshot(peer));
    expect(docSnapshot(viaSidecar)).toBe(docSnapshot(viaPeerSync));
  });
});
