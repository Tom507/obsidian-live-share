// WP42 / C42 AC2 — replayed frames are applied BEFORE live traffic is processed.
//
// WP41 replays each stored frame with its ORIGINAL msgType (MUX_SYNC,
// MUX_SYNC_ENCRYPTED, …) and terminates the batch with one MUX_REPLAY_END
// carrying the highest replayed seq. Replay and live frames are therefore
// indistinguishable by type, so the client's mechanism is a READINESS BARRIER,
// not a type filter: while the batch is open nothing is handed to the doc, and at
// MUX_REPLAY_END the whole batch is released at once, in arrival order — so the
// doc is never observed half-replayed and no live frame overtakes the batch.
//
// The injected seam is `createReplayGate({ enabled })`; the discrimination test
// at the bottom pins that the barrier disappears when it is switched off.
// No timers, no sockets, no sleeps.
import { describe, expect, it } from "vitest";
import {
  MUX_AWARENESS,
  MUX_REPLAY_END,
  MUX_SYNC,
  createReplayGate,
  encodeReplayEndBody,
} from "../../sync/mux-protocol.js";
import type { GatedFrame } from "../../sync/mux-protocol.js";

const DOC = "__canvas__:guid-1";

function frame(msgType: number, tag: number, docId: string = DOC): GatedFrame {
  return { docId, msgType, payload: new Uint8Array([tag]) };
}

function replayEnd(lastSeq: number, docId: string = DOC): GatedFrame {
  return { docId, msgType: MUX_REPLAY_END, payload: encodeReplayEndBody(lastSeq) };
}

const tagOf = (f: GatedFrame): number => f.payload[0];

describe("WP42 AC2 — the replay batch is a barrier, not a trickle", () => {
  it("hands nothing to the doc while the replay batch is still open", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);

    expect(gate.isReplaying(DOC)).toBe(true);
    expect(gate.accept(frame(MUX_SYNC, 1))).toEqual([]);
    expect(gate.accept(frame(MUX_SYNC, 2))).toEqual([]);
    expect(gate.accept(frame(MUX_AWARENESS, 3))).toEqual([]);
    expect(gate.bufferedCount(DOC)).toBe(3);
  });

  it("releases the whole batch in arrival order at MUX_REPLAY_END", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);

    const processed: GatedFrame[] = [];
    processed.push(...gate.accept(frame(MUX_SYNC, 1)));
    processed.push(...gate.accept(frame(MUX_SYNC, 2)));
    processed.push(...gate.accept(frame(MUX_SYNC, 3)));
    expect(processed).toEqual([]);

    processed.push(...gate.accept(replayEnd(3)));

    expect(processed.map(tagOf)).toEqual([1, 2, 3]);
    expect(gate.isReplaying(DOC)).toBe(false);
    expect(gate.bufferedCount(DOC)).toBe(0);
  });

  it("does not forward the MUX_REPLAY_END marker itself to the doc", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);
    const released = gate.accept(replayEnd(0));

    expect(released).toEqual([]);
    expect(released.some((f) => f.msgType === MUX_REPLAY_END)).toBe(false);
    expect(gate.isReplaying(DOC)).toBe(false);
  });

  it("records the highest replayed seq so the next checkpoint can supersede it", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);
    gate.accept(frame(MUX_SYNC, 1));
    const release = gate.endReplay(DOC, "replay-end");
    expect(release.lastSeq).toBeNull(); // ended without a marker

    const gate2 = createReplayGate();
    gate2.beginReplay(DOC);
    gate2.accept(frame(MUX_SYNC, 1));
    gate2.accept(replayEnd(42));
    expect(gate2.lastSeq(DOC)).toBe(42);
  });

  it("no live frame overtakes the batch: everything replayed precedes everything after", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);

    const processed: GatedFrame[] = [];
    processed.push(...gate.accept(frame(MUX_SYNC, 1))); // stored
    processed.push(...gate.accept(frame(MUX_SYNC, 2))); // stored
    processed.push(...gate.accept(replayEnd(2)));
    processed.push(...gate.accept(frame(MUX_SYNC, 90))); // live, after the barrier
    processed.push(...gate.accept(frame(MUX_AWARENESS, 91)));

    expect(processed.map(tagOf)).toEqual([1, 2, 90, 91]);
    const lastReplayed = processed.findIndex((f) => tagOf(f) === 2);
    const firstLive = processed.findIndex((f) => tagOf(f) === 90);
    expect(lastReplayed).toBeLessThan(firstLive);
  });

  it("passes frames straight through for a doc that has no replay session", () => {
    const gate = createReplayGate();
    gate.beginReplay(DOC);

    const other = gate.accept(frame(MUX_SYNC, 99, "__canvas__:guid-OTHER"));
    expect(other.map(tagOf)).toEqual([99]);
    expect(gate.bufferedCount("__canvas__:guid-OTHER")).toBe(0);
    expect(gate.isReplaying("__canvas__:guid-OTHER")).toBe(false);
  });
});

describe("WP42 AC2 — DISCRIMINATION: the barrier disappears when the gate is disabled", () => {
  it("DISCRIMINATION — with enabled:false frames reach the doc mid-batch", () => {
    const disabled = createReplayGate({ enabled: false });
    disabled.beginReplay(DOC);

    // Every frame is handed over immediately, so a consumer sees the doc in a
    // half-replayed state and a post-barrier frame can be processed before the
    // batch is complete — exactly the defect AC2 forbids.
    const first = disabled.accept(frame(MUX_SYNC, 1));
    expect(first.map(tagOf)).toEqual([1]);
    expect(disabled.isReplaying(DOC)).toBe(false);
    expect(disabled.bufferedCount(DOC)).toBe(0);

    const processed: GatedFrame[] = [...first];
    processed.push(...disabled.accept(frame(MUX_SYNC, 2)));
    processed.push(...disabled.accept(replayEnd(2)));
    processed.push(...disabled.accept(frame(MUX_SYNC, 90)));

    // The marker is not even filtered out any more.
    expect(processed.map((f) => f.msgType)).toContain(MUX_REPLAY_END);
    expect(processed.length).toBe(4);

    // The enabled gate over the identical input keeps the batch atomic.
    const enabled = createReplayGate();
    enabled.beginReplay(DOC);
    expect(enabled.accept(frame(MUX_SYNC, 1))).toEqual([]);
    expect(enabled.accept(frame(MUX_SYNC, 2))).toEqual([]);
    const released = enabled.accept(replayEnd(2));
    expect(released.map(tagOf)).toEqual([1, 2]);
    expect(released.map((f) => f.msgType)).not.toContain(MUX_REPLAY_END);
  });
});
