// WP30 / AC1 blind2 — attacked at the SHAPE OF THE REMOVAL, not at the
// projection.
//
// "The file overwrote the board" can be produced two ways in this codebase and
// they are not the same thing. A record can disappear from the projection
// because it was TOMBSTONED — a removal instruction written into `deleted`,
// which is WP19's vocabulary and is how a user deleting a card is represented —
// or because the container no longer has the KEY at all, which is what a
// wholesale epoch adoption produces. Both look identical through
// `buildCanvasData`, and only one of them is what AC2's epoch rule specifies.
//
// The difference is not cosmetic. A tombstone is a value that propagates and
// persists: a board reconstructed from tombstoned history still carries every
// id the import removed, the sidecar replays them forever, and a later repair
// pass can legitimately resurrect one. A wholesale replacement leaves the board
// holding exactly what the file said and nothing else, which is what "overwrite"
// means. So this file reads the RAW containers, not the projection.
//
// The second half is the census: the seed writer that remains in the tree after
// WP29 is asked the same question on the same board, and must be unable to
// remove anything by either shape — no missing key, no tombstone. That is what
// makes the import's ability to remove a property of the import rather than of
// the fixture.

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

const PATH = "vault/deck.canvas";
const TODAY = "2026-08-02";
const SEED_ORIGIN = Symbol("wp30-tp08-blind2");

function node(id: string, x = 0): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text: id };
}

function fileText(nodeIds: string[]): string {
  return JSON.stringify({ nodes: nodeIds.map((id, i) => node(id, i * 10)), edges: [] });
}

function rawNodeKeys(doc: Y.Doc): string[] {
  return [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort();
}

function tombstoneKeys(doc: Y.Doc): string[] {
  return [...doc.getMap<unknown>(DELETED_MAP_NAME).keys()].sort();
}

function visibleIds(doc: Y.Doc): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
  return data.nodes.map((n) => String(n.id)).sort();
}

function replica(epoch: number, nodeIds: string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, "5a1c94b6e07d43f28cb1e6035ad729f8");
    meta.set(PATH_KEY, PATH);
    meta.set(EPOCH_KEY, epoch);
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
          serializeDoc: (d: Y.Doc) => JSON.stringify(visibleIds(d)),
          writeConflictCopy: async () => {},
          notify: () => {},
          today: () => TODAY,
        },
      }),
    notify: () => {},
  };
  await runImportFromFile(PATH, env);
}

// `keep` sits at index 1 on the board and index 0 in the file, so the two sides
// give it DIFFERENT `x` values — which is what makes the wholesale-replacement
// assertion below discriminate at all.
const BOARD = ["drop-1", "keep", "drop-2"];
const FILE = ["keep", "new"];

describe("WP30 tp08 blind2 — the removal is an absence of keys, not a tombstone", () => {
  it("the import leaves the raw container holding exactly the file's ids", async () => {
    const doc = replica(5, BOARD);
    expect(rawNodeKeys(doc)).toEqual(["drop-1", "drop-2", "keep"]);

    await importInto(doc, fileText(FILE));

    expect(rawNodeKeys(doc)).toEqual(["keep", "new"]);
  });

  it("the import writes no tombstone for what it removed", async () => {
    const doc = replica(5, BOARD);
    await importInto(doc, fileText(FILE));

    expect(tombstoneKeys(doc)).toEqual([]);
    for (const id of ["drop-1", "drop-2"]) {
      expect(doc.getMap<Y.Map<unknown>>("nodes").has(id), id).toBe(false);
    }
  });

  it("the projection and the raw container agree after the import", async () => {
    const doc = replica(5, BOARD);
    await importInto(doc, fileText(FILE));

    expect(visibleIds(doc)).toEqual(rawNodeKeys(doc));
    expect(visibleIds(doc)).toEqual(["keep", "new"]);
  });

  it("the surviving seed writer cannot remove by EITHER shape", () => {
    const doc = replica(5, BOARD);
    const tombstonesBefore = tombstoneKeys(doc);

    seedRecordsIntoYMaps(doc, decodeCanvasDataToFlat(parseCanvas(fileText(FILE))), SEED_ORIGIN);

    // no key vanished ...
    for (const id of BOARD) expect(rawNodeKeys(doc), id).toContain(id);
    // ... and nothing was tombstoned instead
    expect(tombstoneKeys(doc)).toEqual(tombstonesBefore);
    expect(visibleIds(doc)).toEqual(["drop-1", "drop-2", "keep", "new"]);
  });

  it("the same board and the same file: the seed grows it, the import shrinks it", async () => {
    const seeded = replica(5, BOARD);
    seedRecordsIntoYMaps(seeded, decodeCanvasDataToFlat(parseCanvas(fileText(FILE))), SEED_ORIGIN);

    const imported = replica(5, BOARD);
    await importInto(imported, fileText(FILE));

    expect(rawNodeKeys(seeded).length).toBeGreaterThan(BOARD.length);
    expect(rawNodeKeys(imported).length).toBeLessThan(BOARD.length);
    expect(rawNodeKeys(imported)).toEqual([...FILE].sort());
  });

  it("a record the file re-states keeps its id and gains the file's value", async () => {
    // `keep` exists on both sides. The id must survive the replacement (it is in
    // the winner), and it must be the WINNER's record — the whole point of a
    // wholesale replacement rather than a field-wise blend.
    const doc = replica(5, BOARD);
    await importInto(doc, fileText(FILE));

    const record = doc.getMap<Y.Map<unknown>>("nodes").get("keep");
    expect(record).toBeDefined();
    expect((record as Y.Map<unknown>).get("id")).toBe("keep");
    expect((record as Y.Map<unknown>).get("x")).toBe(0);
  });
});
