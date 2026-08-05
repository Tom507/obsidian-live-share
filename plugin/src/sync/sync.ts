import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import type { LiveShareSettings } from "../types";
import { normalizePath, toWsUrl } from "../utils";
import type { E2ECrypto } from "./crypto";
import { LINK_READY_STATE, type LinkLifecycleEvent, type LinkSnapshot } from "./link-state";
import type { CheckpointTriggerReason, ReplayEndReason } from "./mux-protocol";
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
  createReplayGate,
  decodeCheckpointBody,
  decodeMuxMessage,
  decodeReplayEndBody,
  encodeCheckpointBody,
  encodeMuxMessage,
  shouldEmitCheckpoint,
} from "./mux-protocol";

const SYNC_STEP2 = 1;
const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 15;
// MUX liveness: app-level ping/pong. The browser/Electron WebSocket cannot send
// protocol-level pings, so a half-dead socket (no FIN) is otherwise undetectable.
const HEARTBEAT_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;
// Awareness keep-alive: periodically re-assert the FULL local awareness state
// (caret + any extra fields such as `lockedNodes`) so peers keep rendering a
// static caret and never prune it under y-protocols' 30 s outdated-timeout.
// Ticks the awareness Lamport clock via setLocalState(getLocalState()), which
// bumps the clock so peers refresh their `lastUpdated` — a bare re-encode at the
// same clock would be a no-op on peers.
//
// The keep-alive is NOT a fixed-period timer: a fixed period only holds while
// every tick fires on schedule, and Chromium throttles timers in occluded
// windows to 1 Hz and then to roughly 1/min. IF a tick were to slip past the
// 30 s outdated-timeout, every peer would prune this client's awareness state —
// and the canvas locks live only inside that state. The pulse is therefore
// driven by an ABSOLUTE-TIME DEADLINE: `lastPulseAt` is compared against the
// wall clock and a pulse is emitted at the first OPPORTUNITY after
// AWARENESS_PULSE_DEADLINE_MS has elapsed. There are two kinds of opportunity:
//   (a) a short tick every AWARENESS_TICK_INTERVAL_MS, and
//   (b) EVERY inbound framed mux message — socket delivery is not
//       timer-throttled, so the first packet after a throttled window is what
//       actually recovers liveness.
// With tick period T and deadline D the worst-case gap between two pulses while
// ticks fire on schedule is T + D = 4 000 + 8 000 = 12 000 ms < 30 000 ms.
// No claim is made here about which mechanism causes a real-world gap: the gap
// is measured on every pulse and warned above AWARENESS_GAP_WARN_MS, so a
// keep-alive gap that approaches the 30 s prune window is observable in the log.
export const AWARENESS_TICK_INTERVAL_MS = 4_000;
export const AWARENESS_PULSE_DEADLINE_MS = 8_000;
// Warn threshold for a measured pulse gap. Above the healthy worst case
// (T + D = 12 000 ms) and 10 000 ms below y-protocols' 30 s prune window, so the
// warn is recorded before peers could have pruned this client.
export const AWARENESS_GAP_WARN_MS = 20_000;
/**
 * Worst-case bound (T + D) on the interval between two awareness pulses while
 * ticks fire on schedule. Still exported, and still 12 000 ms, for existing
 * importers — but it is a BOUND now, not the timer period.
 */
export const AWARENESS_HEARTBEAT_INTERVAL_MS =
  AWARENESS_TICK_INTERVAL_MS + AWARENESS_PULSE_DEADLINE_MS;

/** y-protocols' default awareness outdated-timeout; peers prune past this. */
const AWARENESS_OUTDATED_TIMEOUT_MS = 30_000;

/**
 * Minimal structural logger so SyncManager can narrate keep-alive liveness into
 * the status console without importing the concrete DebugLogger (avoids a
 * cycle). Mirrors CanvasSyncLogger.
 */
export interface SyncLogger {
  debug(category: string, message: string): void;
  warn(category: string, message: string): void;
}

/** Which opportunity emitted a pulse — the diagnostic half of the gap log. */
export type AwarenessPulseSource = "tick" | "message" | "manual";

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
  // Short deadline-evaluation tick (period T). It does NOT pulse on every fire —
  // it asks whether the absolute deadline has expired.
  private awarenessHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // Absolute-time baseline for the keep-alive deadline. `null` means no pulse has
  // been recorded for the current socket, which counts as "deadline expired" so
  // the first opportunity pulses.
  private lastPulseAt: number | null = null;
  private logger: SyncLogger | null = null;
  // True once a socket has successfully opened at least once, so we can tell a
  // reconnect apart from the first connect.
  private hasEverConnected = false;
  // WP42: the replay readiness barrier. Frames that arrive between MUX_SUBSCRIBED
  // and the relay's MUX_REPLAY_END are held, then released at once in arrival
  // order, so the doc is never observed half-replayed.
  private replayGate = createReplayGate();
  // docId -> highest replayed relay seq. A recorded entry IS the blob-support
  // signal: a WP41 relay terminates every subscribe with a marker (even with
  // lastSeq 0), a legacy relay never sends one.
  private relayLastSeq = new Map<string, number>();
  // Any marker seen on this manager proves the relay understands blobs, which
  // retires the legacy safety valve in handleMessage.
  private relaySupportsBlobs = false;
  // Last peer count announced with MUX_SUBSCRIBED, for the sole-peer trigger.
  private peerCounts = new Map<string, number>();
  private updatesSinceCheckpoint = new Map<string, number>();

  // --- WP82 (AC2/AC3/AC4/AC5) ------------------------------------------------
  // Before WP82 `main.ts:975` was the ONLY `"connection"` log site in the whole
  // plugin and it narrated the control channel only. `SyncManager` held a logger
  // and used it for exactly one metric. The mux link was invisible: if the sync
  // socket died, the status bar still read `hosting`.
  private lifecycleCallback: ((event: LinkLifecycleEvent) => void) | null = null;
  private lastChangeAt: number | null = null;
  private retryChainEnded = false;
  /** Set only by the E2E break seam. See {@link breakLink}. */
  private silenced = false;
  /** `true` while a pong deadline is force-closing this socket (AC4 discriminator). */
  private forcedClose = false;

  constructor(settings: LiveShareSettings) {
    this.settings = settings;
  }

  /**
   * WP82 (AC4) — the mux link narrates its own lifecycle, as the control link
   * already did. Wiring only: this class emits facts, the caller decides what to
   * log and what to announce.
   */
  onLifecycle(callback: (event: LinkLifecycleEvent) => void): void {
    this.lifecycleCallback = callback;
  }

  private emitLifecycle(event: LinkLifecycleEvent): void {
    this.lastChangeAt = Date.now();
    this.lifecycleCallback?.(event);
  }

  /**
   * WP82 (AC2) — the mux link's own facts, every one READ AT CALL TIME. The
   * `readyState` comes from the socket object, never from `isConnected`.
   */
  getLinkSnapshot(believedConnected: boolean): LinkSnapshot {
    return {
      link: "mux",
      hasSocket: this.ws !== null,
      readyState: this.ws === null ? LINK_READY_STATE.ABSENT : this.ws.readyState,
      believedConnected,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
      retryChainEnded: this.retryChainEnded,
      lastChangeAt: this.lastChangeAt,
      silenced: this.silenced,
    };
  }

  /**
   * WP82 (AC3) — THE BREAK SEAM for the mux link. E2E ONLY, and its only call
   * site outside tests is inside `plugin/src/testing/`, which the production
   * build dead-code-eliminates via `__LS_E2E__`. Reachable from no UI, command,
   * setting or message handler. See `ControlChannel.breakLink` for the two
   * shapes and why they are not interchangeable.
   */
  breakLink(shape: "close" | "silence"): {
    link: "mux";
    shape: "close" | "silence";
    hadSocket: boolean;
    readyStateBefore: number;
    readyStateAfter: number;
    silenced: boolean;
  } {
    const hadSocket = this.ws !== null;
    const readyStateBefore = this.ws === null ? LINK_READY_STATE.ABSENT : this.ws.readyState;
    if (shape === "silence") {
      this.silenced = true;
    } else if (this.ws) {
      this.ws.close();
    }
    return {
      link: "mux",
      shape,
      hadSocket,
      readyStateBefore,
      readyStateAfter: this.ws === null ? LINK_READY_STATE.ABSENT : this.ws.readyState,
      silenced: this.silenced,
    };
  }

  /** WP82 (AC3) — the restore half. Required; its effect is asserted, not assumed. */
  restoreLink(): {
    link: "mux";
    wasSilenced: boolean;
    wasChainEnded: boolean;
    reconnectStarted: boolean;
    readyStateAfter: number;
  } {
    const wasSilenced = this.silenced;
    this.silenced = false;
    const rearmed = this.rearm();
    return {
      link: "mux",
      wasSilenced,
      wasChainEnded: rearmed.wasChainEnded,
      reconnectStarted: rearmed.reconnectStarted,
      readyStateAfter: rearmed.readyStateAfter,
    };
  }

  /**
   * WP88 (AC3) — the mux half of the production re-arm. Same seam, two callers:
   * `restoreLink` (the rig, which also lifts its own suppression) and
   * `LiveSharePlugin.rearmSharing` (the user-reachable command). See
   * `ControlChannel.rearm` for the full reasoning; the constraint that matters
   * on both links is that nothing here resets the "has this link ever
   * connected" flag.
   */
  rearm(): {
    link: "mux";
    wasChainEnded: boolean;
    reconnectStarted: boolean;
    readyStateAfter: number;
  } {
    const wasChainEnded = this.retryChainEnded || !this.shouldConnect;
    let reconnectStarted = false;
    if (!this.isDestroyed && (this.retryChainEnded || !this.shouldConnect)) {
      this.retryChainEnded = false;
      this.shouldConnect = true;
      this.reconnectAttempts = 0;
      if (this.ws === null) {
        this.openWebSocket();
        reconnectStarted = true;
      }
    }
    return {
      link: "mux",
      wasChainEnded,
      reconnectStarted,
      readyStateAfter: this.ws === null ? LINK_READY_STATE.ABSENT : this.ws.readyState,
    };
  }

  setE2E(e2e: E2ECrypto | null): void {
    this.e2e = e2e;
  }

  /**
   * Attach the status-console logger so keep-alive gaps are recorded (US6). Until
   * one is attached the gap is still measured, it is just not reported anywhere.
   */
  setLogger(logger: SyncLogger): void {
    this.logger = logger;
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
      // WP42: every update that lands in the doc is one more delta the relay has
      // to store, whoever authored it — that count, never a clock, is what drives
      // the checkpoint threshold.
      this.countUpdateForCheckpoint(filePath);
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

    // WP42: hand the relay one compacted frame before we leave, so the next
    // client to enter the room replays a checkpoint instead of the whole delta
    // history. Must precede the unsubscribe — the relay only accepts a
    // checkpoint from a client still in the room.
    this.maybeEmitCheckpoint(filePath, "release");

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

    // WP42: drop this doc's replay bookkeeping with the doc itself.
    this.replayGate.endReplay(filePath, "unsupported");
    this.relayLastSeq.delete(filePath);
    this.peerCounts.delete(filePath);
    this.updatesSinceCheckpoint.delete(filePath);
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
    // WP82 / S38 — both of these early `return`s used to abandon a scheduled
    // reconnect with no callback, no state change and no log. They still
    // return; they no longer do it silently.
    if (this.isDestroyed) {
      this.emitLifecycle({
        kind: "abandoned",
        link: "mux",
        at: "openWebSocket",
        reason: "manager destroyed",
      });
      return;
    }
    if (!this.settings.roomId || !this.settings.serverUrl) {
      this.emitLifecycle({
        kind: "abandoned",
        link: "mux",
        at: "openWebSocket",
        // Names the KEYS that were empty. Never their values — the mux URL
        // carries `token`, `jwt` and `password` as query parameters.
        reason: !this.settings.roomId ? "settings.roomId is empty" : "settings.serverUrl is empty",
      });
      return;
    }

    const wsUrl = toWsUrl(this.settings.serverUrl);
    const params = new URLSearchParams({ token: this.settings.token });
    if (this.settings.jwt) params.set("jwt", this.settings.jwt);
    if (this.settings.serverPassword) params.set("password", this.settings.serverPassword);
    const userId = this.settings.githubUserId || this.settings.clientId;
    if (userId) params.set("userId", userId);

    const url = `${wsUrl}/ws-mux/${encodeURIComponent(this.settings.roomId)}?${params.toString()}`;
    // WP82 / S38 — `new WebSocket(url)` was unguarded here too, so a synchronous
    // throw inside a reconnect timer terminated the chain permanently and
    // invisibly. The policy is unchanged; the exit is now observable.
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.ws = null;
      this.shouldConnect = false;
      this.retryChainEnded = true;
      this.emitLifecycle({
        kind: "gave-up",
        link: "mux",
        attempts: this.reconnectAttempts,
        max: MAX_RECONNECT_ATTEMPTS,
        cause: "socket-construction-threw",
        detail: err instanceof Error ? err.name : "unknown",
      });
      this.onMaxReconnectCallback?.();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      // WP82 (AC3) — the same missing half as `ControlChannel.onopen`, on the
      // mux. `onmessage`, `sendMux` and the heartbeat consult `silenced`; this
      // handler did not, and it resets `reconnectAttempts` and
      // `retryChainEnded`. So `link.break{link:"mux", shape:"silence"}` could
      // not drive the mux to its ceiling either, and any criterion waiting for
      // it would HANG rather than fail. Derived by the liveness sweep, not
      // reported by anyone — the control link's twin, one file over.
      //
      // A socket that opens while the mux is silenced carries no frame in
      // either direction: it is not a reconnect, it must not re-subscribe every
      // doc, and it must not tell the plugin the mux is up (that is precisely
      // the latch WP82 removed). Announce, close, let the chain continue.
      if (this.silenced) {
        this.emitLifecycle({
          kind: "abandoned",
          link: "mux",
          at: "onopen",
          reason: "link silenced: a socket that carries no traffic is not a recovery",
        });
        ws.close();
        return;
      }
      const isReconnect = this.hasEverConnected;
      this.hasEverConnected = true;
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.retryChainEnded = false;
      this.emitLifecycle({ kind: "open", link: "mux", reconnect: isReconnect });
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
      // WP82 (AC3) — inbound half of the `silence` shape: the socket stays OPEN
      // and the frames are dropped before anything sees them, so only this
      // peer's own pong deadline can end the outage.
      if (this.silenced) return;
      const data = new Uint8Array(event.data as ArrayBuffer);
      this.handleMessage(data);
    };

    ws.onclose = () => {
      this.ws = null;
      this.isConnected = false;
      this.stopHeartbeat();
      const forced = this.forcedClose;
      this.forcedClose = false;
      this.emitLifecycle({ kind: "close", link: "mux", forced });
      this.onConnectionChangeCallback?.(false);
      for (const filePath of this.docs.keys()) {
        // WP42: the socket died mid-batch — hand what did arrive to the doc
        // rather than stranding it in the buffer; the resubscribe on reconnect
        // opens a fresh barrier.
        this.closeReplayBarrier(filePath, "unsupported");
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
    if (this.isDestroyed) {
      this.emitLifecycle({
        kind: "abandoned",
        link: "mux",
        at: "scheduleReconnect",
        reason: "manager destroyed",
      });
      return;
    }
    // Not a silent exit: a retry is already scheduled, so the chain is alive.
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.shouldConnect = false;
      this.retryChainEnded = true;
      this.emitLifecycle({
        kind: "gave-up",
        link: "mux",
        attempts: this.reconnectAttempts,
        max: MAX_RECONNECT_ATTEMPTS,
        cause: "exhausted",
      });
      this.onMaxReconnectCallback?.();
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.emitLifecycle({
      kind: "retry",
      link: "mux",
      attempt: this.reconnectAttempts,
      max: MAX_RECONNECT_ATTEMPTS,
      delayMs: delay,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) {
        this.openWebSocket();
      } else {
        this.emitLifecycle({
          kind: "abandoned",
          link: "mux",
          at: "reconnectTimer",
          reason: "shouldConnect went false while the retry was pending",
        });
      }
    }, delay);
  }

  private handleMessage(data: Uint8Array): void {
    const { docId, msgType, payload } = decodeMuxMessage(data);

    // Every inbound framed message (MUX_SYNC / MUX_AWARENESS / MUX_PONG / any
    // other) is an opportunity to evaluate the keep-alive deadline. Socket
    // delivery is not timer-throttled, so this is the path that emits a pulse on
    // the first packet after a period in which no tick fired.
    this.tickAwarenessKeepAlive("message");

    // WP42: a marker proves this relay stores blobs — even one with lastSeq 0,
    // which is "capable but empty", not "no support". Recorded before the gate
    // sees the frame so it also counts when the barrier is already closed and the
    // marker arrives as a stray.
    if (msgType === MUX_REPLAY_END) {
      this.relaySupportsBlobs = true;
      this.relayLastSeq.set(docId, decodeReplayEndBody(payload).lastSeq);
    } else if (
      !this.relaySupportsBlobs &&
      this.replayGate.isReplaying(docId) &&
      this.completesInitialSync(msgType, payload)
    ) {
      // Legacy-relay safety valve (AC3): a pre-WP41 relay never terminates the
      // batch, so an optimistically opened barrier would also hold the very frame
      // that completes the sync — and setSynced, the documented close trigger,
      // would never run. Releasing on that frame keeps arrival order (the buffer
      // is dispatched first) and needs no timer and no timing constant. Retired
      // for good as soon as any marker has proven the relay is WP41-capable.
      this.closeReplayBarrier(docId, "unsupported");
    }

    // The barrier: while a replay batch is open this returns [], and at the
    // marker it returns the whole batch at once, in arrival order.
    for (const frame of this.replayGate.accept({ docId, msgType, payload })) {
      this.dispatchFrame(frame.docId, frame.msgType, frame.payload);
    }

    if (msgType === MUX_REPLAY_END) {
      // The doc is now up to date with everything the relay had stored, so this
      // is the point at which a sole peer can compact that history away.
      this.maybeEmitCheckpoint(docId, "sole-peer-sync");
    }
  }

  /**
   * WP42: the frames the replay barrier has released, plus every frame that
   * arrives outside a batch, take exactly the pre-WP42 dispatch path — replayed
   * and live traffic are indistinguishable by design (WP41 replays under the
   * original msgType), so there is one route, not two.
   */
  private dispatchFrame(docId: string, msgType: number, payload: Uint8Array): void {
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
      case MUX_CHECKPOINT:
        this.handleCheckpoint(docId, payload);
        break;
      case MUX_PONG:
        this.clearPongDeadline();
        break;
    }
  }

  /**
   * WP42: a replayed checkpoint. WP41 stores the checkpoint's OPAQUE TAIL, so the
   * payload that comes back is the bare Yjs update; the enveloped form is
   * tolerated as well. Anything unparseable is dropped silently — an unreadable
   * checkpoint is a persistence detail and must never surface to the user.
   * Applied with `this` as the origin, so it is not echoed back to the relay.
   */
  private handleCheckpoint(docId: string, payload: Uint8Array): void {
    const doc = this.docs.get(docId);
    if (!doc || payload.length === 0) return;
    try {
      Y.applyUpdate(doc, payload, this);
    } catch {
      try {
        const { payload: update } = decodeCheckpointBody(payload);
        if (update.length > 0) Y.applyUpdate(doc, update, this);
      } catch {
        // Not a checkpoint this build can read — ignore it, exactly as an older
        // peer ignores a frame type it does not know.
      }
    }
  }

  /**
   * True for the sync frame that completes the initial handshake (SYNC_STEP2).
   * The sync sub-type is the first varUint of the payload and stays in cleartext
   * even for MUX_SYNC_ENCRYPTED, so no decryption is needed to recognise it.
   */
  private completesInitialSync(msgType: number, payload: Uint8Array): boolean {
    if (msgType !== MUX_SYNC && msgType !== MUX_SYNC_ENCRYPTED) return false;
    return payload.length > 0 && payload[0] === SYNC_STEP2;
  }

  /**
   * WP42: close an open replay barrier and dispatch everything it held, in
   * arrival order. A no-op when no batch is open, so it is safe to call from
   * every completion path.
   */
  private closeReplayBarrier(docId: string, reason: ReplayEndReason): void {
    if (!this.replayGate.isReplaying(docId)) return;
    const release = this.replayGate.endReplay(docId, reason);
    for (const frame of release.frames) {
      this.dispatchFrame(frame.docId, frame.msgType, frame.payload);
    }
  }

  /** WP42: one more stored delta for this doc; may cross the checkpoint threshold. */
  private countUpdateForCheckpoint(docId: string): void {
    this.updatesSinceCheckpoint.set(docId, (this.updatesSinceCheckpoint.get(docId) ?? 0) + 1);
    this.maybeEmitCheckpoint(docId, "update-threshold");
  }

  /**
   * WP42 (AC1): emit the full doc state as ONE update on a documented trigger.
   *
   * Silent no-op when the relay cannot store it (AC3) — and in an E2E room, where
   * a checkpoint would hand the relay a plaintext Yjs update; the room keeps
   * working over the sidecar + peer path instead.
   */
  private maybeEmitCheckpoint(docId: string, reason: CheckpointTriggerReason): void {
    const doc = this.docs.get(docId);
    if (!doc || this.e2e?.enabled) return;

    const lastSeq = this.relayLastSeq.get(docId);
    const emit = shouldEmitCheckpoint({
      reason,
      peerCount: this.peerCounts.get(docId) ?? 0,
      updatesSinceCheckpoint: this.updatesSinceCheckpoint.get(docId) ?? 0,
      // An empty doc encodes a one-byte state vector: nothing worth carrying.
      hasLocalState: Y.encodeStateVector(doc).length > 1,
      relayBlobSupport: lastSeq !== undefined,
    });
    if (!emit) return;

    this.sendMux(
      docId,
      MUX_CHECKPOINT,
      encodeCheckpointBody(lastSeq ?? 0, Y.encodeStateAsUpdate(doc)),
    );
    this.updatesSinceCheckpoint.set(docId, 0);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // A pong deadline is already pending — the previous ping went unanswered.
      if (this.pongTimer) return;
      // WP82 (AC3) — under `silence` the ping is suppressed on the wire but the
      // deadline is still armed, which is what makes the half-dead shape end by
      // the watchdog and not by a FIN.
      if (!this.silenced) this.ws.send(encodeMuxMessage("", MUX_PING));
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        // No pong within the deadline: the socket is half-dead. Force-close so
        // the existing reconnect/backoff logic takes over.
        // WP82 (AC4) — marked as WATCHDOG-FORCED, which is the discriminator
        // between the two break shapes in the narration.
        this.forcedClose = true;
        this.ws?.close();
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
    // Baseline the deadline on the socket we just opened, so a socket OUTAGE is
    // not reported as a keep-alive gap: this metric measures pulse liveness on an
    // OPEN socket, and the reconnect path (ws.onopen) has its own clock-tick.
    this.lastPulseAt = Date.now();
    this.awarenessHeartbeatTimer = setInterval(() => {
      this.tickAwarenessKeepAlive("tick");
    }, AWARENESS_TICK_INTERVAL_MS);
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
    this.lastPulseAt = null;
    this.clearPongDeadline();
  }

  /**
   * Re-emit the full local awareness state for every subscribed doc. Callable
   * directly (WP5 latency harness / unit tests) to pulse a heartbeat
   * deterministically without waiting on wall-clock time. UNCONDITIONAL by
   * contract: every call pulses. No-op while the socket is not OPEN.
   */
  pulseAwarenessHeartbeat(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.emitAwarenessPulse(Date.now(), "manual");
  }

  /**
   * Deadline-driven keep-alive tick. Public so the deadline path is testable with
   * fake timers and no wall-clock wait. Unlike {@link pulseAwarenessHeartbeat}
   * this is CONDITIONAL: it pulses only when the absolute deadline has expired,
   * so it is safe to call on every opportunity — the interval tick and every
   * inbound framed message. Returns true when a pulse was emitted.
   */
  tickAwarenessKeepAlive(source: AwarenessPulseSource = "tick"): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    const now = Date.now();
    if (this.lastPulseAt !== null && now - this.lastPulseAt < AWARENESS_PULSE_DEADLINE_MS) {
      return false;
    }
    this.emitAwarenessPulse(now, source);
    return true;
  }

  /**
   * One pulse: re-emit the full local awareness state for every subscribed doc,
   * then record the gap since the previous pulse. Callers guarantee the socket is
   * OPEN. The gap is reported as an observation only — a gap of this size was
   * measured between two keep-alive pulses — and asserts nothing about its cause.
   */
  private emitAwarenessPulse(now: number, source: AwarenessPulseSource): void {
    const previous = this.lastPulseAt;
    this.lastPulseAt = now;
    for (const docId of this.awarenessMap.keys()) {
      this.reemitLocalAwareness(docId);
    }
    // No previous pulse on this socket → there is no gap to measure yet.
    if (previous === null) return;
    const gap = now - previous;
    if (gap > AWARENESS_GAP_WARN_MS) {
      this.logger?.warn(
        "sync",
        `AWARENESS GAP: ${gap}ms since the previous awareness pulse ` +
          `(source=${source}, warn threshold ${AWARENESS_GAP_WARN_MS}ms, ` +
          `prune window ${AWARENESS_OUTDATED_TIMEOUT_MS}ms)`,
      );
    } else {
      this.logger?.debug("sync", `awareness pulse: gap ${gap}ms (source=${source})`);
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

    // WP42 (AC2): open the barrier BEFORE anything else can arrive for this doc.
    // A WP41 relay sends MUX_SUBSCRIBED first and only then the stored batch, so
    // this is the last moment at which the batch can still be held as a whole.
    // Optimistic by necessity — blob support is only provable by the marker that
    // ends the batch.
    this.replayGate.beginReplay(docId);

    const syncEncoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    this.sendMux(docId, MUX_SYNC, encoding.toUint8Array(syncEncoder));

    let peerCount = 0;
    if (payload.length > 0) {
      const decoder = decoding.createDecoder(payload);
      peerCount = decoding.readVarUint(decoder);
    }

    this.peerCounts.set(docId, peerCount);

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
    // WP42 (AC3): the documented fallback release. A WP41 relay closes the
    // barrier with its marker; a legacy relay never does, so sync completion is
    // what ends the batch instead — no timer, no timing constant, and the buffer
    // is dispatched before any waitForSync listener runs, so nothing observes a
    // half-replayed doc and nothing is surfaced to the user.
    if (value) {
      this.closeReplayBarrier(docId, "unsupported");
    }
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
    // WP82 (AC3) — outbound half of the `silence` shape. One gate, at the one
    // place every mux frame passes through.
    if (this.silenced) return;
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
      // Non-encrypted passthrough: control frames plus WP42's MUX_CHECKPOINT and
      // MUX_REPLAY_END. A checkpoint carries a Yjs update, so in an E2E room none
      // is emitted at all (see maybeEmitCheckpoint) and this branch never carries
      // plaintext document state.
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(encodeMuxMessage(docId, msgType, payload));
      }
    }
  }

  private async sendEncryptedSync(docId: string, payload: Uint8Array): Promise<void> {
    // WP82 (AC3) — re-checked after the `await` in the queue: the suppression
    // can have been applied in the gap between enqueue and send.
    if (this.silenced) return;
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
    // WP82 (AC3) — see `sendEncryptedSync`.
    if (this.silenced) return;
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
