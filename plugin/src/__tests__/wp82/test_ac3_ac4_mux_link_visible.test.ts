// ===========================================================================
// WP82 AC3 + AC4 — the MUX link: the same two break shapes, and the lifecycle
// narration it never had.
//
// Before this WP `main.ts`'s control-channel callback was the ONLY `"connection"`
// log site in the entire plugin, and the mux wiring recorded nothing at all. If
// the sync socket died, the status bar still read `hosting`.
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
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static instances: MockWebSocket[] = [];
  static throwOnNext: Error | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
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
for (const [k, v] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
  (WebSocketFactory as unknown as Record<string, number>)[k] = v;
}
vi.stubGlobal("WebSocket", WebSocketFactory);

const { SyncManager } = await import("../../sync/sync");

function settings(over: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return {
    serverUrl: "http://localhost:3000",
    roomId: "room",
    token: "tok",
    jwt: "",
    githubUserId: "u1",
    clientId: "c1",
    serverPassword: "",
    encryptionPassphrase: "",
    encryptionSalt: "",
    ...over,
  } as unknown as LiveShareSettings;
}

function makeManager(over: Partial<LiveShareSettings> = {}) {
  const events: LinkLifecycleEvent[] = [];
  const connections: boolean[] = [];
  const manager = new SyncManager(settings(over));
  manager.onLifecycle((e) => events.push(e));
  manager.onConnectionChange((c) => connections.push(c));
  return { manager, events, connections };
}

const lastSocket = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

beforeEach(() => {
  MockWebSocket.instances = [];
  MockWebSocket.throwOnNext = null;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WP82 AC4 — the mux link narrates its own lifecycle", () => {
  it("open, close and each numbered retry reach the callback", () => {
    const { manager, events } = makeManager();
    manager.connect();
    lastSocket().simulateOpen();
    expect(events.filter((e) => e.kind === "open")).toHaveLength(1);
    expect(events[0]).toMatchObject({ link: "mux", reconnect: false });

    events.length = 0;
    lastSocket().close();
    expect(events.map((e) => e.kind)).toEqual(["close", "retry"]);
    expect(events[0]).toMatchObject({ forced: false });
    expect(events[1]).toMatchObject({ attempt: 1, max: 15 });
    manager.destroy();
  });

  it("a reconnect is narrated AS a reconnect", () => {
    const { manager, events } = makeManager();
    manager.connect();
    lastSocket().simulateOpen();
    lastSocket().close();
    vi.advanceTimersByTime(60_000);
    events.length = 0;
    lastSocket().simulateOpen();
    expect(events.find((e) => e.kind === "open")).toMatchObject({ reconnect: true });
    manager.destroy();
  });

  it("exhaustion is announced once, and `retryChainEnded` becomes true", () => {
    const { manager, events } = makeManager();
    manager.connect();
    lastSocket().simulateOpen();
    for (let i = 0; i < 18; i++) {
      lastSocket()?.close();
      vi.advanceTimersByTime(60_000);
    }
    const gaveUp = events.filter((e) => e.kind === "gave-up");
    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0]).toMatchObject({ link: "mux", cause: "exhausted", max: 15 });
    expect(manager.getLinkSnapshot(false).retryChainEnded).toBe(true);
    manager.destroy();
  });

  it("S38 — the two silent early returns in `openWebSocket` are observable", () => {
    const missingRoom = makeManager({ roomId: "" });
    missingRoom.manager.connect();
    expect(missingRoom.events.filter((e) => e.kind === "abandoned")).toHaveLength(1);
    expect(missingRoom.events[0]).toMatchObject({ at: "openWebSocket" });
    expect(JSON.stringify(missingRoom.events[0])).not.toMatch(/wss?:|token|jwt|password/i);

    const destroyed = makeManager();
    destroyed.manager.connect();
    lastSocket().simulateOpen();
    destroyed.manager.destroy();
    destroyed.events.length = 0;
    (destroyed.manager as unknown as { openWebSocket(): void }).openWebSocket();
    expect(destroyed.events.filter((e) => e.kind === "abandoned")).toHaveLength(1);
  });

  it("S38 — a throw from `new WebSocket(url)` ends the chain OBSERVABLY", () => {
    const { manager, events } = makeManager();
    manager.connect();
    lastSocket().simulateOpen();
    events.length = 0;
    MockWebSocket.throwOnNext = new SyntaxError("bad url");
    lastSocket().close();
    vi.advanceTimersByTime(60_000);
    const gaveUp = events.filter((e) => e.kind === "gave-up");
    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0]).toMatchObject({ cause: "socket-construction-threw" });
    manager.destroy();
  });
});

describe("WP82 AC3 — the mux break shapes differ, and the difference is the point", () => {
  it("`close` takes the socket away; `silence` leaves it OPEN with no close event", () => {
    const closed = makeManager();
    closed.manager.connect();
    lastSocket().simulateOpen();
    closed.events.length = 0;
    const closeResult = closed.manager.breakLink("close");
    expect(closeResult.readyStateBefore).toBe(LINK_READY_STATE.OPEN);
    expect(closeResult.readyStateAfter).toBe(LINK_READY_STATE.ABSENT);
    expect(closed.events.map((e) => e.kind)).toContain("close");
    closed.manager.destroy();

    const silenced = makeManager();
    silenced.manager.connect();
    const ws = lastSocket();
    ws.simulateOpen();
    silenced.events.length = 0;
    const silenceResult = silenced.manager.breakLink("silence");
    expect(silenceResult.readyStateBefore).toBe(LINK_READY_STATE.OPEN);
    expect(silenceResult.readyStateAfter).toBe(LINK_READY_STATE.OPEN);
    expect(silenced.events.map((e) => e.kind)).not.toContain("close");
    silenced.manager.destroy();
  });

  it("under `silence` only the pong watchdog can end the outage, and it is marked forced", () => {
    const { manager, events } = makeManager();
    manager.connect();
    lastSocket().simulateOpen();
    manager.breakLink("silence");
    events.length = 0;

    vi.advanceTimersByTime(15_000); // heartbeat fires, ping suppressed
    expect(lastSocket().readyState).toBe(LINK_READY_STATE.OPEN);
    vi.advanceTimersByTime(10_000); // pong deadline
    const close = events.find((e) => e.kind === "close");
    expect(close).toMatchObject({ forced: true });
    manager.destroy();
  });

  it("`silence` suppresses outbound frames — paired with an unsilenced control that DOES send", () => {
    // The suppressed arm.
    const silenced = makeManager();
    silenced.manager.connect();
    const silencedWs = lastSocket();
    silencedWs.simulateOpen();
    const silencedBefore = silencedWs.sent.length;
    silenced.manager.breakLink("silence");
    vi.advanceTimersByTime(15_000);
    expect(silencedWs.sent.length).toBe(silencedBefore);
    silenced.manager.destroy();

    // THE POSITIVE CONTROL. Without it, "nothing was sent" would also pass on a
    // build whose heartbeat never fires at all — an absence proving nothing.
    const open = makeManager();
    open.manager.connect();
    const openWs = lastSocket();
    openWs.simulateOpen();
    const openBefore = openWs.sent.length;
    vi.advanceTimersByTime(15_000);
    expect(openWs.sent.length).toBe(openBefore + 1);
    open.manager.destroy();
  });

  it("`restore` re-arms an ended chain", () => {
    const { manager } = makeManager();
    manager.connect();
    lastSocket().simulateOpen();
    for (let i = 0; i < 18; i++) {
      lastSocket()?.close();
      vi.advanceTimersByTime(60_000);
    }
    expect(manager.getLinkSnapshot(false).retryChainEnded).toBe(true);
    const restored = manager.restoreLink();
    expect(restored.wasChainEnded).toBe(true);
    expect(restored.reconnectStarted).toBe(true);
    lastSocket().simulateOpen();
    expect(manager.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.OPEN);
    manager.destroy();
  });
});
