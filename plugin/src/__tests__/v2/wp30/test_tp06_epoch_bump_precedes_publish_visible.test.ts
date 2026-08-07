// WP30 / AC2, importer side — "Executing it increments `meta.epoch`, seeds the
// doc from the file, and causes peers to adopt it through the epoch rule".
//
// AC2 IS AN ORDERING CLAIM AND ORDERING CLAIMS NEED AN ORDERING ORACLE. The end
// state of a correct import and of an import that published the file's records
// first and raised the epoch afterwards are IDENTICAL on the importing client.
// The difference is entirely in what the peers saw: in the second case the
// records arrived as ordinary edits and merged, and the epoch rule never fired.
// An end-state oracle on this replica cannot see that at all.
//
// The oracle used here is therefore a snapshot taken AT THE INSTANT the publish
// is offered (`harness.adoptCalls`): what the winner already carried, and what
// the live doc still held. The claim it pins is the one that is actually
// falsifiable and actually load-bearing:
//
//     when the wholesale replacement is offered to WP28's seam, the winner
//     ALREADY carries BOTH the file's records AND an epoch strictly greater
//     than the live board's — and nothing has been written to the live doc yet.
//
// That is what makes peers route the change through the epoch rule. An import
// that seeds without bumping the epoch presents a winner whose epoch EQUALS the
// live one; `resolveEpochConflict` then returns `"equal"`, adopts nothing and
// writes nothing, and the board silently does not change. That failure is caught
// here twice — once on the winner's epoch, once on the verdict.
//
// THE EPOCH IS SAFE TO ASSERT BY VALUE. `meta.epoch` on the winner has exactly
// one author (this importer) and a causal predecessor (the live board's epoch,
// read before the bump). It is not a contested key, so `toBe` is legitimate
// here in a way it never is for record content after a merge.
//
// PRODUCTION LINE <-> ASSERTION: the `bumpEpoch(winner)` call in
// `runImportFromFile` (`plugin/src/files/canvas-import.ts`), and the fact that
// it is sequenced BEFORE `await env.adoptEpochWinner(...)`. Removing the bump
// reddens `the winner published carries an epoch strictly greater ...`; seeding
// the winner's epoch from the winner itself rather than from the live board
// reddens `the epoch published is the LIVE board's successor`; moving the bump
// after the publish reddens `the winner already carries its epoch when it is
// offered`.

import { describe, expect, it } from "vitest";
import type * as Y from "yjs";

import {
  CANVAS_EPOCH_ADOPT_ORIGIN,
  compareEpoch,
  nextEpoch,
  readEpoch,
} from "../../../canvas/canvas-epoch";
import { IMPORT_STATUS, runImportFromFile } from "../../../files/canvas-import";
import { SEED_DECISION } from "../../../files/canvas-seed-decision";
import {
  CANVAS_PATH,
  CONFLICT_COPY,
  canvasJson,
  createImportHarness,
  edge,
  firstAt,
  projection,
  textNode,
} from "./harness";

const FILE_TEXT = canvasJson(
  [textNode("file-a", 0, "alpha"), textNode("file-b", 60, "beta")],
  [edge("file-e", "file-a", "file-b")],
);

function harnessAt(liveEpoch: unknown) {
  return createImportHarness({
    liveEpoch,
    liveNodes: [textNode("live-1", 0, "one"), textNode("live-2", 40, "two")],
    fileText: FILE_TEXT,
    answer: true,
  });
}

describe("WP30 tp06 — epoch++ and the seed are complete before the publish", () => {
  it("the winner already carries its epoch when it is offered to the publish seam", async () => {
    const harness = harnessAt(7);

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.adoptCalls).toHaveLength(1);
    expect(harness.adoptCalls[0].winnerEpoch).toBe(8);
  });

  it("the epoch published is the LIVE board's successor, not the staged doc's", async () => {
    // A winner staged from a `.canvas` file has no `meta` at all, so a bump
    // taken on the staged doc alone yields 1 and loses every conflict against a
    // board that has ever been imported before. The predecessor must be the
    // live board's epoch.
    for (const liveEpoch of [0, 1, 7, 41]) {
      const harness = harnessAt(liveEpoch);
      const result = await runImportFromFile(CANVAS_PATH, harness.env);
      expect(result.epoch, `live=${liveEpoch}`).toBe(nextEpoch(liveEpoch));
      expect(harness.adoptCalls[0].winnerEpoch, `live=${liveEpoch}`).toBe(liveEpoch + 1);
    }
  });

  it("an unstamped or corrupt live epoch still produces a strictly greater winner", async () => {
    // WP28's `normalizeEpoch` reads an absent, negative, fractional, string or
    // object cell as 0. The import must go through it rather than doing
    // arithmetic on whatever was in the map.
    for (const liveEpoch of [undefined, -3, 2.5, "9", null, {}]) {
      const harness = harnessAt(liveEpoch);
      const live = harness.liveDoc as Y.Doc;
      const before = readEpoch(live);
      const result = await runImportFromFile(CANVAS_PATH, harness.env);
      expect(result.epoch, `live=${String(liveEpoch)}`).toBe(nextEpoch(liveEpoch));
      expect(compareEpoch(before, result.epoch as number), `live=${String(liveEpoch)}`).toBe(
        "remote-wins",
      );
    }
  });

  it("the winner already carries the FILE's records when it is offered", async () => {
    const harness = harnessAt(7);

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.adoptCalls).toHaveLength(1);
    expect(harness.adoptCalls[0].winnerProjection).toEqual({
      nodes: ["file-a", "file-b"],
      edges: ["file-e"],
    });
  });

  it("the live board is still untouched at the moment the publish is offered", async () => {
    const harness = harnessAt(7);

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.adoptCalls).toHaveLength(1);
    expect(harness.adoptCalls[0].liveEpochAtCallTime).toBe(7);
    expect(harness.adoptCalls[0].liveProjectionAtCallTime).toEqual({
      nodes: ["live-1", "live-2"],
      edges: [],
    });
  });

  it("the epoch rule fires on the publish: remote-wins, adopted, archived", async () => {
    const harness = harnessAt(7);

    const result = await runImportFromFile(CANVAS_PATH, harness.env);

    expect(result.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(result.decision).toBe(SEED_DECISION.SEED_FROM_FILE);
    expect(result.archivedTo).toBe(CONFLICT_COPY);
    // The importer's OWN pre-import state is archived too — nothing is lost even
    // on the client that asked for the destruction.
    expect(harness.diskWrites).toHaveLength(1);
    expect(harness.diskWrites[0].path).toBe(CONFLICT_COPY);
  });

  it("the whole publish lands as ONE transaction, under WP28's adopt origin", async () => {
    const harness = harnessAt(7);

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.liveUpdateOrigins).toHaveLength(1);
    expect(harness.liveUpdateOrigins[0]).toBe(CANVAS_EPOCH_ADOPT_ORIGIN);
  });

  it("the live board ends up holding exactly the file, at the new epoch", async () => {
    const harness = harnessAt(7);
    const live = harness.liveDoc as Y.Doc;

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(projection(live)).toEqual({ nodes: ["file-a", "file-b"], edges: ["file-e"] });
    expect(readEpoch(live)).toBe(8);
  });

  it("the archive is taken BEFORE the adoption, not after it", async () => {
    // WP28's own ordering claim, re-measured from WP30's side because this is
    // the caller that makes it live. An archive written after the adoption is a
    // copy of the WINNER — right name, right shape, right date, and none of the
    // user's work in it.
    const harness = harnessAt(7);

    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.diskWrites).toHaveLength(1);
    expect(harness.diskWrites[0].liveProjectionAtWriteTime).toEqual({
      nodes: ["live-1", "live-2"],
      edges: [],
    });
    expect(harness.diskWrites[0].liveEpochAtWriteTime).toBe(7);
    expect(firstAt(harness.trace, "disk:write-conflict-copy")).toBeLessThan(
      firstAt(harness.trace, "live-doc:transaction"),
    );
  });
});
