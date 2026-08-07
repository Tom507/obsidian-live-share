// WP68 / C68 AC3 — I11 REFUSAL NEVER DESTROYS.
//
// "A refused rename costs no file, at either end." This is the criterion the
// charter says is most likely to be got wrong, because "the file has left the
// shared tree, so remove the peer's copy" is a coherent-sounding reading of the
// rename's INTENT — and it is the exact shape of the silent `.canvas` data loss
// this run already found and closed at three depths (C63/WP63).
//
// ── THE ORACLE IS BYTES ──────────────────────────────────────────────────────
// The disk double's `Uint8Array` IS the file. Every "still there and unchanged"
// assertion below compares a COPY of the pre-image bytes, taken before the op,
// against the bytes after it. Nothing here is read through an accessor this WP
// touches, so a representation change cannot silently turn an equality check
// into one that can no longer fire.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ───────────────────────────────────────────
// Two independent breaks, both verified:
//   1. Delete the inbound guard (`sync/control-handlers.ts`). The rename is then
//      APPLIED, the file leaves `oldPath`, and every "still present, byte-
//      identical" row reddens.
//   2. Degrade the refusal into the trap the charter names — replace the inbound
//      guard's `return` with a `trashFile` of the old path. The `admitted` rows
//      in TP02 stay green while THIS file reddens on `trashFile`, which is the
//      whole reason this criterion is a file of its own rather than a line in
//      TP02.
// The exact red messages are in the report's break table.
//
// ── WHAT THIS CRITERION DOES *NOT* GOVERN ────────────────────────────────────
// Manifest membership. `ManifestManager.renameFile` still deletes the stale old
// key and still declines a sidecar destination (WP26 / C26), and that is
// DELIBERATELY a different answer from the disk arm's. This file asserts about
// the file on disk only. A WP that "simplified" the two into one guard would
// have broken C26, and nothing here should be read as licensing that.

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
  SHARED_CANVAS,
  SHARED_NOTE,
  SIDECAR_INDEX,
  SIDECAR_NOTE,
  createInboundRig,
  createOutboundRig,
} = await import("./harness");

type Rig = ReturnType<typeof createInboundRig>;

const INDEX_CONTENT = '{"guid-1":"_liveshare-test/board.canvas","guid-2":"other.canvas"}';

const DISK = {
  [SHARED_NOTE]: "# hello\n\nthe peer's own note, with content that must survive\n",
  [SHARED_CANVAS]: '{"nodes":[{"id":"a"}],"edges":[]}',
  [SIDECAR_INDEX]: INDEX_CONTENT,
  [SIDECAR_NOTE]: "local replica state, also not expendable",
};

/** A snapshot of the whole disk, copied so a later mutation cannot alter it. */
function snapshot(bytes: Map<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map([...bytes].map(([path, data]) => [path, Uint8Array.from(data)]));
}

/** Every journal verb that removes or overwrites bytes. */
const DESTRUCTIVE = ["trashFile", "trash", "delete", "modify", "modifyBinary"];

describe("WP68 AC3 / I11 — a refused rename costs no file, at either end", () => {
  let rig: Rig;

  beforeEach(() => {
    rig = createInboundRig(registerControlHandlers, DISK);
  });

  it("POSITIVE CONTROL — this fixture CAN record a destruction", async () => {
    // Without this row, "no destructive verb appeared" is also what a journal
    // that never records one would report. A `delete` file-op for a shared path
    // is admitted by the untouched all-paths gate and really does trash.
    await rig.deliver({ type: "delete", path: SHARED_NOTE });

    expect(rig.fileManager.trashFile).toHaveBeenCalled();
    expect(rig.vault.journal.some((entry) => entry.startsWith("trashFile "))).toBe(true);
    expect(rig.vault.bytes.has(SHARED_NOTE), "the fixture did not actually destroy anything").toBe(
      false,
    );
  });

  const cases: Array<[string, string, string, string]> = [
    ["shared -> sidecar", SHARED_NOTE, SIDECAR_INDEX, SHARED_NOTE],
    ["sidecar -> shared", SIDECAR_INDEX, "_liveshare-test/stolen-index.json", SIDECAR_INDEX],
    ["shared canvas -> sidecar", SHARED_CANVAS, SIDECAR_NOTE, SHARED_CANVAS],
    ["sidecar note -> shared", SIDECAR_NOTE, SHARED_NOTE, SIDECAR_NOTE],
  ];

  for (const [label, oldPath, newPath, mustSurvive] of cases) {
    it(`REFUSED (${label}) — the file at oldPath is still present and BYTE-IDENTICAL`, async () => {
      const before = snapshot(rig.vault.bytes);
      const preImage = before.get(mustSurvive);
      expect(preImage, "the fixture never had the file this row is about").toBeDefined();
      expect(
        (preImage as Uint8Array).length,
        "the pre-image is empty — truncation is undetectable",
      ).toBeGreaterThan(0);

      await rig.deliver({ type: "rename", oldPath, newPath });

      const after = rig.vault.bytes.get(mustSurvive);
      expect(after, `${mustSurvive} was unlinked by the refusal`).toBeDefined();
      expect(after as Uint8Array, `${mustSurvive} was rewritten or truncated`).toEqual(preImage);
      expect((after as Uint8Array).length).toBeGreaterThan(0);
    });

    it(`REFUSED (${label}) — the WHOLE disk is byte-for-byte what it was`, async () => {
      // Wider than the row above on purpose: "no file was lost" has to include
      // the files this WP was not thinking about, and a destination that was
      // created is as much a defect here as a source that was removed.
      const before = snapshot(rig.vault.bytes);

      await rig.deliver({ type: "rename", oldPath, newPath });

      expect([...rig.vault.bytes.keys()].sort(), "the set of files on disk changed").toEqual(
        [...before.keys()].sort(),
      );
      for (const [path, data] of before) {
        expect(rig.vault.bytes.get(path), `${path} changed`).toEqual(data);
      }
    });

    it(`REFUSED (${label}) — no destructive verb was issued for EITHER endpoint`, async () => {
      await rig.deliver({ type: "rename", oldPath, newPath });

      const destructive = rig.vault.journal.filter((entry) =>
        DESTRUCTIVE.some((verb) => entry.startsWith(`${verb} `)),
      );
      expect(
        destructive,
        "the refusal degraded into a destructive operation — this is the " +
          "refuse-then-delete trap AC3 exists to forbid",
      ).toEqual([]);
      expect(rig.fileManager.trashFile).not.toHaveBeenCalled();
    });
  }

  it("DIVERGENCE IS THE ACCEPTED OUTCOME — the peer simply keeps its copy at the old path", async () => {
    // Stated as a row so nobody later "fixes" the divergence by deleting. The
    // local vault has moved its own file; this peer has not, and that is
    // correct. There is no assertion here that the two agree.
    await rig.deliver({ type: "rename", oldPath: SHARED_NOTE, newPath: SIDECAR_INDEX });

    expect(rig.vault.bytes.has(SHARED_NOTE)).toBe(true);
    expect(rig.vault.getAbstractFileByPath(SHARED_NOTE)?.path).toBe(SHARED_NOTE);
  });

  it("THE OUTBOUND REFUSAL TOUCHES NO DISK EITHER", async () => {
    // `onFileRename` has never made a vault call and still does not. Asserted
    // rather than assumed, because the obvious wrong implementation of "the file
    // left the shared tree" lives on this side too.
    const outbound = createOutboundRig(DISK);
    const before = snapshot(outbound.vault.bytes);

    outbound.rename(SHARED_NOTE, SIDECAR_INDEX);
    outbound.rename(SIDECAR_INDEX, SHARED_NOTE);
    await Promise.resolve();
    await Promise.resolve();

    expect(outbound.vault.journal).toEqual([]);
    expect(outbound.fileManager.trashFile).not.toHaveBeenCalled();
    for (const [path, data] of before) {
      expect(outbound.vault.bytes.get(path), `${path} changed`).toEqual(data);
    }
    expect(outbound.manager.getSidecarRenameRefusals()).toBe(2);
  });

  it("A REFUSAL IS PER-PATH AND NON-FATAL (I5) — the next op still applies", async () => {
    await rig.deliver({ type: "rename", oldPath: SHARED_NOTE, newPath: SIDECAR_INDEX });
    expect(rig.admitted).toEqual([]);

    // Same rig, same handler, immediately afterwards. Nothing threw out of the
    // handler and nothing is wedged.
    await rig.deliver({
      type: "rename",
      oldPath: SHARED_CANVAS,
      newPath: "_liveshare-test/b.canvas",
    });
    expect(rig.admitted).toHaveLength(1);
    expect(rig.vault.bytes.has("_liveshare-test/b.canvas")).toBe(true);
  });
});
