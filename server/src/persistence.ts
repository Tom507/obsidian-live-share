import { Level } from "level";

import { MUX_CHECKPOINT } from "./mux-protocol.js";

export type Permission = "read-write" | "read-only";
export interface Room {
  id: string;
  token: string;
  name: string;
  createdAt: number;
  lastActivityAt: number;
  hostUserId?: string;
  requireApproval?: boolean;
  readOnlyPatterns?: string[];
  defaultPermission?: Permission;
}

export interface Persistence {
  loadRooms(): Promise<Room[]>;
  saveRoom(room: Room): Promise<void>;
  deleteRoom(id: string): Promise<void>;
  close(): Promise<void>;
}

export function createLevelPersistence(dbPath = "./data/yjs-docs"): Persistence {
  const db = new Level(dbPath, { valueEncoding: "buffer" });

  return {
    async loadRooms(): Promise<Room[]> {
      const rooms: Room[] = [];
      try {
        for await (const [key, value] of db.iterator<string, Buffer>({
          keyEncoding: "utf8",
        })) {
          if (key.startsWith("room:")) {
            try {
              rooms.push(JSON.parse(value.toString("utf-8")));
            } catch (err) {
              console.warn("[persistence] corrupt room entry, skipping:", key, err);
            }
          }
        }
      } catch (err) {
        console.warn("[persistence] failed to load rooms:", err);
      }
      return rooms;
    },

    async saveRoom(room: Room): Promise<void> {
      await db.put(`room:${room.id}`, Buffer.from(JSON.stringify(room)) as unknown as string);
    },

    async deleteRoom(id: string): Promise<void> {
      try {
        await db.del(`room:${id}`);
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== "LEVEL_NOT_FOUND") throw err;
      }
    },

    async close(): Promise<void> {
      await db.close();
    },
  };
}

export const noopPersistence: Persistence = {
  loadRooms() {
    return Promise.resolve([]);
  },
  saveRoom() {
    return Promise.resolve();
  },
  deleteRoom() {
    return Promise.resolve();
  },
  close() {
    return Promise.resolve();
  },
};

let defaultPersistence: Persistence | null = null;

export function getDefaultPersistence(): Persistence {
  if (!defaultPersistence) {
    defaultPersistence = createLevelPersistence();
  }
  return defaultPersistence;
}

// ---------------------------------------------------------------------------
// WP41 (C41) — the opaque per-`roomId:docId` blob store.
//
// The relay appends the frames it relays so a room survives the absence of all
// peers, and replays them to a late subscriber. It stores *bytes*: it never
// parses, decrypts, validates or otherwise interprets a payload, which is what
// keeps encrypted rooms end-to-end encrypted. The only things it knows about a
// frame are the envelope type it arrived with and the sequence number the relay
// itself assigned.
//
// Replay safety rests on the CRDT property that update delivery is idempotent
// and commutative — there is deliberately no dedup, reordering or coalescing
// here, because any of those would require understanding the frames.
// ---------------------------------------------------------------------------

export interface StoredFrame {
  seq: number; // relay-assigned, 1-based, strictly ascending per roomId:docId
  msgType: number; // the envelope type as received
  payload: Uint8Array;
}

export interface BlobStore {
  append(
    roomId: string,
    docId: string,
    msgType: number,
    payload: Uint8Array,
  ): Promise<StoredFrame>;
  read(roomId: string, docId: string): Promise<StoredFrame[]>; // ascending seq, non-destructive
  checkpoint(
    roomId: string,
    docId: string,
    upToSeq: number,
    payload: Uint8Array,
  ): Promise<StoredFrame>;
  clear(roomId: string, docId: string): Promise<void>;
  close(): Promise<void>;
}

// Length-prefixing the ids keeps the key collision-free for colon-bearing ids:
// room "a:b" + doc "c" -> "3:a:b:1:c" is distinct from room "a" + doc "b:c" ->
// "1:a:3:b:c". Without it both would flatten to the same string.
function streamKey(roomId: string, docId: string): string {
  return `${roomId.length}:${roomId}:${docId.length}:${docId}:`;
}

function copyBytes(payload: Uint8Array): Uint8Array {
  const copy = new Uint8Array(payload.length);
  copy.set(payload);
  return copy;
}

// A frame handed out to a caller is always a fresh object over fresh bytes: the
// caller may recycle its socket buffer and a consumer may overwrite what it got
// back, without either reaching the stored copy.
function detach(frame: StoredFrame): StoredFrame {
  return { seq: frame.seq, msgType: frame.msgType, payload: copyBytes(frame.payload) };
}

// The cut-off a checkpoint at `checkpointSeq` may apply. `upToSeq = 0`
// supersedes nothing, and an overshooting `upToSeq` can never take the
// checkpoint itself with it.
function truncationCutoff(upToSeq: number, checkpointSeq: number): number {
  if (!Number.isFinite(upToSeq) || upToSeq <= 0) return 0;
  return Math.min(Math.floor(upToSeq), checkpointSeq - 1);
}

interface MemoryStream {
  frames: StoredFrame[];
  nextSeq: number;
}

export function createMemoryBlobStore(): BlobStore {
  const streams = new Map<string, MemoryStream>();

  function stream(roomId: string, docId: string): MemoryStream {
    const key = streamKey(roomId, docId);
    let existing = streams.get(key);
    if (!existing) {
      existing = { frames: [], nextSeq: 1 };
      streams.set(key, existing);
    }
    return existing;
  }

  function push(
    roomId: string,
    docId: string,
    msgType: number,
    payload: Uint8Array,
  ): { state: MemoryStream; frame: StoredFrame } {
    const state = stream(roomId, docId);
    const frame: StoredFrame = {
      seq: state.nextSeq,
      msgType,
      payload: copyBytes(payload),
    };
    state.nextSeq += 1;
    state.frames.push(frame);
    return { state, frame };
  }

  return {
    append(roomId, docId, msgType, payload) {
      const { frame } = push(roomId, docId, msgType, payload);
      return Promise.resolve(detach(frame));
    },

    read(roomId, docId) {
      const existing = streams.get(streamKey(roomId, docId));
      if (!existing) return Promise.resolve([]);
      return Promise.resolve(existing.frames.map(detach));
    },

    checkpoint(roomId, docId, upToSeq, payload) {
      const { state, frame } = push(roomId, docId, MUX_CHECKPOINT, payload);
      const cutoff = truncationCutoff(upToSeq, frame.seq);
      if (cutoff > 0) {
        state.frames = state.frames.filter((stored) => stored.seq > cutoff);
      }
      return Promise.resolve(detach(frame));
    },

    clear(roomId, docId) {
      const existing = streams.get(streamKey(roomId, docId));
      // Keep the counter: sequence numbers are never recycled.
      if (existing) existing.frames = [];
      return Promise.resolve();
    },

    close() {
      streams.clear();
      return Promise.resolve();
    },
  };
}

const SEQ_KEY_WIDTH = 16;

function frameKey(prefix: string, seq: number): string {
  return `f:${prefix}${String(seq).padStart(SEQ_KEY_WIDTH, "0")}`;
}

function encodeFrameValue(msgType: number, payload: Uint8Array): Buffer {
  const value = Buffer.allocUnsafe(4 + payload.length);
  value.writeUInt32BE(msgType >>> 0, 0);
  value.set(payload, 4);
  return value;
}

function decodeFrameValue(value: Buffer): { msgType: number; payload: Uint8Array } {
  return {
    msgType: value.readUInt32BE(0),
    payload: copyBytes(new Uint8Array(value.buffer, value.byteOffset + 4, value.length - 4)),
  };
}

// Production store. Durability across a relay restart is a property of the
// LevelDB volume, not of this module.
export function createLevelBlobStore(dbPath = "./data/frames"): BlobStore {
  const db = new Level<string, Buffer>(dbPath, { valueEncoding: "buffer", keyEncoding: "utf8" });
  const nextSeqCache = new Map<string, number>();
  let closed = false;

  async function nextSeq(prefix: string): Promise<number> {
    const cached = nextSeqCache.get(prefix);
    if (cached !== undefined) return cached;
    let seq = 1;
    try {
      const raw = await db.get(`s:${prefix}`);
      const parsed = Number.parseInt(raw.toString("utf-8"), 10);
      if (Number.isFinite(parsed) && parsed > 0) seq = parsed;
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== "LEVEL_NOT_FOUND") throw err;
    }
    nextSeqCache.set(prefix, seq);
    return seq;
  }

  async function takeSeq(prefix: string): Promise<number> {
    const seq = await nextSeq(prefix);
    nextSeqCache.set(prefix, seq + 1);
    await db.put(`s:${prefix}`, Buffer.from(String(seq + 1)));
    return seq;
  }

  async function put(
    prefix: string,
    msgType: number,
    payload: Uint8Array,
  ): Promise<StoredFrame> {
    // Own the bytes before the first await: the caller may be handing us a
    // pooled socket buffer that is recycled while the write is in flight.
    const bytes = copyBytes(payload);
    const value = encodeFrameValue(msgType, bytes);
    const seq = await takeSeq(prefix);
    await db.put(frameKey(prefix, seq), value);
    return { seq, msgType, payload: bytes };
  }

  async function readFrames(prefix: string): Promise<StoredFrame[]> {
    const frames: StoredFrame[] = [];
    for await (const [key, value] of db.iterator({
      gte: `f:${prefix}`,
      // Sequence suffixes are ASCII digits, so U+00FF bounds the stream.
      lt: `f:${prefix}ÿ`,
    })) {
      const seq = Number.parseInt(key.slice(key.length - SEQ_KEY_WIDTH), 10);
      if (!Number.isFinite(seq)) continue;
      const { msgType, payload } = decodeFrameValue(value);
      frames.push({ seq, msgType, payload });
    }
    // Keys are zero-padded, so iteration order is already ascending seq; the
    // sort only guards against a hand-written key.
    frames.sort((a, b) => a.seq - b.seq);
    return frames;
  }

  return {
    append(roomId, docId, msgType, payload) {
      return put(streamKey(roomId, docId), msgType, payload);
    },

    read(roomId, docId) {
      return readFrames(streamKey(roomId, docId));
    },

    async checkpoint(roomId, docId, upToSeq, payload) {
      const prefix = streamKey(roomId, docId);
      const frame = await put(prefix, MUX_CHECKPOINT, payload);
      const cutoff = truncationCutoff(upToSeq, frame.seq);
      if (cutoff > 0) {
        await db.batch(
          (await readFrames(prefix))
            .filter((stored) => stored.seq <= cutoff)
            .map((stored) => ({ type: "del" as const, key: frameKey(prefix, stored.seq) })),
        );
      }
      return frame;
    },

    async clear(roomId, docId) {
      const prefix = streamKey(roomId, docId);
      // The `s:` counter survives: sequence numbers are never recycled.
      await db.batch(
        (await readFrames(prefix)).map((stored) => ({
          type: "del" as const,
          key: frameKey(prefix, stored.seq),
        })),
      );
    },

    async close() {
      if (closed) return;
      closed = true;
      nextSeqCache.clear();
      await db.close();
    },
  };
}

// Opt-out, mirroring noopPersistence: the relay keeps relaying, it just remembers
// nothing.
export const noopBlobStore: BlobStore = {
  append(_roomId, _docId, msgType, payload) {
    return Promise.resolve({ seq: 0, msgType, payload: copyBytes(payload) });
  },
  read() {
    return Promise.resolve([]);
  },
  checkpoint(_roomId, _docId, _upToSeq, payload) {
    return Promise.resolve({ seq: 0, msgType: MUX_CHECKPOINT, payload: copyBytes(payload) });
  },
  clear() {
    return Promise.resolve();
  },
  close() {
    return Promise.resolve();
  },
};
