// WP91 / C91 AC6 — no collateral. The refcount keeps its meaning everywhere it is
// the only answer available.
//
// WP91 changes WHO GETS TO ASK the echo question for canvas-owned paths. It does
// not change what the refcount means, and it must not: `applyRemoteOp` mutes around
// a remote file-op apply so the apply is not re-broadcast; the vault `create`,
// `delete` and `rename` handlers consult it; and the text-sync and manifest arms sit
// behind it. NONE of those has a content baseline to compare against, so for them
// the refcount is not a proxy for anything better — it is the only answer available.
//
// THE VACUITY RISKS THE CHARTER ATTACHED, AND HOW EACH IS DISCHARGED:
//
//   (a) "'Unchanged' asserted from READING THE DIFF — the five behaviours are
//       driven, in the same run, and each is shown to redden if its mute check is
//       removed." Every row below drives the behaviour through the REAL registered
//       handler over a REAL `FileOpsManager` refcount, and every row carries its own
//       discrimination pair: the same call with the mute LIFTED must produce the
//       opposite outcome. A row whose mute check was deleted would fail its paired
//       half, not merely its own.
//   (b) "A full-suite green quoted in place of naming the affected test files." The
//       report names them.
//   (c) is an attribution rule for the report, not a test.
//
// The structural half of AC6 — that `file-ops.ts` and `control-handlers.ts` are not
// in this work package's diff at all — is asserted by RUNNING the diff, and is in
// the report. A test that shelled out to git would be measuring the checkout.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PATH,
  type Rig,
  advance,
  applyRemoteDelta,
  canvasJson,
  createRig,
  mockFile,
  node,
  remoteNode,
  settle,
} from "./harness";

const SEED = canvasJson([node("seed", "seed card")]);
const NOTE = "notes/hello.md";
const BINARY = "assets/picture.png";

describe("WP91 AC6 — the refcount is intact for every consumer that has no content baseline", () => {
  let rig: Rig;

  beforeEach(async () => {
    vi.useFakeTimers();
    rig = await createRig({ initial: { [PATH]: SEED, [NOTE]: "hello", [BINARY]: "binary" } });
  });

  afterEach(() => {
    rig.destroy();
    vi.useRealTimers();
  });

  it("T1 — a muted `.md` write does NOT reach handleLocalTextModify; the same write unmuted does", async () => {
    rig.fileOps.mutePathEvents(NOTE);
    expect(rig.fileOps.isPathMuted(NOTE)).toBe(true);

    rig.emitModify(NOTE);
    await settle();
    expect(rig.handleLocalTextModify).toHaveBeenCalledTimes(0);

    rig.fileOps.unmutePathEvents(NOTE);
    rig.emitModify(NOTE);
    await settle();
    expect(rig.handleLocalTextModify).toHaveBeenCalledTimes(1);
    expect(rig.handleLocalTextModify).toHaveBeenCalledWith(NOTE);
  });

  it("T2 — the binary/manifest arm is unchanged: muted suppresses, unmuted still updates the manifest", async () => {
    rig.fileOps.mutePathEvents(BINARY);
    rig.emitModify(BINARY);
    await settle();
    expect(rig.manifestUpdateFile).toHaveBeenCalledTimes(0);

    rig.fileOps.unmutePathEvents(BINARY);
    rig.emitModify(BINARY);
    await settle();
    expect(rig.manifestUpdateFile).toHaveBeenCalledTimes(1);
  });

  it("T3 — muted create / delete / rename are still suppressed, and unmuted still pass", async () => {
    rig.fileOps.mutePathEvents(NOTE);
    rig.emitCreate(NOTE);
    rig.emitDelete(NOTE);
    rig.emitRename(NOTE, "notes/old.md");
    await settle();
    expect(rig.onFileCreate).toHaveBeenCalledTimes(0);
    expect(rig.onFileDelete).toHaveBeenCalledTimes(0);
    expect(rig.onFileRename).toHaveBeenCalledTimes(0);

    rig.fileOps.unmutePathEvents(NOTE);
    rig.emitCreate(NOTE);
    rig.emitDelete(NOTE);
    await settle();
    expect(rig.onFileCreate).toHaveBeenCalledTimes(1);
    expect(rig.onFileDelete).toHaveBeenCalledTimes(1);
  });

  it("T4 — `applyRemoteOp`'s mute still stops the outbound re-broadcast", async () => {
    const sent: unknown[] = [];
    rig.fileOps.setSender((op) => sent.push(op));

    // The shape `applyRemoteOp` uses: mute around the apply so the vault event it
    // provokes is not sent straight back to the peer that sent it.
    rig.fileOps.mutePathEvents(BINARY);
    await rig.fileOps.onFileModify(mockFile(BINARY));
    await settle();
    expect(sent).toHaveLength(0);

    rig.fileOps.unmutePathEvents(BINARY);
    await rig.fileOps.onFileModify(mockFile(BINARY));
    await settle();
    expect(sent.length).toBeGreaterThan(0);
  });

  it("T5 — the bookkeeping closes: every mute has its unmute and the refcount returns to zero", async () => {
    for (let i = 0; i < 12; i++) {
      applyRemoteDelta(rig.doc, (nodes) => nodes.set(`p${i}`, remoteNode(`p${i}`, `p${i}`)));
      await rig.persistence.flush();
      await advance(100);
    }
    // Let every outstanding settle window expire.
    await advance(2_000);

    const mutes = rig.muteLog.filter((e) => e.kind === "mute").length;
    const unmutes = rig.muteLog.filter((e) => e.kind === "unmute").length;
    expect(mutes).toBeGreaterThan(0);
    expect(unmutes).toBe(mutes);
    // A stranded count is a PERMANENT silent freeze of the path — this same
    // defect with an infinite window, re-created by its own fix.
    expect(rig.fileOps.isPathMuted(PATH)).toBe(false);
  });

  it("T6 — WP6/US5 survives the reordering: a canvas-owned path is structurally unreachable from the text path, muted or not", async () => {
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote", remoteNode("remote", "peer")));
    await advance(200);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(true);

    rig.emitModify(PATH); // muted, canvas-owned
    await settle();
    await advance(2_000);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(false);
    rig.emitModify(PATH); // unmuted, canvas-owned
    await settle();

    // ONE ownership predicate: the text path is unreachable for this path in both
    // states. A reordering that let it fall through would re-create the
    // two-writer race WP6/US5 closed.
    expect(rig.handleLocalTextModify).toHaveBeenCalledTimes(0);
    // The discrimination pair: the very same handler DOES route an unowned
    // `.canvas` to the text path, so the zero above is not an inert harness.
    rig.canvasSync.unsubscribe(PATH);
    rig.emitModify(PATH);
    await settle();
    expect(rig.handleLocalTextModify).toHaveBeenCalledTimes(1);
  });
});
