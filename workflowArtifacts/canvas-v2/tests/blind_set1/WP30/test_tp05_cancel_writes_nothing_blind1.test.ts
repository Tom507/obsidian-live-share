// WP30 / AC3 ("no write of any kind") blind1 — attacked as a PAIRED
// DIFFERENTIAL over a fixture matrix instead of as one cancel scenario.
//
// The claim is not really "cancelling writes nothing"; it is "the answer to the
// dialog is the ONLY thing that decides whether anything is written". Those come
// apart in both directions, and only the paired form catches both: an import
// that never writes at all satisfies "cancel writes nothing" perfectly, and an
// import that writes before it asks satisfies it on the confirm path only by
// accident.
//
// So every fixture below is run TWICE through identical harnesses that differ in
// exactly one bit — the answer — and the two footprints are compared. The
// footprint is counted at two independent I/O boundaries: bytes offered to the
// vault (through WP28's real `resolveEpochConflict`, which is what actually
// serialises and writes) and transactions committed on the live `Y.Doc`. A
// cancel must score 0 on both. The paired confirm must score non-zero on both,
// or the fixture proved nothing.
//
// Six fixtures, chosen to vary the things an implementation might branch on:
// an empty board, a board the file fully covers, a board the file only partly
// covers, a board the file does not mention at all, an epoch of 0, and a large
// epoch.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  readEpoch,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
import {
  type ImportFromFileEnv,
  IMPORT_STATUS,
  runImportFromFile,
} from "../../../../../plugin/src/files/canvas-import";
import { DELETED_MAP_NAME, buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

const PATH = "atlas/roadmap.canvas";
const TODAY = "2026-08-02";

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
    meta.set(GUID_KEY, "4c9a0e7f31b84d2ea6570c8391fd2b45");
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

interface Rig {
  env: ImportFromFileEnv;
  live: Y.Doc;
  writes: string[];
  updates: unknown[];
}

function rig(epoch: unknown, live: string[], text: string, answer: boolean): Rig {
  const doc = replica(epoch, live);
  const writes: string[] = [];
  const updates: unknown[] = [];
  doc.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));

  const env: ImportFromFileEnv = {
    availability: () => ({ owned: true, degraded: false }),
    liveDoc: () => doc,
    peers: () => [{ displayName: "Nia" }],
    readCanvasFile: async () => text,
    confirm: async () => answer,
    adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) =>
      resolveEpochConflict({
        doc,
        winner,
        canvasPath,
        env: {
          serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
          writeConflictCopy: async (path: string) => {
            writes.push(path);
          },
          notify: () => {},
          today: () => TODAY,
        },
      }),
    notify: () => {},
  };
  return { env, live: doc, writes, updates };
}

const FIXTURES: { name: string; epoch: unknown; live: string[]; file: string[] }[] = [
  { name: "empty board", epoch: 0, live: [], file: ["f1"] },
  { name: "file covers the board exactly", epoch: 1, live: ["a", "b"], file: ["a", "b"] },
  { name: "file covers the board partly", epoch: 2, live: ["a", "b"], file: ["a"] },
  { name: "file mentions nothing the board has", epoch: 3, live: ["a"], file: ["z"] },
  { name: "never stamped", epoch: undefined, live: ["a"], file: ["z"] },
  { name: "large epoch", epoch: 4096, live: ["a", "b", "c"], file: ["z"] },
];

describe("WP30 tp05 blind1 — the answer is the only thing that decides a write", () => {
  it.each(FIXTURES)("$name: cancelling scores zero on both I/O channels", async (fixture) => {
    const cancelled = rig(fixture.epoch, fixture.live, fileText(fixture.file), false);
    const before = {
      ids: ids(cancelled.live),
      epoch: readEpoch(cancelled.live),
      state: Array.from(Y.encodeStateVector(cancelled.live)),
    };

    const result = await runImportFromFile(PATH, cancelled.env);

    expect(result.status).toBe(IMPORT_STATUS.CANCELLED);
    expect(cancelled.writes).toEqual([]);
    expect(cancelled.updates).toEqual([]);
    expect(ids(cancelled.live)).toEqual(before.ids);
    expect(readEpoch(cancelled.live)).toBe(before.epoch);
    expect(Array.from(Y.encodeStateVector(cancelled.live))).toEqual(before.state);
  });

  it.each(FIXTURES)("$name: the paired confirm scores non-zero on both", async (fixture) => {
    const confirmed = rig(fixture.epoch, fixture.live, fileText(fixture.file), true);

    const result = await runImportFromFile(PATH, confirmed.env);

    expect(result.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(confirmed.writes.length).toBe(1);
    expect(confirmed.updates.length).toBe(1);
    expect(ids(confirmed.live)).toEqual([...fixture.file].sort());
  });

  it("across the whole matrix, cancels write 0 and confirms write 6", async () => {
    let cancelFootprint = 0;
    let confirmFootprint = 0;
    for (const fixture of FIXTURES) {
      const no = rig(fixture.epoch, fixture.live, fileText(fixture.file), false);
      await runImportFromFile(PATH, no.env);
      cancelFootprint += no.writes.length + no.updates.length;

      const yes = rig(fixture.epoch, fixture.live, fileText(fixture.file), true);
      await runImportFromFile(PATH, yes.env);
      confirmFootprint += yes.writes.length + yes.updates.length;
    }
    expect(cancelFootprint).toBe(0);
    expect(confirmFootprint).toBe(FIXTURES.length * 2);
  });

  it("a cancel does not poison the next confirm on the same board", async () => {
    const doc = replica(9, ["a", "b"]);
    const writes: string[] = [];
    const updates: unknown[] = [];
    doc.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));
    let answer = false;
    const env: ImportFromFileEnv = {
      availability: () => ({ owned: true, degraded: false }),
      liveDoc: () => doc,
      peers: () => [],
      readCanvasFile: async () => fileText(["z"]),
      confirm: async () => answer,
      adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) =>
        resolveEpochConflict({
          doc,
          winner,
          canvasPath,
          env: {
            serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
            writeConflictCopy: async (path: string) => {
              writes.push(path);
            },
            notify: () => {},
            today: () => TODAY,
          },
        }),
      notify: () => {},
    };

    await runImportFromFile(PATH, env);
    expect(writes).toEqual([]);
    expect(updates).toEqual([]);

    answer = true;
    const second = await runImportFromFile(PATH, env);
    expect(second.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(ids(doc)).toEqual(["z"]);
    expect(readEpoch(doc)).toBe(10);
  });
});
