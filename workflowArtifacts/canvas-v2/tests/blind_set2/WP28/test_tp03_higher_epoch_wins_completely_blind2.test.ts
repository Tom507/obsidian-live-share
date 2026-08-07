// WP28 / AC1 blind2 — "wins completely" asserted as WHOLE-DOCUMENT EQUALITY
// against the winner, not as an id-set comparison.
//
// Different angle: after the adoption, the loser's entire record projection —
// every id, every field, every value, in both id spaces, plus the tombstone map —
// must deep-equal the winner's. An id-set oracle is green against an
// implementation that brings over the right ids but keeps the loser's FIELD
// values on the overlapping records, which is a per-field blend: a card carrying
// one person's text at another person's coordinates, a position nobody chose.
// That is the same class of defect the WP18 batch found in production
// (`decodeV2RecordToFlat` resolving a collision by insertion order) — every
// convergence oracle green over a document nobody authored.
//
// The overlap here is engineered to make the blend visible: the shared records
// have the SAME ids and DIFFERENT values in every field.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readEpoch, resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "wiki/atlas.canvas";

function project(doc: Y.Doc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const space of ["nodes", "edges"]) {
    const container: Record<string, unknown> = {};
    for (const [id, record] of doc.getMap<Y.Map<unknown>>(space)) container[id] = record.toJSON();
    out[space] = container;
  }
  out.deleted = Object.fromEntries(doc.getMap<unknown>("deleted").entries());
  return out;
}

function build(spec: {
  epoch: number;
  nodes: Record<string, Record<string, unknown>>;
  edges?: Record<string, Record<string, unknown>>;
  deleted?: Record<string, unknown>;
}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, spec.epoch);
    for (const space of ["nodes", "edges"] as const) {
      const container = doc.getMap<Y.Map<unknown>>(space);
      for (const [id, fields] of Object.entries(spec[space] ?? {})) {
        const record = new Y.Map<unknown>();
        container.set(id, record);
        for (const [key, value] of Object.entries(fields)) record.set(key, value);
      }
    }
    const deleted = doc.getMap<unknown>("deleted");
    for (const [id, entry] of Object.entries(spec.deleted ?? {})) deleted.set(id, entry);
  });
  return doc;
}

function loserBoard() {
  return build({
    epoch: 4,
    nodes: {
      overlap: { id: "overlap", x: 10, y: 20, width: 100, height: 50, text: "loser body" },
      "loser-1": { id: "loser-1", x: 0, y: 0, text: "loser only 1" },
      "loser-2": { id: "loser-2", x: 5, y: 5, text: "loser only 2" },
    },
    edges: { "edge-shared": { id: "edge-shared", fromNode: "overlap", toNode: "loser-1" } },
    deleted: { ghost: { t: 3, by: "loser", on: true } },
  });
}

function winnerBoard() {
  return build({
    epoch: 11,
    nodes: {
      overlap: { id: "overlap", x: 999, y: 888, width: 777, height: 666, text: "winner body" },
      "winner-1": { id: "winner-1", x: 1, y: 1, text: "winner only 1" },
    },
    edges: { "edge-shared": { id: "edge-shared", fromNode: "overlap", toNode: "winner-1" } },
    deleted: { spectre: { t: 9, by: "winner", on: true } },
  });
}

const silent = {
  serializeDoc: (doc: Y.Doc) => JSON.stringify(project(doc)),
  writeConflictCopy: async () => {},
  notify: () => {},
  today: () => "2026-10-10",
  logger: { debug: () => {}, warn: () => {} },
};

describe("WP28 AC1 blind2 — the adopted document IS the winner's document", () => {
  it("the whole projection deep-equals the winner's", async () => {
    const loser = loserBoard();
    const winner = winnerBoard();
    const expected = project(winner);

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: silent });

    expect(
      project(loser),
      "the adopted board differs from the winner's — either records were left behind or " +
        "field values were blended across the two histories",
    ).toEqual(expected);
    loser.destroy();
    winner.destroy();
  });

  it("no field of an OVERLAPPING record keeps the loser's value", async () => {
    const loser = loserBoard();
    const winner = winnerBoard();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: silent });

    const record = loser.getMap<Y.Map<unknown>>("nodes").get("overlap");
    expect(record?.toJSON()).toEqual({
      id: "overlap",
      x: 999,
      y: 888,
      width: 777,
      height: 666,
      text: "winner body",
    });
    loser.destroy();
    winner.destroy();
  });

  it("an overlapping EDGE takes the winner's endpoints whole", async () => {
    const loser = loserBoard();
    const winner = winnerBoard();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: silent });

    expect(loser.getMap<Y.Map<unknown>>("edges").get("edge-shared")?.toJSON()).toEqual({
      id: "edge-shared",
      fromNode: "overlap",
      toNode: "winner-1",
    });
    loser.destroy();
    winner.destroy();
  });

  it("both loser-only records are gone, and the winner-only one arrived", async () => {
    const loser = loserBoard();
    const winner = winnerBoard();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: silent });

    const nodes = loser.getMap<Y.Map<unknown>>("nodes");
    expect(nodes.has("loser-1")).toBe(false);
    expect(nodes.has("loser-2")).toBe(false);
    expect(nodes.has("winner-1")).toBe(true);
    expect([...nodes.keys()].sort()).toEqual(["overlap", "winner-1"]);
    loser.destroy();
    winner.destroy();
  });

  it("the tombstone map is the winner's, not a union", async () => {
    const loser = loserBoard();
    const winner = winnerBoard();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: silent });

    expect([...loser.getMap<unknown>("deleted").keys()].sort()).toEqual(["spectre"]);
    loser.destroy();
    winner.destroy();
  });

  it("the outcome reports both epochs and the adoption honestly", async () => {
    const loser = loserBoard();
    const winner = winnerBoard();

    const outcome = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: BOARD,
      env: silent,
    });

    expect(outcome.verdict).toBe("remote-wins");
    expect(outcome.localEpoch).toBe(4);
    expect(outcome.remoteEpoch).toBe(11);
    expect(outcome.adopted).toBe(true);
    expect(readEpoch(loser)).toBe(11);
    loser.destroy();
    winner.destroy();
  });

  it("adopting twice from the same winner is a no-op the second time", async () => {
    const loser = loserBoard();
    const winner = winnerBoard();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: silent });
    const after = project(loser);
    const second = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: BOARD,
      env: silent,
    });

    expect(second.adopted).toBe(false);
    expect(project(loser)).toEqual(after);
    loser.destroy();
    winner.destroy();
  });
});
