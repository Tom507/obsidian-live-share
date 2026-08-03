// WP30 / AC1 blind1 — "the only way a file overwrites a living doc" attacked as
// a SET-ALGEBRA property over a family of (board, file) pairs, and measured
// against the alternative mechanism side by side.
//
// The claim decomposes into two halves that are easy to confuse:
//
//   THE SEED WRITER IS MONOTONE. For every (board, file) pair, seeding leaves a
//   board whose id set is the UNION of the two. It can add; it can never
//   subtract. So no seed path — cold open, sidecar resume, host rejoin — can
//   overwrite anything, whatever guard is or is not in front of it.
//
//   THE IMPORT IS A REPLACEMENT. For the same pairs, importing leaves a board
//   whose id set is EXACTLY the file's. Not a superset, not an intersection.
//
// Stated that way the two are distinguishable on every pair where the board
// holds something the file omits, and indistinguishable on every pair where it
// does not — which is why the family below always includes board-only ids, and
// why a single fixture would have been a coin toss. The two mechanisms are run
// over the SAME pairs in the same test so the contrast is measured rather than
// asserted twice.
//
// The third property is the one a reviewer should look for: `union === file`
// exactly when the board holds nothing the file omits, so the pairs where the
// two mechanisms agree are enumerated rather than avoided. A test family that
// only contained disagreeing pairs would be hiding half of its own subject.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
import {
  type ImportFromFileEnv,
  runImportFromFile,
} from "../../../../../plugin/src/files/canvas-import";
import {
  DELETED_MAP_NAME,
  buildCanvasData,
  decodeCanvasDataToFlat,
  parseCanvas,
  seedRecordsIntoYMaps,
} from "../../../../../plugin/src/files/canvas-sync";

const PATH = "atlas/roadmap.canvas";
const TODAY = "2026-08-02";
const SEED_ORIGIN = Symbol("wp30-tp08-blind1");

function node(id: string, x = 0): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text: id };
}

function fileText(nodeIds: string[]): string {
  return JSON.stringify({ nodes: nodeIds.map((id, i) => node(id, i * 10)), edges: [] });
}

function ids(doc: Y.Doc): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
  return data.nodes.map((n) => String(n.id)).sort();
}

function replica(epoch: unknown, nodeIds: string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, "d5a71e0c68b34f92ae13c07d5b829f64");
    meta.set(PATH_KEY, PATH);
    if (epoch !== undefined) meta.set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const [i, id] of nodeIds.entries()) {
      const record = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(node(id, i * 25))) record.set(key, value);
      nodes.set(id, record);
    }
  });
  return doc;
}

async function importInto(doc: Y.Doc, text: string): Promise<void> {
  const env: ImportFromFileEnv = {
    availability: () => ({ owned: true, degraded: false }),
    liveDoc: () => doc,
    peers: () => [],
    readCanvasFile: async () => text,
    confirm: async () => true,
    adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) =>
      resolveEpochConflict({
        doc,
        winner,
        canvasPath,
        env: {
          serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
          writeConflictCopy: async () => {},
          notify: () => {},
          today: () => TODAY,
        },
      }),
    notify: () => {},
  };
  await runImportFromFile(PATH, env);
}

const PAIRS: { name: string; board: string[]; file: string[] }[] = [
  { name: "disjoint", board: ["a", "b"], file: ["y", "z"] },
  { name: "file is a subset", board: ["a", "b", "c"], file: ["a"] },
  { name: "file is a superset", board: ["a"], file: ["a", "b", "c"] },
  { name: "identical", board: ["a", "b"], file: ["a", "b"] },
  { name: "board empty", board: [], file: ["a"] },
  { name: "file empty", board: ["a", "b"], file: [] },
  { name: "overlapping", board: ["a", "b"], file: ["b", "c"] },
];

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();

describe("WP30 tp08 blind1 — seed is a union, import is a replacement", () => {
  it.each(PAIRS)("$name: seeding yields the UNION and can never subtract", ({ board, file }) => {
    const doc = replica(0, board);
    seedRecordsIntoYMaps(doc, decodeCanvasDataToFlat(parseCanvas(fileText(file))), SEED_ORIGIN);
    expect(ids(doc)).toEqual(union(board, file));
    for (const id of board) expect(ids(doc)).toContain(id);
  });

  it.each(PAIRS)("$name: importing yields EXACTLY the file", async ({ board, file }) => {
    const doc = replica(3, board);
    await importInto(doc, fileText(file));
    expect(ids(doc)).toEqual([...file].sort());
  });

  it("the two mechanisms disagree on exactly the pairs where the board holds more", async () => {
    const disagreeing: string[] = [];
    for (const pair of PAIRS) {
      const seeded = replica(0, pair.board);
      seedRecordsIntoYMaps(
        seeded,
        decodeCanvasDataToFlat(parseCanvas(fileText(pair.file))),
        SEED_ORIGIN,
      );
      const imported = replica(3, pair.board);
      await importInto(imported, fileText(pair.file));
      if (JSON.stringify(ids(seeded)) !== JSON.stringify(ids(imported))) {
        disagreeing.push(pair.name);
      }
    }
    const expected = PAIRS.filter((p) => p.board.some((id) => !p.file.includes(id))).map(
      (p) => p.name,
    );
    expect(disagreeing.sort()).toEqual(expected.sort());
    expect(expected.length).toBeGreaterThan(0);
  });

  it("only the import can produce a board strictly smaller than what was there", async () => {
    const shrinking = { board: ["a", "b", "c", "d"], file: ["a"] };

    const seeded = replica(0, shrinking.board);
    seedRecordsIntoYMaps(
      seeded,
      decodeCanvasDataToFlat(parseCanvas(fileText(shrinking.file))),
      SEED_ORIGIN,
    );
    expect(ids(seeded).length).toBeGreaterThanOrEqual(shrinking.board.length);

    const imported = replica(3, shrinking.board);
    await importInto(imported, fileText(shrinking.file));
    expect(ids(imported).length).toBeLessThan(shrinking.board.length);
    expect(ids(imported)).toEqual(["a"]);
  });
});
