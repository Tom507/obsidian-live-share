import type { IncomingMessage } from "node:http";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { minimatch } from "minimatch";
import { WebSocket, WebSocketServer } from "ws";

import { verifyJWT } from "./github-auth.js";
import {
  MUX_AWARENESS,
  MUX_AWARENESS_ENCRYPTED,
  MUX_CHECKPOINT,
  MUX_PING,
  MUX_PONG,
  MUX_SUBSCRIBE,
  MUX_SUBSCRIBED,
  MUX_SYNC,
  MUX_SYNC_ENCRYPTED,
  MUX_SYNC_REQUEST,
  MUX_UNSUBSCRIBE,
  decodeCheckpointBody,
  decodeMuxMessage,
  encodeMuxMessage,
  encodeReplay,
} from "./mux-protocol.js";
import { getPermission } from "./permissions.js";
import { type BlobStore, type Permission, noopBlobStore } from "./persistence.js";
import { getRoom } from "./rooms.js";

const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;
const CANVAS_DOC_PREFIX = "__canvas__:";

// Map a mux docId to its vault path. Canvas docs are keyed "__canvas__:<path>".
function docIdToVaultPath(docId: string): string {
  return docId.startsWith(CANVAS_DOC_PREFIX)
    ? docId.slice(CANVAS_DOC_PREFIX.length)
    : docId;
}

interface MuxClient {
  ws: WebSocket;
  subscribedRooms: Set<string>;
  userId: string | null;
  baseRoomId: string;
}

interface RoomState {
  clients: Set<MuxClient>;
  readOnlyClients: Set<MuxClient>;
  clientAwarenessIds: Map<MuxClient, Set<number>>;
  // Highest awareness clock observed per awareness clientID. Used to synthesize a
  // valid removal update on disconnect (Bug D) — applyAwarenessUpdate ignores a
  // removal whose clock is not strictly greater than the peer's current clock.
  awarenessClocks: Map<number, number>;
  // WP41: clients whose stored-frame replay is still in flight. They are already
  // in `clients` (so nothing produced meanwhile can be lost), but their live
  // traffic is buffered here until the replay batch has been written to the
  // socket — that is what makes "stored frames before any live traffic" hold.
  replayQueues: Map<MuxClient, Uint8Array[]>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

function toUint8Array(raw: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Buffer.isBuffer(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const buf = Buffer.concat(raw as Buffer[]);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function createYjsWSS(blobStore: BlobStore = noopBlobStore) {
  const roomStates = new Map<string, RoomState>();
  const muxWss = new WebSocketServer({
    noServer: true,
    maxPayload: 10 * 1024 * 1024,
  });

  function safeSend(ws: WebSocket, data: Uint8Array | string) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    } catch {
      // Send may fail if socket is closing
    }
  }

  function getOrCreateRoom(roomId: string): RoomState {
    const existing = roomStates.get(roomId);
    if (existing) {
      if (existing.cleanupTimer) {
        clearTimeout(existing.cleanupTimer);
        existing.cleanupTimer = undefined;
      }
      return existing;
    }
    const state: RoomState = {
      clients: new Set(),
      readOnlyClients: new Set(),
      clientAwarenessIds: new Map(),
      awarenessClocks: new Map(),
      replayQueues: new Map(),
    };
    roomStates.set(roomId, state);
    return state;
  }

  // Fan-out to every peer but `exclude`. A peer whose replay is still in flight
  // gets the message buffered instead of sent, so it never observes live traffic
  // ahead of the stored frames.
  function sendToPeers(state: RoomState, msg: Uint8Array, exclude?: MuxClient) {
    for (const peer of state.clients) {
      if (peer === exclude) continue;
      const queued = state.replayQueues.get(peer);
      if (queued) queued.push(msg);
      else safeSend(peer.ws, msg);
    }
  }

  function flushReplayQueue(state: RoomState, client: MuxClient) {
    const queued = state.replayQueues.get(client);
    state.replayQueues.delete(client);
    if (!queued) return;
    for (const msg of queued) safeSend(client.ws, msg);
  }

  // Store the frame exactly as it arrived. The relay knows the envelope type and
  // nothing else — no parsing, no decryption, no validation of the payload.
  function appendFrame(
    baseRoomId: string,
    docId: string,
    msgType: number,
    payload: Uint8Array,
  ) {
    blobStore.append(baseRoomId, docId, msgType, payload).catch((err) => {
      console.error("[yjs-mux] failed to append frame:", err);
    });
  }

  function scheduleRoomCleanup(roomId: string, state: RoomState) {
    if (state.clients.size === 0) {
      state.cleanupTimer = setTimeout(() => {
        if (state.clients.size === 0) {
          roomStates.delete(roomId);
        }
      }, 30_000);
    }
  }

  async function handleSubscribe(client: MuxClient, docId: string, payload: Uint8Array) {
    const roomId = `${client.baseRoomId}:${docId}`;
    const state = getOrCreateRoom(roomId);

    const peerCount = state.clients.size;

    state.clients.add(client);
    client.subscribedRooms.add(roomId);
    // Hold back live traffic for this client until its replay has been sent.
    state.replayQueues.set(client, []);

    if (client.userId) {
      const permission = getPermission(client.baseRoomId, client.userId);
      if (permission === "read-only") {
        state.readOnlyClients.add(client);
      }
    }

    if (payload.length > 0) {
      try {
        const decoder = decoding.createDecoder(payload);
        const clientId = decoding.readVarUint(decoder);
        let ids = state.clientAwarenessIds.get(client);
        if (!ids) {
          ids = new Set();
          state.clientAwarenessIds.set(client, ids);
        }
        ids.add(clientId);
      } catch {
        // Payload may not contain clientID (old clients)
      }
    }

    const peerCountEncoder = encoding.createEncoder();
    encoding.writeVarUint(peerCountEncoder, peerCount);
    const msg = encodeMuxMessage(docId, MUX_SUBSCRIBED, encoding.toUint8Array(peerCountEncoder));
    safeSend(client.ws, msg);

    if (peerCount > 0) {
      sendToPeers(state, encodeMuxMessage(docId, MUX_SYNC_REQUEST), client);
    }

    // WP41: everything the relay kept for this roomId:docId, in ascending seq,
    // terminated by MUX_REPLAY_END — and only then the live stream.
    try {
      const frames = await blobStore.read(client.baseRoomId, docId);
      if (state.clients.has(client)) {
        for (const msg of encodeReplay(docId, frames)) safeSend(client.ws, msg);
      }
    } catch (err) {
      console.error("[yjs-mux] failed to replay stored frames:", err);
    } finally {
      flushReplayQueue(state, client);
    }
  }

  // A client-produced checkpoint: it supersedes everything up to the sequence
  // number in its envelope. The relay reads that number, hands the opaque tail to
  // the store, and does not broadcast it — a checkpoint is a storage
  // instruction, not a document update.
  function handleCheckpoint(client: MuxClient, docId: string, payload: Uint8Array) {
    const roomId = `${client.baseRoomId}:${docId}`;
    const state = roomStates.get(roomId);
    if (!state || !state.clients.has(client)) return;

    // A client that may not write may not compact either: same gate, same
    // permission model, no new policy.
    if (isClientReadOnly(client, state, docId)) return;

    let upToSeq: number;
    let body: Uint8Array;
    try {
      ({ upToSeq, payload: body } = decodeCheckpointBody(payload));
    } catch (err) {
      console.debug("[yjs-mux] malformed checkpoint envelope, skipping:", err);
      return;
    }

    blobStore.checkpoint(client.baseRoomId, docId, upToSeq, body).catch((err) => {
      console.error("[yjs-mux] failed to checkpoint:", err);
    });
  }

  function handleUnsubscribe(client: MuxClient, docId: string) {
    const roomId = `${client.baseRoomId}:${docId}`;
    removeClientFromRoom(client, roomId);
  }

  function handleSync(client: MuxClient, docId: string, payload: Uint8Array, encrypted = false) {
    const roomId = `${client.baseRoomId}:${docId}`;
    const state = roomStates.get(roomId);
    if (!state || !state.clients.has(client)) return;

    const isReadOnly = isClientReadOnly(client, state, docId);
    if (isReadOnly && payload.length > 0) {
      const decoder = decoding.createDecoder(payload);
      const syncType = decoding.peekVarUint(decoder);
      if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
        return;
      }
    }

    const msgType = encrypted ? MUX_SYNC_ENCRYPTED : MUX_SYNC;
    const msg = encodeMuxMessage(docId, msgType, payload);
    sendToPeers(state, msg, client);
    // Only frames the relay actually relays are kept: a write suppressed by the
    // read-only gate above never reaches this line.
    appendFrame(client.baseRoomId, docId, msgType, payload);
  }

  function isClientReadOnly(client: MuxClient, state: RoomState, docId: string): boolean {
    return (
      state.readOnlyClients.has(client) ||
      (!!client.userId && getPermission(client.baseRoomId, client.userId) === "read-only") ||
      isPathReadOnlyForClient(client, docId)
    );
  }

  function handleAwareness(
    client: MuxClient,
    docId: string,
    payload: Uint8Array,
    encrypted = false,
  ) {
    const roomId = `${client.baseRoomId}:${docId}`;
    const state = roomStates.get(roomId);
    if (!state || !state.clients.has(client)) return;

    if (!encrypted) {
      try {
        const decoder = decoding.createDecoder(payload);
        const len = decoding.readVarUint(decoder);
        let ids = state.clientAwarenessIds.get(client);
        if (!ids) {
          ids = new Set();
          state.clientAwarenessIds.set(client, ids);
        }
        for (let i = 0; i < len; i++) {
          // Awareness update entry: <clientID><clock><stateJSON>. Consume the
          // whole triple so we can track the latest clock per client (Bug D).
          const clientId = decoding.readVarUint(decoder);
          const clock = decoding.readVarUint(decoder);
          decoding.readVarString(decoder);
          ids.add(clientId);
          const prevClock = state.awarenessClocks.get(clientId) ?? 0;
          if (clock > prevClock) state.awarenessClocks.set(clientId, clock);
        }
      } catch (err) {
        console.debug("[yjs-mux] malformed awareness data, skipping:", err);
      }
    }

    const msgType = encrypted ? MUX_AWARENESS_ENCRYPTED : MUX_AWARENESS;
    const msg = encodeMuxMessage(docId, msgType, payload);
    // Awareness is ephemeral presence, never persisted.
    sendToPeers(state, msg, client);
  }

  function removeClientFromRoom(client: MuxClient, roomId: string) {
    const state = roomStates.get(roomId);
    if (!state) return;

    state.clients.delete(client);
    state.readOnlyClients.delete(client);
    state.replayQueues.delete(client);
    client.subscribedRooms.delete(roomId);

    const clientIds = state.clientAwarenessIds.get(client);
    if (clientIds && clientIds.size > 0 && state.clients.size > 0) {
      const removalEncoder = encoding.createEncoder();
      encoding.writeVarUint(removalEncoder, clientIds.size);
      for (const id of clientIds) {
        encoding.writeVarUint(removalEncoder, id);
        // Bug D: must advance the clock past the peer's current value, otherwise
        // applyAwarenessUpdate ignores the removal and the caret freezes forever.
        const lastClock = state.awarenessClocks.get(id) ?? 0;
        encoding.writeVarUint(removalEncoder, lastClock + 1);
        encoding.writeVarString(removalEncoder, "null");
      }
      const removalPayload = encoding.toUint8Array(removalEncoder);
      const docId = extractDocId(roomId);
      const msg = encodeMuxMessage(docId, MUX_AWARENESS, removalPayload);
      sendToPeers(state, msg);
    }
    for (const id of clientIds ?? []) {
      state.awarenessClocks.delete(id);
    }
    state.clientAwarenessIds.delete(client);

    scheduleRoomCleanup(roomId, state);
  }

  function removeClientFromAllRooms(client: MuxClient) {
    for (const roomId of [...client.subscribedRooms]) {
      removeClientFromRoom(client, roomId);
    }
  }

  muxWss.on("connection", (ws: WebSocket, req: IncomingMessage, baseRoomId: string) => {
    const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);

    let userId = reqUrl.searchParams.get("userId");
    const jwtToken = reqUrl.searchParams.get("jwt");
    if (jwtToken) {
      const payload = verifyJWT(jwtToken);
      if (payload) userId = payload.sub;
    }

    const client: MuxClient = {
      ws,
      subscribedRooms: new Set(),
      userId,
      baseRoomId,
    };

    ws.on("error", (err) => {
      console.error(`[yjs-mux] ws error for room ${baseRoomId}:`, err.message);
      ws.close();
    });

    ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const data = toUint8Array(raw);
      try {
        const { docId, msgType, payload } = decodeMuxMessage(data);
        switch (msgType) {
          case MUX_SUBSCRIBE:
            handleSubscribe(client, docId, payload).catch((err) => {
              console.error("[yjs-mux] failed to handle subscribe:", err);
            });
            break;
          case MUX_UNSUBSCRIBE:
            handleUnsubscribe(client, docId);
            break;
          case MUX_SYNC:
            handleSync(client, docId, payload);
            break;
          case MUX_SYNC_ENCRYPTED:
            handleSync(client, docId, payload, true);
            break;
          case MUX_AWARENESS:
            handleAwareness(client, docId, payload);
            break;
          case MUX_AWARENESS_ENCRYPTED:
            handleAwareness(client, docId, payload, true);
            break;
          case MUX_CHECKPOINT:
            handleCheckpoint(client, docId, payload);
            break;
          case MUX_PING:
            // MUX liveness (Bug H): echo a pong so the client can detect a
            // half-dead socket and trigger its reconnect logic.
            safeSend(client.ws, encodeMuxMessage(docId, MUX_PONG));
            break;
        }
      } catch (err) {
        console.error("[yjs-mux] failed to handle message:", err);
      }
    });

    ws.on("close", () => {
      removeClientFromAllRooms(client);
    });
  });

  function closeAll() {
    for (const state of roomStates.values()) {
      if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
      for (const client of state.clients) {
        client.ws.close(1000, "server shutting down");
      }
    }
    roomStates.clear();
  }

  function getStats() {
    const uniqueClients = new Set<WebSocket>();
    const sessions = new Set<string>();
    for (const [roomId, state] of roomStates) {
      const baseRoomId = extractBaseRoomId(roomId);
      if (baseRoomId) sessions.add(baseRoomId);
      for (const client of state.clients) {
        uniqueClients.add(client.ws);
      }
    }
    return {
      sessions: sessions.size,
      documents: roomStates.size,
      clients: uniqueClients.size,
    };
  }

  function updatePermission(baseRoomId: string, userId: string, permission: Permission) {
    for (const [fullRoomId, state] of roomStates) {
      if (!fullRoomId.startsWith(`${baseRoomId}:`)) continue;
      for (const client of state.clients) {
        if (client.userId === userId) {
          if (permission === "read-only") {
            state.readOnlyClients.add(client);
          } else {
            state.readOnlyClients.delete(client);
          }
        }
      }
    }
  }

  return { muxWss, closeAll, getStats, updatePermission };
}

function extractBaseRoomId(roomId: string): string {
  const colonIndex = roomId.indexOf(":");
  return colonIndex >= 0 ? roomId.substring(0, colonIndex) : roomId;
}

function extractDocId(roomId: string): string {
  const colonIndex = roomId.indexOf(":");
  return colonIndex >= 0 ? roomId.slice(colonIndex + 1) : roomId;
}

// Bug G: authoritative server-side read-only enforcement for per-path rules.
// A non-host client may not write a Yjs/canvas doc whose vault path is globally
// read-only (room.defaultPermission) or matches one of room.readOnlyPatterns.
// The host (identified by room.hostUserId) is always exempt.
function isPathReadOnlyForClient(client: MuxClient, docId: string): boolean {
  const room = getRoom(client.baseRoomId);
  if (!room) return false;

  const isHost = !!room.hostUserId && !!client.userId && client.userId === room.hostUserId;
  if (isHost) return false;

  if (room.defaultPermission === "read-only") return true;

  const patterns = room.readOnlyPatterns;
  if (!patterns || patterns.length === 0) return false;

  const path = docIdToVaultPath(docId);
  return patterns.some((pattern) => minimatch(path, pattern));
}
