// WP68 / C68 AC2 — THE RECEIVER REFUSES INDEPENDENTLY OF THE SENDER.
//
// Asserted with NO SENDER-SIDE GUARD IN THE PICTURE, exactly as the charter
// requires: every op below is HAND-BUILT and handed straight to the inbound
// `file-op` handler. `FileOpsManager.onFileRename` — the outbound guard TP01
// covers — is never called by this file, so nothing here can be green because of
// it. A peer on an older or hostile build is precisely the case the receiver has
// to survive, and that peer's ops do not pass through this process's emitter.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ───────────────────────────────────────────
// Delete the `if (paths.some((path) => isSidecarPath(path))) { … return; }` block
// from the `isRename` branch of the `file-op` handler
// (`sync/control-handlers.ts`). Every REFUSAL case reddens on `admitted` and on
// the vault journal; the positive controls stay green. VERIFIED RED — the exact
// messages are in the report's break table.
//
// ── WHY THE SCENARIO IS REACHABLE AND NOT ARRANGED ───────────────────────────
// The first case below drives the gate's OWN premise rather than asserting it in
// prose: `isSharedPath` answers `false` for the sidecar endpoint (C26 AC1) and
// `true` for its shared partner, so the pre-WP68 `paths.some(isSharedPath)` form
// admits the op on the strength of the shared endpoint alone. That is the whole
// defect, and it is measured here rather than recalled.
//
// ── TWO INDEPENDENT ORACLES, BOTH REQUIRED ───────────────────────────────────
//   1. `admitted` — every op that reached `applyRemoteOp`. Empty means the op
//      never took an `opQueues` slot and never issued a `mutePathEvents`.
//   2. the vault `journal` — EVERY mutating vault/`FileManager` call, recorded
//      by the double itself. Empty means zero vault mutation, and it is a record
//      of all of them rather than of a hand-picked few, so a mutation this WP
//      did not think of still shows up.

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

const {
  DEEP_NOTE,
  SHARED_CANVAS,
  SHARED_NOTE,
  SIDECAR_INDEX,
  SIDECAR_NOTE,
  SIDECAR_STORE,
  createInboundRig,
} = await import("./harness");

type Rig = ReturnType<typeof createInboundRig>;

/** The peer's own copies. Every case starts from a disk that HAS these files. */
const DISK = {
  [SHARED_NOTE]: "the peer's own note",
  [SHARED_CANVAS]: '{"nodes":[],"edges":[]}',
  [SIDECAR_INDEX]: '{"guid-1":"_liveshare-test/board.canvas"}',
  [SIDECAR_NOTE]: "local replica state",
  [SIDECAR_STORE]: '{"version":1,"canvases":{}}',
};

describe("WP68 AC2 — a hand-built rename touching the sidecar directory mutates nothing", () => {
  let rig: Rig;

  beforeEach(() => {
    rig = createInboundRig(registerControlHandlers, DISK);
  });

  it("THE PREMISE — today's gate would admit on the shared endpoint alone", () => {
    const isShared = (rig.plugin.manifestManager as { isSharedPath: (p: string) => boolean })
      .isSharedPath;
    // C26 AC1: local replica state is not shared content…
    expect(isShared(SIDECAR_INDEX)).toBe(false);
    // …but its partner is, so `paths.some(isSharedPath)` is TRUE for the pair.
    expect(isShared(SHARED_NOTE)).toBe(true);
    expect([SIDECAR_INDEX, SHARED_NOTE].some(isShared)).toBe(true);
    // The strict all-paths form every OTHER op type uses would already refuse it.
    // The rename branch is the only one that does not, which is why it is the
    // only one in scope.
    expect([SIDECAR_INDEX, SHARED_NOTE].some((p) => !isShared(p))).toBe(true);
  });

  it("POSITIVE CONTROL — an ordinary rename IS admitted and DOES move the file", async () => {
    await rig.deliver({ type: "rename", oldPath: SHARED_NOTE, newPath: DEEP_NOTE });

    expect(
      rig.admitted,
      "the rig admits nothing at all — every refusal below is vacuous",
    ).toHaveLength(1);
    expect(rig.vault.journal.some((entry) => entry.startsWith("rename "))).toBe(true);
    expect(rig.vault.bytes.has(DEEP_NOTE)).toBe(true);
    expect(rig.vault.bytes.has(SHARED_NOTE)).toBe(false);
    // `ensureFolder` really runs on this path, so the `createFolder` absence
    // asserted below is a fact about the refusal and not about the fixture.
    expect(rig.vault.createFolder).toHaveBeenCalled();
  });

  const refusals: Array<[string, string, string]> = [
    ["shared -> sidecar index.json", SHARED_NOTE, SIDECAR_INDEX],
    ["sidecar index.json -> shared", SIDECAR_INDEX, SHARED_NOTE],
    ["shared -> a .md under the sidecar directory", SHARED_NOTE, SIDECAR_NOTE],
    ["a .md under the sidecar directory -> shared", SIDECAR_NOTE, SHARED_NOTE],
    ["a shared .canvas -> the sidecar store", SHARED_CANVAS, SIDECAR_STORE],
    ["the sidecar store -> a shared .canvas path", SIDECAR_STORE, "_liveshare-test/stolen.canvas"],
  ];

  for (const [label, oldPath, newPath] of refusals) {
    it(`REFUSED (${label}) — never reaches applyRemoteOp, and the vault is untouched`, async () => {
      await rig.deliver({ type: "rename", oldPath, newPath });

      expect(rig.admitted, `the op was admitted for ${oldPath} -> ${newPath}`).toEqual([]);
      expect(rig.vault.journal, "the refusal mutated the vault").toEqual([]);

      // Named, per AC2's list, so a future mutation route added to the apply
      // path cannot make this row quietly weaker.
      expect(rig.vault.rename).not.toHaveBeenCalled();
      expect(rig.vault.createFolder).not.toHaveBeenCalled();
      expect(rig.vault.create).not.toHaveBeenCalled();
      expect(rig.vault.createBinary).not.toHaveBeenCalled();
      expect(rig.vault.modify).not.toHaveBeenCalled();
      expect(rig.vault.modifyBinary).not.toHaveBeenCalled();
      expect(rig.vault.delete).not.toHaveBeenCalled();
      expect(rig.vault.trash).not.toHaveBeenCalled();
      expect(rig.fileManager.trashFile).not.toHaveBeenCalled();

      // The refusal is OBSERVABLE. Not the primary oracle — state above is —
      // but a silent drop is a defect of its own.
      //
      // WP95 — ASSERT WHICH GATE REFUSED, NOT WHICH WORDS IT USED.
      //
      // COSMETIC CHANGE, and the behaviour above is byte-for-byte what it was:
      // still refused, still zero mutation, still nothing admitted. Only the
      // message differs, because every path in this table is under `.obsidian`
      // (the sidecar directory lives there) and WP95's protected-path gate is
      // ordered ahead of WP68's sidecar gate, so it answers first.
      //
      // The old assertion matched the PROSE `/refused remote rename/`. That is
      // the weakest possible oracle for a refusal: it cannot tell which guard
      // fired, so a run in which WP68's guard had been deleted outright and some
      // other gate happened to refuse would have read identically. Matching on a
      // named gate identity instead means the next reader can tell the two
      // refusals apart, and a gate that stops firing is visible even when the
      // op is still refused by its neighbour.
      const warned = rig.warnings.join("\n");
      expect(
        warned,
        "the refusal named no gate at all — a silent or anonymous drop",
      ).toMatch(/PROTECTED PATH REFUSED|refused remote rename/i);
      expect(
        warned,
        "these endpoints are all under `.obsidian`, so WP95's gate is the one that " +
          "must answer first; WP68's sidecar gate is now the second line for them",
      ).toContain("arm=file-op-gate");
    });
  }

  it("NO SIDECAR DIRECTORY IS EVER CREATED for a refused rename", async () => {
    // `applyRemoteOpInner`'s rename case calls `ensureFolder` on the
    // destination's parent BEFORE `vault.rename`, so a guard placed inside the
    // apply rather than at the gate could still have materialised the directory
    // tree on a peer that does not have one.
    await rig.deliver({
      type: "rename",
      oldPath: SHARED_NOTE,
      newPath: `${SIDECAR_NOTE}/deeper/still.md`,
    });
    expect(rig.vault.createFolder).not.toHaveBeenCalled();
    expect(rig.vault.journal).toEqual([]);
  });

  it("the afterApply hook never runs either — no manifest or background-sync side effect", async () => {
    const manifest = rig.plugin.manifestManager as Record<string, ReturnType<typeof vi.fn>>;
    const background = rig.plugin.backgroundSync as Record<string, ReturnType<typeof vi.fn>>;

    await rig.deliver({ type: "rename", oldPath: SHARED_NOTE, newPath: SIDECAR_INDEX });
    expect(manifest.renameFile).not.toHaveBeenCalled();
    expect(background.onFileRenamed).not.toHaveBeenCalled();

    // POSITIVE CONTROL, same run, same rig: the hook is reachable and does fire
    // for an admitted rename. Without this the row above is satisfied by a rig
    // whose host arm never runs at all.
    await rig.deliver({ type: "rename", oldPath: SHARED_NOTE, newPath: DEEP_NOTE });
    expect(manifest.renameFile).toHaveBeenCalledTimes(1);
  });

  it("BOTH endpoints under the sidecar directory is refused too", async () => {
    // Recorded for completeness rather than as a discriminating case: the
    // pre-WP68 gate ALSO refused this one, because neither path is shared.
    await rig.deliver({ type: "rename", oldPath: SIDECAR_INDEX, newPath: SIDECAR_STORE });
    expect(rig.admitted).toEqual([]);
    expect(rig.vault.journal).toEqual([]);
  });
});
