// WP91 / C91 AC5 — the settle window has a stated ceiling, and the ceiling is NOT
// the fix.
//
// THE DECISION THIS FILE MEASURES. The re-arm is BOUNDED — not removed, and not
// relied upon.
//
//   ├── not REMOVED: `acquireMute` is documented as taking the mute "at most ONCE
//   │   per open settle window". Killing the re-arm produces mute churn in the
//   │   middle of a burst and re-opens the echo for the text-sync, file-op and
//   │   manifest consumers of `isPathMuted`, none of which has a content baseline.
//   │   That trades one defect for three.
//   ├── not RELIED UPON: discrimination is fixed by AC1-AC3, at the seam that can
//   │   see the bytes. If the cap were the whole fix, the next person to raise
//   │   `MAX_WAIT_MS` would silently re-open the defect.
//   └── BOUNDED: before WP91 the window's real length was a function of PEER
//       ACTIVITY and had no ceiling at all under sustained co-editing, while the
//       constant a reader found in the module said 250. A false constant on a data
//       path is the specific thing that made this defect hard to see.
//
// THE VACUITY RISKS THE CHARTER ATTACHED, AND HOW EACH IS DISCHARGED:
//
//   (a) THE C73/WP75 CLASS — "asserting the cap by reading the constant
//       (`expect(DISK_WRITE_SETTLE_MS).toBe(250)`) is a check on a constant, not a
//       measurement of behaviour." Nothing here reads a settle constant. The
//       observable is the recorded `mutePathEvents` / `unmutePathEvents` call
//       SEQUENCE, stamped on the clock, reduced by `longestMutedInterval`.
//   (b) "A scheduler fixture in which the re-arm never fires, so the cap is never
//       exercised and the test is green against any value." T2 is that control:
//       the SAME fixture with `maxMuteMs: Infinity` must show the mute held for
//       the full 10 s. If T1 were green for a fixture reason, T2 would be green
//       too — and T2 asserts the opposite.
//   (c) "Asserting the cap on `CanvasPersistence` only and leaving
//       `noteExternalDiskWrite`'s twin unbounded, which leaves half the window in
//       place." That twin is S68, it is the window this run nearly missed, and T3
//       measures it separately, on its own observable.
//
// THE PREDICTION THIS FILE EXISTS TO CHECK. `MAX_WAIT_MS` (500) + the 250 ms
// settle = 750 ms, against B44's measured lost ≤ 0.8 s / OK ≥ 0.9 s. T1 and T3
// report the measured ceiling against that number; a materially higher one would
// mean a third timer nobody has found.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ECHO_WINDOW_MS } from "../../../files/canvas-sync";
import {
  PATH,
  type Rig,
  advance,
  applyRemoteDelta,
  canvasJson,
  createRig,
  longestMutedInterval,
  node,
  remoteNode,
} from "./harness";

const SEED = canvasJson([node("seed", "seed card")]);
/** The prediction the charter hands the implementor: MAX_WAIT_MS + settle. */
const PREDICTED_CEILING_MS = 750;
const BURST_MS = 10_000;
const STEP_MS = 100;

/**
 * A LANDED WRITE every 100 ms for 10 s of simulated time — the charter's own
 * wording for this observable, and the condition under which the re-arm had no
 * ceiling: each write is closer to the last than the 250 ms window it re-arms, so
 * the window never got a chance to expire on its own.
 *
 * `flush()` rather than the debounce, deliberately. Left to `scheduleWrite`'s
 * trailing+cap debounce a stream of remote deltas lands a write roughly every
 * `MAX_WAIT_MS` = 500 ms, which is WIDER than the settle window — the window would
 * then expire between writes for a reason that has nothing to do with a cap, and
 * the control in T2 would be green against any implementation. Each iteration
 * carries a genuine doc change, so `flushToDisk`'s dedup never swallows it.
 *
 * Samples the sync layer's own echo window at every step so T3 can measure it.
 */
async function sustainedCoEditing(rig: Rig): Promise<boolean[]> {
  const samples: boolean[] = [];
  for (let i = 0; i < BURST_MS / STEP_MS; i++) {
    applyRemoteDelta(rig.doc, (nodes) => nodes.set(`peer-${i}`, remoteNode(`peer-${i}`, `p${i}`)));
    await rig.persistence.flush();
    await advance(STEP_MS);
    samples.push(rig.canvasSync.isRecentDiskWrite(PATH));
  }
  return samples;
}

/** Longest continuous run of `true` in a sample series, in ms. */
function longestRunMs(samples: boolean[]): number {
  let longest = 0;
  let run = 0;
  for (const open of samples) {
    run = open ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest * STEP_MS;
}

describe("WP91 AC5 — both re-arming windows are bounded, and the bound is measured", () => {
  let rig: Rig;

  afterEach(() => {
    rig?.destroy();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("T1 — under 10 s of sustained co-editing the mute is RELEASED while writes are still arriving, and the longest continuous mute is within the ceiling", async () => {
    rig = await createRig({ initial: { [PATH]: SEED } });
    await sustainedCoEditing(rig);

    // The precondition: writes really were still arriving throughout. A quiet
    // fixture would satisfy "released" for the wrong reason.
    expect(rig.written.length).toBeGreaterThan(5);
    // The re-arm really did happen — more than one mute was taken across the
    // burst, which is what "released while writes are still arriving" means.
    const mutes = rig.muteLog.filter((e) => e.kind === "mute");
    const unmutes = rig.muteLog.filter((e) => e.kind === "unmute");
    expect(mutes.length).toBeGreaterThan(1);
    expect(unmutes.length).toBeGreaterThan(1);

    const measured = longestMutedInterval(rig.muteLog, Date.now());
    expect(measured).toBeLessThanOrEqual(PREDICTED_CEILING_MS);
    // Reported as a number rather than asserted as one: this is the row that
    // answers "is there a third timer?" and it must be readable from the run.
    expect({ measuredCeilingMs: measured, predictedMs: PREDICTED_CEILING_MS }).toEqual({
      measuredCeilingMs: measured,
      predictedMs: 750,
    });
  });

  it("T2 — CONTROL for vacuity (b): the same fixture with the cap disabled holds ONE continuous mute for the full 10 s", async () => {
    rig = await createRig({ initial: { [PATH]: SEED }, maxMuteMs: Number.POSITIVE_INFINITY });
    await sustainedCoEditing(rig);

    expect(rig.written.length).toBeGreaterThan(5);
    const measured = longestMutedInterval(rig.muteLog, Date.now());
    // This is the pre-WP91 behaviour, reproduced deliberately: one mute, never
    // released, for as long as the peer keeps typing.
    expect(rig.muteLog.filter((e) => e.kind === "mute")).toHaveLength(1);
    expect(rig.muteLog.filter((e) => e.kind === "unmute")).toHaveLength(0);
    expect(measured).toBeGreaterThan(BURST_MS - 2 * STEP_MS);
    expect(measured).toBeGreaterThan(PREDICTED_CEILING_MS);
  });

  it("T3 — S68: the SECOND window, `noteExternalDiskWrite`'s own, is bounded by the same ceiling", async () => {
    rig = await createRig({ initial: { [PATH]: SEED } });
    const samples = await sustainedCoEditing(rig);

    expect(rig.written.length).toBeGreaterThan(5);
    // It really was open at some point — otherwise "bounded" is vacuous.
    expect(samples.some((open) => open)).toBe(true);
    // And it really did close, while writes were still arriving.
    expect(samples.some((open) => !open)).toBe(true);
    expect(longestRunMs(samples)).toBeLessThanOrEqual(MAX_ECHO_WINDOW_MS);
  });

  it("T4 — the ceiling is measured from the FIRST write of a burst, not from the last", async () => {
    rig = await createRig({ initial: { [PATH]: SEED } });
    // Two writes 400 ms apart. Measuring from the LAST write would put the
    // release at 400 + 250 = 650 ms after the first; measuring from the FIRST
    // caps it at 750 ms regardless of how many writes land in between, and a
    // third write at 700 ms cannot push it further.
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("a", remoteNode("a", "a")));
    await advance(200);
    const firstMuteAt = rig.muteLog.find((e) => e.kind === "mute")?.at as number;
    expect(typeof firstMuteAt).toBe("number");

    for (const gap of [200, 200, 200, 200]) {
      applyRemoteDelta(rig.doc, (nodes) =>
        nodes.set(`n${gap}${Math.random()}`, remoteNode("z", "z")),
      );
      await advance(gap);
    }
    await advance(400);

    const firstUnmuteAt = rig.muteLog.find((e) => e.kind === "unmute")?.at as number;
    expect(typeof firstUnmuteAt).toBe("number");
    expect(firstUnmuteAt - firstMuteAt).toBeLessThanOrEqual(PREDICTED_CEILING_MS);
  });

  it("T5 — a SINGLE write still gets its full settle window: the cap bounds a burst, it does not shorten a quiet write", async () => {
    rig = await createRig({ initial: { [PATH]: SEED } });
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("only", remoteNode("only", "only")));
    await advance(200);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(true);

    await advance(240);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(true); // still inside the 250 ms settle
    await advance(20);
    expect(rig.fileOps.isPathMuted(PATH)).toBe(false); // released on its own terms
  });
});
