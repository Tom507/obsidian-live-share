// ===========================================================================
// LIVENESS SWEEP (B37) — a wait that CANNOT COMPLETE.
//
// The class this file pins is one level worse than "a green that cannot fail".
// A check that cannot fire at least returns an answer somebody can look at. A
// criterion whose precondition can never be produced returns NOTHING — and a
// wait that never returns reads as "slow", or gets killed and re-run.
//
// THE CONFIRMED MEMBER, and its twin one file over:
//
//   `link.break{shape:"silence"}` cannot drive a link to its retry ceiling.
//   The pong deadline force-closes the socket, `scheduleReconnect` fires, and
//   the next socket OPENS — the relay is reachable; it is this peer that is
//   deaf and mute. `onopen` was ungated by `silenced`, so it reset
//   `reconnectAttempts` to 0 and `retryChainEnded` to false. The chain
//   oscillated forever. WP88's AC4 as written was therefore unsatisfiable, and
//   `H:\tmp\liveshare_wp88_e2e.py::wait_for_ceiling` — which polls exactly
//   `retryChainEnded && reconnectAttempts >= 10` — would have HUNG, not failed.
//
// THE METHOD, and it is the whole point of this file: a liveness repair that
// cannot be shown HANGING beforehand has demonstrated nothing. So the tests
// below are written as the rig's own poll loop against virtual time, and they
// report `reached: false` on the unrepaired tree — an executed hang, not a
// described one.
//
// The mock relay ACCEPTS every reconnection. That is the precondition of the
// defect and it must not be weakened: a mock that refused connections would
// drive the chain to its ceiling for the wrong reason and go green on the
// broken tree.
// ===========================================================================

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LINK_READY_STATE, type LinkLifecycleEvent, type LinkSnapshot } from "../../../sync/link-state";
import type { LiveShareSettings } from "../../../types";

// --------------------------------------------------------------------------
// A relay that is REACHABLE. Every socket opens shortly after construction.
// --------------------------------------------------------------------------
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];
  /** `false` models an unreachable relay — used by the `close`-shape control. */
  static relayAccepts = true;

  readyState: number = MockWebSocket.CONNECTING;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
    // Asynchronous on purpose: the channel assigns `onopen` AFTER the
    // constructor returns, so a synchronous open would be missed and the whole
    // fixture would silently measure nothing.
    setTimeout(() => {
      if (MockWebSocket.relayAccepts) this.simulateOpen();
      else this.close();
    }, 1);
  }

  simulateOpen() {
    if (this.readyState !== MockWebSocket.CONNECTING) return;
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

function WebSocketFactory(this: unknown, url: string) {
  return new MockWebSocket(url);
}
for (const [k, v] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
  (WebSocketFactory as unknown as Record<string, number>)[k] = v;
}
vi.stubGlobal("WebSocket", WebSocketFactory);

const { ControlChannel } = await import("../../../sync/control-ws");
const { SyncManager } = await import("../../../sync/sync");

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
    displayName: "T",
    role: "guest",
    ...over,
  } as unknown as LiveShareSettings;
}

const lastSocket = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

/**
 * `H:\tmp\liveshare_wp88_e2e.py::wait_for_ceiling`, transposed onto virtual
 * time. The verdict is the peer's OWN counter — never the clock — which is the
 * discipline WP88's live row used and the reason its elapsed time was recorded
 * rather than asserted.
 */
function pollForCeiling(
  read: () => LinkSnapshot,
  budgetMs: number,
  stepMs = 3_000,
): { reached: boolean; waitedMs: number; snapshot: LinkSnapshot } {
  let waited = 0;
  while (waited < budgetMs) {
    vi.advanceTimersByTime(stepMs);
    waited += stepMs;
    const snapshot = read();
    if (snapshot.retryChainEnded && snapshot.reconnectAttempts >= snapshot.maxReconnectAttempts)
      return { reached: true, waitedMs: waited, snapshot };
  }
  return { reached: false, waitedMs: waited, snapshot: read() };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  MockWebSocket.relayAccepts = true;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
describe("TP01 — the CONTROL link reaches its ceiling under `silence`", () => {
  it("the fixture's precondition: the relay ACCEPTS reconnections", () => {
    // Without this the whole file is vacuous: a chain that ends because nothing
    // will connect proves nothing about a chain that ends despite everything
    // connecting. Asserted, not assumed.
    const channel = new ControlChannel(settings());
    channel.connect();
    vi.advanceTimersByTime(10);
    expect(channel.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.OPEN);
    lastSocket().close();
    vi.advanceTimersByTime(1_000);
    expect(
      channel.getLinkSnapshot(false).readyState,
      "the mock relay refused a reconnect — the fixture cannot show the defect",
    ).toBe(LINK_READY_STATE.OPEN);
    channel.destroy();
  });

  it("a silenced control link REACHES `retryChainEnded` — the wait completes", () => {
    const events: LinkLifecycleEvent[] = [];
    const channel = new ControlChannel(settings());
    channel.onLifecycle((e) => events.push(e));
    channel.connect();
    vi.advanceTimersByTime(10);
    expect(channel.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.OPEN);

    channel.breakLink("silence");
    // The break itself must NOT close the socket — that is the `close` shape,
    // and conflating them would make this a different test.
    expect(channel.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.OPEN);

    const result = pollForCeiling(() => channel.getLinkSnapshot(false), 600_000);

    expect(
      result.reached,
      `the wait for the retry ceiling NEVER COMPLETED: after ${result.waitedMs} ms of ` +
        `virtual time the chain still reports retryChainEnded=` +
        `${result.snapshot.retryChainEnded} attempts=${result.snapshot.reconnectAttempts}. ` +
        "This is the hang, executed: a criterion polling for this state returns no answer at all.",
    ).toBe(true);
    expect(result.snapshot.reconnectAttempts).toBe(10);
    expect(events.filter((e) => e.kind === "gave-up")).toHaveLength(1);
    // The exit is narrated as exhaustion, not as something new.
    expect(events.find((e) => e.kind === "gave-up")).toMatchObject({
      link: "control",
      cause: "exhausted",
      max: 10,
    });
    channel.destroy();
  });

  it("every suppressed open is ANNOUNCED — the chain does not advance in silence", () => {
    const events: LinkLifecycleEvent[] = [];
    const channel = new ControlChannel(settings());
    channel.onLifecycle((e) => events.push(e));
    channel.connect();
    vi.advanceTimersByTime(10);
    channel.breakLink("silence");
    pollForCeiling(() => channel.getLinkSnapshot(false), 600_000);

    const abandoned = events.filter((e) => e.kind === "abandoned" && e.at === "onopen");
    expect(
      abandoned.length,
      "a socket was opened and thrown away with no lifecycle event — WP82's own rule",
    ).toBeGreaterThan(0);
    expect(abandoned[0]).toMatchObject({ link: "control", at: "onopen" });
    channel.destroy();
  });
});

// ===========================================================================
describe("TP02 — the MUX link: the same defect, one file over", () => {
  it("a silenced mux link REACHES `retryChainEnded` — the wait completes", () => {
    const events: LinkLifecycleEvent[] = [];
    const manager = new SyncManager(settings());
    manager.onLifecycle((e) => events.push(e));
    manager.connect();
    vi.advanceTimersByTime(10);
    expect(manager.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.OPEN);

    manager.breakLink("silence");
    expect(manager.getLinkSnapshot(false).readyState).toBe(LINK_READY_STATE.OPEN);

    const result = pollForCeiling(() => manager.getLinkSnapshot(false), 900_000);

    expect(
      result.reached,
      `the mux wait NEVER COMPLETED: after ${result.waitedMs} ms the chain still reports ` +
        `retryChainEnded=${result.snapshot.retryChainEnded} ` +
        `attempts=${result.snapshot.reconnectAttempts}`,
    ).toBe(true);
    expect(result.snapshot.reconnectAttempts).toBe(15);
    expect(events.find((e) => e.kind === "gave-up")).toMatchObject({ link: "mux", cause: "exhausted" });
    manager.destroy();
  });

  it("a silenced mux open does NOT tell the plugin the mux is up", () => {
    // The latch WP82 removed, rebuilt: `isConnected = true` and an
    // `onConnectionChange(true)` on a socket that carries no frame.
    const connections: boolean[] = [];
    const manager = new SyncManager(settings());
    manager.onConnectionChange((c) => connections.push(c));
    manager.connect();
    vi.advanceTimersByTime(10);
    manager.breakLink("silence");
    connections.length = 0;

    pollForCeiling(() => manager.getLinkSnapshot(false), 900_000);

    expect(
      connections.filter((c) => c),
      "a silenced mux reported itself CONNECTED while suppressing every frame",
    ).toEqual([]);
    manager.destroy();
  });
});

// ===========================================================================
// CONTROLS. Each of these passes on BOTH the unrepaired and the repaired tree.
// They are the reason the repair cannot be "end the chain on every open": a
// wait that always completes and a wait that never completes are the same
// defect wearing different clothes.
// ===========================================================================
describe("CONTROLS — the repair is not a blanket ending of retry chains", () => {
  it("CONTROL — an UNSILENCED link that keeps reconnecting NEVER ends its chain", () => {
    const channel = new ControlChannel(settings());
    channel.connect();
    vi.advanceTimersByTime(10);

    // No break at all. The relay accepts, the peer talks, nothing is wrong.
    const result = pollForCeiling(() => channel.getLinkSnapshot(true), 600_000);
    expect(
      result.reached,
      "a healthy link reached its retry ceiling — the repair ends chains it must not end",
    ).toBe(false);
    expect(channel.getLinkSnapshot(true).readyState).toBe(LINK_READY_STATE.OPEN);
    channel.destroy();
  });

  it("CONTROL — the `close` shape against an UNREACHABLE relay still reaches the ceiling", () => {
    const channel = new ControlChannel(settings());
    channel.connect();
    vi.advanceTimersByTime(10);
    MockWebSocket.relayAccepts = false;
    channel.breakLink("close");

    const result = pollForCeiling(() => channel.getLinkSnapshot(false), 600_000);
    expect(result.reached).toBe(true);
    expect(result.snapshot.silenced).toBe(false);
    channel.destroy();
  });

  it("CONTROL — `restoreLink()` after a silenced ceiling brings the link back", () => {
    // The anti-lobotomy row. A repair that merely made a silenced link
    // unrecoverable would pass every test above and destroy the instrument.
    const channel = new ControlChannel(settings());
    channel.connect();
    vi.advanceTimersByTime(10);
    channel.breakLink("silence");
    const reached = pollForCeiling(() => channel.getLinkSnapshot(false), 600_000);
    expect(reached.reached).toBe(true);

    const restored = channel.restoreLink();
    expect(restored.wasSilenced).toBe(true);
    expect(restored.wasChainEnded).toBe(true);
    vi.advanceTimersByTime(1_000);

    const after = channel.getLinkSnapshot(true);
    expect(after.silenced).toBe(false);
    expect(after.retryChainEnded).toBe(false);
    expect(
      after.readyState,
      "the link did not come back after `restore` — the instrument is now one-way",
    ).toBe(LINK_READY_STATE.OPEN);

    // And the proof the suppression really lifted: a send reaches the socket.
    const before = lastSocket().sent.length;
    channel.send({ type: "join-request", userId: "u1" } as never);
    expect(lastSocket().sent.length).toBe(before + 1);
    channel.destroy();
  });

  it("CONTROL — `restoreLink()` brings the MUX back too", () => {
    const manager = new SyncManager(settings());
    manager.connect();
    vi.advanceTimersByTime(10);
    manager.breakLink("silence");
    expect(pollForCeiling(() => manager.getLinkSnapshot(false), 900_000).reached).toBe(true);

    manager.restoreLink();
    vi.advanceTimersByTime(1_000);
    const after = manager.getLinkSnapshot(true);
    expect(after.silenced).toBe(false);
    expect(after.retryChainEnded).toBe(false);
    expect(after.readyState).toBe(LINK_READY_STATE.OPEN);
    manager.destroy();
  });
});

// ===========================================================================
// TP03 — the class, pinned STRUCTURALLY so a new handler cannot join it
// unnoticed. Derived from the source at test time, never from a memory of it.
// ===========================================================================
describe("TP03 — no socket handler winds the retry chain back while the link is silenced", () => {
  /** The lexical body of `<something>.onNAME = (…) => { … }`, by brace match. */
  function handlerBody(source: string, handler: string): string {
    const marker = new RegExp(`\\.${handler}\\s*=\\s*(\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>\\s*\\{`);
    const m = marker.exec(source);
    if (!m) return "";
    let i = source.indexOf("{", m.index + m[0].length - 1);
    let depth = 0;
    for (let j = i; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") {
        depth--;
        if (depth === 0) return source.slice(i, j + 1);
      }
    }
    return "";
  }

  const FILES = [
    ["control-ws.ts", new URL("../../../sync/control-ws.ts", import.meta.url)],
    ["sync.ts", new URL("../../../sync/sync.ts", import.meta.url)],
  ] as const;

  it("POSITIVE CONTROL — the slicer really extracts a handler body, and sees a KNOWN gate", () => {
    // Rule 15's cousin: a presence claim needs the same discipline as an
    // absence claim. `onmessage` has consulted `silenced` since WP82, so if the
    // slicer cannot see THAT, it cannot see anything and TP03 below is vacuous.
    for (const [name, url] of FILES) {
      const source = readFileSync(url, "utf8");
      const body = handlerBody(source, "onmessage");
      expect(body.length, `${name}: the slicer extracted no onmessage body`).toBeGreaterThan(40);
      expect(body, `${name}: the slicer cannot see a gate that is known to be there`).toContain(
        "silenced",
      );
    }
  });

  it("`onopen` consults `silenced` BEFORE it resets the chain, in both link classes", () => {
    for (const [name, url] of FILES) {
      const source = readFileSync(url, "utf8");
      const body = handlerBody(source, "onopen");
      expect(body.length, `${name}: no onopen body found`).toBeGreaterThan(40);

      const gate = body.indexOf("silenced");
      const reset = body.indexOf("retryChainEnded");
      expect(gate, `${name}: onopen does not consult \`silenced\` at all`).toBeGreaterThanOrEqual(0);
      expect(
        reset,
        `${name}: onopen no longer touches retryChainEnded — re-derive this pin`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        gate,
        `${name}: onopen winds the retry chain back BEFORE it asks whether the link is ` +
          "silenced — this is the shape that makes a ceiling unreachable and a criterion hang",
      ).toBeLessThan(reset);
    }
  });
});
