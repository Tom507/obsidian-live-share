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
// WP42 (C42), mirroring WP41 (`server/src/mux-protocol.ts`): the client -> relay
// compaction marker and the relay -> client replay boundary. Both are ADDITIVE —
// every frame type above keeps its number, meaning and byte encoding, `5` stays
// deliberately unclaimed, and a peer or relay that does not know 11/12 simply
// ignores them. Both stay below 128, so the `writeVarUint` msgType remains one
// byte and no existing frame grows.
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

// ---------------------------------------------------------------------------
// WP42 (C42) — client-side checkpoint frame and replay handling.
//
// Everything below is PURE: it uses only the lib0 encoding/decoding primitives
// this file already imports — no Yjs, no Obsidian, no filesystem, no clock — so
// it can be reasoned about and tested headlessly (precedent:
// `plugin/src/canvas/reconcile-plan.ts`). `sync.ts` only wires it.
//
// The frame numbers and body layouts are fixed by WP41 and the two
// `mux-protocol.ts` files are byte-parallel; changing either number is a
// protocol break.
// ---------------------------------------------------------------------------

/**
 * Checkpoint body: varUint `upToSeq`, then the opaque tail verbatim.
 *
 * The supersede point rides in the ENVELOPE so the relay can decide what it may
 * truncate without ever decoding the tail (which may be ciphertext).
 */
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

/** Replay-end body: varUint `lastSeq`. */
export function encodeReplayEndBody(lastSeq: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, lastSeq);
  return encoding.toUint8Array(encoder);
}

/**
 * Must not throw: the marker is a readiness signal, and an empty or garbled body
 * from an unknown relay build degrades to `{ lastSeq: 0 }` — "capable, nothing
 * stored" — rather than breaking the barrier.
 */
export function decodeReplayEndBody(body: Uint8Array): { lastSeq: number } {
  try {
    const decoder = decoding.createDecoder(body);
    const lastSeq = decoding.readVarUint(decoder);
    return { lastSeq: Number.isFinite(lastSeq) && lastSeq > 0 ? lastSeq : 0 };
  } catch {
    return { lastSeq: 0 };
  }
}

export interface CheckpointFrame {
  docId: string;
  /** Everything up to this relay seq may be truncated by the relay. */
  upToSeq: number;
  /** The full doc state as ONE update (`Y.encodeStateAsUpdate`). */
  update: Uint8Array;
}

export function encodeCheckpointFrame(
  docId: string,
  upToSeq: number,
  stateUpdate: Uint8Array,
): Uint8Array {
  return encodeMuxMessage(docId, MUX_CHECKPOINT, encodeCheckpointBody(upToSeq, stateUpdate));
}

export function encodeReplayEndFrame(docId: string, lastSeq: number): Uint8Array {
  return encodeMuxMessage(docId, MUX_REPLAY_END, encodeReplayEndBody(lastSeq));
}

/**
 * `null` for any other msgType AND for any buffer that fails to parse — a frame
 * type this build does not understand must never be misread, and must never
 * throw at a peer that does not know it.
 */
export function decodeCheckpointFrame(data: Uint8Array): CheckpointFrame | null {
  try {
    const { docId, msgType, payload } = decodeMuxMessage(data);
    if (msgType !== MUX_CHECKPOINT) return null;
    const { upToSeq, payload: update } = decodeCheckpointBody(payload);
    return { docId, upToSeq, update };
  } catch {
    return null;
  }
}

/**
 * Emission trigger threshold: an UPDATE COUNT, not a timing constant. No timer,
 * no wall clock is involved in deciding when to checkpoint.
 */
export const CHECKPOINT_UPDATE_THRESHOLD = 64;

export type CheckpointTriggerReason = "sole-peer-sync" | "update-threshold" | "release";

export interface CheckpointTrigger {
  reason: CheckpointTriggerReason;
  peerCount: number;
  updatesSinceCheckpoint: number;
  hasLocalState: boolean;
  relayBlobSupport: boolean;
}

/**
 * The documented trigger. A checkpoint is never emitted into a relay that cannot
 * store it (AC3) and never when there is no state to carry.
 */
export function shouldEmitCheckpoint(trigger: CheckpointTrigger): boolean {
  if (!trigger.relayBlobSupport || !trigger.hasLocalState) return false;
  switch (trigger.reason) {
    case "sole-peer-sync":
      return trigger.peerCount === 0;
    case "update-threshold":
      return trigger.updatesSinceCheckpoint >= CHECKPOINT_UPDATE_THRESHOLD;
    case "release":
      return trigger.updatesSinceCheckpoint > 0;
    default:
      return false;
  }
}

// --- Replay barrier (the AC2 mechanism) ------------------------------------
//
// WP41 replays every stored frame under its ORIGINAL msgType and terminates the
// batch with exactly one MUX_REPLAY_END, even when nothing was stored
// (`lastSeq = 0`). Replayed and live frames are therefore indistinguishable on
// the wire, so the client mechanism is a readiness BARRIER, not a type filter:
// nothing reaches the doc until the batch is complete, and then the whole batch
// is released at once in arrival order.

export interface GatedFrame {
  docId: string;
  msgType: number;
  payload: Uint8Array;
}

export type ReplayEndReason = "replay-end" | "unsupported";

export interface ReplayRelease {
  /** Everything buffered during the batch, in arrival order. */
  frames: GatedFrame[];
  reason: ReplayEndReason;
  /** From the marker; `null` when the batch ended without one. */
  lastSeq: number | null;
  buffered: number;
  /** `reason === "unsupported"` — the legacy-relay fallback path. */
  fallback: boolean;
}

export interface ReplayGate {
  /** Idempotent: a repeat keeps the one open batch and its buffer. */
  beginReplay(docId: string): void;
  /** The frames to process NOW, in order. */
  accept(frame: GatedFrame): GatedFrame[];
  endReplay(docId: string, reason?: ReplayEndReason): ReplayRelease;
  isReplaying(docId: string): boolean;
  bufferedCount(docId: string): number;
  /** Survives the batch; feeds the next checkpoint's `upToSeq`. */
  lastSeq(docId: string): number | null;
}

/**
 * `enabled` is the injected discrimination seam (default `true`). With
 * `enabled: false` the gate degrades to a pass-through and the barrier
 * disappears — which is exactly the defect AC2 forbids, so at least one test
 * fails in that configuration.
 */
export function createReplayGate(options?: { enabled?: boolean }): ReplayGate {
  const enabled = options?.enabled !== false;
  // docId -> frames buffered while its batch is open. Presence == batch open.
  const sessions = new Map<string, GatedFrame[]>();
  // docId -> highest replayed seq, recorded from a marker only.
  const markerSeqs = new Map<string, number>();

  const recordedSeq = (docId: string): number | null => {
    const seq = markerSeqs.get(docId);
    return seq === undefined ? null : seq;
  };

  return {
    beginReplay(docId: string): void {
      if (!enabled) return;
      if (!sessions.has(docId)) sessions.set(docId, []);
    },

    accept(frame: GatedFrame): GatedFrame[] {
      if (!enabled) return [frame];
      const buffer = sessions.get(frame.docId);
      // No open batch (or a doc that never had one): straight through, including
      // a stray marker — the caller decides what a marker outside a batch means.
      if (!buffer) return [frame];
      if (frame.msgType === MUX_REPLAY_END) {
        markerSeqs.set(frame.docId, decodeReplayEndBody(frame.payload).lastSeq);
        sessions.delete(frame.docId);
        // The marker itself is consumed, never forwarded to the doc.
        return buffer;
      }
      buffer.push(frame);
      return [];
    },

    endReplay(docId: string, reason: ReplayEndReason = "replay-end"): ReplayRelease {
      const buffer = sessions.get(docId);
      // Unknown doc / already-closed batch: a no-op release, never a throw.
      sessions.delete(docId);
      const frames = buffer ?? [];
      return {
        frames,
        reason,
        lastSeq: recordedSeq(docId),
        buffered: frames.length,
        fallback: reason === "unsupported",
      };
    },

    isReplaying(docId: string): boolean {
      return sessions.has(docId);
    },

    bufferedCount(docId: string): number {
      return sessions.get(docId)?.length ?? 0;
    },

    lastSeq(docId: string): number | null {
      return recordedSeq(docId);
    },
  };
}

// --- Sidecar + replay composition (AC4) ------------------------------------

export interface RecoverySources {
  /** WP24/WP25 prior updates — INJECTED, never imported. */
  sidecar?: readonly Uint8Array[];
  /** Relay blobs, in relay order. */
  replay?: readonly Uint8Array[];
}

export interface RecoveryReport {
  applied: number;
  skippedDuplicates: number;
  sidecarCount: number;
  replayCount: number;
  recovered: boolean;
}

/** Stable key for byte-identical detection. Pure, no hashing dependency. */
function updateKey(update: Uint8Array): string {
  let key = "";
  for (let i = 0; i < update.length; i++) key += String.fromCharCode(update[i]);
  return `${update.length}:${key}`;
}

/**
 * Apply prior updates from both persistence layers: sidecar first, then replay.
 *
 * `apply` is the injected doc writer (`Y.applyUpdate`), which keeps this pure.
 * Dedupe (default on) skips byte-identical updates so each one is handed to the
 * doc exactly once — but it is an OPTIMISATION only: the "no double application
 * in effect" guarantee rests on the CRDT being idempotent and commutative, not
 * on this bookkeeping, so switching it off changes the counters and not the
 * resulting state.
 */
export function applyRecoveredUpdates(
  apply: (update: Uint8Array) => void,
  sources: RecoverySources,
  options?: { dedupe?: boolean },
): RecoveryReport {
  const dedupe = options?.dedupe !== false;
  const sidecar = sources.sidecar ?? [];
  const replay = sources.replay ?? [];
  const seen = new Set<string>();
  let applied = 0;
  let skippedDuplicates = 0;

  for (const update of [...sidecar, ...replay]) {
    if (dedupe) {
      const key = updateKey(update);
      if (seen.has(key)) {
        skippedDuplicates++;
        continue;
      }
      seen.add(key);
    }
    apply(update);
    applied++;
  }

  return {
    applied,
    skippedDuplicates,
    sidecarCount: sidecar.length,
    replayCount: replay.length,
    recovered: applied > 0,
  };
}
