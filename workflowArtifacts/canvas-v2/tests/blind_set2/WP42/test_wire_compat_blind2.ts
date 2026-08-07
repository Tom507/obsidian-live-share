// WP42 / C42 AC1 (blind 2) — wire compatibility at the ENCODING BOUNDARIES:
// varuint width transitions around the new type number, empty vs. omitted
// payloads, oversized doc ids and payloads, and the "no payload" / "zero-length
// payload" distinction that MUX_SUBSCRIBE and MUX_PING rely on.
import { describe, expect, it } from "vitest";
import {
  MUX_CHECKPOINT,
  MUX_PING,
  MUX_PONG,
  MUX_REPLAY_END,
  MUX_SUBSCRIBE,
  MUX_SYNC,
  decodeMuxMessage,
  encodeMuxMessage,
} from "../../sync/mux-protocol.js";

describe("WP42 AC1 (blind2) — varuint boundaries are not disturbed", () => {
  it("keeps every existing type and the new one inside a one-byte varuint", () => {
    const types = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, MUX_CHECKPOINT, MUX_REPLAY_END];
    for (const t of types) {
      // Empty docId -> 1 byte; a one-byte msgType therefore yields a 2-byte frame.
      expect(encodeMuxMessage("", t).byteLength, `type ${t}`).toBe(2);
    }
  });

  it("still decodes types far above the known range without widening existing frames", () => {
    for (const t of [13, 63, 127, 128, 255, 300]) {
      const decoded = decodeMuxMessage(encodeMuxMessage("d", t, new Uint8Array([1])));
      expect(decoded.msgType, `type ${t}`).toBe(t);
    }
    // A frame that used to be 2 bytes is still 2 bytes.
    expect(encodeMuxMessage("", MUX_PONG).byteLength).toBe(2);
  });
});

describe("WP42 AC1 (blind2) — payload presence semantics are unchanged", () => {
  it("distinguishes an omitted payload from an explicit zero-length payload on the wire", () => {
    const omitted = encodeMuxMessage("doc-z", MUX_SUBSCRIBE);
    const explicitEmpty = encodeMuxMessage("doc-z", MUX_SUBSCRIBE, new Uint8Array(0));
    // The explicit form writes a length prefix of 0; the omitted form writes nothing.
    expect(explicitEmpty.byteLength).toBe(omitted.byteLength + 1);
    // Both decode to a zero-length payload, which is what the dispatcher relies on.
    expect(decodeMuxMessage(omitted).payload.byteLength).toBe(0);
    expect(decodeMuxMessage(explicitEmpty).payload.byteLength).toBe(0);
  });

  it("gives the checkpoint frame exactly the same two forms", () => {
    const omitted = encodeMuxMessage("doc-z", MUX_CHECKPOINT);
    const explicitEmpty = encodeMuxMessage("doc-z", MUX_CHECKPOINT, new Uint8Array(0));
    expect(explicitEmpty.byteLength).toBe(omitted.byteLength + 1);
    expect(decodeMuxMessage(omitted).payload.byteLength).toBe(0);
    expect(decodeMuxMessage(explicitEmpty).payload.byteLength).toBe(0);
    expect(decodeMuxMessage(omitted).msgType).toBe(MUX_CHECKPOINT);
  });
});

describe("WP42 AC1 (blind2) — large and awkward frames are unaffected", () => {
  it("round-trips a 128 KiB payload on an existing type", () => {
    const payload = new Uint8Array(131_072);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) % 256;
    const decoded = decodeMuxMessage(encodeMuxMessage("big.canvas", MUX_SYNC, payload));
    expect(decoded.msgType).toBe(MUX_SYNC);
    expect(decoded.payload.byteLength).toBe(payload.byteLength);
    expect(decoded.payload).toEqual(payload);
  });

  it("round-trips a long multi-byte doc id whose length prefix needs two varuint bytes", () => {
    const docId = `__canvas__:${"ä".repeat(400)}`;
    const decoded = decodeMuxMessage(encodeMuxMessage(docId, MUX_CHECKPOINT, new Uint8Array([9])));
    expect(decoded.docId).toBe(docId);
    expect(decoded.msgType).toBe(MUX_CHECKPOINT);
    expect(Array.from(decoded.payload)).toEqual([9]);
  });

  it("keeps the empty doc id reserved for connection-level frames", () => {
    for (const t of [MUX_PING, MUX_PONG]) {
      const decoded = decodeMuxMessage(encodeMuxMessage("", t));
      expect(decoded.docId).toBe("");
      expect(decoded.msgType).toBe(t);
    }
  });
});
