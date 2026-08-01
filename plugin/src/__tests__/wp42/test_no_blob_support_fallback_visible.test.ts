// WP42 / C42 AC3 — a relay WITHOUT blob support (older deployment) still works:
// the client detects the absence, falls back to the sidecar + peer path, and
// surfaces no error to the user.
//
// Detection: a blob-capable relay (WP41) terminates EVERY subscribe with a
// MUX_REPLAY_END marker, even when it stored nothing (lastSeq 0). A legacy relay
// never sends one. The client therefore opens the barrier optimistically and
// closes it with `endReplay(doc, "unsupported")` from the existing sync-complete
// path — no timer, no new timing constant.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MUX_AWARENESS,
  MUX_REPLAY_END,
  MUX_SYNC,
  applyRecoveredUpdates,
  createReplayGate,
  encodeReplayEndBody,
  shouldEmitCheckpoint,
} from "../../sync/mux-protocol.js";

const tagOf = (f: { payload: Uint8Array }): number => f.payload[0];

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

describe("WP42 AC3 — a blob-capable relay is recognised by its marker", () => {
  it("closes the barrier and records blob support when the marker arrives", () => {
    const doc = "__canvas__:blob-relay";
    const gate = createReplayGate();
    gate.beginReplay(doc);

    gate.accept({ docId: doc, msgType: MUX_SYNC, payload: new Uint8Array([1]) });
    const released = gate.accept({
      docId: doc,
      msgType: MUX_REPLAY_END,
      payload: encodeReplayEndBody(1),
    });

    expect(released.map(tagOf)).toEqual([1]);
    expect(gate.isReplaying(doc)).toBe(false);
    expect(gate.lastSeq(doc)).toBe(1);
  });

  it("recognises an empty-but-capable relay by a marker with lastSeq 0", () => {
    const doc = "__canvas__:blob-relay-empty";
    const gate = createReplayGate();
    gate.beginReplay(doc);
    gate.accept({ docId: doc, msgType: MUX_REPLAY_END, payload: encodeReplayEndBody(0) });

    expect(gate.isReplaying(doc)).toBe(false);
    expect(gate.lastSeq(doc)).toBe(0); // capable, just empty — NOT "no support"
  });
});

describe("WP42 AC3 — the fallback surfaces no error and loses no frame", () => {
  it("releases the optimistically buffered frames in arrival order", () => {
    const doc = "__canvas__:legacy";
    const gate = createReplayGate();
    gate.beginReplay(doc); // optimistic: support unknown until a marker arrives

    expect(gate.accept({ docId: doc, msgType: MUX_SYNC, payload: new Uint8Array([1]) })).toEqual([]);
    expect(
      gate.accept({ docId: doc, msgType: MUX_AWARENESS, payload: new Uint8Array([2]) }),
    ).toEqual([]);

    const release = gate.endReplay(doc, "unsupported");

    expect(release.fallback).toBe(true);
    expect(release.reason).toBe("unsupported");
    expect(release.lastSeq).toBeNull(); // no marker was ever seen
    expect(release.buffered).toBe(2);
    expect(release.frames.map(tagOf)).toEqual([1, 2]);
    expect(gate.isReplaying(doc)).toBe(false);
    expect(gate.lastSeq(doc)).toBeNull();
  });

  it("lets everything through afterwards, so the legacy room keeps working", () => {
    const doc = "__canvas__:legacy2";
    const gate = createReplayGate();
    gate.beginReplay(doc);
    gate.endReplay(doc, "unsupported");

    const out = gate.accept({ docId: doc, msgType: MUX_SYNC, payload: new Uint8Array([9]) });
    expect(out.map(tagOf)).toEqual([9]);
  });

  it("throws nothing anywhere on the fallback path, including a repeated call", () => {
    const errors: unknown[] = [];
    try {
      const gate = createReplayGate();
      gate.beginReplay("__canvas__:legacy3");
      gate.accept({ docId: "__canvas__:legacy3", msgType: MUX_SYNC, payload: new Uint8Array([9]) });
      gate.endReplay("__canvas__:legacy3", "unsupported");
      gate.endReplay("__canvas__:legacy3", "unsupported"); // idempotent
    } catch (err) {
      errors.push(err);
    }
    expect(errors).toEqual([]);
  });

  it("does not emit a checkpoint into a relay that cannot store it", () => {
    expect(
      shouldEmitCheckpoint({
        reason: "sole-peer-sync",
        peerCount: 0,
        updatesSinceCheckpoint: 0,
        hasLocalState: true,
        relayBlobSupport: false,
      }),
    ).toBe(false);
  });
});

describe("WP42 AC3 — the sidecar + peer path alone still reaches the right state", () => {
  it("recovers the full doc from the sidecar when the relay replays nothing", () => {
    const source = new Y.Doc();
    const sidecar: Uint8Array[] = [];
    source.on("update", (u: Uint8Array) => sidecar.push(u));
    source.transact(() => {
      const node = new Y.Map<unknown>();
      node.set("text", "from sidecar");
      source.getMap("nodes").set("n1", node);
    });
    source.getMap("nodes").set("n2", "second");

    const restored = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(restored, u), { sidecar });

    expect(report.replayCount).toBe(0);
    expect(report.sidecarCount).toBe(sidecar.length);
    expect(report.applied).toBe(sidecar.length);
    expect(report.recovered).toBe(true);
    expect(docSnapshot(restored)).toBe(docSnapshot(source));
  });

  it("reports 'not recovered' without throwing when neither layer has anything", () => {
    const doc = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(doc, u), {});
    expect(report.applied).toBe(0);
    expect(report.recovered).toBe(false);
    expect(doc.getMap("nodes").size).toBe(0);
  });
});
