import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import type { LiveShareSettings } from "../types";
import { normalizePath, toWsUrl } from "../utils";
import type { E2ECrypto } from "./crypto";
import {
  MUX_AWARENESS,
  MUX_AWARENESS_ENCRYPTED,
  MUX_PING,
  MUX_PONG,
  MUX_SUBSCRIBE,
  MUX_SUBSCRIBED,
  MUX_SYNC,
  MUX_SYNC_ENCRYPTED,
  MUX_SYNC_REQUEST,
  MUX_UNSUBSCRIBE,
  decodeMuxMessage,
  encodeMuxMessage,
} from "./mux-protocol";

const SYNC_STEP2 = 1;
const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 15;
// MUX liveness: app-level ping/pong. The browser/Electron WebSocket cannot send
// protocol-level pings, so a half-dead socket (no FIN) is otherwise undetectable.
const HEARTBEAT_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;
// Awareness heartbeat: periodically re-assert the FULL local awareness state
// (caret + any extra fields such as `lockedNodes`) so peers keep rendering a
// static caret and never prune it under y-protocols' 30 s outdated-timeout.
// Must be < 30 s; target 10-15 s. Ticks the awareness Lamport clock via
// setLocalState(getLocalState()), which bumps the clock so peers refresh their
// `lastUpdated` — a bare re-encode at the same clock would be a no-op on peers.
export const AWARENESS_HEARTBEAT_INTERVAL_MS = 12_000;

export interface DocHandle {
  doc: Y.Doc;
  text: Y.Text;
  awareness: awarenessProtocol.Awareness;
}

type SyncListener = (synced: boolean) => void;

export class SyncManager {
  private docs = new Map<string, Y.Doc>();
  private awarenessMap = new Map<string, awarenessProtocol.Awareness>();
  private synced = new Map<string, boolean>();
  private syncListeners = new Map<string, Set<SyncListener>>();
  private updateHandlers = new Map<string, (update: Uint8Array, origin: unknown) => void>();
  private awarenessHandlers = new Map<
    string,
    (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void
  >();
  private settings: LiveShareSettings;
  private isConnected = false;
  private ws: WebSocket | null = null;
  private shouldConnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private e2e: E2ECrypto | null = null;
  private sendQueue: Promise<void> = Promise.resolve();
  private isDestroyed = false;
  private onMaxReconnectCallback: (() => void) | null = null;
  private onConnectionChangeCallback: ((connected: boolean) => void) | null = null;
  private onReconnectCallback: ((docIds: string[]) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // True once a socket has successfully opened at least once, so we can tell a
  // reconnect apart from the first connect.
  private hasEverConnected = false;

  constructor(settings: LiveShareSettings) {
    this.settings = settings;
  }

  setE2E(e2e: E2ECrypto | null): void {
    this.e2e = e2e;
  }

  onMaxReconnect(callback: () => void): void {
    this.onMaxReconnectCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.onConnectionChangeCallback = callback;
  }

  /**
   * Reconnect seam for lock-owning layers (WP3). Fired after a socket has been
   * re-established (never on the first connect) with the currently-subscribed
   * doc ids, BEFORE this manager ticks the awareness clock — so the lock layer
   * can WITHHOLD any stale `lockedNodes` before the reconnect re-emit, and never
   * blind-reasserts a lock a peer may have taken during the outage. WP3 defers
   * re-claiming still-free nodes until peers' awareness has re-synced.
   */
  onReconnect(callback: (docIds: string[]) => void): void {
    this.onReconnectCallback = callback;
  }

  updateSettings(settings: LiveShareSettings) {
    this.settings = settings;
  }

  connect(): void {
    this.shouldConnect = true;
    this.reconnectAttempts = 0;
    this.openWebSocket();
  }

  disconnect(): void {
    this.shouldConnect = false;
    this.isConnected = false;
    this.hasEverConnected = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const path of [...this.docs.keys()]) {
      this.releaseDoc(path);
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    this.disconnect();
  }

  getDoc(rawPath: string): DocHandle | null {
    if ((!this.isConnected && !this.shouldConnect) || !this.settings.roomId) return null;

    const filePath = normalizePath(rawPath);

    const existingDoc = this.docs.get(filePath);
    const existingAwareness = this.awarenessMap.get(filePath);
    if (existingDoc && existingAwareness) {
      return {
        doc: existingDoc,
        text: existingDoc.getText("content"),
        awareness: existingAwareness,
      };
    }

    const doc = new Y.Doc();
    this.docs.set(filePath, doc);

    const awareness = new awarenessProtocol.Awareness(doc);
    this.awarenessMap.set(filePath, awareness);

    this.synced.set(filePath, false);

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const syncEncoder = encoding.createEncoder();
      syncProtocol.writeUpdate(syncEncoder, update);
      this.sendMux(filePath, MUX_SYNC, encoding.toUint8Array(syncEncoder));
    };
    doc.on("update", updateHandler);
    this.updateHandlers.set(filePath, updateHandler);

    const awarenessHandler = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "remote") return;
      const changedClients = changes.added.concat(changes.updated, changes.removed);
      if (changedClients.length === 0) return;
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
      this.sendMux(filePath, MUX_AWARENESS, awarenessUpdate);
    };
    awareness.on("update", awarenessHandler);
    this.awarenessHandlers.set(filePath, awarenessHandler);

    if (this.isConnected) {
      this.sendSubscribe(filePath);
    }

    const text = doc.getText("content");
    return { doc, text, awareness };
  }

  releaseDoc(rawPath: string): void {
    const filePath = normalizePath(rawPath);

    this.sendUnsubscribe(filePath);

    const awareness = this.awarenessMap.get(filePath);
    const awarenessHandler = this.awarenessHandlers.get(filePath);
    if (awareness && awarenessHandler) {
      awareness.off("update", awarenessHandler);
      awarenessProtocol.removeAwarenessStates(awareness, [awareness.doc.clientID], null);
      awareness.destroy();
    }
    this.awarenessMap.delete(filePath);
    this.awarenessHandlers.delete(filePath);

    const doc = this.docs.get(filePath);
    const updateHandler = this.updateHandlers.get(filePath);
    if (doc && updateHandler) {
      doc.off("update", updateHandler);
      doc.destroy();
    }
    this.docs.delete(filePath);
    this.updateHandlers.delete(filePath);

    this.synced.delete(filePath);
    this.syncListeners.delete(filePath);
  }

  waitForSync(rawPath: string, timeoutMs = 10_000): Promise<void> {
    const filePath = normalizePath(rawPath);
    if (this.synced.get(filePath)) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners?.delete(listener);
        reject(new Error(`Sync timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      let listeners = this.syncListeners.get(filePath);
      if (!listeners) {
        listeners = new Set();
        this.syncListeners.set(filePath, listeners);
      }

      const listener: SyncListener = (isSynced) => {
        if (!isSynced) return;
        listeners?.delete(listener);
        clearTimeout(timer);
        resolve();
      };
      listeners.add(listener);

      if (this.synced.get(filePath)) {
        listeners.delete(listener);
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private openWebSocket(): void {
    if (this.isDestroyed) return;
    if (!this.settings.roomId || !this.settings.serverUrl) return;

    const wsUrl = toWsUrl(this.settings.serverUrl);
    const params = new URLSearchParams({ token: this.settings.token });
    if (this.settings.jwt) params.set("jwt", this.settings.jwt);
    if (this.settings.serverPassword) params.set("password", this.settings.serverPassword);
    const userId = this.settings.githubUserId || this.settings.clientId;
    if (userId) params.set("userId", userId);

    const url = `${wsUrl}/ws-mux/${encodeURIComponent(this.settings.roomId)}?${params.toString()}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      const isReconnect = this.hasEverConnected;
      this.hasEverConnected = true;
      this.isConnected = true;
      this.reconnectAttempts = 0;
      for (const filePath of this.docs.keys()) {
        this.synced.set(filePath, false);
        this.sendSubscribe(filePath);
      }
      this.startHeartbeat();
      if (isReconnect) {
        // Hand control to the lock layer (WP3) FIRST, so it can WITHHOLD any stale
        // locks before we tick the clock. Otherwise the clock-tick re-emit below
        // would blindly re-assert `lockedNodes` a peer may have acquired during the
        // outage and split the lock (US4 AC3/AC4, GAP-4). The lock layer clears its
        // claims here and defers re-claiming still-free nodes until peers' awareness
        // has re-synced — it never blind-reasserts locks.
        this.onReconnectCallback?.([...this.awarenessMap.keys()]);
        // Reconnect clock-tick (y-websocket #122): advance the awareness clock so
        // our caret / (now withheld) canvas state re-renders on peers without the
        // user typing. The doc + awareness (and therefore `clientID`) are reused
        // across reconnect — no ghost duplicate identity is created.
        for (const docId of this.awarenessMap.keys()) {
          this.reemitLocalAwareness(docId);
        }
      }
      this.onConnectionChangeCallback?.(true);
    };

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      this.handleMessage(data);
    };

    ws.onclose = () => {
      this.ws = null;
      this.isConnected = false;
      this.stopHeartbeat();
      this.onConnectionChangeCallback?.(false);
      for (const filePath of this.docs.keys()) {
        this.setSynced(filePath, false);
      }
      if (this.shouldConnect) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.shouldConnect = false;
      this.onMaxReconnectCallback?.();
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) {
        this.openWebSocket();
      }
    }, delay);
  }

  private handleMessage(data: Uint8Array): void {
    const { docId, msgType, payload } = decodeMuxMessage(data);

    switch (msgType) {
      case MUX_SUBSCRIBED:
        this.handleSubscribed(docId, payload);
        break;
      case MUX_SYNC:
        this.handleSync(docId, payload);
        break;
      case MUX_SYNC_ENCRYPTED:
        void this.handleSyncEncrypted(docId, payload);
        break;
      case MUX_SYNC_REQUEST:
        this.handleSyncRequest(docId);
        break;
      case MUX_AWARENESS:
        this.handleAwareness(docId, payload);
        break;
      case MUX_AWARENESS_ENCRYPTED:
        void this.handleAwarenessEncrypted(docId, payload);
        break;
      case MUX_PONG:
        this.clearPongDeadline();
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // A pong deadline is already pending — the previous ping went unanswered.
      if (this.pongTimer) return;
      this.ws.send(encodeMuxMessage("", MUX_PING));
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        // No pong within the deadline: the socket is half-dead. Force-close so
        // the existing reconnect/backoff logic takes over.
        this.ws?.close();
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
    this.awarenessHeartbeatTimer = setInterval(() => {
      this.pulseAwarenessHeartbeat();
    }, AWARENESS_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.awarenessHeartbeatTimer) {
      clearInterval(this.awarenessHeartbeatTimer);
      this.awarenessHeartbeatTimer = null;
    }
    this.clearPongDeadline();
  }

  /**
   * Re-emit the full local awareness state for every subscribed doc. Driven by
   * the awareness heartbeat timer, but also callable directly (WP5 latency
   * harness / unit tests) to pulse a heartbeat deterministically without waiting
   * on wall-clock time. No-op while the socket is not OPEN.
   */
  pulseAwarenessHeartbeat(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    for (const docId of this.awarenessMap.keys()) {
      this.reemitLocalAwareness(docId);
    }
  }

  private clearPongDeadline(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private handleSubscribed(docId: string, payload: Uint8Array): void {
    const doc = this.docs.get(docId);
    if (!doc) return;

    const syncEncoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    this.sendMux(docId, MUX_SYNC, encoding.toUint8Array(syncEncoder));

    let peerCount = 0;
    if (payload.length > 0) {
      const decoder = decoding.createDecoder(payload);
      peerCount = decoding.readVarUint(decoder);
    }

    if (peerCount === 0) {
      this.setSynced(docId, true);
    } else {
      // Bug A: a newcomer must announce its own already-set (static) awareness
      // state to peers that were present before it joined.
      this.reemitLocalAwareness(docId);
    }
  }

  private handleSyncRequest(docId: string): void {
    const doc = this.docs.get(docId);
    if (!doc) return;

    const syncEncoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    this.sendMux(docId, MUX_SYNC, encoding.toUint8Array(syncEncoder));

    // Bug A: the server relays a SYNC_REQUEST to existing peers whenever a new
    // client subscribes. Re-emit our local awareness so the newcomer receives
    // our already-set (static, never-moved) caret — otherwise it is never
    // transferred and the newcomer never sees our cursor.
    this.reemitLocalAwareness(docId);
  }

  private reemitLocalAwareness(docId: string): void {
    const awareness = this.awarenessMap.get(docId);
    if (!awareness) return;
    // Bail ONLY when there is genuinely no local state to share. A merely-static
    // (movement-free but non-null) caret MUST still be re-emitted — we never
    // treat "no recent movement" as "nothing to send". This is the fix for the
    // static-caret join race: a mid-sync joiner whose awareness clock for us is 0
    // still applies our caret.
    if (awareness.getLocalState() === null) return;
    // Advance the local awareness clock and rebroadcast the FULL local state
    // (caret + any extra fields such as `lockedNodes`). Re-setting the same state
    // object bumps the y-protocols clock, which (a) makes peers refresh their
    // 30 s outdated-prune timer so a static caret / idle lock survives, and
    // (b) forces a newly-joined peer to apply it. The registered awareness
    // 'update' handler performs the actual send via sendMux (encrypted under E2E).
    awareness.setLocalState(awareness.getLocalState());
  }

  private handleSync(docId: string, payload: Uint8Array): void {
    const doc = this.docs.get(docId);
    if (!doc) return;

    const decoder = decoding.createDecoder(payload);
    const syncEncoder = encoding.createEncoder();
    const msgType = decoding.peekVarUint(decoder);

    syncProtocol.readSyncMessage(decoder, syncEncoder, doc, this);

    if (encoding.length(syncEncoder) > 0) {
      this.sendMux(docId, MUX_SYNC, encoding.toUint8Array(syncEncoder));
    }

    if (msgType === SYNC_STEP2) {
      this.setSynced(docId, true);
    }
  }

  private handleAwareness(docId: string, payload: Uint8Array): void {
    const awareness = this.awarenessMap.get(docId);
    if (!awareness) return;
    awarenessProtocol.applyAwarenessUpdate(awareness, payload, "remote");
  }

  private async handleSyncEncrypted(docId: string, payload: Uint8Array): Promise<void> {
    if (!this.e2e?.enabled) {
      // Received encrypted data but we don't have E2E - drop to prevent corruption
      return;
    }
    if (payload.length <= 1) {
      this.handleSync(docId, payload);
      return;
    }
    try {
      const syncType = payload[0];
      const decrypted = await this.e2e.decrypt(payload.slice(1));
      const result = new Uint8Array(1 + decrypted.length);
      result[0] = syncType;
      result.set(decrypted, 1);
      this.handleSync(docId, result);
    } catch {
      // Decryption failure - drop silently to preserve E2E guarantee
    }
  }

  private async handleAwarenessEncrypted(docId: string, payload: Uint8Array): Promise<void> {
    if (!this.e2e?.enabled) {
      // Received encrypted awareness but we don't have E2E - drop
      return;
    }
    try {
      const decrypted = await this.e2e.decrypt(payload);
      this.handleAwareness(docId, decrypted);
    } catch {
      // Decryption failure - drop silently to preserve E2E guarantee
    }
  }

  private setSynced(docId: string, value: boolean): void {
    const prev = this.synced.get(docId);
    this.synced.set(docId, value);
    if (value && !prev) {
      const listeners = this.syncListeners.get(docId);
      if (listeners) {
        for (const listener of listeners) {
          listener(true);
        }
      }
    }
  }

  private sendMux(docId: string, msgType: number, payload?: Uint8Array): void {
    if (!this.e2e?.enabled || !payload || payload.length === 0) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(encodeMuxMessage(docId, msgType, payload));
      }
      return;
    }

    if (msgType === MUX_SYNC) {
      this.sendQueue = this.sendQueue.then(() => this.sendEncryptedSync(docId, payload));
    } else if (msgType === MUX_AWARENESS) {
      this.sendQueue = this.sendQueue.then(() => this.sendEncryptedAwareness(docId, payload));
    } else {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(encodeMuxMessage(docId, msgType, payload));
      }
    }
  }

  private async sendEncryptedSync(docId: string, payload: Uint8Array): Promise<void> {
    if (!this.e2e || this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      const syncType = payload[0];
      const rest = payload.length > 1 ? payload.slice(1) : new Uint8Array(0);
      const encrypted = rest.length > 0 ? await this.e2e.encrypt(rest) : rest;
      const result = new Uint8Array(1 + encrypted.length);
      result[0] = syncType;
      result.set(encrypted, 1);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(encodeMuxMessage(docId, MUX_SYNC_ENCRYPTED, result));
      }
    } catch {
      // Do not fall back to unencrypted - drop the message to preserve E2E guarantee
    }
  }

  private async sendEncryptedAwareness(docId: string, payload: Uint8Array): Promise<void> {
    if (!this.e2e || this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      const encrypted = await this.e2e.encrypt(payload);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(encodeMuxMessage(docId, MUX_AWARENESS_ENCRYPTED, encrypted));
      }
    } catch {
      // Do not fall back to unencrypted - drop the message to preserve E2E guarantee
    }
  }

  private sendSubscribe(filePath: string): void {
    const doc = this.docs.get(filePath);
    if (doc) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, doc.clientID);
      this.sendMux(filePath, MUX_SUBSCRIBE, encoding.toUint8Array(encoder));
    } else {
      this.sendMux(filePath, MUX_SUBSCRIBE);
    }
  }

  private sendUnsubscribe(filePath: string): void {
    this.sendMux(filePath, MUX_UNSUBSCRIBE);
  }
}
