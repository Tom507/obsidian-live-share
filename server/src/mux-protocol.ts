import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

export const MUX_SYNC = 0;
export const MUX_AWARENESS = 1;
export const MUX_SUBSCRIBE = 2;
export const MUX_UNSUBSCRIBE = 3;
export const MUX_SUBSCRIBED = 4;
export const MUX_SYNC_REQUEST = 6;
export const MUX_SYNC_ENCRYPTED = 7;
export const MUX_AWARENESS_ENCRYPTED = 8;
export const MUX_PING = 9;
export const MUX_PONG = 10;
// WP41 (C41): client -> relay compaction marker and relay -> client replay
// boundary. Both are additive; every frame type above keeps its meaning and
// encoding, and a peer that does not know them simply ignores them.
export const MUX_CHECKPOINT = 11;
export const MUX_REPLAY_END = 12;

export function encodeMuxMessage(docId: string, msgType: number, payload?: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, docId);
  encoding.writeVarUint(encoder, msgType);
  if (payload) encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export function decodeMuxMessage(data: Uint8Array): {
  docId: string;
  msgType: number;
  payload: Uint8Array;
} {
  const decoder = decoding.createDecoder(data);
  const docId = decoding.readVarString(decoder);
  const msgType = decoding.readVarUint(decoder);
  const payload = decoding.hasContent(decoder)
    ? decoding.readVarUint8Array(decoder)
    : new Uint8Array(0);
  return { docId, msgType, payload };
}

// One stored frame as it goes back on the wire during a replay. The relay knows
// its sequence number and the envelope type it received — nothing about the
// bytes.
export interface ReplayFrame {
  seq: number;
  msgType: number;
  payload: Uint8Array;
}

// Client -> relay checkpoint body, carried as the payload of
// encodeMuxMessage(docId, MUX_CHECKPOINT, body).
//
// The supersede point rides in the *envelope*: a leading varUint followed by the
// opaque tail. The relay reads the varUint to decide what it may drop and never
// looks at the tail, which may be ciphertext.
export function encodeCheckpointBody(upToSeq: number, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, upToSeq);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export function decodeCheckpointBody(body: Uint8Array): {
  upToSeq: number;
  payload: Uint8Array;
} {
  const decoder = decoding.createDecoder(body);
  const upToSeq = decoding.readVarUint(decoder);
  // readTailAsUint8Array returns a view into `body`; copy so the caller owns it.
  return { upToSeq, payload: decoding.readTailAsUint8Array(decoder).slice() };
}

export function encodeReplayEndBody(lastSeq: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, lastSeq);
  return encoding.toUint8Array(encoder);
}

export function decodeReplayEndBody(body: Uint8Array): { lastSeq: number } {
  const decoder = decoding.createDecoder(body);
  return { lastSeq: decoding.readVarUint(decoder) };
}

// The replay batch: every stored frame in ascending seq order, re-emitted with
// its original docId, envelope type and bytes, then exactly one trailing
// MUX_REPLAY_END carrying the highest replayed sequence number (0 when the doc
// has no stored frames). The marker makes "stored frames before live traffic" an
// observable boundary rather than an implicit one.
export function encodeReplay(docId: string, frames: readonly ReplayFrame[]): Uint8Array[] {
  const ordered = [...frames].sort((a, b) => a.seq - b.seq);
  const out = ordered.map((frame) => encodeMuxMessage(docId, frame.msgType, frame.payload));
  const lastSeq = ordered.length > 0 ? ordered[ordered.length - 1].seq : 0;
  out.push(encodeMuxMessage(docId, MUX_REPLAY_END, encodeReplayEndBody(lastSeq)));
  return out;
}
