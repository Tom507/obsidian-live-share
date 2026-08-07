// ===========================================================================
// WP88 AC3 — every route in the census ends the RETRY, not the SESSION.
//
// Headless, fake timers, injected sockets, SYNTHETIC SENTINELS. No `data.json`
// is opened. These are exactly the states a live instance must not be abused to
// produce: ten consecutive exhausted retries on a real vault would, on the
// unrepaired build, have logged that vault out permanently and — on a host —
// deleted the room for the other peer. That is why AC2/AC3 carry every RED row
// headless and AC4's live row runs on the repaired build only.
//
// ## How this file and the census compose into one argument
//
// The census (AC1) proves, from the parsed tree, that each of E1–E5 calls
// `haltSharing` and reaches nothing destructive. This file proves, by driving
// the REAL `ControlChannel` retry chain and the REAL `SessionManager` through
// the REAL `LiveSharePlugin.handleControlState` / `handleMuxExhausted` /
// `resumeSession`, that `haltSharing` retains all six keys, persists nothing,
// reports the definer's `"gave-up"`, announces once, and can be re-armed.
// Neither half alone is sufficient; together they are the criterion.
// ===========================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notices: string[] = [];

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../__mocks__/obsidian");
  // The shared `__mocks__/obsidian.ts` declares only what the modules already
  // under test need, and `main.ts`'s import graph reaches further than any
  // existing suite did — which is itself a measurement: BEFORE THIS WP NOTHING
  // IMPORTED `main.ts` IN A UNIT TEST AT ALL. The gaps are filled HERE rather
  // than in the shared mock, so no other suite's surface moves.
  class Stub {
    // biome-ignore lint/suspicious/noExplicitAny: an inert stand-in.
    constructor(..._args: any[]) {}
    open() {}
    close() {}
    onOpen() {}
    onClose() {}
    addItem() {
      return this;
    }
    addSeparator() {
      return this;
    }
    showAtMouseEvent() {}
    setIcon() {
      return this;
    }
    setTooltip() {
      return this;
    }
    onClick() {
      return this;
    }
  }
  return {
    FuzzySuggestModal: Stub,
    Menu: Stub,
    ExtraButtonComponent: Stub,
    SettingGroup: Stub,
    WorkspaceLeaf: Stub,
    setIcon: () => {},
    ...actual,
    Notice: class {
      constructor(message?: string) {
        notices.push(String(message ?? ""));
      }
    },
    requestUrl: async () => {
      // If any route below reaches this, a connectivity failure has contacted
      // the relay — which is the host arm's `DELETE /rooms/{roomId}` and is the
      // single worst outcome this WP exists to prevent. Every assertion about
      // it is therefore about this array staying EMPTY, paired with AC5's row
      // where it must not be.
      relayCalls.push("called");
      return { status: 200, json: {}, text: "" };
    },
  };
});

const relayCalls: string[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static instances: MockWebSocket[] = [];
  static throwOnNext: Error | null = null;

  readonly url: string;
  constructor(url: string) {
    this.url = url;
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
    if (this.readyState === MockWebSocket.CLOSED) return;
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
(WebSocketFactory as unknown as Record<string, number>).OPEN = 1;
(WebSocketFactory as unknown as Record<string, number>).CLOSED = 3;
(WebSocketFactory as unknown as Record<string, number>).CONNECTING = 0;
(WebSocketFactory as unknown as Record<string, number>).CLOSING = 2;
vi.stubGlobal("WebSocket", WebSocketFactory);

const LiveSharePlugin = (await import("../../main")).default;
const { SessionManager } = await import("../../session/session");
const { FileOpsManager } = await import("../../files/file-ops");
const { SyncManager } = await import("../../sync/sync");
const { ControlChannel } = await import("../../sync/control-ws");
const { ConnectionStateManager } = await import("../../sync/connection-state");

/** Synthetic sentinels. Invented here; they exist nowhere else in the world. */
const SENTINEL = {
  roomId: "SENTINEL-ROOM-A1",
  token: "SENTINEL-TOKEN-B2",
  encryptionPassphrase: "SENTINEL-PASSPHRASE-C3",
  encryptionSalt: "SENTINEL-SALT-D4",
  role: "guest",
  permission: "read-only",
};

const SIX_KEYS = [
  "roomId",
  "token",
  "encryptionPassphrase",
  "encryptionSalt",
  "role",
  "permission",
] as const;

interface Harness {
  plugin: InstanceType<typeof LiveSharePlugin>;
  settings: Record<string, unknown>;
  saves: () => number;
  channel: InstanceType<typeof ControlChannel>;
  destroy: () => void;
}

function harness(role = "guest"): Harness {
  const settings: Record<string, unknown> = {
    ...SENTINEL,
    role,
    serverUrl: "http://sentinel.invalid",
    serverPassword: "",
    jwt: "",
    clientId: "sentinel-client",
    githubUserId: "",
    displayName: "S",
    avatarUrl: "",
    sharedFolder: "_liveshare-test",
    excludePatterns: [],
    debugLogging: false,
    notificationsEnabled: true,
  };
  let saveCount = 0;

  // biome-ignore lint/suspicious/noExplicitAny: the real class, minimally wired.
  const plugin = new (LiveSharePlugin as any)() as InstanceType<typeof LiveSharePlugin>;
  const p = plugin as unknown as Record<string, unknown>;
  p.settings = settings;
  p.saveSettings = async () => {
    saveCount += 1;
  };
  p.sessionManager = new SessionManager(plugin);
  p.fileOpsManager = new FileOpsManager({} as never, {} as never);
  p.syncManager = new SyncManager(settings as never);
  p.connectionState = new ConnectionStateManager();
  p.statusBarEl = { setText: () => {} };
  p.backgroundSync = {
    isRunning: () => false,
    setCollabBoundFile: () => {},
    destroy: () => {},
  };
  // Enough of a workspace/manifest surface for `cleanupSession` to RUN TO
  // COMPLETION. On the repaired tree no route below reaches it; the stubs exist
  // so that on a PARKED PRE-WP88 BASELINE the destruction completes and can be
  // MEASURED, instead of crashing halfway and reporting a missing property. A
  // RED row that dies on the harness proves nothing about the defect.
  p.app = {
    workspace: {
      getActiveViewOfType: () => null,
      getLeavesOfType: () => [],
    },
  };
  p.collabManager = { deactivateAll: () => {} };
  p.manifestManager = { destroy: () => {} };
  p.logger = {
    log: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  const channel = new ControlChannel(settings as never);
  p.controlChannel = channel;
  // The production wiring, verbatim — the same two lines `connectSync` uses.
  //
  // Guarded so this file can ALSO be run against a parked pre-WP88 baseline in
  // a detached worktree, where the four control transitions are an inline
  // closure inside `connectSync` and there is no named method to wire. That is
  // not a convenience: without the guard the harness throws at construction and
  // every RED row reports "not a function" instead of reporting the
  // destruction, which would be a measurement of the test's own shape.
  if (typeof (p.handleControlState as unknown) === "function") {
    channel.onStateChange((state) => plugin.handleControlState(state));
  }
  channel.onLifecycle((event) => (p.onLinkLifecycle as (e: unknown) => void).call(plugin, event));

  return {
    plugin,
    settings,
    saves: () => saveCount,
    channel,
    destroy: () => {
      (p.fileOpsManager as { destroy(): void }).destroy();
      channel.destroy();
      (p.syncManager as { destroy(): void }).destroy();
    },
  };
}

/** Every one of the six keys still holds its sentinel, byte for byte. */
function expectIdentityRetained(settings: Record<string, unknown>) {
  for (const key of SIX_KEYS) {
    expect(settings[key], `settings.${key} must be byte-unchanged`).toBe(
      (SENTINEL as Record<string, unknown>)[key],
    );
  }
}

/**
 * Drive the REAL control retry chain to its REAL ceiling: 10 attempts,
 * `min(300 * 2**n, 30_000)`. No wall-clock sleep — fake timers only, and the
 * ceiling is reached by the channel's own counter, never by elapsed time.
 */
function controlSockets(): MockWebSocket[] {
  // A link is identified by NAME. `/control/` is the ROUTE segment, not a
  // credential: the token, jwt and password ride in the query string and are
  // never read, matched, logged or asserted on anywhere in this file.
  return MockWebSocket.instances.filter((ws) => ws.url.includes("/control/"));
}

function latestControlSocket(): MockWebSocket | undefined {
  const all = controlSockets();
  return all[all.length - 1];
}

function driveControlToCeiling() {
  for (let attempt = 0; attempt < 12; attempt++) {
    vi.advanceTimersByTime(30_000);
    const live = latestControlSocket();
    if (live && live.readyState !== MockWebSocket.CLOSED) live.close();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  notices.length = 0;
  relayCalls.length = 0;
  MockWebSocket.instances.length = 0;
  MockWebSocket.throwOnNext = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WP88 AC3 — the ceiling ends the retry, not the session", () => {
  it("E1 — control retry EXHAUSTED after connecting: six keys retained, nothing persisted", () => {
    const h = harness("guest");
    try {
      h.channel.connect();
      MockWebSocket.instances[0].simulateOpen(); // everConnected = true ⇒ E1, not E2
      MockWebSocket.instances[0].close();
      driveControlToCeiling();

      const report = h.plugin.linkReport();
      const links = report.links as Record<string, Record<string, unknown>>;
      // The ceiling is evidenced by the peer's OWN counter, never by a clock.
      expect(links.control.retryChainEnded).toBe(true);
      expect(links.control.reconnectAttempts).toBe(10);
      expect(links.control.maxReconnectAttempts).toBe(10);

      // THE CRITERION.
      expectIdentityRetained(h.settings);
      expect(h.saves()).toBe(0);
      expect(relayCalls).toEqual([]); // no `DELETE /rooms/{roomId}`, on any role

      // The definer's existing state, not a new one.
      expect(report.state).toBe("gave-up");
      expect(report.sessionActive).toBe(true);
      expect(report.sharing).toBe(false);
      expect(report.roleBacked).toBe(false);
      expect(links.mux.retryChainEnded).toBe(false); // the OTHER link is unaffected

      const severance = report.severance as Record<string, unknown>;
      expect(severance.halted).toBe(true);
      expect(severance.cause).toBe("retry-exhausted");
      expect(severance.sessionIdentityRetained).toEqual({
        roomIdPresent: true,
        tokenPresent: true,
        encryptionPassphrasePresent: true,
        encryptionSaltPresent: true,
        rolePresent: true,
        permissionPresent: true,
      });
    } finally {
      h.destroy();
    }
  });

  it("E1 — the announcement fires ONCE and the second occurrence is COUNTED", () => {
    const h = harness("guest");
    try {
      h.channel.connect();
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].close();
      driveControlToCeiling();

      const halted = notices.filter((n) => n.includes("Verbindung verloren"));
      expect(halted).toHaveLength(1);

      // Drive the SAME transition again: no second toast, and — the paired
      // positive assertion, without which this passes on a build that announces
      // nothing at all — the announcement state advanced its count.
      h.plugin.handleControlState("disconnected");
      h.plugin.handleControlState("disconnected");
      expect(notices.filter((n) => n.includes("Verbindung verloren"))).toHaveLength(1);
      const state = (h.plugin as unknown as Record<string, { key: string | null; count: number }>)
        .severanceAnnouncement;
      expect(state.key).toBe("halted:retry-exhausted:control");
      expect(state.count).toBe(3);
    } finally {
      h.destroy();
    }
  });

  it("E2 — FIRST-CONNECT outage (S39): six keys retained, and it is NOT called an auth failure", () => {
    const h = harness("guest");
    try {
      h.channel.connect();
      // Never opened ⇒ `everConnected === false` ⇒ the `auth-required` selector.
      MockWebSocket.instances[0].close();
      driveControlToCeiling();

      const report = h.plugin.linkReport();
      const links = report.links as Record<string, Record<string, unknown>>;
      expect(links.control.retryChainEnded).toBe(true);
      expectIdentityRetained(h.settings);
      expect(h.saves()).toBe(0);
      expect(relayCalls).toEqual([]);
      expect((report.severance as Record<string, unknown>).cause).toBe("never-established");

      // S39's MISLABELLING half. The old string told the user to fix
      // credentials that were never rejected, for a session that had not ended.
      expect(notices.join("\n")).not.toContain("authentication required");
      expect(notices.join("\n")).not.toContain("sign in via settings");
      // Paired positive assertion: it says something honest instead.
      expect(notices.join("\n")).toContain("Relay");
      expect(notices.join("\n")).toContain("Sitzung bleibt bestehen");
    } finally {
      h.destroy();
    }
  });

  it("E3 — a socket-construction THROW inside a reconnect timer retains the six keys", () => {
    const h = harness("guest");
    try {
      h.channel.connect();
      MockWebSocket.instances[0].close();
      MockWebSocket.throwOnNext = new TypeError("SENTINEL construction failure");
      vi.advanceTimersByTime(30_000);

      const report = h.plugin.linkReport();
      const links = report.links as Record<string, Record<string, unknown>>;
      expect(links.control.retryChainEnded).toBe(true);
      // Reached with ONE attempt, not ten — this route has no ceiling of its own.
      expect(links.control.reconnectAttempts).toBeLessThan(10);
      expectIdentityRetained(h.settings);
      expect(h.saves()).toBe(0);
      expect(relayCalls).toEqual([]);
    } finally {
      h.destroy();
    }
  });

  it("E4 — the mux ceiling retains the six keys (the real handler, invoked)", () => {
    const h = harness("host"); // HOST: the arm that would have DELETEd the room
    try {
      h.plugin.handleMuxExhausted();
      expect(h.settings.roomId).toBe(SENTINEL.roomId);
      expect(h.settings.token).toBe(SENTINEL.token);
      expect(h.settings.role).toBe("host");
      expect(h.settings.encryptionPassphrase).toBe(SENTINEL.encryptionPassphrase);
      expect(h.settings.encryptionSalt).toBe(SENTINEL.encryptionSalt);
      expect(h.settings.permission).toBe(SENTINEL.permission);
      expect(h.saves()).toBe(0);
      // The row that matters most in the whole WP: a host's mux ceiling used to
      // issue `DELETE /rooms/{roomId}`, destroying the room for every peer.
      expect(relayCalls).toEqual([]);
    } finally {
      h.destroy();
    }
  });

  it("E5 — the plugin-load resume THROWS: six keys retained, room untouched", async () => {
    const h = harness("host");
    try {
      const p = h.plugin as unknown as Record<string, unknown>;
      p.connectSync = async () => {
        throw new Error("SENTINEL resume failure");
      };
      await (p.resumeSession as () => Promise<void>).call(h.plugin);

      expect(h.settings.roomId).toBe(SENTINEL.roomId);
      expect(h.settings.token).toBe(SENTINEL.token);
      expect(h.settings.role).toBe("host");
      expect(h.saves()).toBe(0);
      expect(relayCalls).toEqual([]);
      const severance = h.plugin.severanceReport();
      expect(severance.cause).toBe("resume-failed");
      expect(notices.join("\n")).toContain("Sitzungsdaten bleiben erhalten");
    } finally {
      h.destroy();
    }
  });

  it("the re-arm is USER-REACHABLE, reconnects, and does NOT reset `everConnected`", async () => {
    const h = harness("guest");
    try {
      h.channel.connect();
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].close();
      driveControlToCeiling();
      const ended = h.plugin.linkReport().links as Record<string, Record<string, unknown>>;
      expect(ended.control.retryChainEnded).toBe(true); // no vacuous re-arm

      const before = controlSockets().length;
      const result = await h.plugin.rearmSharing();
      expect(result.rearmed).toBe(true);
      expect((result.control as Record<string, unknown>).wasChainEnded).toBe(true);
      expect((result.control as Record<string, unknown>).reconnectStarted).toBe(true);
      expect(controlSockets().length).toBe(before + 1); // a NEW control socket
      // The mux is re-armed by the same call — one affordance, both links.
      expect((result.mux as Record<string, unknown>).wasChainEnded).toBe(true);

      (latestControlSocket() as MockWebSocket).simulateOpen();
      const after = h.plugin.linkReport().links as Record<string, Record<string, unknown>>;
      expect(after.control.retryChainEnded).toBe(false);
      expect(after.control.up).toBe(true);
      expect((h.plugin.severanceReport() as Record<string, unknown>).halted).toBe(false);
      expectIdentityRetained(h.settings);

      // S39 — `everConnected` was NOT reset, so the NEXT outage on this link
      // reports `disconnected` (a real drop) and not `auth-required` (a claim
      // about credentials). Driven, not asserted from the field's name.
      notices.length = 0;
      (latestControlSocket() as MockWebSocket).close();
      driveControlToCeiling();
      expect(notices.join("\n")).toContain("Verbindung verloren");
      expect(notices.join("\n")).not.toContain("Relay konnte nicht hergestellt");
    } finally {
      h.destroy();
    }
  });

  it("the state is the DEFINER's — there is exactly one `SharingState` union and no rival flag", async () => {
    // Third vacuity risk AC3 names by hand: a sixth sharing state, or a
    // parallel `severed` boolean beside `"gave-up"`, would satisfy every value
    // assertion above while breaking rule 10. Asserted structurally.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "..", "sync", "link-state.ts"), "utf8");
    const unions = [...src.matchAll(/export type SharingState\s*=/g)];
    expect(unions).toHaveLength(1);
    expect(src).toContain(
      'export type SharingState = "no-session" | "connecting" | "retrying" | "gave-up" | "connected"',
    );
    // And no second predicate for "has this peer given up" anywhere in `main.ts`.
    const mainSrc = readFileSync(join(here, "..", "..", "main.ts"), "utf8");
    const { stripComments } = await import("./route-census");
    expect(stripComments(mainSrc)).not.toMatch(/\bsevered\s*[:=]/);
  });
});
