// WP42 / C42 AC2 (blind 1) — the same barrier guarantee observed through REAL
// Yjs state rather than frame tags, and across THREE doc ids replaying
// concurrently on one socket. Interleaving classes from three peers upward are
// distinct, so the multi-doc case is exercised explicitly.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MUX_AWARENESS,
  MUX_REPLAY_END,
  MUX_SYNC,
  MUX_SYNC_ENCRYPTED,
  createReplayGate,
  encodeReplayEndBody,
} from "../../sync/mux-protocol.js";
import type { GatedFrame } from "../../sync/mux-protocol.js";

function replayEnd(docId: string, lastSeq: number): GatedFrame {
  return { docId, msgType: MUX_REPLAY_END, payload: encodeReplayEndBody(lastSeq) };
}

/** Author a deterministic history and capture one update per transaction. */
function history(count: number): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));
  for (let i = 0; i < count; i++) {
    const node = new Y.Map<unknown>();
    node.set("ord", `a${i}`);
    doc.getMap("nodes").set(`n${i}`, node);
  }
  return { doc, updates };
}

describe("WP42 AC2 (blind1) — the doc is never observed half-replayed", () => {
  it("stays untouched until MUX_REPLAY_END, then reaches the full state at once", () => {
    const doc = "__canvas__:atomic";
    const { doc: source, updates } = history(5);

    const target = new Y.Doc();
    const gate = createReplayGate();
    gate.beginReplay(doc);

    for (const update of updates) {
      for (const out of gate.accept({ docId: doc, msgType: MUX_SYNC, payload: update })) {
        Y.applyUpdate(target, out.payload);
      }
      // Mid-batch the doc has learned nothing.
      expect(target.getMap("nodes").size).toBe(0);
    }

    for (const out of gate.accept(replayEnd(doc, updates.length))) {
      Y.applyUpdate(target, out.payload);
    }

    expect(target.getMap("nodes").size).toBe(5);
    expect(target.getMap("nodes").toJSON()).toEqual(source.getMap("nodes").toJSON());
    expect(gate.lastSeq(doc)).toBe(5);
  });

  it("keeps encrypted replay frames in the batch, unmodified and in order", () => {
    const doc = "__canvas__:encrypted";
    const gate = createReplayGate();
    gate.beginReplay(doc);

    const cipher = [new Uint8Array([1, 0xde, 0xad]), new Uint8Array([1, 0xbe, 0xef])];
    expect(gate.accept({ docId: doc, msgType: MUX_SYNC_ENCRYPTED, payload: cipher[0] })).toEqual([]);
    expect(gate.accept({ docId: doc, msgType: MUX_SYNC_ENCRYPTED, payload: cipher[1] })).toEqual([]);

    const released = gate.accept(replayEnd(doc, 2));
    expect(released.map((f) => f.msgType)).toEqual([MUX_SYNC_ENCRYPTED, MUX_SYNC_ENCRYPTED]);
    expect(released.map((f) => f.payload)).toEqual(cipher);
  });
});

describe("WP42 AC2 (blind1) — three docs replay independently on one socket", () => {
  it("closes each doc's barrier only on that doc's own marker", () => {
    const docs = ["__canvas__:a", "__canvas__:b", "__canvas__:c"];
    const gate = createReplayGate();
    for (const d of docs) gate.beginReplay(d);

    const processedFor: Record<string, GatedFrame[]> = Object.fromEntries(
      docs.map((d) => [d, [] as GatedFrame[]]),
    );
    const push = (out: GatedFrame[]) => {
      for (const f of out) processedFor[f.docId].push(f);
    };
    const tag = (docId: string, msgType: number, value: number): GatedFrame => ({
      docId,
      msgType,
      payload: new Uint8Array([value]),
    });

    // Fully interleaved arrival across the three docs.
    push(gate.accept(tag(docs[0], MUX_SYNC, 10)));
    push(gate.accept(tag(docs[1], MUX_SYNC, 20)));
    push(gate.accept(tag(docs[2], MUX_SYNC, 30)));
    push(gate.accept(tag(docs[0], MUX_AWARENESS, 11)));
    push(gate.accept(tag(docs[1], MUX_SYNC, 21)));

    expect(gate.bufferedCount(docs[0])).toBe(2);
    expect(gate.bufferedCount(docs[1])).toBe(2);
    expect(gate.bufferedCount(docs[2])).toBe(1);

    // Closing doc b must not release doc a or doc c.
    push(gate.accept(replayEnd(docs[1], 2)));
    expect(processedFor[docs[1]].map((f) => f.payload[0])).toEqual([20, 21]);
    expect(processedFor[docs[0]]).toEqual([]);
    expect(processedFor[docs[2]]).toEqual([]);
    expect(gate.isReplaying(docs[0])).toBe(true);
    expect(gate.isReplaying(docs[2])).toBe(true);

    push(gate.accept(replayEnd(docs[0], 2)));
    push(gate.accept(replayEnd(docs[2], 1)));

    expect(processedFor[docs[0]].map((f) => f.payload[0])).toEqual([10, 11]);
    expect(processedFor[docs[2]].map((f) => f.payload[0])).toEqual([30]);
    expect(gate.lastSeq(docs[0])).toBe(2);
    expect(gate.lastSeq(docs[1])).toBe(2);
    expect(gate.lastSeq(docs[2])).toBe(1);
  });
});

describe("WP42 AC2 (blind1) — DISCRIMINATION", () => {
  it("DISCRIMINATION — with enabled:false the doc is observably half-replayed mid-batch", () => {
    const doc = "__canvas__:disabled";
    const { updates } = history(5);

    const target = new Y.Doc();
    const disabled = createReplayGate({ enabled: false });
    disabled.beginReplay(doc);

    const sizesMidBatch: number[] = [];
    for (const update of updates) {
      for (const out of disabled.accept({ docId: doc, msgType: MUX_SYNC, payload: update })) {
        Y.applyUpdate(target, out.payload);
      }
      sizesMidBatch.push(target.getMap("nodes").size);
    }

    // The doc grew one node at a time instead of appearing complete at the marker.
    expect(sizesMidBatch).toEqual([1, 2, 3, 4, 5]);
    expect(disabled.bufferedCount(doc)).toBe(0);
    expect(disabled.isReplaying(doc)).toBe(false);
  });
});
