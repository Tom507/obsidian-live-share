// WP42 / C42 AC1+AC3 (blind 2) — degenerate unknown frames: zero-length payload,
// omitted payload, a 64 KiB payload, an empty doc id, and a truncated/garbage
// buffer. None of them may throw out of the decode path, and none may be
// mistaken for a checkpoint.
import { describe, expect, it } from "vitest";
import {
  MUX_CHECKPOINT,
  MUX_REPLAY_END,
  MUX_SYNC,
  decodeCheckpointFrame,
  decodeMuxMessage,
  encodeMuxMessage,
} from "../../sync/mux-protocol.js";

/** Decode without letting anything escape; returns the error instead of throwing. */
function safeDecode(frame: Uint8Array): { ok: true; msgType: number } | { ok: false; err: unknown } {
  try {
    return { ok: true, msgType: decodeMuxMessage(frame).msgType };
  } catch (err) {
    return { ok: false, err };
  }
}

describe("WP42 AC1/AC3 (blind2) — degenerate unknown frames decode cleanly", () => {
  it("handles an unknown type with no payload at all", () => {
    const result = safeDecode(encodeMuxMessage("doc", MUX_REPLAY_END));
    expect(result).toEqual({ ok: true, msgType: MUX_REPLAY_END });
    expect(decodeMuxMessage(encodeMuxMessage("doc", MUX_REPLAY_END)).payload.byteLength).toBe(0);
  });

  it("handles an unknown type with an explicit zero-length payload", () => {
    const frame = encodeMuxMessage("doc", MUX_REPLAY_END, new Uint8Array(0));
    expect(safeDecode(frame)).toEqual({ ok: true, msgType: MUX_REPLAY_END });
    expect(decodeMuxMessage(frame).payload.byteLength).toBe(0);
  });

  it("handles an unknown type carrying 64 KiB", () => {
    const payload = new Uint8Array(65_536);
    payload.fill(0xa5);
    const frame = encodeMuxMessage("doc", 13, payload);
    expect(safeDecode(frame)).toEqual({ ok: true, msgType: 13 });
    expect(decodeMuxMessage(frame).payload.byteLength).toBe(65_536);
  });

  it("handles an unknown type on the connection-level empty doc id", () => {
    const frame = encodeMuxMessage("", 14, new Uint8Array([1]));
    expect(safeDecode(frame)).toEqual({ ok: true, msgType: 14 });
    expect(decodeMuxMessage(frame).docId).toBe("");
  });
});

describe("WP42 AC1/AC3 (blind2) — nothing degenerate is mistaken for a checkpoint", () => {
  it("returns null for a zero-length-payload frame of a NON-checkpoint type", () => {
    // The batch boundary is its own type (MUX_REPLAY_END); a degenerate frame of
    // any other type must never be read as a checkpoint.
    for (const type of [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, MUX_REPLAY_END, 200]) {
      expect(decodeCheckpointFrame(encodeMuxMessage("doc", type)), `type ${type}`).toBeNull();
      expect(
        decodeCheckpointFrame(encodeMuxMessage("doc", type, new Uint8Array(0))),
        `type ${type} explicit empty`,
      ).toBeNull();
    }
  });

  it("does not confuse a MUX_SYNC frame whose payload happens to start with 11", () => {
    const frame = encodeMuxMessage("doc", MUX_SYNC, new Uint8Array([MUX_CHECKPOINT, 0, 0]));
    expect(decodeCheckpointFrame(frame)).toBeNull();
    expect(decodeMuxMessage(frame).msgType).toBe(MUX_SYNC);
  });

  it("never leaks a decode error for a truncated buffer through the tolerance path", () => {
    const full = encodeMuxMessage("doc-truncated", MUX_CHECKPOINT, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const truncated = full.slice(0, Math.max(1, full.byteLength - 3));
    let threw: unknown = null;
    try {
      const decoded = decodeCheckpointFrame(truncated);
      // Either a null (rejected) or a frame — both are acceptable; a THROW is not.
      expect(decoded === null || typeof decoded.docId === "string").toBe(true);
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeNull();
  });
});
