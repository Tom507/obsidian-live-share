// WP95 TP01 — AC2 (the predicate) and AC6 (the op kinds), MEASURED.
//
// THE TRAP THIS FILE EXISTS TO AVOID. S94 was demonstrated for the RENAME arm
// only; create, modify, delete and the chunked transfer were stated as
// implications. A fix that assumed the other arms behave like rename would rest
// on exactly the reasoning that produced the defect, so every op kind below is
// DRIVEN through the real inbound gate and observed, not argued about.
//
// The oracles are WP68's: the vault JOURNAL (every mutating call, in order) and
// `admitted` (every op that reached `applyRemoteOp`). Both are asserted in both
// directions in the same run — a positive control drives the same fixtures and
// asserts the journal is NON-empty, so "nothing was mutated" cannot pass against
// a rig that never mutates anything.

import { describe, expect, it, vi } from "vitest";

// The UI modules `control-handlers.ts` imports extend Obsidian base classes the
// headless environment does not provide. Stubbed exactly as WP68's inbound suite
// stubs them — no handler this file drives reaches any of them.
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
  PROTECTED_ROOTS,
  isProtectedPath,
  protectedRootFor,
} from "../../../files/protected-paths";
import { SIDECAR_DIR, isSidecarPath, sidecarIndexPath } from "../../../files/canvas-sidecar";
import type { FileOp } from "../../../types";

const { registerControlHandlers } = await import("../../../sync/control-handlers");

const {
  GIT_HOOK,
  NESTED_GIT_HOOK,
  PLUGIN_CODE,
  PLUGIN_DATA,
  SHARED_NOTE,
  createInboundRig,
  deliverChunk,
  opsTargeting,
} = await import("./harness");

describe("WP95 AC2 — one predicate, and it is wider than the one that missed", () => {
  it("MEASURED: the two roots the charter names are the two roots the constant carries", () => {
    // Derived from the constant rather than restated. A test that hard-coded the
    // pair would keep passing after the constant changed.
    expect([...PROTECTED_ROOTS].sort()).toEqual([".git", ".obsidian"]);
  });

  it("the files S94 names are protected — plugin CODE and plugin SETTINGS", () => {
    expect(isProtectedPath(PLUGIN_CODE)).toBe(true);
    expect(isProtectedPath(PLUGIN_DATA)).toBe(true);
    expect(protectedRootFor(PLUGIN_DATA)).toBe(".obsidian");
  });

  it("`.git/**` is protected, INCLUDING a nested repository's hooks", () => {
    expect(isProtectedPath(GIT_HOOK)).toBe(true);
    // A vault may contain git repositories below its root, and a hook there is
    // exactly as executable as one at the top. `isSidecarPath` answers FALSE for
    // the analogous nested case on purpose; the opposite answer is correct here.
    expect(isProtectedPath(NESTED_GIT_HOOK)).toBe(true);
    expect(protectedRootFor(NESTED_GIT_HOOK)).toBe(".git");
  });

  it("case does not buy a bypass, and neither does a backslash or a leading `./`", () => {
    expect(isProtectedPath(".OBSIDIAN/plugins/live-share/main.js")).toBe(true);
    expect(isProtectedPath(".Obsidian/plugins/live-share/main.js")).toBe(true);
    expect(isProtectedPath(".obsidian\\plugins\\live-share\\main.js")).toBe(true);
    expect(isProtectedPath("./.obsidian/plugins/live-share/main.js")).toBe(true);
    expect(isProtectedPath("/.obsidian/plugins/live-share/main.js")).toBe(true);
    expect(isProtectedPath(".obsidian//plugins/live-share/main.js")).toBe(true);
  });

  it("the root itself is protected — a rename ONTO `.obsidian` is not a peer's to make", () => {
    expect(isProtectedPath(".obsidian")).toBe(true);
    expect(isProtectedPath(".git")).toBe(true);
  });

  it("ordinary paths are NOT protected — the predicate is not a blanket refusal", () => {
    // Without this the whole suite would be green against `() => true`.
    expect(isProtectedPath(SHARED_NOTE)).toBe(false);
    expect(isProtectedPath("notes/a/b/c.md")).toBe(false);
    expect(isProtectedPath("board.canvas")).toBe(false);
    // Prefix-sharing near misses, on WP68's AC4 precedent.
    expect(isProtectedPath(".obsidianful/board.canvas")).toBe(false);
    expect(isProtectedPath(".github/workflows/ci.yml")).toBe(false);
    expect(isProtectedPath("gitignore/notes.md")).toBe(false);
    expect(isProtectedPath("")).toBe(false);
  });

  it("STRICTLY WIDER than `isSidecarPath`, and the widening is non-vacuous", () => {
    // Direction 1 — everything the old guard caught, this one catches. The
    // sidecar lives under `.obsidian/`, so WP68's coverage is preserved and the
    // repair cannot have narrowed anything.
    const sidecarPaths = [
      sidecarIndexPath(),
      `${SIDECAR_DIR}/notes/replica.md`,
      `${SIDECAR_DIR}/abc.yhistory`,
    ];
    for (const path of sidecarPaths) {
      expect(isSidecarPath(path), `${path} is a sidecar path`).toBe(true);
      expect(isProtectedPath(path), `${path} must also be protected`).toBe(true);
    }
    // Direction 2 — the gap S94 named. These are NOT sidecar paths, which is
    // precisely why they were reachable, and they ARE protected now. Without
    // this arm the test above would pass against `isProtectedPath = isSidecarPath`.
    for (const path of [PLUGIN_CODE, PLUGIN_DATA, GIT_HOOK]) {
      expect(isSidecarPath(path), `${path} is NOT a sidecar path — that was the defect`).toBe(
        false,
      );
      expect(isProtectedPath(path), `${path} must be protected`).toBe(true);
    }
  });
});

describe("WP95 AC6 — every op kind in the union, driven and observed", () => {
  // The table is `Record<FileOp["type"], FileOp>`, so the compiler enforces that
  // this loop covers the whole union. See `harness.ts`.
  const kinds = Object.keys(opsTargeting(PLUGIN_DATA)) as FileOp["type"][];

  it("the census denominator is the union's size, not a number somebody typed", () => {
    // Nine members in `FileOp`. If the union grows, `opsTargeting` stops
    // compiling until it is extended — so this number cannot silently drift out
    // of agreement with the type, only fail to build.
    expect(kinds).toHaveLength(9);
  });

  for (const kind of kinds) {
    it(`\`${kind}\` targeting the plugin's data file is REFUSED — zero vault mutation`, async () => {
      const rig = createInboundRig(registerControlHandlers, {
        [PLUGIN_DATA]: "existing",
        "notes/ordinary.md": "ordinary",
      });
      await rig.deliver(opsTargeting(PLUGIN_DATA)[kind]);

      // Oracle 1 — nothing reached the applier, so no `opQueues` slot was taken
      // and no mute can have been stranded.
      expect(rig.admitted, `${kind} must not reach applyRemoteOp`).toEqual([]);
      // Oracle 2 — the journal of EVERY mutating vault call, not a hand-picked few.
      expect(rig.vault.journal, `${kind} must mutate nothing`).toEqual([]);
      // Oracle 3 — the refusal is named, not a silent drop.
      expect(rig.warnings.join("\n")).toContain("PROTECTED PATH REFUSED");
    });
  }

  it("POSITIVE CONTROL — the same rig, the same run, an ordinary path DOES mutate", async () => {
    // Without this every assertion above passes against a rig that cannot write.
    const rig = createInboundRig(registerControlHandlers, { "notes/ordinary.md": "ordinary" });
    await rig.deliver({ type: "modify", path: "notes/ordinary.md", content: "changed" });
    expect(rig.admitted).toHaveLength(1);
    expect(rig.vault.journal).not.toEqual([]);
    expect(rig.warnings.join("\n")).not.toContain("PROTECTED PATH REFUSED");
  });

  it("the CHUNK CHANNEL is a separate door and it refuses too", async () => {
    // These four messages do not travel as `file-op`: separate `ControlMessage`
    // types, separate `channel.on` registration, separate gate. The op-kind loop
    // above cannot reach them — it delivers `chunk-*` through the `file-op`
    // handler, which is a shape a peer never actually sends. This case sends the
    // shape a peer DOES send.
    const rig = createInboundRig(registerControlHandlers, { [PLUGIN_DATA]: "existing" });
    deliverChunk(rig, "file-chunk-start", { path: PLUGIN_DATA, totalSize: 8, transferId: "t1" });
    deliverChunk(rig, "file-chunk-data", {
      path: PLUGIN_DATA,
      index: 0,
      data: "AAAAAAAA",
      transferId: "t1",
    });
    deliverChunk(rig, "file-chunk-end", { path: PLUGIN_DATA, transferId: "t1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(rig.admitted).toEqual([]);
    expect(rig.vault.journal).toEqual([]);
    expect(rig.warnings.join("\n")).toContain("arm=chunk-gate");
  });

  it("POSITIVE CONTROL — the chunk channel still carries an ordinary path", async () => {
    const rig = createInboundRig(registerControlHandlers, {});
    deliverChunk(rig, "file-chunk-start", {
      path: "notes/big.bin",
      totalSize: 8,
      transferId: "t2",
    });
    await Promise.resolve();
    expect(rig.admitted).toHaveLength(1);
  });
});
