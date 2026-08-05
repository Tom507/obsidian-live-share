// ===========================================================================
// WP82 AC1 — the connected marking is a function of the LINK, not of the role
// the peer held when the link opened.
//
// FOUR ROLE PATHS, as four separate rows, at the `registerControlHandlers`
// seam with a fake channel. Row 1 is the live defect and is the ONLY row that
// discriminates against the unrepaired tree — the other three pass on a build
// whose latch is still broken, which is exactly why asserting only them would
// be vacuous.
//
// The pre-WP82 tree fails row 1 like this:
//   `join-response{isHost:true}` on a peer whose `settings.role === "guest"`
//   hits `control-handlers.ts:209`, calls `promoteToHost()` and `return`s —
//   before the `plugin.controlConnected = true` that used to sit at the BOTTOM
//   of the handler, past a `role !== "guest"` return. The peer's other chance,
//   `main.ts`'s socket-open callback, was gated on `role === "host"` and was
//   false at the time. Both sites are role-gated and mutually exclusive, so the
//   promoted peer is marked by neither, for the life of the session.
// ===========================================================================

import { describe, expect, it, vi } from "vitest";

// The handler's UI imports are stubbed LOCALLY rather than by widening the
// shared `__mocks__/obsidian.ts`: none of them is on any path this AC drives,
// and adding a class to a mock every other suite loads is a change with a much
// larger blast radius than the thing being tested.
vi.mock("../../ui/modals", () => ({
  ConfirmModal: class {
    open() {}
  },
  UserPickerModal: class {
    open() {}
  },
}));
vi.mock("../../ui/approval-modal", () => ({
  ApprovalModal: class {
    open() {}
  },
}));
vi.mock("../../ui/focus-notification", () => ({
  showFocusNotification: () => {},
}));

const { registerControlHandlers } = await import("../../sync/control-handlers");

type Handler = (msg: Record<string, unknown>) => void;

/** A fake control channel that records handler registrations and can deliver. */
function createFakeChannel() {
  const handlers = new Map<string, Handler[]>();
  return {
    handlers,
    on(type: string, handler: Handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    send: vi.fn(),
    deliver(type: string, msg: Record<string, unknown>) {
      for (const handler of handlers.get(type) ?? []) handler(msg);
    },
  };
}

interface FakePlugin {
  settings: Record<string, unknown>;
  controlChannel: ReturnType<typeof createFakeChannel>;
  controlConnected: boolean;
  updateOnlineState: () => void;
  promoteToHost: () => Promise<void>;
  demoteToGuest: () => Promise<void>;
  onlineStateUpdates: number;
  promotions: number;
  demotions: number;
  [key: string]: unknown;
}

function createFakePlugin(role: "host" | "guest"): FakePlugin {
  const channel = createFakeChannel();
  const plugin: FakePlugin = {
    settings: { role, permission: "read-write", approvalTimeoutSeconds: 60 },
    controlChannel: channel,
    controlConnected: false,
    onlineStateUpdates: 0,
    promotions: 0,
    demotions: 0,
    updateOnlineState() {
      plugin.onlineStateUpdates += 1;
    },
    async promoteToHost() {
      plugin.promotions += 1;
      plugin.settings.role = "host";
    },
    async demoteToGuest() {
      plugin.demotions += 1;
      plugin.settings.role = "guest";
    },
    // Everything below is inert scaffolding the handler may touch.
    fileOpsManager: { setSender: () => {} },
    manifestManager: { isSharedPath: () => false },
    remoteUsers: new Map(),
    presenceManager: { broadcastPresence: () => {}, handlePresenceUpdate: () => {} },
    explorerIndicators: { update: () => {} },
    logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    app: { vault: { getFiles: () => [], getAbstractFileByPath: () => null }, workspace: {} },
    backgroundSync: { startAll: async () => {} },
    syncManager: {},
    async saveSettings() {},
    async endSession() {},
    notify() {},
    updateStatusBar() {},
    onActiveFileChange() {},
    refreshPresenceView() {},
  };
  return plugin;
}

/**
 * Drive one full ordering and report what the peer ended up believing.
 * `socketOpenRole` is the role held when the control socket opened, which is
 * the fact the pre-WP82 gate in `main.ts` keyed on.
 */
function driveJoinResponse(opts: {
  resumeAs: "host" | "guest";
  isHost: boolean;
}): { plugin: FakePlugin; roleAfter: unknown } {
  const plugin = createFakePlugin(opts.resumeAs);
  registerControlHandlers(plugin as never);

  // --- socket open ---------------------------------------------------------
  // The pre-WP82 `main.ts` gate, reproduced faithfully: `if (role === "host")`.
  // WP82 removes that gate; this test does NOT model the repair, it models the
  // OLD behaviour so that the handler under test is the only thing that can
  // make row 1 green. That is what keeps the row honest.
  if (plugin.settings.role === "host") {
    plugin.controlConnected = true;
    plugin.updateOnlineState();
  }

  // --- join-response arrives ----------------------------------------------
  plugin.controlChannel.deliver("join-response", {
    type: "join-response",
    isHost: opts.isHost,
    approved: true,
  });

  return { plugin, roleAfter: plugin.settings.role };
}

describe("WP82 AC1 — the connected marking is a function of the link, not of the role", () => {
  it("ROW 1 (THE DEFECT): resume as guest → isHost:true → promoted, and the peer is STILL marked connected", () => {
    const { plugin, roleAfter } = driveJoinResponse({ resumeAs: "guest", isHost: true });

    // The promotion really happened — otherwise this row would go green for
    // the wrong reason (a `join-response` that did nothing at all).
    expect(plugin.promotions).toBe(1);
    expect(roleAfter).toBe("host");

    // THE ASSERTION. Red on the unrepaired tree.
    expect(plugin.controlConnected).toBe(true);
    expect(plugin.onlineStateUpdates).toBeGreaterThan(0);
  });

  it("ROW 2: resume as host → isHost:false → demoted, and the marking is not lost either", () => {
    const { plugin, roleAfter } = driveJoinResponse({ resumeAs: "host", isHost: false });

    expect(plugin.demotions).toBe(1);
    expect(roleAfter).toBe("guest");
    expect(plugin.controlConnected).toBe(true);
  });

  it("ROW 3: resume as guest → isHost:false, the ordinary guest join", () => {
    const { plugin, roleAfter } = driveJoinResponse({ resumeAs: "guest", isHost: false });

    expect(plugin.promotions).toBe(0);
    expect(plugin.demotions).toBe(0);
    expect(roleAfter).toBe("guest");
    expect(plugin.controlConnected).toBe(true);
  });

  it("ROW 4: resume as host → isHost:true, the ordinary host case", () => {
    const { plugin, roleAfter } = driveJoinResponse({ resumeAs: "host", isHost: true });

    expect(plugin.promotions).toBe(0);
    expect(plugin.demotions).toBe(0);
    expect(roleAfter).toBe("host");
    expect(plugin.controlConnected).toBe(true);
  });

  it("the marking is reached BEFORE either role branch returns — structurally", () => {
    // The discriminating structural fact: in the repaired tree the marking is
    // hoisted above the `promoteToHost` / `demoteToGuest` branches. Both rows 1
    // and 2 take an early `return`, so if the marking were still below them,
    // neither could be true. Asserted here as one statement so a future edit
    // that pushes it back down reddens one obviously-named row.
    const promoted = driveJoinResponse({ resumeAs: "guest", isHost: true });
    const demoted = driveJoinResponse({ resumeAs: "host", isHost: false });
    expect([promoted.plugin.controlConnected, demoted.plugin.controlConnected]).toEqual([
      true,
      true,
    ]);
  });
});
