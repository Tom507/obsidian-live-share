// WP68 / C68 AC4 — NO COLLATERAL.
//
// "Every rename with neither endpoint under the sidecar directory behaves
// exactly as it does today, outbound and inbound — including a `.canvas`, a deep
// path, the backslash spelling a Windows or remote caller produces, and the
// prefix-sharing near miss `.obsidian/liveshare/stateful/…`, which is NOT a
// sidecar path."
//
// This file is the guard's OTHER half. TP01–TP03 show it refuses; a guard that
// refuses too much passes all three of them and breaks the product. Every row
// here is a case the guard must let through, plus the bookkeeping rows that say
// a refusal leaves nothing stranded.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ───────────────────────────────────────────
// Widen either guard from `isSidecarPath` to a prefix test without the `/`
// boundary — the shape somebody reaches for when writing it by hand:
//     path.startsWith(".obsidian/liveshare/state")
// The near-miss rows redden immediately, in both directions, because
// `.obsidian/liveshare/stateful/board.canvas` shares that prefix.
// Widening it to `skipsAutoTextSync` (the predicate the charter rules out)
// reddens the `.canvas` rows instead. Both breaks verified; messages in the
// report's break table.
//
// ── THE BACKSLASH SPELLING CUTS BOTH WAYS ────────────────────────────────────
// A remote or Windows caller can spell either kind of path with `\`. So the
// backslash form of an ORDINARY path must still travel (rows below), and the
// backslash form of a SIDECAR path must still be refused — a guard that only
// recognised the `/` spelling would be bypassable by anyone who chose the other
// one, which on a security boundary is the same as no guard.

import { TFile } from "obsidian";
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

const { registerControlHandlers } = await import("../../../sync/control-handlers");
const { VAULT_EVENT_SETTLE_MS } = await import("../../../utils");
const { isSidecarPath } = await import("../../../files/canvas-sidecar");

const {
  DEEP_NOTE,
  NEAR_MISS,
  SHARED_CANVAS,
  SHARED_NOTE,
  SIDECAR_INDEX,
  createInboundRig,
  createOutboundRig,
} = await import("./harness");

const NEAR_MISS_SIBLING = NEAR_MISS.replace("board.canvas", "notes/other.md");
const SIDECAR_INDEX_BACKSLASH = SIDECAR_INDEX.replace(/\//g, "\\");
const DEEP_NOTE_BACKSLASH = DEEP_NOTE.replace(/\//g, "\\");

const DISK = {
  [SHARED_NOTE]: "note",
  [SHARED_CANVAS]: '{"nodes":[],"edges":[]}',
  [DEEP_NOTE]: "deep",
  [NEAR_MISS]: '{"nodes":[],"edges":[]}',
  [NEAR_MISS_SIBLING]: "near miss sibling",
  [SIDECAR_INDEX]: "{}",
};

describe("WP68 AC4 — the near miss is NOT a sidecar path, and the predicate says so", () => {
  it("`.obsidian/liveshare/stateful/…` shares the prefix and is still an ordinary path", () => {
    // The premise of every near-miss row below, measured on the real predicate
    // rather than assumed. A hand-written `startsWith` without the `/` boundary
    // answers `true` here, and this row is what catches it.
    expect(isSidecarPath(NEAR_MISS)).toBe(false);
    expect(isSidecarPath(NEAR_MISS_SIBLING)).toBe(false);
    // POSITIVE CONTROL: the predicate is a filter, not a wall — it does say
    // `true` to something.
    expect(isSidecarPath(SIDECAR_INDEX)).toBe(true);
    expect(isSidecarPath(SIDECAR_INDEX_BACKSLASH)).toBe(true);
  });
});

describe("WP68 AC4 — OUTBOUND: every non-sidecar rename emits exactly what it emitted before", () => {
  let rig: ReturnType<typeof createOutboundRig>;

  beforeEach(() => {
    rig = createOutboundRig(DISK);
  });

  const admitted: Array<[string, string, string, string, string]> = [
    ["an ordinary note", SHARED_NOTE, DEEP_NOTE, SHARED_NOTE, DEEP_NOTE],
    [
      "a shared .canvas",
      SHARED_CANVAS,
      "_liveshare-test/renamed.canvas",
      SHARED_CANVAS,
      "_liveshare-test/renamed.canvas",
    ],
    [
      "a deep path",
      DEEP_NOTE,
      "_liveshare-test/a/b/c/d/e/f/deeper.md",
      DEEP_NOTE,
      "_liveshare-test/a/b/c/d/e/f/deeper.md",
    ],
    [
      "the near miss (a .canvas under `…/stateful/`)",
      NEAR_MISS,
      `${NEAR_MISS}.bak`,
      NEAR_MISS,
      `${NEAR_MISS}.bak`,
    ],
    ["the near miss, the other way", `${NEAR_MISS}.bak`, NEAR_MISS, `${NEAR_MISS}.bak`, NEAR_MISS],
    [
      "a near-miss sibling deeper in",
      NEAR_MISS_SIBLING,
      SHARED_NOTE,
      NEAR_MISS_SIBLING,
      SHARED_NOTE,
    ],
    // The backslash spelling is normalised to `/` on the wire exactly as it was
    // before this WP — the emitted op is the same op, not a refusal.
    ["the backslash spelling", DEEP_NOTE_BACKSLASH, SHARED_NOTE, DEEP_NOTE, SHARED_NOTE],
  ];

  for (const [label, oldPath, newPath, wireOld, wireNew] of admitted) {
    it(`ADMITTED (${label}) — the op reaches the wire unchanged`, async () => {
      rig.rename(oldPath, newPath);
      await Promise.resolve();
      await Promise.resolve();

      expect(rig.sent).toEqual([{ type: "rename", oldPath: wireOld, newPath: wireNew }]);
      expect(rig.manager.getSidecarRenameRefusals()).toBe(0);
    });
  }

  it("REFUSED — the BACKSLASH spelling of a sidecar path is not a way past the guard", async () => {
    rig.rename(SHARED_NOTE, SIDECAR_INDEX_BACKSLASH);
    rig.rename(SIDECAR_INDEX_BACKSLASH, SHARED_NOTE);
    await Promise.resolve();
    await Promise.resolve();

    expect(rig.sent).toEqual([]);
    expect(rig.manager.getSidecarRenameRefusals()).toBe(2);
  });

  it("BOOKKEEPING — a refusal strands no mute, and the ordinary path still muted/unmutes", async () => {
    // A stranded mute count is a SILENT FREEZE of that path: every later vault
    // event for it is dropped and nothing says so. `onFileRename` takes no mute
    // at all, so the refusal cannot strand one — asserted rather than argued.
    rig.rename(SHARED_NOTE, SIDECAR_INDEX);
    await Promise.resolve();
    expect(rig.manager.isPathMuted(SHARED_NOTE)).toBe(false);
    expect(rig.manager.isPathMuted(SIDECAR_INDEX)).toBe(false);

    // POSITIVE CONTROL: `isPathMuted` is capable of answering `true`, so the two
    // rows above are not satisfied by a predicate that always says `false`.
    rig.manager.mutePathEvents(SHARED_NOTE);
    expect(rig.manager.isPathMuted(SHARED_NOTE)).toBe(true);
    rig.manager.unmutePathEvents(SHARED_NOTE);
    expect(rig.manager.isPathMuted(SHARED_NOTE)).toBe(false);
  });

  it("BOOKKEEPING — a refusal does not wedge the send queue for the paths it touched", async () => {
    // The refusal returns BEFORE `sendQueues.set`, so no pending task is left
    // for either endpoint. If one were, the next rename of the same path would
    // chain behind a promise nothing resolves and never emit.
    rig.rename(SHARED_NOTE, SIDECAR_INDEX);
    await Promise.resolve();
    expect(rig.sent).toEqual([]);

    rig.rename(SHARED_NOTE, DEEP_NOTE);
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.sent, "the send queue for the refused path was left holding a task").toEqual([
      { type: "rename", oldPath: SHARED_NOTE, newPath: DEEP_NOTE },
    ]);
  });

  it("EVERY OTHER OP TYPE IS UNTOUCHED — a create/delete of a sidecar path is not this WP's business", async () => {
    // Out of scope by the charter, and it must STAY out of scope: this row
    // records what the WP did NOT change, in both directions.
    //
    // `onFileCreate` refuses the CONTENT push for a sidecar path through
    // `skipsAutoTextSync` (WP83 / WP26), not through this guard, so nothing
    // reaches the wire and the WP68 counter must not move.
    const created = new TFile();
    created.path = SIDECAR_INDEX;
    await rig.manager.onFileCreate(created);
    expect(rig.sent, "the content push for a sidecar path is WP83's refusal, not this one").toEqual(
      [],
    );
    expect(rig.manager.getSidecarRenameRefusals()).toBe(0);

    // `onFileDelete` has NO path-class guard and still has none — it is a
    // different op type and explicitly out of scope. Pinned so that "WP68
    // widened its guard to the whole manager" would redden here.
    rig.manager.onFileDelete({ path: SIDECAR_INDEX } as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      rig.sent,
      "a delete op changed shape — WP68 touches no op type other than `rename`",
    ).toEqual([{ type: "delete", path: SIDECAR_INDEX }]);
    expect(rig.manager.getSidecarRenameRefusals()).toBe(0);
  });
});

describe("WP68 AC4 — INBOUND: every non-sidecar rename is still admitted and still applied", () => {
  let rig: ReturnType<typeof createInboundRig>;

  beforeEach(() => {
    rig = createInboundRig(registerControlHandlers, DISK);
  });

  const admitted: Array<[string, string, string]> = [
    ["an ordinary note", SHARED_NOTE, "_liveshare-test/renamed.md"],
    ["a shared .canvas", SHARED_CANVAS, "_liveshare-test/renamed.canvas"],
    ["a deep path", DEEP_NOTE, "_liveshare-test/a/b/c/d/e/f/deeper.md"],
    ["the near miss (a .canvas under `…/stateful/`)", NEAR_MISS, `${NEAR_MISS}.bak`],
    ["a near-miss sibling deeper in", NEAR_MISS_SIBLING, "_liveshare-test/recovered.md"],
    ["the backslash spelling", DEEP_NOTE_BACKSLASH, "_liveshare-test/from-backslash.md"],
  ];

  for (const [label, oldPath, newPath] of admitted) {
    it(`ADMITTED (${label}) — reaches applyRemoteOp AND actually moves the bytes`, async () => {
      await rig.deliver({ type: "rename", oldPath, newPath });

      expect(rig.admitted, `${oldPath} -> ${newPath} was refused`).toHaveLength(1);
      expect(rig.vault.bytes.has(newPath), "the destination has no bytes — nothing moved").toBe(
        true,
      );
      expect(rig.vault.journal.some((entry) => entry.startsWith("rename "))).toBe(true);
    });
  }

  it("REFUSED — the BACKSLASH spelling of a sidecar path is not a way past the inbound gate", async () => {
    await rig.deliver({
      type: "rename",
      oldPath: SHARED_NOTE,
      newPath: SIDECAR_INDEX_BACKSLASH,
    });
    expect(rig.admitted).toEqual([]);
    expect(rig.vault.journal).toEqual([]);

    await rig.deliver({
      type: "rename",
      oldPath: SIDECAR_INDEX_BACKSLASH,
      newPath: SHARED_NOTE,
    });
    expect(rig.admitted).toEqual([]);
    expect(rig.vault.journal).toEqual([]);
  });

  it("BOOKKEEPING — an ADMITTED rename still mutes and still unmutes both endpoints", async () => {
    // The mute lifecycle for the path that IS applied is unchanged. Asserted
    // with fake timers so the release is observed rather than waited for: the
    // unmute is scheduled in `applyRemoteOpInner`'s `finally`, one
    // `VAULT_EVENT_SETTLE_MS` out.
    vi.useFakeTimers();
    try {
      const local = createInboundRig(registerControlHandlers, DISK);
      await local.deliver({ type: "rename", oldPath: SHARED_NOTE, newPath: DEEP_NOTE });

      expect(local.manager.isPathMuted(SHARED_NOTE), "the apply took no mute at all").toBe(true);
      expect(local.manager.isPathMuted(DEEP_NOTE)).toBe(true);

      vi.advanceTimersByTime(VAULT_EVENT_SETTLE_MS + 1);

      expect(local.manager.isPathMuted(SHARED_NOTE), "the mute was stranded").toBe(false);
      expect(local.manager.isPathMuted(DEEP_NOTE), "the mute was stranded").toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("BOOKKEEPING — a REFUSED rename takes no mute, so none can be stranded", async () => {
    await rig.deliver({ type: "rename", oldPath: SHARED_NOTE, newPath: SIDECAR_INDEX });

    expect(rig.manager.isPathMuted(SHARED_NOTE)).toBe(false);
    expect(rig.manager.isPathMuted(SIDECAR_INDEX)).toBe(false);
    // And the path is not frozen: the very next op for it still applies.
    await rig.deliver({ type: "rename", oldPath: SHARED_NOTE, newPath: "_liveshare-test/ok.md" });
    expect(rig.vault.bytes.has("_liveshare-test/ok.md")).toBe(true);
  });

  it("EVERY OTHER OP TYPE STILL USES THE STRICT ALL-PATHS GATE — unchanged by this WP", async () => {
    // A `create` for a sidecar path was already refused before WP68, by the
    // `paths.some(path => !isSharedPath(path))` form the other branches use. It
    // must still be refused, and still by THAT gate — recorded here so a later
    // edit that moves the rename guard up out of its branch, and thereby changes
    // the other branches, reddens something.
    await rig.deliver({ type: "create", path: SIDECAR_INDEX, content: "x" });
    expect(rig.admitted).toEqual([]);

    await rig.deliver({ type: "create", path: "_liveshare-test/fresh.md", content: "x" });
    expect(rig.admitted, "the create branch stopped admitting an ordinary path").toHaveLength(1);
    expect(rig.vault.bytes.has("_liveshare-test/fresh.md")).toBe(true);
  });
});
