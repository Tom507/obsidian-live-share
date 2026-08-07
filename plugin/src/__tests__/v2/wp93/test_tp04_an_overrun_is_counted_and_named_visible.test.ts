// WP93 / C93 AC4 — AN OVERRUN IS COUNTED AND NAMED.
//
// WHY THIS OUTRANKS THE REPAIR, and it is worth saying in the test file and not
// only in the report: the clamp reached WP91's stated ceiling and NOTHING IN THE
// PRODUCT NOTICED. S71 exists at all because `SyncManager` happens to measure
// its own pulse gap on every pulse and warn above a threshold; the mute measured
// nothing, so a 60 s mute and a 250 ms mute were the same observation from
// outside — silence. This criterion is the one that keeps its value even if the
// inversion turns out to be the wrong remedy for some consumer.
//
// ⚠ THE TRAP THIS CRITERION SETS FOR ITSELF, AND HOW IT IS DISCHARGED (AC4(a)).
// After AC3 lands, an overrun in the ORDINARY case is unreachable — so "zero
// overruns" becomes true for free, which is precisely the shape of B44's
// `[06] B: node gone`. A zero here would therefore be worth nothing on its own.
// So the PRIMARY observable of this file is a POSITIVE, NON-ZERO count under the
// clamped arm (T1), and the zero in the unclamped arm (T2) is admissible ONLY
// because T1 in the same run shows the counter can move. T3 runs both arms
// inside one test body so the pairing cannot be split by a later edit.
//
// WHAT WOULD MAKE EACH ROW FAIL:
//   T1  the counter stops advancing on a late release, or the worst-overshoot
//       figure stops tracking the clamp.
//   T2  a release inside its ceiling starts counting as an overrun.
//   T3  the two arms stop disagreeing — i.e. the counter reads the same under a
//       clamp and without one, which is the only way this instrument can be
//       broken and still look fine.
//   T4  `MUTE OVERRUN:` stops being emitted, or starts carrying a path.
//   T5  a second production emitter of the signature appears.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findPluginSrc, stripComments } from "./census";
import { CLAMP_MS, type Rig, advance, createRig, overrunLines, settle } from "./harness";

/** A mute nothing will ever consume, taken by a REAL producer: an applied delete
 * whose target does not exist calls no vault method and emits no event. This is
 * the same shape as `background-sync.ts`'s byte-identical write. */
async function armAnUnconsumableMute(rig: Rig, path: string): Promise<void> {
  await rig.fileOps.applyRemoteOp({ type: "delete", path });
  await settle();
  await rig.deliverVaultEvents();
  expect(rig.pendingVaultEvents).toHaveLength(0);
  expect(rig.fileOps.isPathMuted(path)).toBe(true);
}

describe("WP93 AC4 — an overrun is counted and named", () => {
  let rig: Rig | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    rig?.destroy();
    rig = undefined;
    vi.useRealTimers();
  });

  it("T1 — PRIMARY: under the clamp the overrun counter advances by EXACTLY ONE per late release, and every other counter is asserted in the same assertion", async () => {
    rig = createRig({ clamped: true });
    await armAnUnconsumableMute(rig, "never-existed.md");
    expect(rig.fileOps.getMuteReleaseStats().overruns).toBe(0); // not yet released

    await advance(CLAMP_MS);

    // EVERY counter in the accessor, in ONE assertion, so a change that moves a
    // neighbouring counter cannot hide behind a green on the one being watched.
    expect(rig.fileOps.getMuteReleaseStats()).toEqual({
      releasedByEvent: 0,
      releasedByCeiling: 1,
      overruns: 1,
      worstOverrunMs: CLAMP_MS - 250, // held 60 000, ceiling 250
      overrunsByClass: { text: 1 },
      pending: 0,
    });

    // A second one advances it by exactly one more, and no more.
    await armAnUnconsumableMute(rig, "also-gone.md");
    await advance(CLAMP_MS);
    expect(rig.fileOps.getMuteReleaseStats().overruns).toBe(2);
    expect(rig.fileOps.getMuteReleaseStats().releasedByCeiling).toBe(2);
  });

  it("T2 — the same traffic UNCLAMPED counts ZERO — admissible only because T1 showed the counter can move", async () => {
    rig = createRig(); // default scheduler: the real globals, no clamp
    await armAnUnconsumableMute(rig, "never-existed.md");
    await advance(250);

    expect(rig.fileOps.getMuteReleaseStats()).toEqual({
      releasedByEvent: 0,
      releasedByCeiling: 1, // the ceiling still released it — on time
      overruns: 0,
      worstOverrunMs: 0,
      overrunsByClass: {},
      pending: 0,
    });
    expect(overrunLines(rig.logs)).toHaveLength(0);
  });

  it("T3 — BOTH ARMS IN ONE RUN: clamped is non-zero, unclamped is zero, same traffic, same body", async () => {
    const clamped = createRig({ clamped: true });
    const plain = createRig();
    try {
      await armAnUnconsumableMute(clamped, "x.md");
      await armAnUnconsumableMute(plain, "x.md");
      await advance(CLAMP_MS);

      const a = clamped.fileOps.getMuteReleaseStats();
      const b = plain.fileOps.getMuteReleaseStats();
      expect(a.overruns).toBeGreaterThan(0);
      expect(b.overruns).toBe(0);
      // Both released. The difference is WHEN, and only the counter can say so.
      expect(a.releasedByCeiling).toBe(1);
      expect(b.releasedByCeiling).toBe(1);
      expect(clamped.fileOps.isPathMuted("x.md")).toBe(false);
      expect(plain.fileOps.isPathMuted("x.md")).toBe(false);
    } finally {
      clamped.destroy();
      plain.destroy();
    }
  });

  it("T4 — `MUTE OVERRUN:` is emitted, and it carries a path CLASS, a held time and a ceiling — never a path", async () => {
    rig = createRig({ clamped: true, initial: {} });
    await armAnUnconsumableMute(rig, "secret-project-notes.md");
    await advance(CLAMP_MS);

    const lines = overrunLines(rig.logs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`MUTE OVERRUN: text held=${CLAMP_MS}ms ceiling=250ms (overruns=1)`);
    // S62's lesson one subsystem over: a count is a diagnostic, a filename here
    // would put user data into a value other components may render.
    expect(lines[0]).not.toContain("secret");
    expect(lines[0]).not.toContain(".md");

    // The class is derived from the SHARED extension predicate, so the three
    // classes are real and distinguishable.
    await armAnUnconsumableMute(rig, "board.canvas");
    await armAnUnconsumableMute(rig, "image.png");
    await advance(CLAMP_MS);
    expect(rig.fileOps.getMuteReleaseStats().overrunsByClass).toEqual({
      text: 1,
      canvas: 1,
      binary: 1,
    });
  });

  it("T5 — the signature has EXACTLY ONE production emitter (BUILD_SPEC §10's rule, which `SEED REFUSAL STORE:` broke until B45)", () => {
    // COMMENT-STRIPPED, not grepped. Four production lines name the signature
    // and three of them are prose — a grep would report four emitters and a
    // hand-tuned "looks like a comment" regex would be a fifth thing to get
    // wrong. This uses the same strip AC1's census does.
    const root = findPluginSrc();
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
          walk(join(dir, entry.name), out);
        } else if (entry.name.endsWith(".ts")) out.push(join(dir, entry.name));
      }
      return out;
    };
    const emitters: string[] = [];
    let mentions = 0;
    for (const file of walk(root)) {
      const raw = readFileSync(file, "utf8");
      mentions += raw.match(/MUTE OVERRUN:/g)?.length ?? 0;
      const code = stripComments(raw);
      for (const _ of code.match(/MUTE OVERRUN:/g) ?? []) {
        emitters.push(file.slice(root.length + 1).replace(/\\/g, "/"));
      }
    }
    expect(emitters).toEqual(["files/file-ops.ts"]);
    // Both numbers on the record, as AC1(b) requires of every derived count.
    expect(mentions).toBeGreaterThan(emitters.length);
  });

  it("T6 — the counter is STATE, so a test can be an oracle over it: the accessor is read-only and does not reset", async () => {
    rig = createRig({ clamped: true });
    await armAnUnconsumableMute(rig, "gone.md");
    await advance(CLAMP_MS);
    const first = rig.fileOps.getMuteReleaseStats();
    const second = rig.fileOps.getMuteReleaseStats();
    expect(second).toEqual(first);
    // And mutating what the accessor returns cannot reach the manager's state.
    (second.overrunsByClass as Record<string, number>).text = 999;
    expect(rig.fileOps.getMuteReleaseStats().overrunsByClass).toEqual({ text: 1 });
  });
});
