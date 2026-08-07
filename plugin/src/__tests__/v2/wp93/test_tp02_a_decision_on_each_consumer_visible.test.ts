// WP93 / C93 AC2 — A DECISION, IN WRITING, ON EACH CONSUMER, AND THE THREE
// HAZARD ROWS ARE DRIVEN RATHER THAN ARGUED.
//
// THE DISPOSITION TABLE THIS FILE DRIVES. It is not uniform, and the charter is
// right that a uniform answer would be a finding rather than a shortcut:
//
//   A1 create   `applyRemoteOpInner` arms `["create","modify"]`, because a
//               `create` whose target already exists is applied with
//               `vault.modify`. The lazy release is CORRECT here — but only
//               because the release is keyed per op type. A `modify`-keyed
//               release would never fire for a fresh create. (T1)
//   A2 delete   arms `["delete"]`. CORRECT — and a delete whose target did not
//               exist emits nothing at all, which is the strand case the
//               ceiling exists for. (T2, T6)
//   A3 rename   arms `["rename","delete"]` on BOTH endpoints. CORRECT WITH ONE
//               THING STATED: the `pendingRename` chain the charter worries
//               about NEVER STARTS under a mute — `vault-events.ts`'s rename
//               gate returns before `renamedPaths.add`, so `onFileRename`,
//               `onFileRenamed`, `renameFile` and `handleRename` are all
//               downstream of the gate, not downstream of the release. There is
//               no mid-teardown window to lift the mute inside of. (T3)
//   A4 text     arms `["modify"]`. CORRECT. It is the clean case.
//   A5 binary   arms `["modify"]`. CORRECT, same shape as A4. (T4)
//   B1-B7      guard the OUTBOUND side. B1/B4/B6/B7 are entry checks and a
//               release-timing change cannot reach them: they run before any
//               await. B2/B3/B5 are POST-AWAIT RE-CHECKS and they are the rows
//               the change actually reaches — see T5 and the decision below.
//
//   ⚠ CANVAS-OWNED `.canvas` MODIFY: NO DISPOSITION, DELIBERATELY. WP91 removed
//     the mute from in front of canvas capture and the branch returns before the
//     text gate, so a canvas-owned `modify` reports no consumption and any mute
//     on that path is released by the ceiling exactly as before WP93. Putting a
//     mute-shaped signal back there is an abort criterion.
//
// THE DECISION ON THE THREE POST-AWAIT RE-CHECKS, one sentence each:
//   B2  (`onFileCreate`, after `readBinary`) — REFUSES if the path was muted at
//       ANY point during the read, not only if it is still muted when the read
//       returns.
//   B3  (`onFileCreate`, after `read`) — same.
//   B5  (`onFileModify`, after `readBinary`) — same.
// The reason is one sentence too: a mute taken and released inside the read
// window means a remote apply landed on this path while we were reading it, so
// the bytes in hand are the bytes we just applied and emitting them
// re-broadcasts our own apply. Before WP93 the re-check gave that answer only by
// accident of the timer outliving every read; now it is a property of the
// interval and is immune to release timing in both directions.
//
// WHAT WOULD MAKE EACH ROW FAIL — every one was broken and seen red; the
// messages are in the implementation report.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Rig, advance, createRig, mockFile, settle } from "./harness";

describe("WP93 AC2 — each consumer's disposition, driven", () => {
  let rig: Rig;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    rig?.destroy();
    vi.useRealTimers();
  });

  it("T1 — A1: an applied CREATE releases its mute on the vault `create`, with the clock never moved", async () => {
    rig = createRig({ clamped: true });
    await rig.fileOps.applyRemoteOp({ type: "create", path: "note.md", content: "hello" });
    await settle();

    // The precondition, asserted rather than assumed (AC5(c)): a real producer
    // really did take the mute, and it is still held while the event is in
    // flight.
    expect(rig.fileOps.isPathMuted("note.md")).toBe(true);
    expect(rig.muteLog.filter((e) => e.kind === "mute")).toHaveLength(1);

    await rig.deliverVaultEvents();

    // Released, and the clock has not advanced by one millisecond. Under the
    // clamped scheduler the ceiling cannot possibly have fired.
    expect(rig.fileOps.isPathMuted("note.md")).toBe(false);
    expect(rig.fileOps.getMuteReleaseStats().releasedByEvent).toBe(1);
    expect(rig.fileOps.getMuteReleaseStats().releasedByCeiling).toBe(0);
  });

  it("T1b — A1: a `modify`-KEYED release would never fire for a create, which is why the key is per op type", async () => {
    rig = createRig({ clamped: true });
    // The op arms `["create","modify"]`. Feeding it the wrong kind directly is
    // the shape a naive `modify`-only release would have: nothing is released.
    await rig.fileOps.applyRemoteOp({ type: "delete", path: "gone.md" });
    await settle();
    expect(rig.fileOps.isPathMuted("gone.md")).toBe(true);
    rig.fileOps.noteVaultEvent("gone.md", "modify");
    expect(rig.fileOps.isPathMuted("gone.md")).toBe(true); // a delete is not consumed by a modify
    rig.fileOps.noteVaultEvent("gone.md", "delete");
    expect(rig.fileOps.isPathMuted("gone.md")).toBe(false);
  });

  it("T2 — A2: an applied DELETE releases on the vault `delete`, and the outbound echo is suppressed on the way", async () => {
    rig = createRig({ clamped: true, initial: { "doomed.md": "x" } });
    await rig.fileOps.applyRemoteOp({ type: "delete", path: "doomed.md" });
    await settle();
    expect(rig.fileOps.isPathMuted("doomed.md")).toBe(true);

    await rig.deliverVaultEvents();
    expect(rig.fileOps.isPathMuted("doomed.md")).toBe(false);
    // I11 in the other direction: the mute did its job on the way out. Nothing
    // was re-broadcast.
    expect(rig.sent).toHaveLength(0);
    expect(rig.backgroundSync.onFileRemoved).not.toHaveBeenCalled();
  });

  it("T3 — A3, THE HAZARD ROW: a REMOTE rename's `pendingRename` chain never starts under the mute, so there is no mid-teardown window", async () => {
    rig = createRig({ clamped: true, initial: { "old.md": "body" } });
    await rig.fileOps.applyRemoteOp({ type: "rename", oldPath: "old.md", newPath: "new.md" });
    await settle();

    // BOTH endpoints are muted — `getOpPaths` returns oldPath and newPath.
    expect(rig.fileOps.isPathMuted("old.md")).toBe(true);
    expect(rig.fileOps.isPathMuted("new.md")).toBe(true);

    await rig.deliverVaultEvents();

    // The chain is DOWNSTREAM OF THE GATE, not downstream of the release: the
    // rename handler returns at `isPathMuted` before `renamedPaths.add`, so none
    // of these ever ran and none of them can observe a lifted mute.
    expect(rig.backgroundSync.onFileRenamed).not.toHaveBeenCalled();
    expect(rig.backgroundSync.cancelSubscribe).not.toHaveBeenCalled();
    expect(rig.canvasSync.handleRename).not.toHaveBeenCalled();
    expect(rig.manifest.renameFile).not.toHaveBeenCalled();
    expect(rig.sent).toHaveLength(0);

    // ONE event, TWO armed releases, and both are consumed.
    expect(rig.fileOps.isPathMuted("old.md")).toBe(false);
    expect(rig.fileOps.isPathMuted("new.md")).toBe(false);
    expect(rig.fileOps.getMuteReleaseStats().releasedByEvent).toBe(2);
  });

  it("T4 — A4/A5: an applied MODIFY releases on the vault `modify`, and neither the text arm nor the binary arm runs", async () => {
    rig = createRig({ clamped: true, initial: { "note.md": "before", "pic.png": "" } });
    await rig.fileOps.applyRemoteOp({ type: "modify", path: "note.md", content: "after" });
    await rig.fileOps.applyRemoteOp({
      type: "modify",
      path: "pic.png",
      content: "",
      binary: true,
    });
    await settle();
    expect(rig.fileOps.isPathMuted("note.md")).toBe(true);
    expect(rig.fileOps.isPathMuted("pic.png")).toBe(true);

    await rig.deliverVaultEvents();

    expect(rig.backgroundSync.handleLocalTextModify).not.toHaveBeenCalled();
    expect(rig.manifest.updateFile).not.toHaveBeenCalled();
    expect(rig.fileOps.isPathMuted("note.md")).toBe(false);
    expect(rig.fileOps.isPathMuted("pic.png")).toBe(false);
    expect(rig.fileOps.getMuteReleaseStats().releasedByEvent).toBe(2);
  });

  it("T5 — B2/B3/B5, THE POST-AWAIT RE-CHECKS: a mute taken AND RELEASED inside the awaited read still refuses the outbound push", async () => {
    rig = createRig({ clamped: true, initial: { "note.md": "on disk" } });
    // A GENUINELY DEFERRED read (AC2(c) forbids a synchronous fake): the outbound
    // push is parked inside `await vault.read` for as long as the test likes.
    const gate = rig.deferReads("note.md");
    const outbound = rig.fileOps.onFileCreate(mockFile("note.md"));
    await settle();
    expect(rig.sent).toHaveLength(0); // still reading

    // A remote apply lands on the same path WHILE the read is parked, and its
    // mute is released by its own vault event before the read returns. This is
    // the case the pre-WP93 250 ms timer made unreachable and the lazy release
    // makes ordinary.
    await rig.fileOps.applyRemoteOp({ type: "modify", path: "note.md", content: "applied" });
    await settle();
    await rig.deliverVaultEvents();
    expect(rig.fileOps.isPathMuted("note.md")).toBe(false); // released mid-read

    gate.resolve("on disk");
    await outbound;
    await settle();

    // THE DECISION: refused. `isPathMuted` reads FALSE at the instant of the
    // re-check, so a re-check that only asked the refcount would have emitted
    // here — and would have re-broadcast the bytes the apply just landed.
    expect(rig.fileOps.isPathMuted("note.md")).toBe(false);
    expect(rig.sent).toHaveLength(0);
  });

  it("T5b — CONTROL for T5: with no mute taken during the same deferred read, the outbound push IS emitted", async () => {
    rig = createRig({ clamped: true, initial: { "note.md": "on disk" } });
    const gate = rig.deferReads("note.md");
    const outbound = rig.fileOps.onFileCreate(mockFile("note.md"));
    await settle();
    gate.resolve("on disk");
    await outbound;
    await settle();

    // Without this row T5 is green for any implementation that never emits.
    expect(rig.sent).toEqual([{ type: "create", path: "note.md", content: "on disk" }]);
  });

  it("T6 — THE DEGENERATE CASE: a mutation that emits NO vault event is released by the CEILING, not by an event", async () => {
    rig = createRig({ initial: {} });
    // A delete of a path that is not there. `applyRemoteOpInner`'s delete branch
    // finds nothing, calls no vault method and therefore emits nothing — the
    // same shape as `background-sync.ts`'s byte-identical write, which returns
    // before writing and produces no `modify` at all.
    await rig.fileOps.applyRemoteOp({ type: "delete", path: "never-existed.md" });
    await settle();
    await rig.deliverVaultEvents();
    expect(rig.pendingVaultEvents).toHaveLength(0); // no event, by construction
    expect(rig.fileOps.isPathMuted("never-existed.md")).toBe(true);

    await advance(250);
    expect(rig.fileOps.isPathMuted("never-existed.md")).toBe(false);
    const stats = rig.fileOps.getMuteReleaseStats();
    expect(stats.releasedByCeiling).toBe(1);
    expect(stats.releasedByEvent).toBe(0);
    // Unclamped, the ceiling is not an overrun: it landed on time.
    expect(stats.overruns).toBe(0);
  });

  it("T6b — CONTROL for T6: with the CEILING removed, the same degenerate case STRANDS the refcount forever", async () => {
    rig = createRig({ initial: {} });
    // This is what a PURELY lazy release does, and it is why WP93 is an
    // inversion rather than a replacement. `mutedPaths` has no sweeper and no
    // clock, so an un-decremented count drops every vault event for that path
    // for the rest of the session.
    rig.fileOps.mutePathEvents("stranded.md");
    rig.fileOps.armMuteRelease("stranded.md", {
      consumes: ["delete"],
      // `2 ** 31 - 1` and NOT `MAX_SAFE_INTEGER`: a `setTimeout` delay above
      // 2^31-1 overflows and is silently clamped to 1 ms by the runtime, which
      // fires this "never" timer immediately and makes the control green for
      // the wrong reason. Seen doing exactly that on this row's first run.
      ceilingMs: 2 ** 31 - 1,
    });
    expect(rig.fileOps.isPathMuted("stranded.md")).toBe(true);

    await advance(10 * 60 * 1000); // ten minutes of simulated time
    expect(rig.fileOps.isPathMuted("stranded.md")).toBe(true);
    expect(rig.fileOps.getMuteReleaseStats().pending).toBe(1);
    // A permanent silent freeze of that path: this work package's own defect
    // with an infinite window. T6 is the row that shows the shipped code does
    // not do this.
  });
});
