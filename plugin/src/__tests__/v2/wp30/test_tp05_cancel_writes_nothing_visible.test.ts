// WP30 / AC3, second half — "cancelling performs no write of any kind".
//
// THIS IS THE ASSERTION MOST LIKELY TO BE WRITTEN SO IT CANNOT FAIL, and the
// three ways that happens are all closed here deliberately.
//
//   1. "NO WRITE" IS OBSERVED AT THE I/O BOUNDARY, NOT INFERRED FROM THE ABSENCE
//      OF A VISIBLE CHANGE. The harness's `adoptEpochWinner` is WP28's REAL
//      `resolveEpochConflict` over a fake vault and a real live `Y.Doc` with an
//      update observer. Two independent channels are counted — bytes offered to
//      the vault, and transactions committed on the live doc — and neither is
//      derivable from the other. An implementation that bypassed the publish
//      seam and wrote to the doc directly would still be seen by the second.
//
//   2. THE POSITIVE CONTROL IS MANDATORY. The same harness, answering `true`,
//      must produce exactly one byte-offer and exactly one transaction. Without
//      it, "zero writes" is also what a harness that cannot write at all says,
//      and every assertion in this file would be green against an import that
//      does nothing whatsoever.
//
//   3. THE CANCEL MUST BE A DECISION, NOT AN EARLY BAIL. Each cancel arm also
//      asserts the run got FAR ENOUGH TO WRITE: the file was read, the summary
//      was built, and the dialog was shown. A run that returned before the
//      confirmation would trivially satisfy "no write" and would satisfy nothing
//      else AC3 asks for.
//
// THE THIRD ARM — dismissal. `ConfirmModal.onClose` resolves `false` when the
// user dismisses without deciding (`plugin/src/ui/modals.ts:109-112`), so
// dismissal ALREADY counts as cancel and needs no new code. What does need
// pinning is the fail-closed reading on WP30's side: any answer that is not
// exactly `true` is a cancel, so a confirmation seam that resolves nothing at
// all (a modal torn down by a workspace change, a promise that settles
// `undefined`) can never be read as consent.
//
// PRODUCTION LINE <-> ASSERTION: the `ok !== true` early return in
// `runImportFromFile` (`plugin/src/files/canvas-import.ts`), immediately after
// `await env.confirm(...)` and before the winner is staged. Moving ANY write
// above the confirmation reddens `nothing is written before the user has
// answered`; changing `ok !== true` to `ok === false` reddens the
// non-boolean arms; removing the early return reddens every arm at once.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readEpoch } from "../../../canvas/canvas-epoch";
import { IMPORT_STATUS, runImportFromFile } from "../../../files/canvas-import";
import {
  CANVAS_PATH,
  canvasJson,
  createImportHarness,
  projection,
  textNode,
  totalWrites,
} from "./harness";

const LIVE_NODES = [textNode("live-1", 0, "one"), textNode("live-2", 40, "two")];
const FILE_TEXT = canvasJson([textNode("file-1", 10, "from the file")]);

/** Everything a confirmation seam can settle with that is not the literal `true`. */
const NOT_CONSENT: unknown[] = [false, undefined, null, 0, "", "true", Number.NaN];

describe("WP30 tp05 — cancelling performs no write of any kind", () => {
  it("POSITIVE CONTROL: confirming writes — one archive, one transaction", async () => {
    const harness = createImportHarness({
      liveEpoch: 4,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: true,
    });
    const before = projection(harness.liveDoc as Y.Doc);

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(harness.env.adoptEpochWinner).toHaveBeenCalledTimes(1);
    expect(harness.diskWrites).toHaveLength(1);
    expect(harness.liveUpdateOrigins).toHaveLength(1);
    expect(totalWrites(harness)).toBe(2);
    expect(projection(harness.liveDoc as Y.Doc)).not.toEqual(before);
  });

  it("cancelling offers no bytes to the vault and opens no transaction", async () => {
    const harness = createImportHarness({
      liveEpoch: 4,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: false,
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.status).toBe(IMPORT_STATUS.CANCELLED);
    expect(harness.diskWrites).toEqual([]);
    expect(harness.liveUpdateOrigins).toEqual([]);
    expect(totalWrites(harness)).toBe(0);
    expect(harness.env.adoptEpochWinner).not.toHaveBeenCalled();
  });

  it("cancelling leaves the live replica byte-identical", async () => {
    const harness = createImportHarness({
      liveEpoch: 4,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: false,
    });
    const live = harness.liveDoc as Y.Doc;
    const stateBefore = Y.encodeStateVector(live);
    const projectionBefore = projection(live);
    const epochBefore = readEpoch(live);

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(Array.from(Y.encodeStateVector(live))).toEqual(Array.from(stateBefore));
    expect(projection(live)).toEqual(projectionBefore);
    expect(readEpoch(live)).toBe(epochBefore);
    expect(readEpoch(live)).toBe(4);
  });

  it("the cancel is a DECISION: the file was read and the dialog was shown first", async () => {
    const harness = createImportHarness({
      liveEpoch: 4,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: false,
    });

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.reads).toEqual([CANVAS_PATH]);
    expect(harness.confirmCalls).toHaveLength(1);
    expect(harness.confirmCalls[0].message.length).toBeGreaterThan(0);
    // ... and it still wrote nothing.
    expect(totalWrites(harness)).toBe(0);
  });

  it("nothing is written before the user has answered", async () => {
    const seen: string[] = [];
    const harness = createImportHarness({
      liveEpoch: 4,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: async () => {
        // Snapshot the write channels AT THE MOMENT the dialog is open. An
        // implementation that published first and asked afterwards is invisible
        // to an end-state oracle on the confirm path, because the end state of a
        // confirmed import is the same either way.
        seen.push(`writes=${totalWrites(harness)}`);
        return true;
      },
    });

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(seen).toEqual(["writes=0"]);
    // and the confirmed run did go on to write — the control for this arm.
    expect(totalWrites(harness)).toBe(2);
  });

  it("any answer that is not exactly `true` is a cancel, and writes nothing", async () => {
    for (const answer of NOT_CONSENT) {
      const harness = createImportHarness({
        liveEpoch: 4,
        liveNodes: LIVE_NODES,
        fileText: FILE_TEXT,
        answer: (async () => answer) as unknown as () => Promise<boolean>,
      });

      const result = await runImportFromFile(CANVAS_PATH, harness.env);

      expect(result.status, `answer=${String(answer)}`).toBe(IMPORT_STATUS.CANCELLED);
      expect(totalWrites(harness), `answer=${String(answer)}`).toBe(0);
      expect(harness.env.adoptEpochWinner, `answer=${String(answer)}`).not.toHaveBeenCalled();
    }
  });

  it("a cancelled import reports no epoch and no archive", async () => {
    const harness = createImportHarness({
      liveEpoch: 4,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: false,
    });

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.epoch).toBeNull();
    expect(result.archivedTo).toBeNull();
    expect(result.decision).toBeNull();
  });

  it("cancelling twice in a row is still zero writes (no latent half-state)", async () => {
    const harness = createImportHarness({
      liveEpoch: 4,
      liveNodes: LIVE_NODES,
      fileText: FILE_TEXT,
      answer: false,
    });

    await runImportFromFile(CANVAS_PATH, harness.env);
    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.confirmCalls).toHaveLength(2);
    expect(totalWrites(harness)).toBe(0);
  });
});
