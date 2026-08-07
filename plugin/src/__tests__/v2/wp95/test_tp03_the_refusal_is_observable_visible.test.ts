// WP95 TP03 — AC5, and the reader carried in from B56/W4.
//
// AN OBSERVABLE A LIVE VALIDATOR CANNOT READ IS NOT AN OBSERVABLE. That is the
// finding this file closes, and it is not hypothetical: `getMuteReleaseStats()`
// has existed since WP93 and NO e2e command reached it, so WP93 AC4's counter
// had no live reader and its `MUTE OVERRUN:` line only appeared when an overrun
// actually happened. A validator could not tell "no overruns" from "no
// instrument". Both counters get a command here, and both commands are asserted
// to FORWARD the product's answer rather than to compute one.
//
// The refusal counter is asserted as STATE, not as a log line — the precedent is
// `refusedSidecarRenames` / `refusedWhileSealed` in `file-ops.ts`: a test can be
// an oracle over state, and a log line is a string somebody may reword.
//
// NOTHING HERE NAMES A PATH. The counter's breakdowns are by ARM and by
// protected ROOT, both of which are classes; the assertions below check that the
// ledger does NOT carry a path, which is a criterion and not tidiness.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ui/modals", () => ({
  ConfirmModal: class {
    open() {}
  },
  UserPickerModal: class {
    open() {}
  },
}));
vi.mock("../../../ui/approval-modal", () => ({
  ApprovalModal: class {
    open() {}
  },
}));
vi.mock("../../../ui/focus-notification", () => ({
  showFocusNotification: () => {},
}));

import {
  getProtectedPathRefusals,
  resetProtectedPathRefusals,
} from "../../../files/protected-paths";
import { routeCommand } from "../../../testing/e2e-control";

const { registerControlHandlers } = await import("../../../sync/control-handlers");
const { PLUGIN_DATA, SHARED_NOTE, createInboundRig } = await import("./harness");

beforeEach(() => {
  resetProtectedPathRefusals();
});

describe("WP95 AC5 — the refusal is counted, classed and named", () => {
  it("a refused peer op increments the ledger; an admitted one does not", async () => {
    expect(getProtectedPathRefusals().total).toBe(0);

    const rig = createInboundRig(registerControlHandlers, {
      [PLUGIN_DATA]: "x",
      [SHARED_NOTE]: "y",
    });

    // POSITIVE CONTROL FIRST, so a counter that increments on everything is
    // caught before the refusal is even attempted.
    await rig.deliver({ type: "modify", path: SHARED_NOTE, content: "changed" });
    expect(getProtectedPathRefusals().total).toBe(0);

    await rig.deliver({ type: "modify", path: PLUGIN_DATA, content: "overwritten" });
    const after = getProtectedPathRefusals();
    expect(after.total).toBe(1);
    expect(after.byArm["file-op-gate"]).toBe(1);
    expect(after.byRoot[".obsidian"]).toBe(1);
  });

  it("the ledger carries an ARM and a ROOT, and no path anywhere in it", async () => {
    const rig = createInboundRig(registerControlHandlers, { [PLUGIN_DATA]: "x" });
    await rig.deliver({ type: "delete", path: PLUGIN_DATA });

    const serialised = JSON.stringify(getProtectedPathRefusals());
    // The root is a class and may appear. The filename is the user's file and
    // may not — `data.json` in a real vault is where their credentials live.
    expect(serialised).toContain(".obsidian");
    expect(serialised).not.toContain("data.json");
    expect(serialised).not.toContain("plugins/live-share");
  });

  it("the log line is emitted once per refusal and names no path either", async () => {
    const rig = createInboundRig(registerControlHandlers, { [PLUGIN_DATA]: "x" });
    await rig.deliver({ type: "create", path: PLUGIN_DATA, content: "z" });

    const joined = rig.warnings.join("\n");
    expect(joined).toContain("PROTECTED PATH REFUSED");
    expect(joined).toContain("arm=file-op-gate");
    expect(joined).toContain("root=.obsidian/**");
    expect(joined).not.toContain("data.json");
  });
});

describe("WP93 AC4 / WP95 AC5 — both counters have a live reader", () => {
  /** A minimal e2e host exposing only the two methods under test. */
  function hostWith(stats: unknown, refusals: unknown) {
    return {
      sessionInfo: () => ({}),
      canvasOpen: async () => ({}),
      canvasState: () => ({}),
      bindingCounters: () => ({}),
      simulateEdit: async () => ({}),
      muteReleaseStats: () => stats,
      protectedPathRefusals: () => refusals,
    } as never;
  }

  it("`fileop.muteStats` forwards the manager's own answer verbatim", async () => {
    // WP93's shape, and the command returns THE OBJECT it was given — it does
    // not rebuild, filter or recompute it. A rig that recomputed the statistic
    // would be an oracle over itself.
    const stats = {
      releasedByEvent: 7,
      releasedByCeiling: 2,
      overruns: 1,
      worstOverrunMs: 59_750,
      overrunsByClass: { canvas: 1 },
      pending: 0,
    };
    const res = await routeCommand(hostWith(stats, {}), { cmd: "fileop.muteStats" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, result: stats });
  });

  it("`fileop.protectedRefusals` forwards the ledger verbatim", async () => {
    const refusals = { total: 3, byArm: { "file-op-gate": 3 }, byRoot: { ".obsidian": 3 } };
    const res = await routeCommand(hostWith({}, refusals), { cmd: "fileop.protectedRefusals" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, result: refusals });
  });

  it("a host WITHOUT the readers is refused by name, not silently answered", async () => {
    // The failure mode this AC exists to forbid is a command that answers `{}`
    // on an instance that has no instrument, which reads to a validator exactly
    // like "zero refusals".
    const bare = {
      sessionInfo: () => ({}),
      canvasOpen: async () => ({}),
      canvasState: () => ({}),
      bindingCounters: () => ({}),
      simulateEdit: async () => ({}),
    } as never;
    for (const cmd of ["fileop.muteStats", "fileop.protectedRefusals"]) {
      const res = await routeCommand(bare, { cmd });
      expect(res.status).not.toBe(200);
      expect(JSON.stringify(res.body)).toContain(cmd);
    }
  });
});
