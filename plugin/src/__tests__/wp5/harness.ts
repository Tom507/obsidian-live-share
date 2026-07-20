// WP5 — Latency E2E harness utilities (US6).
//
// Runs the REAL NeuralAngels relay (server/src, imported in-process) and REAL
// sync-core client instances (plugin SyncManager + canvas CanvasPresence) with an
// injected 50–150 ms RTT between each client and the relay. Localhost is ~0 ms and
// hides exactly the races these tests target, so the injected latency is the
// gating signal (BUILD_SPEC §7).
//
// The injection is a per-client latency-wrapping WebSocket: every outbound frame
// and every inbound frame is held for `linkDelayMs` before delivery. A round trip
// A→relay→B→relay→A therefore incurs ~4·linkDelayMs; a one-way A→B ~2·linkDelayMs.
// This is `delayed message delivery`, not wall-clock sleeps in the assertions.
//
// NOTE: this file is intentionally NOT named *.test.ts so vitest does not collect
// it as a suite; it is imported by wp5-latency.test.ts.

import { createApp } from "../../../../server/src/index.js";
import { noopPersistence } from "../../../../server/src/persistence.js";
import { SyncManager } from "../../sync/sync";
import type { LiveShareSettings } from "../../types";

// The genuine platform WebSocket (undici in Node ≥ 21). Captured before any test
// stubs globalThis.WebSocket with the latency wrapper.
const RealWebSocket: typeof WebSocket = globalThis.WebSocket;

/** Live latency-wrapped sockets, newest last — lets a test force a socket drop. */
export const liveSockets: LatencyWebSocketLike[] = [];

export interface LatencyWebSocketLike {
  readonly _real: WebSocket;
  forceDrop(): void;
}

/**
 * Build a WebSocket-compatible class that wraps a real socket and delays every
 * frame (both directions) by `linkDelayMs`. Instances satisfy exactly the surface
 * SyncManager uses: constructor(url), binaryType, onopen/onmessage/onclose/onerror,
 * send(), close(), readyState, and the static OPEN constant.
 */
export function makeLatencyWebSocket(linkDelayMs: number) {
  return class LatencyWebSocket implements LatencyWebSocketLike {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly _real: WebSocket;
    onopen: ((ev?: unknown) => void) | null = null;
    onclose: ((ev?: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;

    constructor(url: string) {
      const real = new RealWebSocket(url);
      real.binaryType = "arraybuffer";
      this._real = real;
      liveSockets.push(this);

      Object.defineProperty(this, "binaryType", {
        get: () => real.binaryType,
        set: (v: BinaryType) => {
          real.binaryType = v;
        },
      });

      real.onopen = (ev) => this.onopen?.(ev);
      real.onerror = (ev) => this.onerror?.(ev);
      real.onclose = (ev) => this.onclose?.(ev);
      real.onmessage = (ev: MessageEvent) => {
        // Inbound latency: hold the received frame before handing it up.
        setTimeout(() => this.onmessage?.({ data: ev.data }), linkDelayMs);
      };
    }

    get readyState(): number {
      return this._real.readyState;
    }

    send(data: ArrayBuffer | Uint8Array): void {
      // Copy: the caller (lib0 encoder) may reuse its buffer synchronously.
      const copy =
        data instanceof Uint8Array ? data.slice() : new Uint8Array(data as ArrayBuffer).slice();
      // Outbound latency: hold the frame, then push it onto the wire.
      setTimeout(() => {
        try {
          if (this._real.readyState === RealWebSocket.OPEN) this._real.send(copy);
        } catch {
          /* socket closed mid-flight */
        }
      }, linkDelayMs);
    }

    close(code?: number, reason?: string): void {
      this._real.close(code, reason);
    }

    /** Simulate an abrupt network drop (no graceful client-side disconnect). */
    forceDrop(): void {
      this._real.close();
    }
  };
}

export function installLatency(linkDelayMs: number): () => void {
  const prev = globalThis.WebSocket;
  // biome-ignore lint/suspicious/noExplicitAny: test stub of the global.
  (globalThis as any).WebSocket = makeLatencyWebSocket(linkDelayMs);
  return () => {
    // biome-ignore lint/suspicious/noExplicitAny: restore the global.
    (globalThis as any).WebSocket = prev;
    liveSockets.length = 0;
  };
}

export interface Relay {
  port: number;
  close(): Promise<void>;
}

export async function startRelay(): Promise<Relay> {
  const { server } = createApp(noopPersistence);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface Room {
  id: string;
  token: string;
}

export async function createRoom(port: number, name: string): Promise<Room> {
  const res = await fetch(`http://localhost:${port}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const room = (await res.json()) as { id: string; token: string };
  return { id: room.id, token: room.token };
}

export function makeSettings(over: Partial<LiveShareSettings>): LiveShareSettings {
  return {
    serverUrl: "http://localhost:3000",
    roomId: "r",
    token: "t",
    jwt: "",
    serverPassword: "",
    clientId: "c",
    githubUserId: "",
    role: "host",
    displayName: "T",
    avatarUrl: "",
    cursorColor: "#000",
    sharedFolder: "",
    encryptionPassphrase: "",
    encryptionSalt: "",
    autoReconnect: true,
    notificationsEnabled: false,
    debugLogging: false,
    debugLogPath: "",
    excludePatterns: [],
    requireApproval: false,
    approvalTimeoutSeconds: 60,
    showCanvasCursors: true,
    showCanvasPresence: true,
    permission: "read-write",
    readOnlyPatterns: [],
    ...over,
  } as LiveShareSettings;
}

export function newClient(port: number, room: Room, clientId: string): SyncManager {
  const sm = new SyncManager(
    makeSettings({
      serverUrl: `http://localhost:${port}`,
      roomId: room.id,
      token: room.token,
      clientId,
    }),
  );
  sm.connect();
  return sm;
}

/** Poll `fn` until it returns truthy or the timeout elapses. Real timers only. */
export async function waitUntil<T>(
  fn: () => T | undefined | null | false,
  { timeout = 3000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - start > timeout) {
      throw new Error(`waitUntil: condition not met within ${timeout}ms`);
    }
    await sleep(interval);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
