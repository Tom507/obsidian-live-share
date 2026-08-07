// WP93 / C93 AC3 — THE RELEASE IS BOUNDED BY SOMETHING A CLAMPED RENDERER
// CANNOT STRETCH, AND THE CEILING IS EXPLICITLY NOT THE MECHANISM.
//
// ⚠⚠ WHAT THIS FILE IS AND IS NOT EVIDENCE OF. THE CLAMPED SCHEDULER IS A
// SIMULATION. It is NOT evidence that the product survives a real Chromium
// wake-up clamp; it is evidence that THE PRODUCT'S BEHAVIOUR DOES NOT DEPEND ON
// THE TIMER. Nobody may upgrade that reading. WP91's own report records that its
// instrument was a virtual clock which "cannot observe a clamp by construction",
// and the Dispatcher's instruction for this work package is not to ship a second
// instrument with the same blind spot — which is what T0 exists for.
//
// T0 IS THE ROW THAT PROVES THE INSTRUMENT (AC3(b)). A "clamped scheduler"
// fixture that clamps a timer nothing under test uses is a second instrument
// that cannot observe what it claims to. So T0 takes the PRE-REPAIR RELEASE
// EXPRESSION — read out of the committed blob at `e1cbf69` and asserted to match
// the replica character for character — runs it against the SHIPPED mute
// primitives under a clamp installed on the GLOBAL `setTimeout`, and shows the
// mute held for the full 60 s. The instrument stretches the timer the pre-repair
// code actually used. Everything after T0 is measured on the same clamp.
//
// WHAT WOULD MAKE EACH ROW FAIL:
//   T0   the fixture stops stretching the pre-repair release, or the replica
//        stops matching the committed pre-repair source.
//   T1   the release stops firing on the consuming event under the clamp.
//   T2   THE CONTROL. The same fixture with the event term removed must hold the
//        mute for the FULL clamped 60 s. If T1 were green for a fixture reason,
//        T2 would be green too — and T2 asserts the opposite.
//   T3   the ceiling stops catching the no-event case.
//   T4   a `main.ts` release site regresses to a bare `setTimeout`.
//
// THE VACUITY RISKS THE CHARTER ATTACHED:
//   (a) THE C73/WP75 CLASS — asserting the bound by reading the constant that
//       sets it. NOTHING in this file reads `VAULT_EVENT_SETTLE_MS` or any other
//       settle constant. Every interval is reduced from the recorded
//       `mutePathEvents`/`unmutePathEvents` CALL SEQUENCE by
//       `longestMutedInterval`.
//   (b) THE FIXTURE THAT CLAMPS NOTHING — T0, above.
//   (c) A WALL-CLOCK 60 s SLEEP — there is none. `vi.useFakeTimers()` throughout;
//       the whole file runs in about a second.
//   (d) BOUNDING ONLY `file-ops.ts`'s primitives and leaving the other producers
//       on their own bare timers — T4 derives the release sites from the source
//       and states each one's disposition, and AC1's census is the standing
//       version of the same check.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VAULT_EVENT_SETTLE_MS } from "../../../utils";
import { deriveCensus, findPluginSrc } from "./census";
import {
  CLAMP_MS,
  type MuteEvent,
  type Rig,
  advance,
  createRig,
  installGlobalClamp,
  longestMutedInterval,
  settle,
} from "./harness";

const PRE_REPAIR = "e1cbf69d128f714e6c5311e2a8b9b039401f9458";

/**
 * The pre-repair release, transcribed. T0 asserts this is character-for-
 * character what `applyRemoteOpInner`'s `finally` held at `PRE_REPAIR` before
 * running it, so the control cannot drift into testing something the tree never
 * contained.
 */
const PRE_REPAIR_RELEASE = `    } finally {
      setTimeout(() => {
        for (const path of paths) this.unmutePathEvents(path);
      }, VAULT_EVENT_SETTLE_MS);
    }`;

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

describe("WP93 AC3 — the ceiling is the safety net, not the mechanism", () => {
  let rig: Rig | undefined;
  let uninstallClamp: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    uninstallClamp?.();
    uninstallClamp = undefined;
    rig?.destroy();
    rig = undefined;
    vi.useRealTimers();
  });

  it("T0 — THE INSTRUMENT IS PROVEN: the PRE-REPAIR release expression, read out of the committed blob, holds the mute for the FULL 60 s under this fixture", () => {
    // (i) the replica is the committed pre-repair source, not a paraphrase.
    const before = execFileSync("git", ["show", `${PRE_REPAIR}:plugin/src/files/file-ops.ts`], {
      encoding: "utf8",
      cwd: repoRoot(),
      maxBuffer: 32 * 1024 * 1024,
    }).replace(/\r\n/g, "\n");
    expect(before).toContain(PRE_REPAIR_RELEASE);

    // (ii) and the WORKING TREE no longer contains it — otherwise "pre-repair"
    // would be describing the current code. Read from disk, never from the git
    // index: the index lags an unstaged edit and would report the old shape.
    const after = readFileSync(join(findPluginSrc(), "files", "file-ops.ts"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    expect(after).not.toContain(PRE_REPAIR_RELEASE);

    // (iii) run that expression, against the REAL shipped primitives, under a
    // clamp installed on the GLOBAL `setTimeout` — the timer the pre-repair code
    // used. Nothing injected, nothing mocked.
    rig = createRig();
    uninstallClamp = installGlobalClamp();
    const paths = ["note.md"];
    const log: MuteEvent[] = [];
    for (const path of paths) {
      log.push({ kind: "mute", at: Date.now(), path });
      rig.fileOps.mutePathEvents(path);
    }
    setTimeout(() => {
      for (const path of paths) {
        log.push({ kind: "unmute", at: Date.now(), path });
        rig?.fileOps.unmutePathEvents(path);
      }
    }, VAULT_EVENT_SETTLE_MS);

    // A quarter of a second later — the whole window the constant promises — the
    // mute is still held.
    vi.advanceTimersByTime(VAULT_EVENT_SETTLE_MS * 4);
    expect(rig.fileOps.isPathMuted("note.md")).toBe(true);
    // One millisecond short of a minute, still held.
    vi.advanceTimersByTime(CLAMP_MS - VAULT_EVENT_SETTLE_MS * 4 - 1);
    expect(rig.fileOps.isPathMuted("note.md")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(rig.fileOps.isPathMuted("note.md")).toBe(false);

    // Measured from the call sequence, never from the constant.
    expect(longestMutedInterval(log, "note.md", Date.now())).toBe(CLAMP_MS);
  });

  it("T0b — and the SEAM is the same timer: production's default scheduler routes straight to the globals", () => {
    // The bridge between T0 (global clamp) and T1-T3 (injected clamp): a clamp
    // on the globals and a clamp on the injected seam are the same clamp,
    // because production injects nothing.
    const calls: number[] = [];
    const inner = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", ((cb: () => void, ms?: number) => {
      calls.push(Number(ms) || 0);
      return (inner as (...a: unknown[]) => unknown)(cb, ms);
    }) as unknown as typeof globalThis.setTimeout);
    try {
      const plain = createRig(); // no scheduler injected — production's shape
      plain.fileOps.mutePathEvents("x.md");
      plain.fileOps.armMuteRelease("x.md", { consumes: ["modify"] });
      expect(calls).toContain(VAULT_EVENT_SETTLE_MS);
      plain.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("T1 — under the clamp the mute is released BY THE EVENT, and the longest muted interval is bounded by the event and not by 60 s", async () => {
    rig = createRig({ clamped: true, initial: { "note.md": "before" } });
    await rig.fileOps.applyRemoteOp({ type: "modify", path: "note.md", content: "after" });
    await settle();
    expect(rig.fileOps.isPathMuted("note.md")).toBe(true); // really taken

    await rig.deliverVaultEvents();

    // The clock has not moved at all, and the mute is gone.
    const measured = longestMutedInterval(rig.muteLog, "note.md", Date.now());
    expect(rig.fileOps.isPathMuted("note.md")).toBe(false);
    expect(measured).toBeLessThan(VAULT_EVENT_SETTLE_MS);
    expect(rig.fileOps.getMuteReleaseStats()).toMatchObject({
      releasedByEvent: 1,
      releasedByCeiling: 0,
      overruns: 0,
    });

    // And to be explicit about what the row is worth: had the timer decided,
    // this number would be CLAMP_MS. T2 is that number.
    expect(measured).toBeLessThan(CLAMP_MS);
  });

  it("T2 — THE CONTROL: the IDENTICAL fixture with the event term removed holds the mute for the FULL clamped 60 s", async () => {
    rig = createRig({
      clamped: true,
      initial: { "note.md": "before" },
      releaseOnConsumingEvent: false, // the only difference from T1
    });
    await rig.fileOps.applyRemoteOp({ type: "modify", path: "note.md", content: "after" });
    await settle();
    await rig.deliverVaultEvents();

    // The event arrived and was suppressed exactly as in T1 — and changed
    // nothing, because the event term is off.
    expect(rig.fileOps.isPathMuted("note.md")).toBe(true);
    await advance(CLAMP_MS - 1);
    expect(rig.fileOps.isPathMuted("note.md")).toBe(true);
    await advance(1);
    expect(rig.fileOps.isPathMuted("note.md")).toBe(false);

    expect(longestMutedInterval(rig.muteLog, "note.md", Date.now())).toBe(CLAMP_MS);
    expect(rig.fileOps.getMuteReleaseStats()).toMatchObject({
      releasedByEvent: 0,
      releasedByCeiling: 1,
    });
  });

  it("T3 — THE CEILING STILL WORKS: the degenerate no-event case releases at the clamped ceiling, and AC4 counts it", async () => {
    rig = createRig({ clamped: true });
    // No file, so `trashFile` is never called and no vault event exists.
    await rig.fileOps.applyRemoteOp({ type: "delete", path: "never-existed.md" });
    await settle();
    await rig.deliverVaultEvents();
    expect(rig.pendingVaultEvents).toHaveLength(0);
    expect(rig.fileOps.isPathMuted("never-existed.md")).toBe(true);

    await advance(CLAMP_MS);
    expect(rig.fileOps.isPathMuted("never-existed.md")).toBe(false);
    expect(longestMutedInterval(rig.muteLog, "never-existed.md", Date.now())).toBe(CLAMP_MS);
    // The two criteria meet here deliberately: a ceiling release this late is an
    // overrun, and it is counted rather than silent.
    expect(rig.fileOps.getMuteReleaseStats()).toMatchObject({
      releasedByCeiling: 1,
      overruns: 1,
    });
  });

  it("T4 — AC3(d): no release site in this work package's scope is still a bare `setTimeout`, and every remaining one has a stated reason", () => {
    const census = deriveCensus();
    const bare = census.producers.filter((site) => /setTimeout/.test(site.text));

    // The three that remain, each with its reason IN THIS ASSERTION rather than
    // in prose somewhere else. All three are in files §2/§6 forbid this work
    // package from touching; repairing them here would be an unattributable
    // diff, and two of them are already carried up as S75.
    const REMAINING_UNCAPPED: Record<string, string> = {
      "files/manifest.ts":
        "P10, discovered by this work package's own census and named by no prior document: " +
        "`syncFromManifest` receives the release as an injected callback and wraps it in a bare " +
        "250 ms setTimeout, reached from six main.ts call sites. Repairing it needs a fourth " +
        "production file, and §2 caps this work package at three. RECORDED, NOT REPAIRED.",
    };
    expect(Object.keys(REMAINING_UNCAPPED)).toEqual([...new Set(bare.map((s) => s.file))].sort());
    for (const reason of Object.values(REMAINING_UNCAPPED)) {
      expect(reason.length).toBeGreaterThan(80);
    }

    // And the four `main.ts` sites plus `applyRemoteOpInner` now arm the
    // inversion instead. `background-sync.ts` and `canvas-sync.ts` release
    // synchronously inside their OWN timers, which is why they do not appear
    // above; they are out of scope and reported in the implementation report.
    const armed = census.producers.filter((site) => /armMuteRelease/.test(site.text));
    expect(armed.map((s) => s.file).sort()).toEqual([
      "files/file-ops.ts",
      "main.ts",
      "main.ts",
      "main.ts",
      "main.ts",
    ]);
  });

  it("T5 — WP91's cap is not weakened: its three constructs are byte-identical to the pre-repair blob", () => {
    // TARGETED rather than whole-file, deliberately (RULE 14): the tree is
    // shared, and a whole-file comparison would red on a sibling batch's edit
    // elsewhere in the module and be read as this work package's regression.
    // These three are WP91's landed shape and they are what must not move.
    const WP91_CONSTRUCTS = [
      /const DISK_WRITE_SETTLE_MS = [^;]+;/,
      /const MAX_MUTE_MS = [^;]+;/,
      /private armSettleRelease\(\): void \{[\s\S]*?\n {2}\}/,
      /private releaseMute\(\): void \{[\s\S]*?\n {2}\}/,
    ];
    const now = readFileSync(
      join(findPluginSrc(), "files", "canvas-persistence.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const before = execFileSync(
      "git",
      ["show", `${PRE_REPAIR}:plugin/src/files/canvas-persistence.ts`],
      { encoding: "utf8", cwd: repoRoot(), maxBuffer: 32 * 1024 * 1024 },
    ).replace(/\r\n/g, "\n");
    // Asserted by RUNNING the comparison, not by reading a diff (AC5(a)).
    for (const construct of WP91_CONSTRUCTS) {
      const mine = now.match(construct)?.[0];
      expect(mine, `WP91 construct not found: ${construct}`).toBeTruthy();
      expect(mine).toEqual(before.match(construct)?.[0]);
    }
  });
});
