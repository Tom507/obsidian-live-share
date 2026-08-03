// WP24 / AC3 (truncated) — a torn history is the case that will actually happen
// in the field: the process died between `io.append` reaching the OS and the
// bytes reaching the platter, so the last frame is short.
//
// Two distinct torn shapes exist and a parser can handle one while crashing on
// the other:
//
//   - a header cut mid-way (1..3 of the 4 length bytes present)
//   - a complete header whose declared payload length runs past end-of-file
//
// The second one is where a naive parser does `bytes.slice(at + 4, at + 4 + n)`,
// gets a SHORT array back without any error (slice clamps), and hands those
// truncated bytes to Yjs — which then either throws out of `load` (AC3
// violation) or, worse, accepts them.
//
// Both must land on TRUNCATED, apply nothing, and not throw.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import { concatBytes, createFakeIO, docSnapshot, frame, recordUpdates } from "./harness";

const GUID = "guid-torn";

function threeGoodFrames(): { frames: Uint8Array[]; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates = recordUpdates(doc);
  doc.getMap("nodes").set("p", { x: 1 });
  doc.getMap("nodes").set("q", { x: 2 });
  doc.getMap("nodes").set("r", { x: 3 });
  return { frames: updates.map(frame), updates };
}

async function loadFrom(history: Uint8Array) {
  const io = createFakeIO({ [sidecarHistoryPath(GUID)]: history });
  const store = createSidecarStore(io);
  const doc = new Y.Doc();
  const events: unknown[] = [];
  doc.on("update", (u: Uint8Array) => events.push(u));
  const result = await store.load(GUID, doc);
  return { io, doc, events, result };
}

describe("WP24 AC3 — a truncated history is a defined degradation", () => {
  it("a header cut mid-way reports TRUNCATED and applies nothing", async () => {
    const { frames } = threeGoodFrames();
    const history = concatBytes(frames[0], frames[1], Uint8Array.from([0x00, 0x00]));

    const { result, doc, events } = await loadFrom(history);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.TRUNCATED);
    expect(result.historyEntriesApplied).toBe(0);
    expect(events).toHaveLength(0);
    expect(docSnapshot(doc)).toEqual(docSnapshot(new Y.Doc()));
  });

  it("a payload that runs past end-of-file reports TRUNCATED and applies nothing", async () => {
    const { frames } = threeGoodFrames();
    const short = frames[2].slice(0, frames[2].length - 3); // header intact, payload short
    const history = concatBytes(frames[0], frames[1], short);

    const { result, doc, events } = await loadFrom(history);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.TRUNCATED);
    expect(result.historyEntriesApplied).toBe(0);
    expect(events).toHaveLength(0);
    expect(docSnapshot(doc)).toEqual(docSnapshot(new Y.Doc()));
  });

  it("a single byte of file is TRUNCATED, not CORRUPT and not MISSING", async () => {
    const { result } = await loadFrom(Uint8Array.from([0x00]));
    expect(result.degradation).toBe(SIDECAR_DEGRADATION.TRUNCATED);
  });

  it("never throws, whatever the tear looks like", async () => {
    const { frames } = threeGoodFrames();
    const whole = concatBytes(...frames);
    for (let cut = 1; cut < whole.length; cut++) {
      const { result } = await loadFrom(whole.slice(0, cut));
      // Every prefix is either a run of complete frames (NONE) or a tear
      // (TRUNCATED). Nothing here may throw and nothing may be CORRUPT.
      expect([SIDECAR_DEGRADATION.NONE, SIDECAR_DEGRADATION.TRUNCATED]).toContain(
        result.degradation,
      );
    }
  });

  it("the good frames really were applicable — the emptiness is the store's doing", async () => {
    // Positive control. Without it, "doc stayed empty" would also pass for a
    // fixture whose frames carried nothing.
    const { frames, updates } = threeGoodFrames();
    const control = new Y.Doc();
    for (const update of updates) Y.applyUpdate(control, update);
    expect(Object.keys(control.getMap("nodes").toJSON())).toHaveLength(3);

    const history = concatBytes(frames[0], frames[1], frames[2].slice(0, 5));
    const { doc } = await loadFrom(history);
    expect(doc.getMap("nodes").toJSON()).toEqual({});
  });

  it("a truncated tail does not stop a later, repaired sidecar from loading", async () => {
    // The degradation is a report, not a latch: once the file is whole again
    // the very same store loads it normally.
    const { frames, updates } = threeGoodFrames();
    const io = createFakeIO({
      [sidecarHistoryPath(GUID)]: concatBytes(frames[0], Uint8Array.from([0x00, 0x00, 0x00])),
    });
    const store = createSidecarStore(io);
    expect((await store.load(GUID, new Y.Doc())).degradation).toBe(SIDECAR_DEGRADATION.TRUNCATED);

    io.files.set(sidecarHistoryPath(GUID), concatBytes(...frames));
    const doc = new Y.Doc();
    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.historyEntriesApplied).toBe(updates.length);
    expect(Object.keys(doc.getMap("nodes").toJSON())).toHaveLength(3);
  });
});
