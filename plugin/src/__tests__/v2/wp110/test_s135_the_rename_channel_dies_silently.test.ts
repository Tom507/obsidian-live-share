// S135 — A RENAME THE SHARE NEVER HEARS.
//
// ⚠ THE CHARTER'S PREMISE IS CORRECTED HERE, AND THE CORRECTION IS MEASURED.
//
// The signal reads: a rename that changes a file's PARENT FOLDER never
// propagates, from either role, while a same-folder rename propagates in ~0.1 s.
// The charter names four candidate links and asks which one drops the op —
// never emitted, emitted but not sent, sent but refused on receipt, or applied
// to a path the receiver rejects.
//
// The answer, from execution rather than from reading: NONE OF THEM. The first
// describe block below drives the real outbound path and the real inbound gate
// with a cross-folder destination, from both roles, for `.md` and `.canvas`, and
// the op is emitted with both endpoints intact, admitted by the gate, and
// applied — `createFolder` for the destination's parent and then `rename`. The
// destination folder is NOT the discriminator at any seam in this code.
//
// What IS a drop, and a permanent, silent, session-wide one, is the promise
// chain the rename handler serialises on. `vault-events.ts` built it as
//
//     const prev = pendingRename ?? Promise.resolve();
//     const task = prev.then(async () => { onFileRename(...); await ...; });
//     pendingRename = task.finally(...);
//
// with no `catch` anywhere. `prev.then(fn)` DOES NOT RUN `fn` when `prev` is
// rejected — so the first follow-up that throws (the `BackgroundSync`
// re-subscribe, the manifest re-key, `CanvasSync.handleRename`, or the
// `onActiveFileChange` at the end) leaves `pendingRename` permanently rejected,
// and every later rename skips `onFileRename` ENTIRELY. The op is never
// EMITTED — the charter's first option — for the rest of the session. The
// `delete` handler chains on the same promise, so deletes go with them.
// Measured: four gestures in, ONE op out, and the only trace was an unhandled
// rejection on a console nobody was capturing.
//
// That is S135's signature exactly — permanent, silent, no notice, no counter,
// both roles, unaffected by retrying — and it is on the charter's own anchor
// (`files/vault-events.ts`, the `"rename"` vault event). It is NOT proof that
// this is what happened in the live vaults; see the report's residual section.
// What the live evidence and this defect share is the shape, and this is the
// only mechanism on that path that produces it.

import { describe, expect, it, vi } from "vitest";

// `control-handlers.ts` reaches `ui/modals`, where `UserPickerModal` extends
// `FuzzySuggestModal` AT MODULE SCOPE — the import fails to LOAD without this.
// Additive and local, the WP85/S116/S129/S124 precedent.
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Stub {
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    constructor(..._args: any[]) {}
    open() {}
    close() {}
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    addItem(_callback: any) {
      return this;
    }
  }
  return {
    ...actual,
    Menu: Stub,
    FuzzySuggestModal: Stub,
    SuggestModal: Stub,
    requestUrl: async () => ({ status: 200, json: {}, text: "" }),
    setIcon: () => {},
    addIcon: () => {},
  };
});

import { FileOpsManager } from "../../../files/file-ops";
import { registerControlHandlers } from "../../../sync/control-handlers";
import type { FileOp } from "../../../types";
import { createFakeChannel, createRecordingVault } from "../wp68/harness";
import { SHARE, SUBFOLDER, createGestureRig, manifestFor } from "./harness";

const OUTSIDE = "_w4wp97-outside/note.md";

/** `.md` and `.canvas`, because AC3 asks whether the canvas half differs. */
const EXTENSIONS = [".md", ".canvas"] as const;

// ---------------------------------------------------------------------------
// A2 / A3 — the cross-folder destination is not refused at any seam.
// ---------------------------------------------------------------------------

describe("S135 — the OUTBOUND half: a cross-folder move is emitted, both roles", () => {
  for (const role of ["host", "guest"] as const) {
    for (const extension of EXTENSIONS) {
      const source = `${SHARE}/note${extension}`;
      const sameFolder = `${SHARE}/renamed${extension}`;
      const crossFolder = `${SUBFOLDER}/note${extension}`;

      it(`[${role}] [${extension}] the live gesture — a move into ${SUBFOLDER}/ reaches the wire`, async () => {
        const rig = createGestureRig({ role, initial: { [source]: "the user's note" } });
        await rig.rename(source, crossFolder);
        expect(rig.sent).toEqual([
          { type: "rename", oldPath: source, newPath: crossFolder },
        ]);
      });

      it(`[${role}] [${extension}] THE INTERNAL CONTROL — a same-folder rename reaches the wire too`, async () => {
        // The charter's control, and it is doing real work here: it is what
        // turns "the cross-folder row is green" from "renames work" into "the
        // DESTINATION FOLDER changes nothing", which is the charter correction.
        const rig = createGestureRig({ role, initial: { [source]: "the user's note" } });
        await rig.rename(source, sameFolder);
        expect(rig.sent).toEqual([{ type: "rename", oldPath: source, newPath: sameFolder }]);
      });

      it(`[${role}] [${extension}] a DEEP new tree is emitted verbatim, not truncated to its parent`, async () => {
        const deep = `${SHARE}/a/b/c/note${extension}`;
        const rig = createGestureRig({ role, initial: { [source]: "x" } });
        await rig.rename(source, deep);
        expect(rig.sent).toEqual([{ type: "rename", oldPath: source, newPath: deep }]);
      });
    }
  }

  it("the live SEQUENCE — the subfolder is announced, then the file follows it", async () => {
    // The signal records that the subfolder itself propagates while the file
    // does not. Both ops leave this client, in that order, from one rig.
    const source = `${SHARE}/note.md`;
    const rig = createGestureRig({ role: "host", initial: { [source]: "x" } });
    await rig.createFolder(SUBFOLDER);
    await rig.rename(source, `${SUBFOLDER}/note.md`);
    expect(rig.sent).toEqual([
      { type: "folder-create", path: SUBFOLDER },
      { type: "rename", oldPath: source, newPath: `${SUBFOLDER}/note.md` },
    ]);
  });
});

describe("S135 — the INBOUND half: a cross-folder move is admitted and applied", () => {
  /**
   * The real `file-op` gate over a real `applyRemoteOp`, with the vault as the
   * oracle. Built here rather than in the harness because it needs the real
   * `registerControlHandlers`, and that import must sit under the `vi.mock`
   * above.
   */
  function receiverRig(initial: Record<string, string>) {
    const vault = createRecordingVault(initial);
    const manager = new FileOpsManager(vault as never, { trashFile: vi.fn() } as never);
    const channel = createFakeChannel();
    const manifest = manifestFor(SHARE);
    const admitted: FileOp[] = [];
    const warnings: string[] = [];
    let inflight: Promise<unknown> = Promise.resolve();

    const plugin: Record<string, unknown> = {
      settings: { role: "guest", permission: "read-write" },
      controlChannel: channel,
      fileOpsManager: {
        setSender: (sender: (op: FileOp) => void) => manager.setSender(sender),
        applyRemoteOp: (op: FileOp, after?: () => Promise<void>) => {
          admitted.push(op);
          const promise = manager.applyRemoteOp(op, after);
          inflight = inflight.then(() => promise).catch(() => {});
          return promise;
        },
        isPathMuted: (path: string) => manager.isPathMuted(path),
        noteEscapingRenameRefusal: () => manager.noteEscapingRenameRefusal(),
        getEscapingRenameRefusals: () => manager.getEscapingRenameRefusals(),
      },
      manifestManager: {
        isSharedPath: (path: string) => manifest.isSharedPath(path),
        renameFile: vi.fn(),
        removeFile: vi.fn(),
        updateFile: vi.fn(async () => {}),
        addFolder: vi.fn(),
      },
      backgroundSync: {
        onFileAdded: vi.fn(async () => {}),
        onFileRemoved: vi.fn(),
        onFileRenamed: vi.fn(async () => {}),
      },
      syncManager: {},
      remoteUsers: new Map(),
      app: { vault, workspace: { getActiveViewOfType: () => null } },
      logger: {
        log: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn((_category: string, message: string) => warnings.push(message)),
        error: vi.fn(),
      },
      async saveSettings() {},
    };
    registerControlHandlers(plugin as never);
    return {
      vault,
      manager,
      admitted,
      warnings,
      async deliver(op: FileOp) {
        channel.deliver("file-op", { op });
        await inflight;
        for (let i = 0; i < 30; i++) await Promise.resolve();
      },
    };
  }

  for (const extension of EXTENSIONS) {
    const source = `${SHARE}/note${extension}`;
    const crossFolder = `${SUBFOLDER}/note${extension}`;

    it(`[${extension}] the peer follows the move INTO the subfolder, creating it first`, async () => {
      const rig = receiverRig({ [source]: "the user's note" });
      await rig.deliver({ type: "rename", oldPath: source, newPath: crossFolder } as FileOp);

      // The DISK is the oracle: the bytes are at the new path and gone from the old.
      expect(rig.vault.bytes.has(crossFolder)).toBe(true);
      expect(new TextDecoder().decode(rig.vault.bytes.get(crossFolder) as Uint8Array)).toBe(
        "the user's note",
      );
      expect(rig.vault.bytes.has(source)).toBe(false);
      // …and the destination's parent was created on the way, which is the ONLY
      // thing a cross-folder destination changes anywhere in this pipeline.
      expect(rig.vault.journal).toContain(`createFolder ${SUBFOLDER}`);
      expect(rig.vault.journal).toContain(`rename ${source} -> ${crossFolder}`);
      expect(rig.manager.getEscapingRenameRefusals()).toBe(0);
    });

    it(`[${extension}] INTERNAL CONTROL — a same-folder rename applies with NO folder creation`, async () => {
      const rig = receiverRig({ [source]: "the user's note" });
      await rig.deliver({
        type: "rename",
        oldPath: source,
        newPath: `${SHARE}/renamed${extension}`,
      } as FileOp);
      expect(rig.vault.bytes.has(`${SHARE}/renamed${extension}`)).toBe(true);
      // The two rows differ in exactly one observable: no SUBFOLDER is created.
      // Asserted on the absence of that one entry rather than on the whole
      // journal — the recording vault's `getAbstractFileByPath` resolves files
      // only, so `ensureFolder` re-creates the share ROOT here as a fixture
      // artefact. Pinning the whole journal would be pinning the harness.
      expect(rig.vault.journal).toContain(`rename ${source} -> ${SHARE}/renamed${extension}`);
      expect(rig.vault.journal).not.toContain(`createFolder ${SUBFOLDER}`);
    });
  }

  it("POSITIVE CONTROL — S124 is NOT reopened: a destination OUTSIDE the share is still refused", async () => {
    // The repair must widen nothing. A rename whose destination leaves the
    // shared tree is refused, counted and announced, exactly as WP108 landed it.
    const rig = receiverRig({ [`${SHARE}/note.md`]: "the user's note" });
    await rig.deliver({
      type: "rename",
      oldPath: `${SHARE}/note.md`,
      newPath: OUTSIDE,
    } as FileOp);
    expect(rig.vault.journal).toEqual([]);
    expect(rig.vault.bytes.has(OUTSIDE)).toBe(false);
    expect(rig.manager.getEscapingRenameRefusals()).toBe(1);
    expect(rig.warnings.some((w) => w.includes("leaves the shared folder"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A1 — THE DROP, and it is the promise chain.
// ---------------------------------------------------------------------------

describe("S135 — 🚨 a rejected follow-up used to kill the rename and delete channels", () => {
  const A = `${SHARE}/a.md`;
  const B = `${SHARE}/b.md`;
  const C = `${SHARE}/c.md`;
  const D = `${SHARE}/d.md`;

  it("HEALTHY CONTROL — four gestures, four ops", async () => {
    // The anti-vacuity row. Without it every assertion below could pass against
    // a rig that never emits anything at all.
    const rig = createGestureRig({});
    await rig.rename(A, B);
    await rig.rename(B, C);
    await rig.rename(C, `${SUBFOLDER}/c.md`);
    await rig.remove(D);
    expect(rig.sent.map((op) => op.type)).toEqual(["rename", "rename", "rename", "delete"]);
  });

  it("🚨 THE DEFECT — one throwing follow-up and every LATER gesture is silent", async () => {
    // RED before the repair: `sent` held ONE op. The three gestures after the
    // failure never reached `onFileRename` / `onFileDelete` at all, because
    // `prev.then(fn)` skips `fn` on a rejected `prev`. Permanent — nothing in
    // the handler ever clears a rejected `pendingRename`.
    let calls = 0;
    const rig = createGestureRig({
      onFileRenamed: async () => {
        calls += 1;
        if (calls === 1) throw new Error("the follow-up threw");
      },
    });
    await rig.rename(A, B);
    await rig.rename(B, C);
    await rig.rename(C, `${SUBFOLDER}/c.md`);
    await rig.remove(D);

    expect(rig.sent.map((op) => op.type)).toEqual(["rename", "rename", "rename", "delete"]);
    // The endpoints of the LAST rename are intact — the channel is not merely
    // alive, it is carrying the right thing.
    expect(rig.sent[2]).toEqual({ type: "rename", oldPath: C, newPath: `${SUBFOLDER}/c.md` });
    // …and the follow-up itself really did run three times, so the chain
    // advanced rather than being bypassed.
    expect(rig.followUpCalls()).toBe(3);
  });

  it("the failing rename's OWN op is not lost either", async () => {
    // `onFileRename` is the FIRST statement of the task, before any await, so a
    // rejection downstream of it never costs the op it belongs to. Asserted so
    // a future repair that moves the emit below an await reddens here.
    const rig = createGestureRig({
      onFileRenamed: async () => {
        throw new Error("the follow-up threw");
      },
    });
    await rig.rename(A, B);
    expect(rig.sent).toEqual([{ type: "rename", oldPath: A, newPath: B }]);
  });

  it("REPEATED failures do not wedge it — the chain survives every one", async () => {
    // A repair that recovered ONCE would pass the row above and still lose the
    // channel on the second failure. Ten consecutive rejections, ten ops.
    const rig = createGestureRig({
      onFileRenamed: async () => {
        throw new Error("the follow-up threw");
      },
    });
    for (let i = 0; i < 10; i++) {
      await rig.rename(`${SHARE}/f${i}.md`, `${SUBFOLDER}/f${i}.md`);
    }
    expect(rig.sent).toHaveLength(10);
    expect(rig.manager.getRenameTaskFailures()).toBe(10);
  });

  it("a throwing CanvasSync.handleRename is contained on the same chain", async () => {
    // The follow-up has four collaborators and any of them can reject. The
    // containment is on the chain, not on one caller, so it must hold whichever
    // one throws — otherwise the repair is a patch on the collaborator that
    // happened to be tested.
    const rig = createGestureRig({
      handleRename: async () => {
        throw new Error("the identity store rejected");
      },
    });
    await rig.rename(A, B);
    await rig.rename(B, C);
    expect(rig.sent.map((op) => op.type)).toEqual(["rename", "rename"]);
    expect(rig.manager.getRenameTaskFailures()).toBe(2);
  });

  it("ATTRIBUTION — the contained failure is counted and named, both endpoints", async () => {
    // S105's lesson, applied to the producing side: a contained failure that
    // says nothing is indistinguishable from one that never happened, and that
    // is precisely how this survived. The count is on the manager's ledger (an
    // oracle a live validator can read through the e2e surface) and the line
    // carries BOTH paths, because either endpoint being the surprise is a
    // different bug.
    const rig = createGestureRig({
      onFileRenamed: async () => {
        throw new Error("waitForSync timed out");
      },
    });
    expect(rig.manager.getRenameTaskFailures()).toBe(0);
    await rig.rename(A, `${SUBFOLDER}/a.md`);

    expect(rig.manager.getRenameTaskFailures()).toBe(1);
    const line = rig.warnings.find((w) => w.startsWith("RENAME FOLLOW-UP FAILED:"));
    expect(line).toBeDefined();
    expect(line).toContain(A);
    expect(line).toContain(`${SUBFOLDER}/a.md`);
    expect(line).toContain("waitForSync timed out");
  });

  it("SILENCE CONTROL — a healthy rename produces no failure line and no count", async () => {
    // Without this the attribution row could pass against an emitter that fires
    // on every rename, which would make the counter useless as a discriminator.
    const rig = createGestureRig({});
    await rig.rename(A, `${SUBFOLDER}/a.md`);
    expect(rig.manager.getRenameTaskFailures()).toBe(0);
    expect(rig.warnings.filter((w) => w.startsWith("RENAME FOLLOW-UP FAILED:"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A2 — S120's property still holds. Asserted, not assumed.
// ---------------------------------------------------------------------------

describe("S135 — S120 is not reopened by this repair, and its SECOND gate is closed", () => {
  const PATH = `${SHARE}/hello.md`;

  it("🚨 a user rename inside a mute armed for create/modify is NOT swallowed", async () => {
    // WP108's property, driven through the REAL handler chain rather than
    // through the predicate — and that is what found the second defect. RED
    // before this package: the `vault-events` gate correctly admitted the
    // gesture and `FileOpsManager.onFileRename`'s own `isPathMuted` — still the
    // type-blind refcount S120 replaced everywhere else — then dropped it, with
    // nothing counted and nothing logged. A test written against
    // `isPathMutedFor` alone would have stayed green over both defects.
    const rig = createGestureRig({ initial: { [PATH]: "x" } });
    rig.manager.mutePathEvents(PATH);
    rig.manager.armMuteRelease(PATH, { consumes: ["create", "modify"] });

    await rig.rename(PATH, `${SUBFOLDER}/hello.md`);
    expect(rig.sent).toEqual([
      { type: "rename", oldPath: PATH, newPath: `${SUBFOLDER}/hello.md` },
    ]);
  });

  it("FAIL-CLOSED CONTROL — a rename echo of an applied rename is still suppressed", async () => {
    // The other half. If this went green-by-permissiveness the echo loop the
    // mute exists to break would be back, and the row above would be worthless.
    const rig = createGestureRig({ initial: { [PATH]: "x" } });
    rig.manager.mutePathEvents(PATH);
    rig.manager.armMuteRelease(PATH, { consumes: ["rename", "delete"] });

    await rig.rename(PATH, `${SUBFOLDER}/hello.md`);
    expect(rig.sent).toEqual([]);
    expect(rig.manager.getMuteDrops().byKind).toEqual({ rename: 1 });
  });
});
