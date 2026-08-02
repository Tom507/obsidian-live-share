// WP28 / AC4 — "a DISTINCT log signature records every epoch conflict with BOTH
// epoch values".
//
// A signature that records only the winner cannot be used to diagnose the
// conflict afterwards, which is the entire reason AC4 exists: the Definition of
// Done for this WP is "the W4 divergence class is NAMED and archived rather than
// silent". "Epoch conflict on boards/plan.canvas, adopted epoch 9" names half of
// what happened. The question a human actually has — *what did we have before,
// and how far behind were we?* — is answerable only from both numbers.
//
// So: both numbers appear, both are ATTRIBUTABLE (labelled, so `3` and `9` cannot
// be read the wrong way round), the archive path is named, and the sentence is
// distinct from every other signature in this codebase.
//
// The signature is a HUMAN channel, never the oracle for the mechanism itself
// (charter §5: "do not assert on log strings as the primary oracle; state is the
// oracle, signatures are for humans"). Every state claim in this WP is pinned in
// tp03/tp04/tp08 against the doc; this file pins the sentence only.

import { describe, expect, it } from "vitest";

import {
  compareEpoch,
  conflictCopyPath,
  epochConflictSignature,
  resolveEpochConflict,
} from "../../../canvas/canvas-epoch";
import {
  ingestRejectionSignature,
  quarantineReleaseSignature,
  quarantineSignature,
} from "../../../files/canvas-sync";
import { CANVAS_PATH, TODAY, createProbe, makeDoc, node } from "./harness";

const ARCHIVE = "boards/plan.conflict-2026-08-02.canvas";

describe("WP28 AC4 — the signature carries BOTH epoch values", () => {
  it("both numbers appear in the sentence", () => {
    const signature = epochConflictSignature(CANVAS_PATH, 3, 9, ARCHIVE);
    expect(signature).toContain("3");
    expect(signature).toContain("9");
  });

  it("each number is ATTRIBUTABLE — swapping the arguments changes the sentence", () => {
    const forward = epochConflictSignature(CANVAS_PATH, 3, 9, ARCHIVE);
    const backward = epochConflictSignature(CANVAS_PATH, 9, 3, ARCHIVE);
    expect(
      forward,
      "the signature reads the same both ways round — a reader cannot tell which side " +
        "was behind, which is the one fact the line exists to carry",
    ).not.toBe(backward);
    expect(forward).toContain("local=3");
    expect(forward).toContain("remote=9");
    expect(backward).toContain("local=9");
    expect(backward).toContain("remote=3");
  });

  it("neither value can be recovered from the other — the pair is not a delta", () => {
    const a = epochConflictSignature(CANVAS_PATH, 1, 3, ARCHIVE);
    const b = epochConflictSignature(CANVAS_PATH, 7, 9, ARCHIVE);
    expect(a).not.toBe(b);
    expect(a).toContain("local=1");
    expect(b).toContain("local=7");
  });

  it("it names the canvas and the archive copy", () => {
    const signature = epochConflictSignature(CANVAS_PATH, 3, 9, ARCHIVE);
    expect(signature).toContain(CANVAS_PATH);
    expect(signature).toContain(ARCHIVE);
  });

  it("it names which side won, in agreement with `compareEpoch`", () => {
    expect(epochConflictSignature(CANVAS_PATH, 3, 9, ARCHIVE)).toContain("remote-wins");
    expect(epochConflictSignature(CANVAS_PATH, 9, 3, null)).toContain("local-wins");
    expect(compareEpoch(3, 9)).toBe("remote-wins");
  });

  it("is DISTINCT from every other signature this codebase emits", () => {
    const signature = epochConflictSignature(CANVAS_PATH, 3, 9, ARCHIVE);
    const others = [
      ingestRejectionSignature("host-seed" as never, "node", "n-a", "MISSING_ID" as never),
      quarantineSignature("node", "n-a", "MISSING_ID" as never),
      quarantineReleaseSignature("node", "n-a"),
    ];
    for (const other of others) {
      const marker = other.slice(0, other.indexOf("signature:") + "signature:".length);
      expect(
        signature.startsWith(marker),
        `the epoch signature shares its opening with \`${marker}\` — an operator ` +
          "grepping for one class finds the other",
      ).toBe(false);
    }
    expect(signature).toContain("EPOCH CONFLICT signature:");
  });

  it("refuses to describe a NON-conflict — equal epochs have no signature", () => {
    for (const value of [0, 1, 7]) {
      expect(
        () => epochConflictSignature(CANVAS_PATH, value, value, null),
        `equal epochs (${value}) produced a conflict signature — an implementation that ` +
          "logs a conflict on every merge makes the log useless for finding real ones",
      ).toThrow();
    }
    expect(() => epochConflictSignature(CANVAS_PATH, 0, undefined as never, null)).toThrow();
  });
});

describe("WP28 AC4 — the signature is emitted for every conflict and only for a conflict", () => {
  it("a real conflict emits it once, on the logger, and returns it in the outcome", async () => {
    const loser = makeDoc({ epoch: 2, nodes: { "n-a": node("n-a", "alpha") } });
    const winner = makeDoc({ epoch: 8, nodes: { "n-z": node("n-z", "zulu") } });
    const probe = createProbe();

    const outcome = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });

    const expected = epochConflictSignature(
      CANVAS_PATH,
      2,
      8,
      conflictCopyPath(CANVAS_PATH, TODAY),
    );
    expect(outcome.signature).toBe(expected);
    expect(probe.logs.length).toBe(1);
    expect(probe.logs[0].message).toBe(expected);
    expect(probe.logs[0].category).toContain("epoch");
    loser.destroy();
    winner.destroy();
  });

  it("the emitted signature carries the epochs that were actually in the two docs", async () => {
    const loser = makeDoc({ epoch: 4, nodes: { "n-a": node("n-a", "alpha") } });
    const winner = makeDoc({ epoch: 11, nodes: { "n-z": node("n-z", "zulu") } });
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.logs[0].message).toContain("local=4");
    expect(probe.logs[0].message).toContain("remote=11");
    loser.destroy();
    winner.destroy();
  });

  it("an unstamped loser is recorded as epoch 0, not as `undefined`", async () => {
    const loser = makeDoc({ nodes: { "n-a": node("n-a", "alpha") } });
    const winner = makeDoc({ epoch: 1, nodes: { "n-z": node("n-z", "zulu") } });
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.logs[0].message).toContain("local=0");
    expect(probe.logs[0].message).not.toContain("undefined");
    expect(probe.logs[0].message).not.toContain("NaN");
    loser.destroy();
    winner.destroy();
  });

  it("no signature is emitted when the local side wins", async () => {
    const loser = makeDoc({ epoch: 8, nodes: { "n-a": node("n-a", "alpha") } });
    const winner = makeDoc({ epoch: 2, nodes: { "n-z": node("n-z", "zulu") } });
    const probe = createProbe();

    const outcome = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });

    expect(outcome.signature).toBeNull();
    expect(probe.logs).toEqual([]);
    loser.destroy();
    winner.destroy();
  });

  it("a missing logger is not an error — the outcome still carries the signature", async () => {
    const loser = makeDoc({ epoch: 1, nodes: { "n-a": node("n-a", "alpha") } });
    const winner = makeDoc({ epoch: 2, nodes: { "n-z": node("n-z", "zulu") } });
    const probe = createProbe();
    const env = { ...probe.env, logger: undefined };

    const outcome = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: CANVAS_PATH,
      env: env as never,
    });

    expect(outcome.signature).toContain("local=1");
    expect(outcome.signature).toContain("remote=2");
    loser.destroy();
    winner.destroy();
  });
});
