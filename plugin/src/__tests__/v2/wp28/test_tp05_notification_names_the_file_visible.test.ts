// WP28 / AC2 (second conjunct) — "and the user is notified with a message
// NAMING THE FILE".
//
// "A notification fired" is not the AC. The user is being told that their board
// was replaced by somebody else's; the only thing that makes that survivable is
// knowing where their own version went. A message reading "Live Share: canvas
// conflict resolved" satisfies every "did we notify?" assertion ever written and
// leaves the user with no way to find the file — which is indistinguishable, from
// where they are standing, from having lost the work outright.
//
// So the assertion is on the message CONTENT: it must contain the conflict
// copy's path, verbatim, exactly as `conflictCopyPath` produced it and exactly as
// it was handed to the write channel. Three things that must agree and are
// produced by three different steps.

import { describe, expect, it } from "vitest";

import {
  conflictCopyPath,
  epochConflictNotice,
  resolveEpochConflict,
} from "../../../canvas/canvas-epoch";
import { CANVAS_PATH, TODAY, createProbe, makeDoc, node } from "./harness";

function pair(loserEpoch = 1, winnerEpoch = 4) {
  const loser = makeDoc({ epoch: loserEpoch, nodes: { "n-a": node("n-a", "loser alpha") } });
  const winner = makeDoc({ epoch: winnerEpoch, nodes: { "n-z": node("n-z", "winner zulu") } });
  return { loser, winner };
}

describe("WP28 AC2 — the notification names the conflict copy", () => {
  it("the message contains the archive path verbatim", async () => {
    const { loser, winner } = pair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    const expectedPath = conflictCopyPath(CANVAS_PATH, TODAY);
    expect(probe.notices.length).toBe(1);
    expect(
      probe.notices[0].message,
      "the user was notified without being told where their own version went",
    ).toContain(expectedPath);
    loser.destroy();
    winner.destroy();
  });

  it("the named path is the path that was actually WRITTEN", async () => {
    const { loser, winner } = pair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.notices[0].message).toContain(probe.writes[0].path);
    loser.destroy();
    winner.destroy();
  });

  it("the notification follows the write — the user is never sent to a file that is not there", async () => {
    const { loser, winner } = pair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.notices[0].at).toBeGreaterThan(probe.writes[0].at);
    loser.destroy();
    winner.destroy();
  });

  it("exactly ONE notification per conflict", async () => {
    const { loser, winner } = pair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.notices.length).toBe(1);
    loser.destroy();
    winner.destroy();
  });

  it("`epochConflictNotice` is the one formatter, and it is not the bare path", () => {
    const path = conflictCopyPath("boards/plan.canvas", "2026-01-09");
    const message = epochConflictNotice(path);

    expect(message).toContain(path);
    expect(
      message.length,
      "the notice is the path and nothing else — a user reading a lone filename in a " +
        "toast has not been told what happened to their board",
    ).toBeGreaterThan(path.length + 8);
    expect(message).toMatch(/Live Share/);
  });

  it("a different canvas produces a message naming THAT canvas's copy", async () => {
    const otherPath = "team/retro board.canvas";
    const loser = makeDoc({ epoch: 0, path: otherPath, nodes: { "n-a": node("n-a", "x") } });
    const winner = makeDoc({ epoch: 5, path: otherPath, nodes: { "n-z": node("n-z", "y") } });
    const probe = createProbe({ today: "2027-11-30" });

    await resolveEpochConflict({ doc: loser, winner, canvasPath: otherPath, env: probe.env });

    const expected = conflictCopyPath(otherPath, "2027-11-30");
    expect(probe.notices[0].message).toContain(expected);
    expect(probe.notices[0].message).not.toContain(CANVAS_PATH);
    loser.destroy();
    winner.destroy();
  });

  it("`today()` is asked for exactly once and its answer is what the message names", async () => {
    const { loser, winner } = pair();
    const probe = createProbe({ today: "2026-12-24" });

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.notices[0].message).toContain("2026-12-24");
    expect(probe.writes[0].path).toContain("2026-12-24");
    loser.destroy();
    winner.destroy();
  });
});
