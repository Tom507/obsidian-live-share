import type {
  ControlMessage,
  ControlMessageMap,
  ControlMessageType,
  LiveShareSettings,
} from "../types";
import { toWsUrl } from "../utils";
import type { E2ECrypto } from "./crypto";
import { LINK_READY_STATE, type LinkLifecycleEvent, type LinkSnapshot } from "./link-state";

export type { ControlMessage, ControlMessageType };

type Handler<T extends ControlMessageType = ControlMessageType> = (
  msg: ControlMessageMap[T],
) => void;

const RECONNECT_BASE_MS = 300;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;

export class ControlChannel {
  private ws: WebSocket | null = null;
  private handlers = new Map<ControlMessageType, Handler<ControlMessageType>[]>();
  private settings: LiveShareSettings;
  private isDestroyed = false;
  private e2e: E2ECrypto | null = null;
  private stateChangeCallback:
    | ((state: "connected" | "reconnecting" | "disconnected" | "auth-required") => void)
    | null = null;
  private everConnected = false;
  private errorCallback: ((context: string, err: unknown) => void) | null = null;

  private latencyMs = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPingTime = 0;
  private awaitingPong = false;

  private shouldConnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // --- WP82 ----------------------------------------------------------------
  private lifecycleCallback: ((event: LinkLifecycleEvent) => void) | null = null;
  private lastChangeAt: number | null = null;
  private retryChainEnded = false;
  /** Set only by the E2E break seam. See {@link breakLink}. */
  private silenced = false;
  /** `true` while a pong deadline is force-closing this socket (AC4 discriminator). */
  private forcedClose = false;

  constructor(settings: LiveShareSettings, e2e?: E2ECrypto) {
    this.settings = settings;
    this.e2e = e2e ?? null;
  }

  /**
   * WP82 (AC4/AC5) — narration. Wiring only: this class emits the facts, the
   * caller decides what to log and what to announce. Before WP82 the control
   * channel narrated exactly four transitions through `onStateChange` and every
   * exit from its retry chain was silent.
   */
  onLifecycle(callback: (event: LinkLifecycleEvent) => void): void {
    this.lifecycleCallback = callback;
  }

  private emit(event: LinkLifecycleEvent): void {
    this.lastChangeAt = Date.now();
    this.lifecycleCallback?.(event);
  }

  /**
   * WP82 (AC2) — the link's own facts, every one READ AT CALL TIME. The
   * `readyState` comes from the socket object, never from `everConnected` or
   * from any belief this class holds; that distinction is the whole WP.
   */
  getLinkSnapshot(believedConnected: boolean): LinkSnapshot {
    return {
      link: "control",
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
   * WP82 (AC3) — THE BREAK SEAM. E2E ONLY.
   *
   * Its only call site outside tests is inside `plugin/src/testing/`, which the
   * production build dead-code-eliminates via `__LS_E2E__`. It is reachable
   * from no UI, no command, no setting and no message handler: nothing in
   * `main.ts`, `ui/`, `commands.ts` or any `channel.on(...)` handler calls it.
   *
   * Two shapes, and they are NOT interchangeable:
   *
   * - `close`   — a clean FIN from inside the process. Exercises `onclose` →
   *               `scheduleReconnect`. The relay sees the socket go.
   * - `silence` — the socket is left OPEN and its traffic is suppressed in both
   *               directions, so NO `onclose` fires and only the pong deadline
   *               can end it. This is the flaky-Wi-Fi shape, the one a `close`
   *               cannot simulate, and the only one that exercises the
   *               half-dead-socket watchdog at all. The relay sees nothing.
   *
   * Returns the socket's `readyState` immediately before and immediately after,
   * read from the live socket — no field here is a literal.
   */
  breakLink(shape: "close" | "silence"): {
    link: "control";
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
      link: "control",
      shape,
      hadSocket,
      readyStateBefore,
      readyStateAfter: this.ws === null ? LINK_READY_STATE.ABSENT : this.ws.readyState,
      silenced: this.silenced,
    };
  }

  /**
   * WP82 (AC3) — the restore half, and it is REQUIRED: a scenario that leaves a
   * link silenced has corrupted every scenario after it. Lifts the suppression
   * and re-arms a retry chain that has ended, WITHOUT touching `everConnected`
   * (resetting it is S39, which routes a network outage to `auth-required`).
   */
  restoreLink(): {
    link: "control";
    wasSilenced: boolean;
    wasChainEnded: boolean;
    reconnectStarted: boolean;
    readyStateAfter: number;
  } {
    const wasSilenced = this.silenced;
    this.silenced = false;
    const rearmed = this.rearm();
    return {
      link: "control",
      wasSilenced,
      wasChainEnded: rearmed.wasChainEnded,
      reconnectStarted: rearmed.reconnectStarted,
      readyStateAfter: rearmed.readyStateAfter,
    };
  }

  /**
   * WP88 (AC3) — THE RE-ARM, and it is now reachable from the PRODUCT.
   *
   * WP82 landed this behaviour inside {@link restoreLink}, which is the E2E
   * break seam's other half and is dead-code-eliminated from a production
   * build. So a peer that had given up could be re-armed by the rig and by
   * nothing else. After WP88 the ceiling no longer destroys the session, which
   * makes that gap the defect: retention with no way back is a session that
   * reports itself alive with no edge that can restore it — WP82's own defect,
   * rebuilt by WP88's repair. Hence one seam, two callers.
   *
   * `everConnected` is DELIBERATELY NOT RESET (S39): resetting it would route a
   * later network outage on this link to `"auth-required"`, i.e. would tell the
   * user their credentials are the problem because their Wi-Fi died. The
   * comment that used to live on `restoreLink` said exactly this and it is the
   * reason it still says it here.
   *
   * `silenced` is NOT touched either — it belongs to the rig's break seam, and
   * a production re-arm has no business lifting an instrument's suppression.
   */
  rearm(): {
    link: "control";
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
      link: "control",
      wasChainEnded,
      reconnectStarted,
      readyStateAfter: this.ws === null ? LINK_READY_STATE.ABSENT : this.ws.readyState,
    };
  }

  onStateChange(
    callback: (state: "connected" | "reconnecting" | "disconnected" | "auth-required") => void,
  ) {
    this.stateChangeCallback = callback;
  }

  onError(callback: (context: string, err: unknown) => void) {
    this.errorCallback = callback;
  }

  getLatency(): number {
    return this.latencyMs;
  }

  connect(): void {
    if (this.isDestroyed) return;
    this.shouldConnect = true;
    this.reconnectAttempts = 0;
    this.everConnected = false;
    this.openWebSocket();
  }

  private openWebSocket(): void {
    // WP82 / S38 — this early `return` used to abandon a scheduled reconnect
    // with no callback, no state change and no log. It is now observable. It is
    // still a `return`: making the exit observable is this WP's subject,
    // changing WHEN the chain gives up is a product decision with no
    // measurement behind it and is explicitly not made here.
    if (this.isDestroyed || !this.shouldConnect) {
      this.emit({
        kind: "abandoned",
        link: "control",
        at: "openWebSocket",
        reason: this.isDestroyed ? "channel destroyed" : "shouldConnect is false",
      });
      return;
    }
    const wsUrl = toWsUrl(this.settings.serverUrl);
    let url = `${wsUrl}/control/${encodeURIComponent(this.settings.roomId)}?token=${encodeURIComponent(this.settings.token)}`;
    if (this.settings.jwt) url += `&jwt=${encodeURIComponent(this.settings.jwt)}`;
    if (this.settings.serverPassword)
      url += `&password=${encodeURIComponent(this.settings.serverPassword)}`;

    // WP82 / S38 — `new WebSocket(url)` was unguarded, so a synchronous throw
    // inside a reconnect timer terminated the chain permanently AND invisibly.
    // The throw still ends the chain (the policy is unchanged); what changed is
    // that it now says so.
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.ws = null;
      this.shouldConnect = false;
      this.retryChainEnded = true;
      this.emit({
        kind: "gave-up",
        link: "control",
        attempts: this.reconnectAttempts,
        max: MAX_RECONNECT_ATTEMPTS,
        cause: "socket-construction-threw",
        // The message only. No URL, and no fragment of one: the control socket
        // URL carries `token`, `jwt` and `password` as query parameters.
        detail: err instanceof Error ? err.name : "unknown",
      });
      this.errorCallback?.("connect", err);
      this.stateChangeCallback?.(this.everConnected ? "disconnected" : "auth-required");
      return;
    }

    const wasReconnect = this.everConnected;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.everConnected = true;
      this.retryChainEnded = false;
      this.emit({ kind: "open", link: "control", reconnect: wasReconnect });
      this.stateChangeCallback?.("connected");
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      // WP82 (AC3) — the `silence` shape suppresses traffic in BOTH directions.
      // Inbound frames are dropped here, before any handler runs, so the peer
      // is deaf as well as mute and only its own pong deadline can end the
      // outage. E2E-only: `silenced` is set by nothing but the break seam.
      if (this.silenced) return;
      try {
        const msg = JSON.parse(
          typeof event.data === "string" ? event.data : "",
        ) as ControlMessage & { encrypted?: boolean };

        if (msg.type === "pong") {
          // A pong proves the socket is still alive: clear the pong deadline so
          // the half-dead-socket detector does not force a close.
          if (this.awaitingPong) {
            this.latencyMs = Date.now() - this.lastPingTime;
            this.awaitingPong = false;
          }
          if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
          }
        }

        if (msg.encrypted && this.e2e?.enabled) {
          void this.decryptAndDispatch(msg);
          return;
        }
        const handlers = this.handlers.get(msg.type);
        if (handlers) {
          for (const handler of handlers) handler(msg as never);
        }
      } catch (err) {
        this.errorCallback?.("message", err);
      }
    };

    this.ws.onclose = () => {
      this.stopPing();
      this.ws = null;
      const forced = this.forcedClose;
      this.forcedClose = false;
      this.emit({ kind: "close", link: "control", forced });
      if (this.isDestroyed) return;
      if (this.shouldConnect) {
        this.stateChangeCallback?.("reconnecting");
        this.scheduleReconnect();
      } else {
        this.stateChangeCallback?.(this.everConnected ? "disconnected" : "auth-required");
      }
    };

    this.ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.shouldConnect = false;
      this.retryChainEnded = true;
      this.emit({
        kind: "gave-up",
        link: "control",
        attempts: this.reconnectAttempts,
        max: MAX_RECONNECT_ATTEMPTS,
        cause: "exhausted",
      });
      this.stateChangeCallback?.(this.everConnected ? "disconnected" : "auth-required");
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.emit({
      kind: "retry",
      link: "control",
      attempt: this.reconnectAttempts,
      max: MAX_RECONNECT_ATTEMPTS,
      delayMs: delay,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) this.openWebSocket();
      else
        this.emit({
          kind: "abandoned",
          link: "control",
          at: "reconnectTimer",
          reason: "shouldConnect went false while the retry was pending",
        });
    }, delay);
  }

  send(msg: ControlMessage): void {
    // WP82 (AC3) — outbound half of the `silence` shape.
    if (this.silenced) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const encryptable =
      msg.type === "file-op" ||
      msg.type === "file-chunk-start" ||
      msg.type === "file-chunk-data" ||
      msg.type === "file-chunk-end" ||
      msg.type === "file-chunk-resume";
    if (this.e2e?.enabled && encryptable) {
      void this.encryptAndSend(msg);
    } else {
      this.ws.send(JSON.stringify(msg));
    }
  }

  on<T extends ControlMessageType>(type: T, handler: (msg: ControlMessageMap[T]) => void): void {
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push(handler as Handler<ControlMessageType>);
  }

  off<T extends ControlMessageType>(type: T, handler: (msg: ControlMessageMap[T]) => void): void {
    const list = this.handlers.get(type);
    if (list) {
      const index = list.indexOf(handler as Handler<ControlMessageType>);
      if (index >= 0) list.splice(index, 1);
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    const wasOpen = this.ws !== null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (wasOpen) {
      this.stateChangeCallback?.("disconnected");
    }
    this.handlers.clear();
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private sendPing(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.lastPingTime = Date.now();
    this.awaitingPong = true;
    // WP82 (AC3) — under `silence` the ping is suppressed on the wire but the
    // deadline below is STILL ARMED. That is precisely the flaky-Wi-Fi shape:
    // the socket stays OPEN, the relay sees nothing change, and the only thing
    // that can end the outage is this peer's own watchdog.
    if (!this.silenced) {
      this.ws.send(JSON.stringify({ type: "ping", timestamp: this.lastPingTime }));
    }
    // Arm a pong deadline: a half-dead socket (Wi-Fi drop, no FIN) keeps
    // sending into the void, so if no pong arrives in time force a close and
    // let the existing reconnect logic re-establish the channel.
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      if (this.awaitingPong && this.ws?.readyState === WebSocket.OPEN) {
        // WP82 (AC4) — mark the close as WATCHDOG-FORCED so the narration can
        // distinguish it from a clean FIN. A log line that said only "closed"
        // would satisfy a naive check while telling the reader nothing about
        // which mechanism ended the socket.
        this.forcedClose = true;
        this.ws.close();
      }
    }, PONG_TIMEOUT_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    this.awaitingPong = false;
  }

  private async encryptAndSend(msg: ControlMessage): Promise<void> {
    // WP82 (AC3) — the encrypted arm of `send` writes to the socket directly,
    // so the outbound suppression is re-checked here (it is `await`ed, so the
    // flag can have been set in the gap).
    if (this.silenced) return;
    if (!this.e2e || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      if (
        (msg.type === "file-chunk-start" || msg.type === "file-chunk-end") &&
        typeof msg.path === "string"
      ) {
        const encrypted = await this.e2e.encryptString(msg.path);
        this.ws.send(JSON.stringify({ ...msg, path: encrypted, encrypted: true }));
      } else if (msg.type === "file-chunk-data" && typeof msg.data === "string") {
        const encryptedData = await this.e2e.encryptString(msg.data);
        const encryptedPath =
          typeof msg.path === "string" ? await this.e2e.encryptString(msg.path) : msg.path;
        this.ws.send(
          JSON.stringify({
            ...msg,
            data: encryptedData,
            path: encryptedPath,
            encrypted: true,
          }),
        );
      } else if (msg.type === "file-chunk-resume" && typeof msg.path === "string") {
        const encrypted = await this.e2e.encryptString(msg.path);
        this.ws.send(JSON.stringify({ ...msg, path: encrypted, encrypted: true }));
      } else if (msg.type === "file-op") {
        const op = msg.op as unknown as Record<string, unknown>;
        if (op && typeof op.content === "string") {
          const encryptedOp: Record<string, unknown> = {
            ...op,
            content: await this.e2e.encryptString(op.content),
          };
          if (typeof op.path === "string") encryptedOp.path = await this.e2e.encryptString(op.path);
          if (typeof op.oldPath === "string")
            encryptedOp.oldPath = await this.e2e.encryptString(op.oldPath);
          if (typeof op.newPath === "string")
            encryptedOp.newPath = await this.e2e.encryptString(op.newPath);
          this.ws.send(
            JSON.stringify({
              ...msg,
              op: encryptedOp,
              encrypted: true,
            }),
          );
        } else if (op) {
          const encryptedOp: Record<string, unknown> = { ...op };
          if (typeof op.path === "string") encryptedOp.path = await this.e2e.encryptString(op.path);
          if (typeof op.oldPath === "string")
            encryptedOp.oldPath = await this.e2e.encryptString(op.oldPath);
          if (typeof op.newPath === "string")
            encryptedOp.newPath = await this.e2e.encryptString(op.newPath);
          this.ws.send(JSON.stringify({ ...msg, op: encryptedOp, encrypted: true }));
        } else {
          this.ws.send(JSON.stringify(msg));
        }
      }
    } catch (err) {
      this.errorCallback?.("encrypt", err);
    }
  }

  private async decryptAndDispatch(raw: ControlMessage & { encrypted?: boolean }): Promise<void> {
    if (!this.e2e) return;
    try {
      const { encrypted: _omit, ...msg } = raw;
      void _omit;
      let decryptedMsg: ControlMessage;
      if (
        (msg.type === "file-chunk-start" || msg.type === "file-chunk-end") &&
        typeof msg.path === "string"
      ) {
        const decryptedPath = await this.e2e.decryptString(msg.path);
        decryptedMsg = { ...msg, path: decryptedPath };
      } else if (msg.type === "file-chunk-data" && typeof msg.data === "string") {
        const decryptedData = await this.e2e.decryptString(msg.data);
        const decryptedPath =
          typeof msg.path === "string" ? await this.e2e.decryptString(msg.path) : msg.path;
        decryptedMsg = {
          ...msg,
          data: decryptedData,
          path: decryptedPath,
        };
      } else if (msg.type === "file-chunk-resume" && typeof msg.path === "string") {
        const decryptedPath = await this.e2e.decryptString(msg.path);
        decryptedMsg = { ...msg, path: decryptedPath };
      } else if (msg.type === "file-op") {
        const op = msg.op as unknown as Record<string, unknown>;
        if (op && typeof op.content === "string") {
          const decryptedOp: Record<string, unknown> = {
            ...op,
            content: await this.e2e.decryptString(op.content),
          };
          if (typeof op.path === "string") decryptedOp.path = await this.e2e.decryptString(op.path);
          if (typeof op.oldPath === "string")
            decryptedOp.oldPath = await this.e2e.decryptString(op.oldPath);
          if (typeof op.newPath === "string")
            decryptedOp.newPath = await this.e2e.decryptString(op.newPath);
          decryptedMsg = {
            ...msg,
            op: decryptedOp,
          } as unknown as ControlMessage;
        } else if (op) {
          const decryptedOp: Record<string, unknown> = { ...op };
          if (typeof op.path === "string") decryptedOp.path = await this.e2e.decryptString(op.path);
          if (typeof op.oldPath === "string")
            decryptedOp.oldPath = await this.e2e.decryptString(op.oldPath);
          if (typeof op.newPath === "string")
            decryptedOp.newPath = await this.e2e.decryptString(op.newPath);
          decryptedMsg = {
            ...msg,
            op: decryptedOp,
          } as unknown as ControlMessage;
        } else {
          decryptedMsg = msg;
        }
      } else {
        decryptedMsg = msg;
      }
      const handlers = this.handlers.get(decryptedMsg.type);
      if (handlers) {
        for (const handler of handlers) handler(decryptedMsg as never);
      }
    } catch (err) {
      this.errorCallback?.("decrypt", err);
    }
  }
}
