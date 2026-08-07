// WP93 / C93 AC5 — NO COLLATERAL, IN BOTH DIRECTIONS.
//
// I11 binds both ways here and that is the reason this file exists:
//   ├── A RELEASE THAT FIRES EARLY turns a suppressed echo into a re-broadcast,
//   │   and on the text and binary modify gates into a capture of our own write.
//   └── A RELEASE THAT FIRES LATE OR NEVER is a PERMANENT SILENT FREEZE of that
//       path — `mutedPaths` has no sweeper and no clock, so an un-decremented
//       count drops every vault event for that path for the rest of the session.
//
// THE VACUITY RISKS THE CHARTER ATTACHED:
//   (a) "unchanged" asserted by READING a diff rather than RUNNING one — T5 runs
//       the comparison, over the files §6 forbids, in both directions.
//   (b) a suite green quoted in place of naming the affected files — the
//       implementation report names them with counts; T5 is the structural half.
//   (c) THE KILLER: the eleven behaviours driven on a harness that never takes a
//       mute, so all of them are true of the UNMUTED case. Every row below
//       asserts the refcount is `> 0` AT THE INSTANT OF THE EVENT, and T0 shows
//       those assertions failing when the mute-acquire is removed from the
//       fixture — i.e. the fixture's mute is doing the work.
//   (d) attributing a red to a sibling batch without measuring it — T5 attributes
//       by a WP93 MARKER rather than by a whole-file diff, because it was written
//       as a whole-file diff first and MEASURED failing on a sibling's transient
//       patch. See the comment on T5 itself.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveCensus, findPluginSrc } from "./census";
import { type Rig, advance, createRig, mockFile, settle } from "./harness";

describe("WP93 AC5 — no collateral, and the refcount always lands on zero", () => {
  let rig: Rig | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    rig?.destroy();
    rig = undefined;
    vi.useRealTimers();
  });

  it("T0 — THE FIXTURE'S MUTE IS DOING THE WORK: with no mute taken, the same events reach every consumer", async () => {
    // AC5(c)'s discharge. If this row were green the same way T1 is, T1 would be
    // measuring nothing: it would be true of any implementation, muted or not.
    rig = createRig({ initial: { "note.md": "x" } });
    expect(rig.fileOps.isPathMuted("note.md")).toBe(false);

    // Deliver each event with NO mute held. Every consumer runs.
    rig.pendingVaultEvents.push(
      { event: "modify", args: [mockFile("note.md")] },
      { event: "delete", args: [mockFile("note.md")] },
      { event: "create", args: [mockFile("fresh.md")] },
      { event: "rename", args: [mockFile("new.md"), "old.md"] },
    );
    await rig.deliverVaultEvents();

    expect(rig.backgroundSync.handleLocalTextModify).toHaveBeenCalled();
    expect(rig.backgroundSync.onFileRemoved).toHaveBeenCalled();
    expect(rig.manifest.removeFile).toHaveBeenCalled();
    expect(rig.backgroundSync.onFileRenamed).toHaveBeenCalled();
    expect(rig.canvasSync.handleRename).toHaveBeenCalled();
  });

  it("T1 — A1-A5: with the mute HELD at the instant of the event, every one of the five gates still suppresses", async () => {
    rig = createRig({
      clamped: true,
      initial: { "note.md": "x", "pic.png": "", "old.md": "o", "doomed.md": "d" },
    });
    // EVERY mute here is taken by a REAL producer running a real op — never by
    // hand. That is AC5(c)'s precondition, and T0 above is what shows the
    // assertions below would go red without it.
    await rig.fileOps.applyRemoteOp({ type: "modify", path: "note.md", content: "y" });
    await rig.fileOps.applyRemoteOp({ type: "modify", path: "pic.png", content: "", binary: true });
    await rig.fileOps.applyRemoteOp({ type: "create", path: "fresh.md", content: "f" });
    await rig.fileOps.applyRemoteOp({ type: "delete", path: "doomed.md" });
    await rig.fileOps.applyRemoteOp({ type: "rename", oldPath: "old.md", newPath: "new.md" });
    await settle();

    // Discard the events those applies produced. This row measures THE GATES,
    // and a delivered event would release the mute it was gated by — which is
    // tp03's subject, and delivering it here would leave later gates in this
    // same row unmuted. (Seen doing exactly that: the buffered `modify` released
    // `note.md` and the synthetic `delete` that followed reached
    // `backgroundSync.onFileRemoved`.)
    rig.pendingVaultEvents.length = 0;

    // THE PRECONDITION, ASSERTED (AC5(c)): the refcount is non-zero right now.
    for (const path of ["note.md", "pic.png", "fresh.md", "doomed.md", "old.md", "new.md"]) {
      expect(rig.fileOps.isPathMuted(path), `${path} is not muted`).toBe(true);
    }

    // ONE PATH PER GATE, deliberately. A mute suppresses ONE echo and is then
    // consumed — that is the whole design — so two events on one path would see
    // the second arrive unmuted, which is correct behaviour and would make this
    // row measure the release instead of the gates. (Seen doing exactly that.)
    rig.pendingVaultEvents.push(
      { event: "modify", args: [mockFile("note.md")] }, // A4 text
      { event: "modify", args: [mockFile("pic.png")] }, // A5 binary
      { event: "delete", args: [mockFile("doomed.md")] }, // A2
      { event: "create", args: [mockFile("fresh.md")] }, // A1
      { event: "rename", args: [mockFile("new.md"), "old.md"] }, // A3
    );
    await rig.deliverVaultEvents();

    // A1 create, A2 delete, A3 rename, A4 text-modify, A5 binary-modify: not one
    // of them reached its consumer, and the host's manifest arms behind A1/A2/A5
    // did not run either.
    expect(rig.backgroundSync.handleLocalTextModify).not.toHaveBeenCalled();
    expect(rig.backgroundSync.onFileRemoved).not.toHaveBeenCalled();
    expect(rig.backgroundSync.onFileRenamed).not.toHaveBeenCalled();
    expect(rig.canvasSync.handleRename).not.toHaveBeenCalled();
    expect(rig.manifest.removeFile).not.toHaveBeenCalled();
    expect(rig.manifest.updateFile).not.toHaveBeenCalled();
    expect(rig.manifest.addFolder).not.toHaveBeenCalled();
    // B1-B7: the outbound side refused too. Nothing was emitted at all.
    expect(rig.sent).toHaveLength(0);
  });

  // ⚠ THE COMPLEMENT, RUN AS A CENSUS — which of the four entry checks this row
  // can actually observe on its own. Each was deleted in turn and the suite
  // re-run; these are the measured results, not a prediction:
  //
  //   B1  `onFileCreate` entry  ── REDDENS NOTHING. The push is still refused,
  //                                by B3's post-await re-check one seam later.
  //   B4  `onFileModify` entry  ── REDDENS NOTHING, for the same reason (B5).
  //   B6  `onFileDelete` entry  ── REDS. `onFileDelete` is synchronous and has
  //                                no re-check; the entry check is the only one.
  //   B7  `onFileRename` entry  ── REDS. Same, and it guards BOTH endpoints.
  //
  // The two that redden nothing are NOT a hole in this row: they are the
  // belt-and-braces the charter describes, and the measurement is that the
  // braces hold when the belt is cut. What it does mean is that this row is
  // evidence for B6 and B7 specifically, and that B1/B4 are evidenced by T1 and
  // by tp02 T5 instead. Saying which is which is the point of running the
  // complement rather than asserting a green over all four.
  it("T2 — B1/B4/B6/B7: the four ENTRY checks still refuse the outbound push for a path we are applying", async () => {
    rig = createRig({ clamped: true, initial: { "note.md": "x", "pic.png": "" } });
    rig.fileOps.mutePathEvents("note.md");
    rig.fileOps.mutePathEvents("pic.png");
    expect(rig.fileOps.isPathMuted("note.md")).toBe(true);

    await rig.fileOps.onFileCreate(mockFile("note.md")); // B1 (+ B3 downstream)
    await rig.fileOps.onFileModify(mockFile("pic.png")); // B4 (+ B5 downstream)
    rig.fileOps.onFileDelete(mockFile("note.md")); // B6
    rig.fileOps.onFileRename(mockFile("note.md"), "pic.png"); // B7, both endpoints
    await settle();

    expect(rig.sent).toHaveLength(0);
  });

  it("T3 — THE STRAND, ASSERTED POSITIVELY: after every driven scenario the refcount is ZERO for every path touched", async () => {
    rig = createRig({ clamped: true, initial: { "a.md": "1", "b.png": "", "old.md": "o" } });

    await rig.fileOps.applyRemoteOp({ type: "create", path: "new.md", content: "n" });
    await rig.fileOps.applyRemoteOp({ type: "modify", path: "a.md", content: "2" });
    await rig.fileOps.applyRemoteOp({ type: "modify", path: "b.png", content: "", binary: true });
    await rig.fileOps.applyRemoteOp({ type: "delete", path: "a.md" });
    await rig.fileOps.applyRemoteOp({ type: "rename", oldPath: "old.md", newPath: "moved.md" });
    await rig.fileOps.applyRemoteOp({ type: "folder-create", path: "subdir" });
    // Two that emit NOTHING and therefore can only be released by the ceiling.
    await rig.fileOps.applyRemoteOp({ type: "delete", path: "absent.md" });
    await rig.fileOps.applyRemoteOp({ type: "chunk-start", path: "big.bin", totalSize: 10 });
    await settle();
    await rig.deliverVaultEvents();
    // The ceiling, clamped, for whatever the events did not consume.
    await advance(60_000);

    for (const path of [
      "a.md",
      "b.png",
      "new.md",
      "old.md",
      "moved.md",
      "subdir",
      "absent.md",
      "big.bin",
    ]) {
      expect(rig.fileOps.isPathMuted(path), `mute stranded on ${path}`).toBe(false);
    }
    // Nothing is still armed: a pending release IS a held mute.
    expect(rig.fileOps.getMuteReleaseStats().pending).toBe(0);
    // Balanced primitives: every take has exactly one matching release.
    const mutes = rig.muteLog.filter((e) => e.kind === "mute").length;
    const unmutes = rig.muteLog.filter((e) => e.kind === "unmute").length;
    expect({ mutes, unmutes }).toEqual({ mutes: unmutes, unmutes });
    expect(mutes).toBeGreaterThan(8);
  });

  it("T4 — `destroy()` cancels every armed ceiling: a timer that outlived the manager would fire against a cleared refcount", async () => {
    const doomed = createRig({ clamped: true });
    await doomed.fileOps.applyRemoteOp({ type: "delete", path: "absent.md" });
    await settle();
    expect(doomed.fileOps.getMuteReleaseStats().pending).toBe(1);
    doomed.destroy();
    // IMMEDIATELY, not after the clock moves. Asserting `pending === 0` only
    // after advancing is green whether the timer was CANCELLED or merely FIRED
    // LATE — measured: removing the cancel loop from `destroy()` reddened
    // nothing until this line was added.
    expect(doomed.fileOps.getMuteReleaseStats().pending).toBe(0);
    const atDestroy = doomed.fileOps.getMuteReleaseStats();
    await advance(60_000);
    // And nothing fires afterwards: a release landing on a manager whose
    // refcount map has already been cleared would move a counter here.
    expect(doomed.fileOps.getMuteReleaseStats()).toEqual(atDestroy);
  });

  it("T5 — STRUCTURAL: the files §6 forbids are not in this work package's diff, asserted by RUNNING the comparison", () => {
    const src = findPluginSrc();
    const FORBIDDEN = [
      "files/canvas-sync.ts",
      "files/canvas-persistence.ts",
      "files/background-sync.ts",
      "sync/sync.ts",
      "sync/control-handlers.ts",
      "debug-logger.ts",
    ];
    // ⚠ ATTRIBUTED BY MARKER, NOT BY WHOLE-FILE DIFF — and this row was WRITTEN
    // as a whole-file diff first, and MEASURED failing for exactly the reason
    // vacuity risk (d) names. THE TREE IS SHARED (RULE 14): a sibling batch
    // transiently patches production files while running its own falsification
    // campaign, and a whole-file comparison against the pre-repair blob reds on
    // THEIR edit and reads as this work package's regression. Seen: two clean
    // full-suite runs 90 seconds apart, one green and one red on this row and on
    // tp01 T6, with `fileop-inject.test.ts` and `wp5/latency.test.ts` carrying
    // fresh mtimes and no `git status` entry — the signature of patch-run-restore.
    //
    // A marker cannot be produced by a sibling: nothing outside this work package
    // writes `WP93`. So the claim is made positively, in both directions.
    const MARKER = /\bWP93\b/;
    for (const name of [...FORBIDDEN, "files/canvas-sidecar.ts"]) {
      const now = readFileSync(join(src, ...name.split("/")), "utf8");
      expect(MARKER.test(now), `${name} carries a WP93 line and must not`).toBe(false);
    }
    // And the complement: EXACTLY the three files §2 allows carry the marker.
    const marked = deriveCensus()
      .countedFiles.filter((name) =>
        MARKER.test(readFileSync(join(src, ...name.split("/")), "utf8")),
      )
      .sort();
    expect(marked).toEqual(["files/file-ops.ts", "files/vault-events.ts", "main.ts"]);

    // `files/canvas-sidecar.ts` is uncommitted in the shared tree under a sibling
    // batch. It is included above (a marker test is safe on it) and deliberately
    // excluded from any content comparison, because a WP93 line in it would be
    // unattributable by construction and a sibling's line is not this batch's.
    expect(FORBIDDEN).not.toContain("files/canvas-sidecar.ts");
  });

  it("T6 — WP91's landed shape survives: the canvas branch still does NOT consult the mute", () => {
    const vaultEvents = readFileSync(
      join(findPluginSrc(), "files", "vault-events.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    // The region between the ownership predicate's `if` and its `return` is the
    // canvas branch. It must contain no mute question and no consumption signal:
    // WP91 removed the mute from in front of canvas capture, and putting
    // anything mute-shaped back is an abort criterion.
    const branch = vaultEvents.match(
      /if \(canvasSync && canvasOwned\(file\.path, canvasSync\)\) \{[\s\S]*?\n {8}\}/,
    )?.[0];
    expect(branch, "the canvas ownership branch was not found").toBeTruthy();
    const code = (branch ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/isPathMuted/);
    expect(code).not.toMatch(/noteMuteConsumed/);
    expect(code).toMatch(/handleLocalModify/);
  });
});
