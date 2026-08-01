// WP42 / C42 AC2 (blind 2) — boundary shapes of the same barrier: an empty batch
// (marker with lastSeq 0 and nothing before it), a 200-frame batch, a doubled
// beginReplay, a marker for a doc that never opened a session, and a second
// marker after the barrier already closed.
import { describe, expect, it } from "vitest";
import {
  MUX_AWARENESS,
  MUX_REPLAY_END,
  MUX_SYNC,
  createReplayGate,
  encodeReplayEndBody,
} from "../../sync/mux-protocol.js";
import type { GatedFrame } from "../../sync/mux-protocol.js";

const DOC = "__canvas__:edge";

function frame(msgType: number, tag: number, docId: string = DOC): GatedFrame {
  return { docId, msgType, payload: new Uint8Array([tag & 0xff, (tag >> 8) & 0xff]) };
}

function replayEnd(lastSeq: number, docId: string = DOC): GatedFrame {
  return { docId, msgType: MUX_REPLAY_END, payload: encodeReplayEndBody(lastSeq) };
}

const tagOf = (f: GatedFrame): number => f.payload[0] | (f.payload[1] << 8);

describe("WP42 AC2 (blind2) — empty and oversized batches", () => {
  it("closes immediately on a marker with lastSeq 0 and releases nothing", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);

    const released = gate.accept(replayEnd(0));
    expect(released).toEqual([]);
    expect(gate.isReplaying(DOC)).toBe(false);
    expect(gate.lastSeq(DOC)).toBe(0);

    // Everything after the (empty) batch flows straight through.
    expect(gate.accept(frame(MUX_SYNC, 1)).map(tagOf)).toEqual([1]);
  });

  it("buffers a 200-frame batch and releases it in exact arrival order", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);

    const expected: number[] = [];
    for (let i = 0; i < 200; i++) {
      expected.push(1000 + i);
      expect(gate.accept(frame(i % 2 === 0 ? MUX_SYNC : MUX_AWARENESS, 1000 + i))).toEqual([]);
    }
    expect(gate.bufferedCount(DOC)).toBe(200);

    const released = gate.accept(replayEnd(200));
    expect(released.map(tagOf)).toEqual(expected);
    expect(gate.bufferedCount(DOC)).toBe(0);
    expect(gate.lastSeq(DOC)).toBe(200);
  });

  it("carries a large lastSeq through the marker body unchanged", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);
    gate.accept(replayEnd(1_234_567));
    expect(gate.lastSeq(DOC)).toBe(1_234_567);
  });
});

describe("WP42 AC2 (blind2) — repeated and stray calls", () => {
  it("treats a repeated beginReplay for the same doc as one batch, not two", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);
    gate.accept(frame(MUX_SYNC, 50));
    gate.beginReplay(DOC); // e.g. a reconnect re-subscribe

    expect(gate.isReplaying(DOC)).toBe(true);
    const released = gate.accept(replayEnd(1));
    expect(released.map(tagOf)).toEqual([50]);
    expect(gate.bufferedCount(DOC)).toBe(0);
  });

  it("passes a stray marker through for a doc that never opened a batch", () => {
    const gate = createReplayGate();
    const out = gate.accept(replayEnd(9, "__canvas__:never-started"));
    // No session: the gate does not swallow frames it was never asked to hold.
    expect(out.length).toBe(1);
    expect(out[0].msgType).toBe(MUX_REPLAY_END);
    expect(gate.isReplaying("__canvas__:never-started")).toBe(false);
  });

  it("makes endReplay a harmless no-op for a doc with no session", () => {
    const gate = createReplayGate();
    const release = gate.endReplay("__canvas__:never-started", "replay-end");
    expect(release.frames).toEqual([]);
    expect(release.buffered).toBe(0);
    expect(release.fallback).toBe(false);
  });

  it("does not reopen the barrier when a second marker arrives after it closed", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);
    gate.accept(frame(MUX_SYNC, 7));
    expect(gate.accept(replayEnd(1)).map(tagOf)).toEqual([7]);

    const stray = gate.accept(replayEnd(2));
    expect(stray.length).toBe(1); // passed through, not swallowed
    expect(gate.isReplaying(DOC)).toBe(false);
    expect(gate.accept(frame(MUX_SYNC, 8)).map(tagOf)).toEqual([8]);
  });
});

describe("WP42 AC2 (blind2) — DISCRIMINATION", () => {
  it("DISCRIMINATION — a disabled gate never buffers and never filters the marker", () => {
    const disabled = createReplayGate({ enabled: false });
    disabled.beginReplay(DOC);

    const processed: GatedFrame[] = [];
    for (let i = 0; i < 5; i++) processed.push(...disabled.accept(frame(MUX_SYNC, 1000 + i)));
    processed.push(...disabled.accept(replayEnd(5)));
    processed.push(...disabled.accept(frame(MUX_SYNC, 2000)));

    expect(disabled.bufferedCount(DOC)).toBe(0);
    expect(processed.length).toBe(7);
    expect(processed.map((f) => f.msgType)).toContain(MUX_REPLAY_END);
    expect(disabled.lastSeq(DOC)).toBeNull();
  });
});
