// WP42 / C42 AC3 (blind 2) — degradation under hostile input: a malformed
// MUX_REPLAY_END body, a fallback on a doc that buffered 25 frames, a fallback on
// a doc that buffered none, and a mixed socket where one doc degrades while
// another one on the same connection completes normally. Nothing may throw.
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
} from "../../sync/mux-protocol.js";

/** Run a thunk and report a throw as a value rather than propagating it. */
function ranCleanly(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

describe("WP42 AC3 (blind2) — a malformed marker degrades instead of throwing", () => {
  it("never throws for an empty or truncated MUX_REPLAY_END body", () => {
    const twoByte = encodeReplayEndBody(300);
    expect(twoByte.byteLength).toBeGreaterThan(1);
    const cases: [string, Uint8Array][] = [
      ["empty", new Uint8Array(0)],
      ["truncated multi-byte varuint", twoByte.slice(0, 1)],
      ["stray byte", new Uint8Array([0x80])],
    ];
    for (const [name, body] of cases) {
      expect(
        ranCleanly(() => {
          const decoded = decodeReplayEndBody(body);
          expect(Number.isInteger(decoded.lastSeq)).toBe(true);
          expect(decoded.lastSeq).toBeGreaterThanOrEqual(0);
        }),
        name,
      ).toBe(true);
    }
  });

  it("still closes the barrier when the marker body is unreadable", () => {
    const doc = "__canvas__:bad-marker";
    const gate = createReplayGate();
    gate.beginReplay(doc);
    gate.accept({ docId: doc, msgType: MUX_SYNC, payload: new Uint8Array([1]) });

    let released: { payload: Uint8Array }[] = [];
    expect(
      ranCleanly(() => {
        released = gate.accept({ docId: doc, msgType: MUX_REPLAY_END, payload: new Uint8Array(0) });
      }),
    ).toBe(true);
    expect(released.map((f) => f.payload[0])).toEqual([1]);
    expect(gate.isReplaying(doc)).toBe(false);
  });
});

describe("WP42 AC3 (blind2) — fallback volume boundaries", () => {
  it("preserves interleaved sync/awareness ordering exactly through a 25-frame fallback", () => {
    const doc = "__canvas__:order";
    const gate = createReplayGate();
    gate.beginReplay(doc);

    const arrivals: number[] = [];
    for (let i = 0; i < 25; i++) {
      arrivals.push(i);
      gate.accept({
        docId: doc,
        msgType: i % 3 === 0 ? MUX_AWARENESS : MUX_SYNC,
        payload: new Uint8Array([i]),
      });
    }
    const release = gate.endReplay(doc, "unsupported");

    expect(release.fallback).toBe(true);
    expect(release.buffered).toBe(25);
    expect(release.frames.map((f) => f.payload[0])).toEqual(arrivals);
  });

  it("falls back cleanly on a doc that buffered nothing at all", () => {
    const gate = createReplayGate();
    gate.beginReplay("__canvas__:silent");
    const release = gate.endReplay("__canvas__:silent", "unsupported");

    expect(release.frames).toEqual([]);
    expect(release.buffered).toBe(0);
    expect(release.fallback).toBe(true);
    expect(release.lastSeq).toBeNull();
  });

  it("degrades one doc while another on the same socket completes normally", () => {
    const legacyDoc = "__canvas__:mixed-legacy";
    const blobDoc = "__canvas__:mixed-blob";
    const gate = createReplayGate();
    gate.beginReplay(legacyDoc);
    gate.beginReplay(blobDoc);

    gate.accept({ docId: legacyDoc, msgType: MUX_SYNC, payload: new Uint8Array([1]) });
    gate.accept({ docId: blobDoc, msgType: MUX_SYNC, payload: new Uint8Array([2]) });

    const blobReleased = gate.accept({
      docId: blobDoc,
      msgType: MUX_REPLAY_END,
      payload: encodeReplayEndBody(1),
    });
    expect(blobReleased.map((f) => f.payload[0])).toEqual([2]);
    expect(gate.lastSeq(blobDoc)).toBe(1);
    // The legacy doc is untouched by the other doc's marker.
    expect(gate.isReplaying(legacyDoc)).toBe(true);
    expect(gate.bufferedCount(legacyDoc)).toBe(1);

    const legacyRelease = gate.endReplay(legacyDoc, "unsupported");
    expect(legacyRelease.frames.map((f) => f.payload[0])).toEqual([1]);
    expect(legacyRelease.fallback).toBe(true);
    expect(gate.lastSeq(legacyDoc)).toBeNull();
  });
});

describe("WP42 AC3 (blind2) — degradation keeps the sidecar path whole", () => {
  it("keeps sidecar-only recovery correct when the replay array is explicitly empty", () => {
    const source = new Y.Doc();
    const sidecar: Uint8Array[] = [];
    source.on("update", (u: Uint8Array) => sidecar.push(u));
    for (let i = 0; i < 6; i++) source.getMap("nodes").set(`n${i}`, { ord: `a${i}` });

    const restored = new Y.Doc();
    const report = applyRecoveredUpdates((u) => Y.applyUpdate(restored, u), {
      sidecar,
      replay: [],
    });

    expect(report.replayCount).toBe(0);
    expect(report.sidecarCount).toBe(6);
    expect(report.recovered).toBe(true);
    expect(restored.getMap("nodes").toJSON()).toEqual(source.getMap("nodes").toJSON());
  });
});
