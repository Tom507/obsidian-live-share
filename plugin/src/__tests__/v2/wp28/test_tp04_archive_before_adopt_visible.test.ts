// WP28 / AC2 — "the losing side writes its state to `<name>.conflict-<date>.canvas`
// BEFORE adopting the winner".
//
// THIS IS THE HIGHEST-VALUE FILE IN THIS WORK PACKAGE, and the reason is that
// the wrong implementation is INVISIBLE at rest.
//
// An implementation that adopts first and archives afterwards produces a
// conflict copy with the right name, the right date, the right extension and a
// perfectly valid `.canvas` body — a body that is a COPY OF THE WINNER. Every
// end-state oracle is green: the file exists, the doc converged, the user got a
// notification. The only thing that is gone is the exact work the archive
// existed to preserve, and nobody will find out until they open the file, which
// by then is the only copy that no longer contains what they lost.
//
// So "the conflict copy exists at the end" is not an oracle for this AC. An
// ORDERING claim needs an ORDERING oracle, and this file uses two independent
// ones:
//
//   ├── STATE-AT-WRITE-TIME — the probe records, inside `writeConflictCopy`,
//   │      what the loser's doc STILL HELD at that instant. If adoption already
//   │      ran, the doc holds the winner's ids and the winner's epoch, and the
//   │      assertion is red. This one cannot be satisfied by reordering log
//   │      lines; it reads the subject.
//   └── CONTENT — the archived text must contain the loser-only record and must
//          NOT contain the winner-only record. Independent of the doc, and red
//          against exactly the same defect.
//
// The third property is FAIL-CLOSED: if the archive write rejects, nothing is
// adopted. An archive that is "best effort" is not an archive — it is a delete
// with a log line.

import { describe, expect, it } from "vitest";
import type * as Y from "yjs";

import { conflictCopyPath, readEpoch, resolveEpochConflict } from "../../../canvas/canvas-epoch";
import {
  CANVAS_PATH,
  TODAY,
  createProbe,
  edge,
  harnessSerialize,
  makeDoc,
  node,
  recordIds,
} from "./harness";

function conflictingPair() {
  const loser = makeDoc({
    epoch: 2,
    nodes: {
      "n-shared": node("n-shared", "LOSER text"),
      "n-loser-only": node("n-loser-only", "the sketch the user spent an hour on", 300),
    },
    edges: { "e-loser-only": edge("e-loser-only", "n-shared", "n-loser-only") },
  });
  const winner = makeDoc({
    epoch: 6,
    nodes: {
      "n-shared": node("n-shared", "WINNER text"),
      "n-winner-only": node("n-winner-only", "imported from the host's file", 600),
    },
    edges: {},
  });
  return { loser, winner };
}

describe("WP28 AC2 — the archive is written BEFORE the adoption, not merely at the end", () => {
  it("at the instant of the write, the doc still holds the LOSER's records", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();
    probe.watch(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.writes.length).toBe(1);
    const write = probe.writes[0];
    expect(
      write.docNodeIds,
      "the conflict copy was written from a doc that had ALREADY adopted the winner — " +
        "the archive on disk is a copy of the winner and the loser's work is gone",
    ).toEqual(["n-loser-only", "n-shared"]);
    expect(write.docEdgeIds).toEqual(["e-loser-only"]);
    expect(write.docEpoch, "the epoch had already moved when the archive was written").toBe(2);
    loser.destroy();
    winner.destroy();
  });

  it("the archived CONTENT is the loser's pre-adoption state", async () => {
    const { loser, winner } = conflictingPair();
    const expected = harnessSerialize(loser);
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    const { content } = probe.writes[0];
    expect(content).toBe(expected);
    expect(content).toContain("the sketch the user spent an hour on");
    expect(content).toContain("LOSER text");
    expect(
      content,
      "the archive carries the WINNER's content — this is what an adopt-then-archive " +
        "implementation writes, and it looks perfectly healthy on disk",
    ).not.toContain("imported from the host's file");
    expect(content).not.toContain("WINNER text");
    loser.destroy();
    winner.destroy();
  });

  it("the write is ordered before the doc's first mutation", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();
    probe.watch(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    const firstMutation = probe.firstMutationAt();
    expect(firstMutation, "the loser's doc was never mutated — nothing was adopted").not.toBeNull();
    expect(
      probe.writes[0].at,
      `the archive (order ${probe.writes[0].at}) was written after the doc was ` +
        `first mutated (order ${firstMutation})`,
    ).toBeLessThan(firstMutation as number);
    loser.destroy();
    winner.destroy();
  });

  it("the serialisation of the loser also precedes the adoption", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();
    probe.watch(loser);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });

    expect(probe.serializations.length).toBe(1);
    expect(probe.serializations[0].nodeIds).toEqual(["n-loser-only", "n-shared"]);
    expect(probe.serializations[0].at).toBeLessThan(probe.writes[0].at);
    expect(probe.serializations[0].at).toBeLessThan(probe.firstMutationAt() as number);
    loser.destroy();
    winner.destroy();
  });

  it("the archive goes to the path `conflictCopyPath` names, and nowhere else", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();

    const outcome = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });

    const expectedPath = conflictCopyPath(CANVAS_PATH, TODAY);
    expect(probe.writes[0].path).toBe(expectedPath);
    expect(outcome.archivedTo).toBe(expectedPath);
    expect(probe.writes.map((w) => w.path)).toEqual([expectedPath]);
    loser.destroy();
    winner.destroy();
  });

  it("FAIL-CLOSED: a rejected archive write adopts nothing", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe({ failWriteWith: new Error("EACCES: read-only vault") });
    probe.watch(loser);
    const idsBefore = recordIds(loser, "nodes");

    await expect(
      resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env }),
    ).rejects.toThrow(/EACCES/);

    expect(
      recordIds(loser, "nodes"),
      "the archive failed and the winner was adopted anyway — that is a DELETE with a " +
        "log line, not an archive",
    ).toEqual(idsBefore);
    expect(readEpoch(loser)).toBe(2);
    expect(probe.transactions).toEqual([]);
    expect(probe.notices, "the user was told a file exists that was never written").toEqual([]);
    loser.destroy();
    winner.destroy();
  });

  it("exactly ONE archive per conflict — a second resolve on the settled doc archives nothing", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: CANVAS_PATH, env: probe.env });
    const second = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });

    expect(second.verdict).toBe("equal");
    expect(second.adopted).toBe(false);
    expect(second.archivedTo).toBeNull();
    expect(
      probe.writes.length,
      "resolving again after the epochs equalised wrote a SECOND conflict copy — " +
        "the archive path triggers on a related-replica merge",
    ).toBe(1);
    loser.destroy();
    winner.destroy();
  });

  it("the doc is untouched until the archive resolves, even with a slow write", async () => {
    const { loser, winner } = conflictingPair();
    const probe = createProbe();
    probe.watch(loser);
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowWrite = probe.env.writeConflictCopy;
    probe.env.writeConflictCopy = async (path: string, content: string) => {
      await slowWrite(path, content);
      await gate;
    };

    const pending = resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: CANVAS_PATH,
      env: probe.env,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      probe.transactions,
      "the doc was mutated while the archive write was still in flight",
    ).toEqual([]);
    expect(loser.getMap<Y.Map<unknown>>("nodes").has("n-loser-only")).toBe(true);

    release();
    await pending;
    expect(loser.getMap<Y.Map<unknown>>("nodes").has("n-loser-only")).toBe(false);
    loser.destroy();
    winner.destroy();
  });
});
