// WP28 / AC1 blind1 — "wins COMPLETELY" attacked as a SET EQUATION over a
// generated population, not as three named ids.
//
// Different angle: build a loser and a winner with 40 records each and a
// deliberately engineered overlap, then compute the SYMMETRIC DIFFERENCE between
// what the loser ends up holding and what the winner holds. The assertion is
// that the difference is empty in BOTH directions.
//
// One direction alone is the trap this file exists for. "Every winner record is
// present" is green against an implementation that unions the two histories —
// which converges, satisfies SEC, satisfies the schema, satisfies byte equality
// and leaves a board carrying two people's unrelated work at once, half of it
// invisible to whoever made the other half. The other direction, "no record the
// winner does not have", is what fails there, and it is the one a hand-written
// example list usually forgets because the example only has one leftover.
//
// The tombstone space is included in the sweep: a "wholesale replacement" that
// forgets `deleted` leaves the loser's suppressions applied to the winner's
// records, which hides cards the winner can see and nobody can explain.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readEpoch, resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "programme/roadmap.canvas";

function build(spec: {
  epoch: number;
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  deletedIds?: readonly string[];
  marker: string;
}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, spec.epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const id of spec.nodeIds) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("text", `${spec.marker}:${id}`);
    }
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    for (const id of spec.edgeIds) {
      const record = new Y.Map<unknown>();
      edges.set(id, record);
      record.set("id", id);
      record.set("label", spec.marker);
    }
    const deleted = doc.getMap<unknown>("deleted");
    for (const id of spec.deletedIds ?? []) deleted.set(id, { t: 1, by: spec.marker, on: true });
  });
  return doc;
}

function ids(doc: Y.Doc, space: string): Set<string> {
  return new Set(doc.getMap<Y.Map<unknown>>(space).keys());
}

function symmetricDifference(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const value of a) if (!b.has(value)) out.push(`only-in-doc:${value}`);
  for (const value of b) if (!a.has(value)) out.push(`only-in-winner:${value}`);
  return out.sort();
}

function silentEnv() {
  const writes: { path: string; content: string }[] = [];
  return {
    env: {
      serializeDoc: (doc: Y.Doc) => JSON.stringify([...ids(doc, "nodes")].sort()),
      writeConflictCopy: async (path: string, content: string) => {
        writes.push({ path, content });
      },
      notify: () => {},
      today: () => "2026-09-30",
      logger: { debug: () => {}, warn: () => {} },
    },
    writes,
  };
}

const LOSER_NODES = Array.from({ length: 40 }, (_u, i) => `L${i}`);
const WINNER_NODES = [
  ...LOSER_NODES.slice(0, 12), // the overlap
  ...Array.from({ length: 28 }, (_u, i) => `W${i}`),
];

describe("WP28 AC1 blind1 — the loser's record space becomes the winner's, exactly", () => {
  it("the symmetric difference of the node spaces is empty in BOTH directions", async () => {
    const loser = build({ epoch: 2, nodeIds: LOSER_NODES, edgeIds: [], marker: "loser" });
    const winner = build({ epoch: 3, nodeIds: WINNER_NODES, edgeIds: [], marker: "winner" });
    const probe = silentEnv();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(
      symmetricDifference(ids(loser, "nodes"), ids(winner, "nodes")),
      "the adoption left records behind or failed to bring records over",
    ).toEqual([]);
    expect(ids(loser, "nodes").size).toBe(40);
    loser.destroy();
    winner.destroy();
  });

  it("every one of the 28 records only the LOSER had is gone", async () => {
    const loser = build({ epoch: 2, nodeIds: LOSER_NODES, edgeIds: [], marker: "loser" });
    const winner = build({ epoch: 3, nodeIds: WINNER_NODES, edgeIds: [], marker: "winner" });
    const probe = silentEnv();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    const survivors = LOSER_NODES.slice(12).filter((id) => ids(loser, "nodes").has(id));
    expect(
      survivors,
      `${survivors.length} of the loser's own records survived the adoption — the board ` +
        "now carries two unrelated histories at once",
    ).toEqual([]);
  });

  it("the OVERLAPPING records carry the winner's content, not the loser's", async () => {
    const loser = build({ epoch: 2, nodeIds: LOSER_NODES, edgeIds: [], marker: "loser" });
    const winner = build({ epoch: 3, nodeIds: WINNER_NODES, edgeIds: [], marker: "winner" });
    const probe = silentEnv();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    for (const id of LOSER_NODES.slice(0, 12)) {
      expect(loser.getMap<Y.Map<unknown>>("nodes").get(id)?.get("text"), id).toBe(
        `winner:${id}`,
      );
    }
    loser.destroy();
    winner.destroy();
  });

  it("the edge space is swept by the same equation", async () => {
    const loser = build({
      epoch: 1,
      nodeIds: LOSER_NODES.slice(0, 6),
      edgeIds: ["eL0", "eL1", "eL2", "eShared"],
      marker: "loser",
    });
    const winner = build({
      epoch: 4,
      nodeIds: WINNER_NODES.slice(0, 6),
      edgeIds: ["eShared", "eW0"],
      marker: "winner",
    });
    const probe = silentEnv();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(symmetricDifference(ids(loser, "edges"), ids(winner, "edges"))).toEqual([]);
    expect([...ids(loser, "edges")].sort()).toEqual(["eShared", "eW0"]);
    loser.destroy();
    winner.destroy();
  });

  it("the loser's TOMBSTONES do not survive to suppress the winner's records", async () => {
    const loser = build({
      epoch: 1,
      nodeIds: ["a", "b"],
      edgeIds: [],
      deletedIds: ["W0", "W1", "gone"],
      marker: "loser",
    });
    const winner = build({
      epoch: 2,
      nodeIds: ["W0", "W1", "W2"],
      edgeIds: [],
      deletedIds: ["ancient"],
      marker: "winner",
    });
    const probe = silentEnv();

    await resolveEpochConflict({ doc: loser, winner, canvasPath: BOARD, env: probe.env });

    expect(
      [...loser.getMap<unknown>("deleted").keys()].sort(),
      "the loser's tombstones outlived its records and now hide the winner's cards",
    ).toEqual(["ancient"]);
    expect([...ids(loser, "nodes")].sort()).toEqual(["W0", "W1", "W2"]);
    loser.destroy();
    winner.destroy();
  });

  it("the epoch lands on the winner's value even across a wide gap", async () => {
    const loser = build({ epoch: 0, nodeIds: ["a"], edgeIds: [], marker: "loser" });
    const winner = build({ epoch: 4096, nodeIds: ["z"], edgeIds: [], marker: "winner" });
    const probe = silentEnv();

    const outcome = await resolveEpochConflict({
      doc: loser,
      winner,
      canvasPath: BOARD,
      env: probe.env,
    });

    expect(outcome.remoteEpoch).toBe(4096);
    expect(outcome.localEpoch).toBe(0);
    expect(readEpoch(loser)).toBe(4096);
    loser.destroy();
    winner.destroy();
  });
});
