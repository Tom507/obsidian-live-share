// WP28 / AC3 blind2 — the non-triggering claim as a ZERO-SIDE-EFFECT INVARIANT
// over a long randomised session.
//
// Different angle: blind1 counts conflict copies over an epoch matrix. This file
// runs a 60-step session in which the epochs are DELIBERATELY held equal while
// everything else about the two replicas varies wildly — record counts, ids,
// field values, empty vs full, tombstones present vs absent, corrupt-but-matching
// epoch cells — and asserts that the four side-effect channels stay completely
// empty for the whole run, and that the local doc is never written to.
//
// This is the assertion that makes AC2 non-vacuous. "The loser archives before
// adopting" is satisfied PERFECTLY by an implementation that archives on every
// merge. That implementation is only distinguishable here: every subscribe, every
// peer arrival, every resume produces a `plan.conflict-….canvas` and a toast, and
// nothing about the archive itself is wrong.
//
// The equal-epoch case is not the exotic one. It is the case that runs thousands
// of times a day in a live session; the conflict is the exception.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "daily/standup.canvas";

/** A tiny deterministic PRNG so the session is reproducible without a fixture file. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function makeReplica(epoch: unknown, cardCount: number, tag: string, tombstones: number): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    if (epoch !== undefined) doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (let i = 0; i < cardCount; i++) {
      const record = new Y.Map<unknown>();
      nodes.set(`${tag}-${i}`, record);
      record.set("id", `${tag}-${i}`);
      record.set("text", `${tag} body ${i}`);
      record.set("x", i * 17);
    }
    const deleted = doc.getMap<unknown>("deleted");
    for (let i = 0; i < tombstones; i++) deleted.set(`${tag}-gone-${i}`, { t: i, by: tag, on: true });
  });
  return doc;
}

interface Ledger {
  archives: number;
  notices: number;
  logs: number;
  serialisations: number;
}

function makeEnv(ledger: Ledger) {
  return {
    serializeDoc: () => {
      ledger.serialisations += 1;
      return "{}";
    },
    writeConflictCopy: async () => {
      ledger.archives += 1;
    },
    notify: () => {
      ledger.notices += 1;
    },
    today: () => "2026-04-04",
    logger: {
      debug: () => {},
      warn: () => {
        ledger.logs += 1;
      },
    },
  };
}

/** Every shape of "the two epoch cells are equal", including the corrupt ones. */
const EQUAL_CELLS: unknown[] = [0, 1, 2, 5, 13, 400, undefined, Number.NaN, null, "7", -3, 2.5];

describe("WP28 AC3 blind2 — a 60-step equal-epoch session has zero side effects", () => {
  it("no archive, no notice, no log and no serialisation across the whole session", async () => {
    const ledger: Ledger = { archives: 0, notices: 0, logs: 0, serialisations: 0 };
    const env = makeEnv(ledger);
    const random = rng(20_260_404);

    for (let step = 0; step < 60; step++) {
      const cell = EQUAL_CELLS[step % EQUAL_CELLS.length];
      const mine = makeReplica(cell, Math.floor(random() * 6), `mine-${step}`, step % 3);
      const theirs = makeReplica(cell, Math.floor(random() * 6), `theirs-${step}`, (step + 1) % 4);

      const outcome = await resolveEpochConflict({
        doc: mine,
        winner: theirs,
        canvasPath: BOARD,
        env,
      });

      expect(outcome.verdict, `step ${step} with cell ${String(cell)}`).toBe("equal");
      expect(outcome.adopted).toBe(false);
      expect(outcome.archivedTo).toBeNull();
      expect(outcome.signature).toBeNull();
      mine.destroy();
      theirs.destroy();
    }

    expect(
      ledger,
      "a related-replica session produced side effects — an implementation that archives " +
        "on every merge passes AC2 and fails exactly here",
    ).toEqual({ archives: 0, notices: 0, logs: 0, serialisations: 0 });
  });

  it("the local replica is never written to across the session", async () => {
    const ledger: Ledger = { archives: 0, notices: 0, logs: 0, serialisations: 0 };
    const env = makeEnv(ledger);
    let mutations = 0;

    for (let step = 0; step < 24; step++) {
      const cell = EQUAL_CELLS[step % EQUAL_CELLS.length];
      const mine = makeReplica(cell, 3, `mine-${step}`, 1);
      const theirs = makeReplica(cell, 4, `theirs-${step}`, 2);
      mine.on("afterTransaction", () => {
        mutations += 1;
      });

      await resolveEpochConflict({ doc: mine, winner: theirs, canvasPath: BOARD, env });

      expect(
        [...mine.getMap("nodes").keys()].sort(),
        `step ${step}: the local records changed on an equal-epoch merge`,
      ).toEqual([`mine-${step}-0`, `mine-${step}-1`, `mine-${step}-2`]);
      mine.destroy();
      theirs.destroy();
    }

    expect(mutations, "the equal path opened a transaction on the local doc").toBe(0);
    expect(ledger.archives).toBe(0);
  });

  it("the tombstone map is not disturbed at equal epochs", async () => {
    const ledger: Ledger = { archives: 0, notices: 0, logs: 0, serialisations: 0 };
    const mine = makeReplica(8, 2, "mine", 3);
    const theirs = makeReplica(8, 2, "theirs", 5);
    const before = [...mine.getMap<unknown>("deleted").keys()].sort();

    await resolveEpochConflict({
      doc: mine,
      winner: theirs,
      canvasPath: BOARD,
      env: makeEnv(ledger),
    });

    expect([...mine.getMap<unknown>("deleted").keys()].sort()).toEqual(before);
    expect(before).toHaveLength(3);
    mine.destroy();
    theirs.destroy();
  });

  it("the LOCAL-WINS side of the session is equally inert", async () => {
    const ledger: Ledger = { archives: 0, notices: 0, logs: 0, serialisations: 0 };
    const env = makeEnv(ledger);

    for (let step = 0; step < 20; step++) {
      const mine = makeReplica(100 + step, 2, `mine-${step}`, 0);
      const theirs = makeReplica(step, 2, `theirs-${step}`, 0);
      const outcome = await resolveEpochConflict({
        doc: mine,
        winner: theirs,
        canvasPath: BOARD,
        env,
      });
      expect(outcome.verdict, `step ${step}`).toBe("local-wins");
      expect(outcome.adopted).toBe(false);
      mine.destroy();
      theirs.destroy();
    }

    expect(
      ledger,
      "the WINNING side archived — an implementation that archives whenever the epochs " +
        "differ writes a copy of the state it is about to keep",
    ).toEqual({ archives: 0, notices: 0, logs: 0, serialisations: 0 });
  });

  it("one genuine conflict dropped into the middle of the session is still caught", async () => {
    const ledger: Ledger = { archives: 0, notices: 0, logs: 0, serialisations: 0 };
    const env = makeEnv(ledger);

    for (let step = 0; step < 10; step++) {
      const mine = makeReplica(4, 2, `mine-${step}`, 0);
      const theirs = makeReplica(4, 2, `theirs-${step}`, 0);
      await resolveEpochConflict({ doc: mine, winner: theirs, canvasPath: BOARD, env });
      mine.destroy();
      theirs.destroy();
    }
    expect(ledger.archives).toBe(0);

    const behind = makeReplica(4, 2, "behind", 0);
    const ahead = makeReplica(5, 2, "ahead", 0);
    await resolveEpochConflict({ doc: behind, winner: ahead, canvasPath: BOARD, env });

    expect(ledger, "the one real conflict in the session was not archived").toEqual({
      archives: 1,
      notices: 1,
      logs: 1,
      serialisations: 1,
    });
    behind.destroy();
    ahead.destroy();
  });
});
