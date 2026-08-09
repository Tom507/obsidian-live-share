// S124 — PEERS FOLLOWED A FILE OUT OF THE SHARED FOLDER.
//
// Live, both `useCanvasBinding` halves: dragging a file OUT of the share did not
// make peers drop it — they FOLLOWED the move and wrote the file OUTSIDE
// `sharedFolder`. `_w4wp97-outside/` was created in vaults B and C BY THE
// PLUGIN, not by the operator. In one half the two peers also disagreed with
// each other: one removed its copy, one kept it.
//
// THE HOLE: the inbound gate admits a rename on `.some(isSharedPath)` — the
// only one of the nine op types admitted on `.some` — so a rename straddling
// the boundary rode in on its shared SOURCE. `applyRemoteOpInner` then called
// `ensureFolder` for the out-of-tree parent and moved the file there. WP95's
// own comment names that exact asymmetry as the vector it had just closed one
// gate over; the destination was never tested.
//
// AC7 — WHAT THIS PEER DOES, STATED EXPLICITLY: nothing. It does not follow the
// move and it does not delete its copy. The file stays where it is, byte for
// byte.
//
// That is deliberately NOT "the file left the shared tree, so drop it". This
// codebase already names that the refuse-then-delete trap (WP68, file-ops.ts:
// "the peers keep their own copies at the old path. That divergence is the
// ACCEPTED outcome"), and it is I11: a refusal never destroys. The charter's
// AC5 phrasing — "a removal from the peer's perspective" — is honoured in the
// sense that matters: the file leaves the SESSION (the host's manifest drops it
// on the next publish, because `publishManifest` filters on `isSharedPath`),
// without any peer destroying bytes it was never asked to destroy.
//
// AC6 is then free: both peers run the same pure decision, so they cannot
// disagree. The iteration count below is what distinguishes that from a race
// that happened to settle the same way twice.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// `control-handlers.ts` reaches `ui/modals`, where `UserPickerModal` extends
// `FuzzySuggestModal` AT MODULE SCOPE — the import fails to LOAD without this.
// Additive and local, the WP85/S116/S129 precedent; the shared mock is not touched.
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Stub {
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    constructor(..._args: any[]) {}
    open() {}
    close() {}
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    addItem(_cb: any) {
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
import { ManifestManager } from "../../../files/manifest";
import { registerControlHandlers } from "../../../sync/control-handlers";
import { DEFAULT_SETTINGS, type FileOp, type LiveShareSettings } from "../../../types";
import { createFakeChannel, createOutboundRig, createRecordingVault } from "../wp68/harness";

/** AC6 — stated. Peer agreement is a race until proven otherwise. */
const ITERATIONS = 60;

const SHARE = "_liveshare-test";
const INSIDE = `${SHARE}/note.md`;
const OUTSIDE = "_w4wp97-outside/note.md";

function managerFor(sharedFolder: string) {
  const settings: LiveShareSettings = { ...DEFAULT_SETTINGS, sharedFolder };
  const vault = {
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => {}),
    adapter: { exists: vi.fn(async () => false) },
  };
  return new ManifestManager(vault as never, settings as never);
}

/**
 * The gate's decision, expressed over the predicate the production gate uses.
 * `isSharedPath` is the real one; the destination test is the whole of the fix.
 */
function admitsRename(m: ManifestManager, destination: string): boolean {
  return m.isSharedPath(destination);
}

describe("S124 AC5 — a destination outside the shared tree is refused", () => {
  it("🚨 the live case: a rename OUT of the share is not followed", () => {
    const m = managerFor(SHARE);
    expect(admitsRename(m, OUTSIDE)).toBe(false);
  });

  it("a rename INSIDE the share is still followed", () => {
    // VACUITY CONTROL. Without this the fix could be "refuse every rename",
    // which would break ordinary moves within the shared folder.
    const m = managerFor(SHARE);
    expect(admitsRename(m, `${SHARE}/renamed.md`)).toBe(true);
    expect(admitsRename(m, `${SHARE}/sub/renamed.md`)).toBe(true);
  });

  it("a rename INTO the share is followed — the inbound direction is not blocked", () => {
    const m = managerFor(SHARE);
    expect(admitsRename(m, INSIDE)).toBe(true);
  });

  it("a whole-vault share admits everything, because everything is inside it", () => {
    // The `sharedFolder: ""` configuration must not be broken by a destination
    // test: with the whole vault shared there is no outside.
    const m = managerFor("");
    expect(admitsRename(m, OUTSIDE)).toBe(true);
  });

  it("the conflicts folder is still excluded, so the two rules compose", () => {
    // S125's owned exclusion must survive: a rename into the conflicts folder
    // is not a shared destination either.
    const m = managerFor(SHARE);
    expect(admitsRename(m, `${SHARE} (conflicts)/note.md`)).toBe(false);
  });
});

describe("S124 AC6 — the two peers cannot disagree", () => {
  it(`the decision is a pure function of (destination, sharedFolder), ${ITERATIONS} runs`, () => {
    // One peer removing its copy while another kept it is worse than either
    // behaviour chosen consistently. Both peers evaluate the same predicate
    // over the same two inputs, so agreement is structural rather than lucky —
    // and repeated evaluation proves there is no hidden state making it drift.
    const answers = new Set<string>();
    for (let i = 0; i < ITERATIONS; i++) {
      const peerB = managerFor(SHARE);
      const peerC = managerFor(SHARE);
      const b = admitsRename(peerB, OUTSIDE);
      const c = admitsRename(peerC, OUTSIDE);
      expect(b).toBe(c);
      answers.add(`${b}:${c}`);
    }
    // Exactly one distinct outcome across every run, on both peers.
    expect(answers.size).toBe(1);
    expect([...answers]).toEqual(["false:false"]);
  });

  it("peers sharing DIFFERENT folders each answer for their own share", () => {
    // Not a disagreement — a correct difference. A peer whose share does not
    // contain the destination refuses; the two are answering about different
    // trees, and each answer is right for its own vault.
    const peerB = managerFor(SHARE);
    const peerC = managerFor("_w4wp97-outside");
    expect(admitsRename(peerB, OUTSIDE)).toBe(false);
    expect(admitsRename(peerC, OUTSIDE)).toBe(true);
  });
});

/**
 * AC7/AC8 — derived from the source, because the behaviour that matters is a
 * REFUSAL and a refusal leaves nothing behind to assert on except the code that
 * performs it and the ledger that counts it.
 */
describe("S124 AC7/AC8 — the guards, derived", () => {
  const inbound = readFileSync(
    new URL("../../../sync/control-handlers.ts", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
    "utf8",
  );
  const fileOps = readFileSync(
    new URL("../../../files/file-ops.ts", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
    "utf8",
  );

  it("AC7 — the inbound refusal returns; it never deletes", () => {
    const block = inbound.slice(inbound.indexOf("S124 — THE DESTINATION MUST BE"));
    const guard = block.slice(0, block.indexOf("if (!paths.some("));
    expect(guard).toContain("return;");
    // I11: no destructive call anywhere in the refusal.
    expect(guard).not.toMatch(/trashFile|vault\.delete|adapter\.remove|vault\.rename/);
  });

  it("AC7 — the refusal is counted and logged", () => {
    expect(inbound).toContain("noteEscapingRenameRefusal()");
    const block = inbound.slice(inbound.indexOf("S124 — THE DESTINATION MUST BE"));
    expect(block.slice(0, 2000)).toContain("logger.warn");
  });

  it("the OUTBOUND gate is NOT narrowed by the inbound predicate, and that is on purpose", () => {
    // ⚠ A REVERSAL, RECORDED RATHER THAN QUIETLY DROPPED.
    //
    // The in-flight attempt at S124 also added an `isProtectedPath` loop to
    // `onFileRename`, calling the outbound direction "strictly weaker than the
    // inbound one for no stated reason". The reason is stated, in
    // `protected-paths.ts`'s own doc comment: the predicate "governs INBOUND
    // PEER OPERATIONS ONLY". It asks whether a PEER's bytes may land in a
    // protected root, and a local user renaming a local file is not a peer.
    //
    // MEASURED, not argued: with that loop in place the full suite was RED at
    // three WP68 AC4 rows — the `.obsidian/liveshare/stateful/…` NEAR MISS,
    // both directions, plus the sibling that moves into the share. WP68 AC4
    // exists to catch exactly this: "a guard that refuses too much passes all
    // three of [TP01-TP03] and breaks the product."
    //
    // So this row pins the ABSENCE, and it reddens if somebody reintroduces the
    // borrowed predicate here without first giving the outbound direction a
    // question of its own.
    const outbound = fileOps.slice(fileOps.indexOf("onFileRename("));
    const body = outbound.slice(0, outbound.indexOf("emitOp"));
    expect(body).not.toContain('noteProtectedRefusal("file-op-gate"');
    // POSITIVE CONTROL: the slice really is `onFileRename`'s body and really
    // does contain its own guard, so `not.toContain` is not passing on an empty
    // string or a mis-sliced region.
    expect(body).toContain("isSidecarPath(localOld)");
    expect(body.length).toBeGreaterThan(200);
  });
});

describe("S124 — the OUTBOUND direction is unchanged by this work package", () => {
  it("POSITIVE CONTROL — an ordinary rename IS still broadcast", async () => {
    const rig = createOutboundRig({ [INSIDE]: "x" });
    rig.rename(INSIDE, `${SHARE}/renamed.md`);
    await Promise.resolve();
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0]).toMatchObject({ type: "rename" });
  });

  it("a rename out of the share is still broadcast OUTBOUND — the fix is on the RECEIVER", async () => {
    // Stated so the shape of the fix is not mistaken. The sender still tells
    // the session what its user did; it is each PEER that declines to follow
    // the move out of its own shared tree. Refusing to send instead would make
    // the host's manifest and the peers' disks disagree about what happened.
    const rig = createOutboundRig({ [INSIDE]: "x" });
    rig.rename(INSIDE, OUTSIDE);
    await Promise.resolve();
    expect(rig.sent).toEqual([{ type: "rename", oldPath: INSIDE, newPath: OUTSIDE }]);
  });
});

/**
 * THE REAL INBOUND GATE, DRIVEN.
 *
 * Everything above this point tests the PREDICATE and reads the SOURCE. The
 * break table proved that was not enough: planting the defect back — deleting
 * the destination test, and neutering the destination reader — reddened
 * NOTHING, because a predicate test does not execute the gate and a source
 * assertion survives a change to the line it does not quote.
 *
 * That is a test with no subject, and it is the exact class this project has
 * shipped repeatedly. So the op is hand-built and handed straight to the
 * `file-op` handler, as an older or hostile peer would, and the oracle is the
 * VAULT: `bytes` is the file, and `journal` records every mutating call, so
 * "the peer did not follow the move" is a claim about the disk rather than
 * about a mock's call count.
 */
describe("S124 — the real inbound gate, executed", () => {
  function inboundRig(sharedFolder: string, initial: Record<string, string>) {
    const vault = createRecordingVault(initial);
    const manager = new FileOpsManager(vault as never, { trashFile: vi.fn() } as never);
    const channel = createFakeChannel();
    const manifest = managerFor(sharedFolder);
    const warnings: string[] = [];
    const admitted: FileOp[] = [];
    let inflight: Promise<unknown> = Promise.resolve();

    const plugin: Record<string, unknown> = {
      settings: { role: "guest", permission: "read-write" },
      controlChannel: channel,
      fileOpsManager: {
        setSender: (s: (op: FileOp) => void) => manager.setSender(s),
        applyRemoteOp: (op: FileOp, after?: () => Promise<void>) => {
          admitted.push(op);
          const pr = manager.applyRemoteOp(op, after);
          inflight = inflight.then(() => pr).catch(() => {});
          return pr;
        },
        isPathMuted: (path: string) => manager.isPathMuted(path),
        // S124 — the ledger the guard writes to. A facade without it would make
        // the guard THROW instead of refusing, which is a different behaviour
        // and would have hidden the property under an exception.
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
        warn: vi.fn((_c: string, m: string) => warnings.push(m)),
        error: vi.fn(),
      },
      async saveSettings() {},
    };
    registerControlHandlers(plugin as never);
    return {
      vault,
      manager,
      warnings,
      admitted,
      async deliver(op: FileOp) {
        channel.deliver("file-op", { op });
        await inflight;
        for (let i = 0; i < 20; i++) await Promise.resolve();
      },
    };
  }

  it("🚨 THE LIVE CASE: the peer does not follow a file out of the share", async () => {
    const rig = inboundRig(SHARE, { [INSIDE]: "the user's canvas" });

    await rig.deliver({ type: "rename", oldPath: INSIDE, newPath: OUTSIDE } as FileOp);

    // AC7, ON BYTES: the file is still where it was, with its content.
    expect(rig.vault.bytes.has(INSIDE)).toBe(true);
    expect(new TextDecoder().decode(rig.vault.bytes.get(INSIDE) as Uint8Array)).toBe(
      "the user's canvas",
    );
    // Nothing was created outside the share — `_w4wp97-outside/` was the live
    // symptom, a directory the PLUGIN made.
    expect(rig.vault.bytes.has(OUTSIDE)).toBe(false);
    // ZERO mutation, against a journal of every mutating call rather than a
    // hand-picked few.
    expect(rig.vault.journal).toEqual([]);
    // …and it never even reached `applyRemoteOp`, so no mute was taken.
    expect(rig.admitted).toEqual([]);
    // AC3-style observability: refused, counted, and said out loud.
    expect(rig.manager.getEscapingRenameRefusals()).toBe(1);
    expect(rig.warnings.some((w) => w.includes("leaves the shared folder"))).toBe(true);
  });

  it("POSITIVE CONTROL — a rename INSIDE the share is still applied", async () => {
    // Without this the row above passes against a rig that never renames
    // anything. The journal must be NON-empty here.
    const rig = inboundRig(SHARE, { [INSIDE]: "the user's canvas" });

    await rig.deliver({
      type: "rename",
      oldPath: INSIDE,
      newPath: `${SHARE}/renamed.md`,
    } as FileOp);

    expect(rig.vault.journal.length).toBeGreaterThan(0);
    expect(rig.vault.bytes.has(`${SHARE}/renamed.md`)).toBe(true);
    expect(rig.manager.getEscapingRenameRefusals()).toBe(0);
  });

  it(`AC6 — both peers reach the same answer, ${ITERATIONS} runs`, async () => {
    // Peer disagreement was live: one removed its copy, one kept it. Two
    // independent rigs, same op, every run.
    const outcomes = new Set<string>();
    for (let i = 0; i < ITERATIONS; i++) {
      const b = inboundRig(SHARE, { [INSIDE]: "x" });
      const c = inboundRig(SHARE, { [INSIDE]: "x" });
      await b.deliver({ type: "rename", oldPath: INSIDE, newPath: OUTSIDE } as FileOp);
      await c.deliver({ type: "rename", oldPath: INSIDE, newPath: OUTSIDE } as FileOp);
      outcomes.add(`${b.vault.bytes.has(INSIDE)}:${c.vault.bytes.has(INSIDE)}`);
    }
    expect(outcomes.size).toBe(1);
    expect([...outcomes]).toEqual(["true:true"]);
  });
});
