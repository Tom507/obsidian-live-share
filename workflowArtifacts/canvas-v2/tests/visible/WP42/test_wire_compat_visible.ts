// WP42 / C42 AC1 — wire compatibility: adding the checkpoint frame type must not
// change the meaning or the ENCODING of any existing frame type.
//
// Oracle: golden bytes for two production frames plus an independent reference
// encoder built directly on lib0 (the same primitives mux-protocol uses), so a
// silent change to the framing is caught byte-exactly.
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import {
  MUX_AWARENESS,
  MUX_AWARENESS_ENCRYPTED,
  MUX_CHECKPOINT,
  MUX_PING,
  MUX_PONG,
  MUX_REPLAY_END,
  MUX_SUBSCRIBE,
  MUX_SUBSCRIBED,
  MUX_SYNC,
  MUX_SYNC_ENCRYPTED,
  MUX_SYNC_REQUEST,
  MUX_UNSUBSCRIBE,
  decodeMuxMessage,
  encodeMuxMessage,
} from "../../sync/mux-protocol.js";

/** Byte-for-byte re-implementation of the pre-WP42 framing. */
function referenceEncode(docId: string, msgType: number, payload?: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, docId);
  encoding.writeVarUint(encoder, msgType);
  if (payload) encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

const EXISTING: ReadonlyArray<readonly [string, number]> = [
  ["MUX_SYNC", MUX_SYNC],
  ["MUX_AWARENESS", MUX_AWARENESS],
  ["MUX_SUBSCRIBE", MUX_SUBSCRIBE],
  ["MUX_UNSUBSCRIBE", MUX_UNSUBSCRIBE],
  ["MUX_SUBSCRIBED", MUX_SUBSCRIBED],
  ["MUX_SYNC_REQUEST", MUX_SYNC_REQUEST],
  ["MUX_SYNC_ENCRYPTED", MUX_SYNC_ENCRYPTED],
  ["MUX_AWARENESS_ENCRYPTED", MUX_AWARENESS_ENCRYPTED],
  ["MUX_PING", MUX_PING],
  ["MUX_PONG", MUX_PONG],
];

describe("WP42 AC1 — existing mux constants are frozen", () => {
  it("keeps every pre-WP42 message type at its original number", () => {
    expect(MUX_SYNC).toBe(0);
    expect(MUX_AWARENESS).toBe(1);
    expect(MUX_SUBSCRIBE).toBe(2);
    expect(MUX_UNSUBSCRIBE).toBe(3);
    expect(MUX_SUBSCRIBED).toBe(4);
    expect(MUX_SYNC_REQUEST).toBe(6);
    expect(MUX_SYNC_ENCRYPTED).toBe(7);
    expect(MUX_AWARENESS_ENCRYPTED).toBe(8);
    expect(MUX_PING).toBe(9);
    expect(MUX_PONG).toBe(10);
  });

  it("claims 11 and 12 for the P6 checkpoint and replay-boundary frames", () => {
    // Fixed by WP41 (server/src/mux-protocol.ts); the client must match exactly.
    expect(MUX_CHECKPOINT).toBe(11);
    expect(MUX_REPLAY_END).toBe(12);
    for (const [, value] of EXISTING) {
      expect(MUX_CHECKPOINT).not.toBe(value);
      expect(MUX_REPLAY_END).not.toBe(value);
    }
    const all = [...EXISTING.map(([, v]) => v), MUX_CHECKPOINT, MUX_REPLAY_END];
    expect(new Set(all).size).toBe(all.length);
    // Both stay single-byte varuints, so no frame grows by a byte.
    expect(MUX_CHECKPOINT).toBeLessThan(128);
    expect(MUX_REPLAY_END).toBeLessThan(128);
  });

  it("leaves 5 unclaimed, so no existing deployment reinterprets it", () => {
    const claimed = [...EXISTING.map(([, v]) => v), MUX_CHECKPOINT, MUX_REPLAY_END];
    expect(claimed).not.toContain(5);
  });
});

describe("WP42 AC1 — the existing encoding is byte-unchanged", () => {
  it("matches the golden bytes of the production heartbeat frame", () => {
    // writeVarString("") -> [0]; writeVarUint(9) -> [9]; no payload.
    expect(Array.from(encodeMuxMessage("", MUX_PING))).toEqual([0, 9]);
  });

  it("matches the golden bytes of a payload-less subscribe frame", () => {
    // writeVarString("doc-1") -> [5, 'd','o','c','-','1']; writeVarUint(2) -> [2].
    expect(Array.from(encodeMuxMessage("doc-1", MUX_SUBSCRIBE))).toEqual([
      5, 100, 111, 99, 45, 49, 2,
    ]);
  });

  it("equals the independent reference encoder for every existing frame type", () => {
    const payload = new Uint8Array([0, 1, 2, 253, 254, 255]);
    for (const [name, type] of EXISTING) {
      expect(encodeMuxMessage("notes/readme.md", type, payload), name).toEqual(
        referenceEncode("notes/readme.md", type, payload),
      );
      expect(encodeMuxMessage("notes/readme.md", type), name).toEqual(
        referenceEncode("notes/readme.md", type),
      );
    }
  });

  it("round-trips every existing frame type unchanged", () => {
    const payload = new Uint8Array([7, 7, 7, 0, 9]);
    for (const [name, type] of EXISTING) {
      const decoded = decodeMuxMessage(encodeMuxMessage("doc/x.canvas", type, payload));
      expect(decoded.docId, name).toBe("doc/x.canvas");
      expect(decoded.msgType, name).toBe(type);
      expect(decoded.payload, name).toEqual(payload);
    }
  });

  it("frames the two new types with the same layout as every other type", () => {
    const payload = new Uint8Array([42, 43, 44]);
    for (const type of [MUX_CHECKPOINT, MUX_REPLAY_END]) {
      expect(encodeMuxMessage("doc-c", type, payload), `type ${type}`).toEqual(
        referenceEncode("doc-c", type, payload),
      );
    }
  });
});
