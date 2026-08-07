// ===========================================================================
// WP82 AC3 + AC4 + AC5 — the CONTROL link: two break shapes, the narration
// that distinguishes them, and every exit from the retry chain.
//
// Headless with fake timers and an injected socket, because these are the
// states a live instance must not be abused to produce (a socket-construction
// throw, ten consecutive exhausted retries). No wall-clock sleeps: backoff,
// ping interval and pong deadline are asserted with fake timers.
// ===========================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinkLifecycleEvent } from "../../sync/link-state";
import { LINK_READY_STATE } from "../../sync/link-state";
import type { LiveShareSettings } from "../../types";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static instances: MockWebSocket[] = [];
  /** When set, the NEXT construction throws. Drives the S38 throw row. */
  static throwOnNext: Error | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }
}

function WebSocketFactory(this: unknown, url: string) {
  if (MockWebSocket.throwOnNext) {
    const err = MockWebSocket.throwOnNext;
    MockWebSocket.throwOnNext = null;
    throw err;
  }
  return new MockWebSocket(url);
}
(WebSocketFactory as unknown as Record<string, number>).OPEN = 1;
(WebSocketFactory as unknown as Record<string, number>).CLOSED = 3;
(WebSocketFactory as unknown as Record<string, number>).CONNECTING = 0;
(WebSocketFactory as unknown as Record<string, number>).CLOSING = 2;

vi.stubGlobal("WebSocket", WebSocketFactory);

const { ControlChannel } = await import("../../sync/control-ws");

function settings(): LiveShareSettings {
  return {
    serverUrl: "http://localhost:3000",
    roomId: "room",
    token: "tok",
    jwt: "",
    githubUserId: "u1",
    avatarUrl: "",
    displayName: "T",
    cursorColor: "#000",
    sharedFolder: "_liveshare-test",
    role: "guest",
    encryptionPassphrase: "",
    encryptionSalt: "",
    permission: "read-write",
    requireApproval: false,
    serverPassword: "",
    clientId: "c1",
    notificationsEnabled: true,
    debugLogging: false,
    debugLogPath: "log.md",
    autoReconnect: true,
    excludePatterns: [],
    readOnlyPatterns: [],
    approvalTimeoutSeconds: 60,
    showCanvasCursors: true,
    showCanvasPresence: true,
    useCanvasBinding: false,
  } as unknown as LiveShareSettings;
}

function makeChannel() {
  const events: LinkLifecycleEvent[] = [];
  const states: string[] = [];
  const channel = new ControlChannel(settings());
  channel.onLifecycle((e) => events.push(e));
  channel.onStateChange((s) => states.push(s));
  return { channel, events, states };
}

function lastSocket(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

beforeEach(() => {
  MockWebSocket.instances = [];
  MockWebSocket.throwOnNext = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WP82 AC2 — the control link's snapshot is read from the socket, at call time", () => {
  it("readyState tracks the live socket through open → break → reconnect", () => {
    const { channel } = makeChannel();
    channel.connect();
    expect(channel.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.CONNECTING);
    lastSocket().simulateOpen();
    expect(channel.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.OPEN);
    // The belief passed in is reported back UNCHANGED and does not colour the
    // measurement — the two are separate fields on purpose.
    expect(channel.getLinkSnapshot(false).believedConnected).toBe(false);
    expect(channel.getLinkSnapshot(true).readyState).toBe(LINK_READY_STATE.OPEN);
    channel.destroy();
  });

  it("no socket reads ABSENT, not CLOSED", () => {
    const { channel } = makeChannel();
    expect(channel.getLinkSnapshot(true).hasSocket).toBe(false);
    expect(channel.getLinkSnapshot(true).readyState).toBe(LINK_READY_STATE.ABSENT);
  });
});

describe("WP82 AC3 — two break shapes, and they are NOT the same act", () => {
  it("`close` produces a clean FIN: onclose fires, the socket goes, a retry is scheduled", () => {
    const { channel, events } = makeChannel();
    channel.connect();
    lastSocket().simulateOpen();
    events.length = 0;

    const result = channel.breakLink("close");

    expect(result.hadSocket).toBe(true);
    expect(result.readyStateBefore).toBe(LINK_READY_STATE.OPEN);
    // Read from the LIVE socket after the act — not a literal.
    expect(result.readyStateAfter).toBe(LINK_READY_STATE.ABSENT);
    expect(result.silenced).toBe(false);

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("close");
    expect(kinds).toContain("retry");
    const close = events.find((e) => e.kind === "close");
    expect(close).toMatchObject({ forced: false });
    channel.destroy();
  });

  it("`silence` leaves the socket OPEN, fires NO onclose, and suppresses traffic both ways", () => {
    const { channel, events } = makeChannel();
    const received: string[] = [];
    channel.on("pong", () => received.push("pong"));
    channel.connect();
    const ws = lastSocket();
    ws.simulateOpen();
    events.length = 0;

    const result = channel.breakLink("silence");

    expect(result.silenced).toBe(true);
    expect(result.readyStateBefore).toBe(LINK_READY_STATE.OPEN);
    // THE difference from `close`: the socket is still OPEN.
    expect(result.readyStateAfter).toBe(LINK_READY_STATE.OPEN);
    expect(events.map((e) => e.kind)).not.toContain("close");

    // Outbound suppressed.
    const before = ws.sent.length;
    channel.send({ type: "join-request", userId: "u1" } as never);
    expect(ws.sent.length).toBe(before);

    // Inbound suppressed — the frame arrives at the socket and reaches no handler.
    ws.simulateMessage(JSON.stringify({ type: "pong" }));
    expect(received).toEqual([]);

    channel.destroy();
  });

  it("only `silence` reaches the pong watchdog, and the watchdog-forced close says so", () => {
    const { channel, events } = makeChannel();
    channel.connect();
    lastSocket().simulateOpen();
    channel.breakLink("silence");
    events.length = 0;

    // 15 s ping interval, then a 10 s pong deadline. Nothing goes out and
    // nothing comes back, so only this peer's own deadline can end the outage.
    vi.advanceTimersByTime(15_000);
    expect(lastSocket().readyState).toBe(LINK_READY_STATE.OPEN);
    vi.advanceTimersByTime(10_000);

    const close = events.find((e) => e.kind === "close");
    expect(close).toBeDefined();
    expect(close).toMatchObject({ forced: true });
    channel.destroy();
  });

  it("`restore` lifts the suppression and its effect is asserted, not assumed", () => {
    const { channel } = makeChannel();
    channel.connect();
    const ws = lastSocket();
    ws.simulateOpen();
    channel.breakLink("silence");
    expect(channel.getLinkSnapshot(true).silenced).toBe(true);

    const restored = channel.restoreLink();
    expect(restored.wasSilenced).toBe(true);
    expect(channel.getLinkSnapshot(true).silenced).toBe(false);

    // The proof the suppression is really gone: a send reaches the socket again.
    const before = ws.sent.length;
    channel.send({ type: "join-request", userId: "u1" } as never);
    expect(ws.sent.length).toBe(before + 1);
    channel.destroy();
  });

  it("`restore` re-arms a chain that had ended, and the link comes back", () => {
    const { channel, events } = makeChannel();
    channel.connect();
    lastSocket().simulateOpen();

    // Drive past the ceiling: 10 attempts.
    for (let i = 0; i < 12; i++) {
      lastSocket()?.close();
      vi.advanceTimersByTime(60_000);
    }
    expect(channel.getLinkSnapshot(false).retryChainEnded).toBe(true);
    events.length = 0;

    const restored = channel.restoreLink();
    expect(restored.wasChainEnded).toBe(true);
    expect(restored.reconnectStarted).toBe(true);
    expect(channel.getLinkSnapshot(false).retryChainEnded).toBe(false);
    lastSocket().simulateOpen();
    expect(channel.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.OPEN);
    channel.destroy();
  });
});

describe("WP82 AC5 — no exit from the retry chain is silent", () => {
  it("exhaustion announces ONCE, with the attempt count, and marks the chain ended", () => {
    const { channel, events } = makeChannel();
    channel.connect();
    lastSocket().simulateOpen();

    for (let i = 0; i < 12; i++) {
      lastSocket()?.close();
      vi.advanceTimersByTime(60_000);
    }

    const gaveUp = events.filter((e) => e.kind === "gave-up");
    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0]).toMatchObject({ link: "control", cause: "exhausted", max: 10 });

    // The retries were numbered on the way there — the discriminating detail a
    // generic "connection changed" line would not carry.
    const retries = events.filter((e) => e.kind === "retry");
    expect(retries.map((e) => (e as { attempt: number }).attempt)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    channel.destroy();
  });

  it("S38 row 1 — the `openWebSocket` early return is observable where it produced nothing", () => {
    const { channel, events } = makeChannel();
    channel.connect();
    lastSocket().simulateOpen();
    channel.destroy();
    events.length = 0;

    // A destroyed channel asked to open: before WP82 this returned in silence.
    (channel as unknown as { openWebSocket(): void }).openWebSocket();
    const abandoned = events.filter((e) => e.kind === "abandoned");
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({ at: "openWebSocket" });
  });

  it("S38 row 2 — a THROW from `new WebSocket(url)` inside a reconnect timer is announced, not silent", () => {
    const { channel, events } = makeChannel();
    channel.connect();
    lastSocket().simulateOpen();
    events.length = 0;

    MockWebSocket.throwOnNext = new SyntaxError("bad url");
    lastSocket().close();
    vi.advanceTimersByTime(60_000);

    const gaveUp = events.filter((e) => e.kind === "gave-up");
    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0]).toMatchObject({ cause: "socket-construction-threw" });
    // The error NAME only — never the URL, which carries the token.
    expect(JSON.stringify(gaveUp[0])).not.toMatch(/wss?:|token|jwt|password/i);
    expect(channel.getLinkSnapshot(false).retryChainEnded).toBe(true);
    channel.destroy();
  });

  it("a successful reconnect clears `retryChainEnded`, so the announcement can re-arm", () => {
    const { channel } = makeChannel();
    channel.connect();
    lastSocket().simulateOpen();
    lastSocket().close();
    vi.advanceTimersByTime(60_000);
    lastSocket().simulateOpen();
    expect(channel.getLinkSnapshot(true).retryChainEnded).toBe(false);
    expect(channel.getLinkSnapshot(true).reconnectAttempts).toBe(0);
    channel.destroy();
  });
});

describe("WP82 — the four existing control-channel state transitions are UNCHANGED", () => {
  it("connected / reconnecting / disconnected still fire with the same names and volume", () => {
    const { channel, states } = makeChannel();
    channel.connect();
    lastSocket().simulateOpen();
    expect(states).toEqual(["connected"]);
    lastSocket().close();
    expect(states).toEqual(["connected", "reconnecting"]);
    channel.destroy();
    expect(states).toEqual(["connected", "reconnecting"]);
  });
});
