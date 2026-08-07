// WP28 / AC1 blind1 — "on EVERY replica", attacked with FIVE replicas at five
// different epochs, resolved in a scrambled order.
//
// Different angle: the visible probe drives three replicas that are all strictly
// behind one winner. Here the population is mixed — one replica IS the winner,
// one is already at the winner's epoch (a related replica), and three are behind
// by different amounts — and the resolutions are applied in a scrambled order.
// The claim is a population claim: after every replica has met the winner, the
// board is the same board everywhere, and exactly the replicas that were
// strictly behind archived.
//
// The CRDT discipline (Shared Ownership Contract §5, WP28): the epoch and the id
// set are asserted by identity because each replica's adoption is a local write
// with a single author and no concurrent same-key write to arbitrate. Nothing
// here asserts a specific winner for a value two replicas wrote concurrently —
// there is no such value in this file, which is itself the point: the epoch
// carries the ordering precisely so record content does not have to.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readEpoch, resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "shared/mesh.canvas";
const WINNER_EPOCH = 12;
/** replica index → its epoch. Index 4 is already current; index 0 never stamped. */
const EPOCHS = [0, 3, 7, 11, WINNER_EPOCH];
/** Deliberately not 0,1,2,3,4. */
const RESOLVE_ORDER = [3, 0, 4, 2, 1];

function replicaDoc(index: number): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, EPOCHS[index]);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const id of ["common", `private-${index}`]) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("text", `replica ${index}`);
    }
  });
  return doc;
}

function winnerDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, WINNER_EPOCH);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const id of ["common", "imported-a", "imported-b"]) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("text", "the imported board");
    }
  });
  return doc;
}

function tap() {
  const archives: string[] = [];
  const notices: string[] = [];
  return {
    archives,
    notices,
    env: {
      serializeDoc: (doc: Y.Doc) => JSON.stringify([...doc.getMap("nodes").keys()].sort()),
      writeConflictCopy: async (_p: string, content: string) => {
        archives.push(content);
      },
      notify: (message: string) => notices.push(message),
      today: () => "2026-07-07",
      logger: { debug: () => {}, warn: () => {} },
    },
  };
}

async function runPopulation() {
  const replicas = EPOCHS.map((_e, index) => replicaDoc(index));
  const winner = winnerDoc();
  const taps = replicas.map(() => tap());
  for (const index of RESOLVE_ORDER) {
    await resolveEpochConflict({
      doc: replicas[index],
      winner,
      canvasPath: BOARD,
      env: taps[index].env,
    });
  }
  return { replicas, winner, taps };
}

/** The replicas strictly behind the winner — the ones the epoch rule acts on. */
const BEHIND = EPOCHS.map((epoch, index) => ({ epoch, index }))
  .filter(({ epoch }) => epoch < WINNER_EPOCH)
  .map(({ index }) => index);

describe("WP28 AC1 blind1 — a five-replica population all lands on the winner", () => {
  it("every replica that was BEHIND holds exactly the winner's ids afterwards", async () => {
    const { replicas, winner } = await runPopulation();
    const expected = [...winner.getMap("nodes").keys()].sort();

    for (const index of BEHIND) {
      expect([...replicas[index].getMap("nodes").keys()].sort(), `replica ${index}`).toEqual(
        expected,
      );
    }
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("the replica ALREADY at the winner's epoch keeps its own board", async () => {
    const { replicas, winner } = await runPopulation();
    const current = EPOCHS.indexOf(WINNER_EPOCH);

    expect([...replicas[current].getMap("nodes").keys()].sort()).toEqual([
      "common",
      `private-${current}`,
    ]);
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("no BEHIND replica's private record survives its own adoption", async () => {
    const { replicas, winner } = await runPopulation();

    for (const index of BEHIND) {
      for (let other = 0; other < EPOCHS.length; other++) {
        expect(
          replicas[index].getMap<Y.Map<unknown>>("nodes").has(`private-${other}`),
          `replica ${index} still holds \`private-${other}\``,
        ).toBe(false);
      }
    }
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("every replica reports the same epoch, and it is the winner's", async () => {
    const { replicas, winner } = await runPopulation();

    expect(replicas.map((replica) => readEpoch(replica))).toEqual(
      EPOCHS.map(() => WINNER_EPOCH),
    );
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("exactly the four strictly-behind replicas archived; the current one did not", async () => {
    const { replicas, winner, taps } = await runPopulation();

    for (const [index, probe] of taps.entries()) {
      const behind = EPOCHS[index] < WINNER_EPOCH;
      expect(
        probe.archives.length,
        `replica ${index} (epoch ${EPOCHS[index]}) archived ${probe.archives.length} times`,
      ).toBe(behind ? 1 : 0);
      expect(probe.notices.length).toBe(behind ? 1 : 0);
    }
    expect(taps.reduce((sum, probe) => sum + probe.archives.length, 0)).toBe(4);
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("each archive holds that replica's OWN private record and no other's", async () => {
    const { replicas, winner, taps } = await runPopulation();

    for (const [index, probe] of taps.entries()) {
      if (probe.archives.length === 0) continue;
      expect(probe.archives[0], `replica ${index}`).toContain(`private-${index}`);
      for (let other = 0; other < EPOCHS.length; other++) {
        if (other === index) continue;
        expect(probe.archives[0]).not.toContain(`private-${other}`);
      }
    }
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });

  it("resolving the whole population a SECOND time archives nothing more", async () => {
    const { replicas, winner, taps } = await runPopulation();

    for (const index of RESOLVE_ORDER) {
      await resolveEpochConflict({
        doc: replicas[index],
        winner,
        canvasPath: BOARD,
        env: taps[index].env,
      });
    }

    expect(
      taps.reduce((sum, probe) => sum + probe.archives.length, 0),
      "a settled population produced more conflict copies — the archive path is firing " +
        "on ordinary related-replica merges",
    ).toBe(4);
    for (const replica of replicas) replica.destroy();
    winner.destroy();
  });
});
