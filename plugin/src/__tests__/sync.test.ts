import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import {
  MUX_AWARENESS,
  MUX_PING,
  MUX_PONG,
  MUX_SUBSCRIBE,
  MUX_SYNC_ENCRYPTED,
  MUX_SYNC_REQUEST,
  decodeMuxMessage,
  encodeMuxMessage,
} from "../sync/mux-protocol";
import { AWARENESS_HEARTBEAT_INTERVAL_MS, SyncManager } from "../sync/sync";
import type { LiveShareSettings } from "../types";

/** Pull the raw awareness-update payloads for a doc out of a mock socket's sends. */
function awarenessFrames(ws: MockWebSocket, docId: string): Uint8Array[] {
  return ws.sent
    .map((buf) => decodeMuxMessage(new Uint8Array(buf)))
    .filter((msg) => msg.msgType === MUX_AWARENESS && msg.docId === docId)
    .map((msg) => msg.payload);
}

/** Decode awareness frames the way a remote peer would, returning the applied states. */
function decodeRemoteStates(frames: Uint8Array[]): Record<string, unknown>[] {
  const doc = new Y.Doc();
  const aw = new awarenessProtocol.Awareness(doc);
  aw.setLocalState(null); // drop the default local {} so only applied states remain
  for (const frame of frames) {
    awarenessProtocol.applyAwarenessUpdate(aw, frame, "remote");
  }
  return [...aw.getStates().values()] as Record<string, unknown>[];
}

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = "blob";
  sent: ArrayBuffer[] = [];

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;

  url: string;
  constructor(url: string) {
    this.url = url;
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    if (data instanceof Uint8Array) {
      this.sent.push(
        (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
    } else {
      this.sent.push(data);
    }
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

function makeSettings(overrides: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return {
    serverUrl: "http://localhost:3000",
    roomId: "test-room",
    token: "test-token",
    jwt: "",
    serverPassword: "",
    clientId: "client-1",
    githubUserId: "",
    role: "host" as const,
    displayName: "Test",
    avatarUrl: "",
    cursorColor: "#000",
    sharedFolder: "",
    encryptionPassphrase: "",
    encryptionSalt: "",
    autoReconnect: false,
    notificationsEnabled: false,
    debugLogging: false,
    debugLogPath: "",
    excludePatterns: [] as string[],
    requireApproval: false,
    approvalTimeoutSeconds: 60,
    permission: "read-write" as const,
    readOnlyPatterns: [] as string[],
    ...overrides,
  };
}

let mockWsInstances: MockWebSocket[] = [];

describe("SyncManager", () => {
  beforeEach(() => {
    mockWsInstances = [];
    vi.stubGlobal(
      "WebSocket",
      Object.assign(
        function MockWSConstructor(url: string) {
          const ws = new MockWebSocket(url);
          mockWsInstances.push(ws);
          return ws;
        },
        { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getDoc returns a handle before WS opens (shouldConnect is true)", () => {
    const sm = new SyncManager(makeSettings());
    sm.connect();

    // WS is still in CONNECTING state
    expect(mockWsInstances).toHaveLength(1);
    expect(mockWsInstances[0].readyState).toBe(MockWebSocket.CONNECTING);

    const handle = sm.getDoc("notes/test.md");
    expect(handle).not.toBeNull();
    expect(handle!.doc).toBeDefined();
    expect(handle!.text).toBeDefined();
    expect(handle!.awareness).toBeDefined();

    sm.destroy();
  });

  it("does not send any messages before WS opens", () => {
    const sm = new SyncManager(makeSettings());
    sm.connect();

    // Register a doc while WS is still CONNECTING
    sm.getDoc("notes/test.md");

    const ws = mockWsInstances[0];
    expect(ws.readyState).toBe(MockWebSocket.CONNECTING);
    expect(ws.sent).toHaveLength(0);

    sm.destroy();
  });

  it("sends subscribe messages for all registered docs after WS opens", () => {
    const sm = new SyncManager(makeSettings());
    sm.connect();

    sm.getDoc("notes/a.md");
    sm.getDoc("notes/b.md");

    const ws = mockWsInstances[0];
    expect(ws.sent).toHaveLength(0);

    // Simulate the WS opening
    ws.simulateOpen();

    // Should have sent subscribe for both docs
    expect(ws.sent.length).toBeGreaterThanOrEqual(2);

    const subscribedPaths = ws.sent
      .map((buf) => decodeMuxMessage(new Uint8Array(buf)))
      .filter((msg) => msg.msgType === MUX_SUBSCRIBE)
      .map((msg) => msg.docId);

    expect(subscribedPaths).toContain("notes/a.md");
    expect(subscribedPaths).toContain("notes/b.md");

    sm.destroy();
  });

  it("local Yjs updates before WS opens are preserved in the doc", () => {
    const sm = new SyncManager(makeSettings());
    sm.connect();

    const handle = sm.getDoc("notes/test.md")!;

    // Write to the Y.Doc before WS is open
    handle.doc.transact(() => {
      handle.text.insert(0, "hello world");
    });

    // The local doc should have the content
    expect(handle.text.toString()).toBe("hello world");

    // No messages sent yet (WS still connecting)
    const ws = mockWsInstances[0];
    expect(ws.sent).toHaveLength(0);

    // After WS opens, subscribe is sent which will trigger sync protocol exchange
    ws.simulateOpen();

    const subscribedPaths = ws.sent
      .map((buf) => decodeMuxMessage(new Uint8Array(buf)))
      .filter((msg) => msg.msgType === MUX_SUBSCRIBE)
      .map((msg) => msg.docId);
    expect(subscribedPaths).toContain("notes/test.md");

    // The local content is still intact
    expect(handle.text.toString()).toBe("hello world");

    sm.destroy();
  });

  it("getDoc returns null when neither connected nor shouldConnect", () => {
    const sm = new SyncManager(makeSettings());
    // Never called connect(), so shouldConnect=false, isConnected=false
    const handle = sm.getDoc("notes/test.md");
    expect(handle).toBeNull();
  });

  it("getDoc returns null when roomId is empty", () => {
    const sm = new SyncManager(makeSettings({ roomId: "" }));
    sm.connect();
    const handle = sm.getDoc("notes/test.md");
    expect(handle).toBeNull();
    sm.destroy();
  });

  it("fires onMaxReconnect callback after max reconnect attempts", () => {
    vi.useFakeTimers();
    try {
      const sm = new SyncManager(makeSettings());
      const callback = vi.fn();
      sm.onMaxReconnect(callback);
      sm.connect();

      // First WS instance is the initial connection attempt.
      // Each iteration: close the current WS (triggering scheduleReconnect),
      // then advance timers so the reconnect fires and opens a new WS.
      // After 15 reconnect attempts, the next close triggers the max-reconnect path.
      for (let i = 0; i < 15; i++) {
        const ws = mockWsInstances[mockWsInstances.length - 1];
        ws.close();
        vi.runAllTimers();
      }

      // Close the final WS - this triggers scheduleReconnect with attempts >= 15
      const lastWs = mockWsInstances[mockWsInstances.length - 1];
      lastWs.close();

      // After exhausting reconnect attempts, the callback should have fired
      expect(callback).toHaveBeenCalledTimes(1);

      // getDoc should return null since shouldConnect is now false
      const handle = sm.getDoc("notes/test.md");
      expect(handle).toBeNull();

      sm.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops MUX_SYNC_ENCRYPTED when E2E is disabled instead of corrupting doc", () => {
    const sm = new SyncManager(makeSettings());
    sm.connect();

    const handle = sm.getDoc("notes/test.md")!;
    handle.doc.transact(() => {
      handle.text.insert(0, "clean");
    });

    const ws = mockWsInstances[0];
    ws.simulateOpen();

    // Simulate receiving an encrypted sync message while E2E is not enabled
    const fakeEncryptedPayload = new Uint8Array([0, 99, 99, 99, 99]);
    const muxMsg = encodeMuxMessage("notes/test.md", MUX_SYNC_ENCRYPTED, fakeEncryptedPayload);
    ws.onmessage?.({
      data: (muxMsg.buffer as ArrayBuffer).slice(
        muxMsg.byteOffset,
        muxMsg.byteOffset + muxMsg.byteLength,
      ),
    });

    // The doc should remain uncorrupted
    expect(handle.text.toString()).toBe("clean");

    sm.destroy();
  });

  // Bug A: an existing peer must re-emit its local (static) awareness when the
  // server relays a SYNC_REQUEST for a newly-subscribing client.
  it("re-emits local awareness on MUX_SYNC_REQUEST so a newcomer sees the cursor", () => {
    const sm = new SyncManager(makeSettings());
    sm.connect();

    const handle = sm.getDoc("notes/test.md")!;
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    // Host sets its caret once (static awareness state).
    handle.awareness.setLocalState({ user: { name: "Host" }, cursor: { anchor: 0, head: 0 } });

    // Ignore everything sent so far (subscribe + the initial awareness broadcast).
    ws.sent = [];

    // Server relays a SYNC_REQUEST to us because a new peer just subscribed.
    const syncReq = encodeMuxMessage("notes/test.md", MUX_SYNC_REQUEST);
    ws.onmessage?.({
      data: (syncReq.buffer as ArrayBuffer).slice(
        syncReq.byteOffset,
        syncReq.byteOffset + syncReq.byteLength,
      ),
    });

    const awarenessMsgs = ws.sent
      .map((buf) => decodeMuxMessage(new Uint8Array(buf)))
      .filter((msg) => msg.msgType === MUX_AWARENESS && msg.docId === "notes/test.md");
    expect(awarenessMsgs.length).toBeGreaterThan(0);

    sm.destroy();
  });

  it("does not re-emit awareness on SYNC_REQUEST when local state was cleared", () => {
    const sm = new SyncManager(makeSettings());
    sm.connect();

    const handle = sm.getDoc("notes/test.md")!;
    const ws = mockWsInstances[0];
    ws.simulateOpen();
    // Explicitly clear the default {} local state so getLocalState() is null.
    handle.awareness.setLocalState(null);
    ws.sent = [];

    const syncReq = encodeMuxMessage("notes/test.md", MUX_SYNC_REQUEST);
    ws.onmessage?.({
      data: (syncReq.buffer as ArrayBuffer).slice(
        syncReq.byteOffset,
        syncReq.byteOffset + syncReq.byteLength,
      ),
    });

    const awarenessMsgs = ws.sent
      .map((buf) => decodeMuxMessage(new Uint8Array(buf)))
      .filter((msg) => msg.msgType === MUX_AWARENESS);
    expect(awarenessMsgs.length).toBe(0);

    sm.destroy();
  });

  // Bug H: MUX liveness — periodic ping + pong deadline.
  it("sends a MUX_PING heartbeat after the interval elapses", () => {
    vi.useFakeTimers();
    try {
      const sm = new SyncManager(makeSettings());
      sm.connect();
      const ws = mockWsInstances[0];
      ws.simulateOpen();
      ws.sent = [];

      vi.advanceTimersByTime(15_000);

      const pings = ws.sent
        .map((buf) => decodeMuxMessage(new Uint8Array(buf)))
        .filter((msg) => msg.msgType === MUX_PING);
      expect(pings.length).toBe(1);

      sm.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the socket when no MUX_PONG arrives before the deadline", () => {
    vi.useFakeTimers();
    try {
      const sm = new SyncManager(makeSettings());
      sm.connect();
      const ws = mockWsInstances[0];
      ws.simulateOpen();

      vi.advanceTimersByTime(15_000); // ping sent, pong deadline armed
      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      vi.advanceTimersByTime(10_000); // pong deadline expires
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);

      sm.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the socket open when a MUX_PONG answers the ping", () => {
    vi.useFakeTimers();
    try {
      const sm = new SyncManager(makeSettings());
      sm.connect();
      const ws = mockWsInstances[0];
      ws.simulateOpen();

      vi.advanceTimersByTime(15_000); // ping sent, pong deadline armed

      const pong = encodeMuxMessage("", MUX_PONG);
      ws.onmessage?.({
        data: (pong.buffer as ArrayBuffer).slice(
          pong.byteOffset,
          pong.byteOffset + pong.byteLength,
        ),
      });

      vi.advanceTimersByTime(10_000); // deadline would have fired — but pong cleared it
      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      sm.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- WP1: Awareness latency-resistance ----

  // AC3/AC4 + US4 AC2: the heartbeat re-emits the FULL local state (incl.
  // lockedNodes) on a fixed cadence < 30 s even with zero local edits.
  it("heartbeat re-emits full local awareness (incl. lockedNodes) under 30 s with no edits", () => {
    vi.useFakeTimers();
    try {
      const sm = new SyncManager(makeSettings());
      sm.connect();
      const handle = sm.getDoc("notes/test.md")!;
      const ws = mockWsInstances[0];
      ws.simulateOpen();

      // A static caret plus a held lock — no further local edits after this.
      handle.awareness.setLocalState({
        user: { name: "Host", color: "#f00" },
        cursor: { anchor: 0, head: 0 },
        lockedNodes: { nodeA: { color: "#f00", name: "Host" } },
      });
      ws.sent = [];

      // The heartbeat cadence must be under the 30 s y-protocols prune window.
      expect(AWARENESS_HEARTBEAT_INTERVAL_MS).toBeLessThan(30_000);

      vi.advanceTimersByTime(AWARENESS_HEARTBEAT_INTERVAL_MS);

      const frames = awarenessFrames(ws, "notes/test.md");
      expect(frames.length).toBeGreaterThan(0);

      const states = decodeRemoteStates(frames);
      const held = states.find((s) => (s as { lockedNodes?: unknown }).lockedNodes);
      expect(held).toBeDefined();
      expect((held as { lockedNodes: Record<string, unknown> }).lockedNodes.nodeA).toEqual({
        color: "#f00",
        name: "Host",
      });

      sm.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  // AC2/AC4: a static (non-moving) caret keeps being broadcast past 30 s and is
  // never short-circuited by a "no recent movement" bail.
  it("keeps broadcasting a static caret past 30 s without local movement", () => {
    vi.useFakeTimers();
    try {
      const sm = new SyncManager(makeSettings());
      sm.connect();
      const handle = sm.getDoc("notes/test.md")!;
      const ws = mockWsInstances[0];
      ws.simulateOpen();

      const staticState = { user: { name: "Host" }, cursor: { anchor: 3, head: 3 } };
      handle.awareness.setLocalState(staticState);
      ws.sent = [];

      // Simulate 36 s of a completely idle, non-moving caret.
      vi.advanceTimersByTime(36_000);

      const frames = awarenessFrames(ws, "notes/test.md");
      expect(frames.length).toBeGreaterThan(0);

      // The caret never moved — cursor position is unchanged.
      expect(handle.awareness.getLocalState()).toMatchObject({ cursor: { anchor: 3, head: 3 } });

      sm.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  // AC4: a manual heartbeat pulse re-emits a static caret (no-bail seam usable by
  // the WP5 latency harness).
  it("pulseAwarenessHeartbeat re-emits a static caret (does not bail)", () => {
    const sm = new SyncManager(makeSettings());
    sm.connect();
    const handle = sm.getDoc("notes/test.md")!;
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    handle.awareness.setLocalState({ user: { name: "Host" }, cursor: { anchor: 0, head: 0 } });
    ws.sent = [];

    sm.pulseAwarenessHeartbeat();

    expect(awarenessFrames(ws, "notes/test.md").length).toBeGreaterThan(0);
    sm.destroy();
  });

  // AC5/AC6: on reconnect the awareness clock ticks (caret re-renders on peers)
  // and the client keeps a single stable identity — no ghost duplicate.
  it("reconnect ticks the awareness clock and keeps a single stable identity", () => {
    vi.useFakeTimers();
    try {
      const sm = new SyncManager(makeSettings({ autoReconnect: true }));
      const onReconnect = vi.fn();
      sm.onReconnect(onReconnect);
      sm.connect();

      const ws1 = mockWsInstances[0];
      ws1.simulateOpen(); // first connect — no reconnect tick

      const handle = sm.getDoc("notes/test.md")!;
      const clientIdBefore = handle.doc.clientID;
      handle.awareness.setLocalState({ user: { name: "Host" }, cursor: { anchor: 1, head: 1 } });

      // Drop the socket; the reconnect backoff should schedule a new attempt.
      // Advance by a bounded amount (first backoff is 100 ms) rather than
      // runAllTimers — the y-protocols Awareness keeps an internal interval alive
      // that would otherwise trip vitest's infinite-timer guard.
      ws1.close();
      vi.advanceTimersByTime(500);

      expect(mockWsInstances.length).toBeGreaterThanOrEqual(2);
      const ws2 = mockWsInstances[mockWsInstances.length - 1];
      ws2.sent = [];
      ws2.simulateOpen();

      // Caret re-renders on peers without typing → an awareness frame is emitted.
      expect(awarenessFrames(ws2, "notes/test.md").length).toBeGreaterThan(0);
      // WP3 reconnect seam fired with the active doc ids.
      expect(onReconnect).toHaveBeenCalledTimes(1);
      expect(onReconnect.mock.calls[0][0]).toContain("notes/test.md");

      // Single stable identity: same clientID, exactly one local awareness entry.
      const handleAfter = sm.getDoc("notes/test.md")!;
      expect(handleAfter.doc.clientID).toBe(clientIdBefore);
      expect(handleAfter.awareness.getStates().size).toBe(1);
      expect(handleAfter.awareness.getStates().has(clientIdBefore)).toBe(true);

      sm.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  // AC5: the reconnect clock-tick does NOT fire on the very first connect.
  it("does not fire the reconnect seam on the first connect", () => {
    const sm = new SyncManager(makeSettings());
    const onReconnect = vi.fn();
    sm.onReconnect(onReconnect);
    sm.connect();

    sm.getDoc("notes/test.md");
    mockWsInstances[0].simulateOpen();

    expect(onReconnect).not.toHaveBeenCalled();
    sm.destroy();
  });
});
