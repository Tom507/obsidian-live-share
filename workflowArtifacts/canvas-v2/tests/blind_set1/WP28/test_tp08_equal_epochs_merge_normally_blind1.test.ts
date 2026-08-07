// WP28 / AC3 blind1 — the non-triggering claim, attacked as a COUNTING
// EXPERIMENT over a generated matrix instead of a list of cases.
//
// Different angle: run all 12x12 ordered epoch pairs through the resolver with a
// single shared probe, then assert that the number of conflict copies written is
// EXACTLY the number of pairs whose local epoch is strictly lower. There are 144
// merges and only 66 conflicts; an implementation that archives on every merge
// writes 144, one that archives whenever the epochs merely differ writes 132, one
// that archives only when it feels like it writes something else. Each of those
// is a different number, so the count alone identifies the defect.
//
// This is the assertion that makes AC2 mean something. Without it, "the loser
// archives before adopting" is satisfied perfectly by an implementation that
// archives on EVERY merge — every subscribe, every peer arrival, every resume —
// and the user's vault fills with conflict copies of a board nobody ever forked.
//
// The second half kills the other cheap shortcut: divergent CONTENT at equal
// epochs must still not trigger. Two related replicas normally hold different
// records — that is what a live session looks like — so an implementation that
// reaches for "the docs look different, better archive" is wrong in the most
// common situation there is.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "ops/runbook.canvas";
const EPOCH_RANGE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function doc(epoch: unknown, cards: readonly string[]): Y.Doc {
  const d = new Y.Doc();
  d.transact(() => {
    if (epoch !== undefined) d.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const nodes = d.getMap<Y.Map<unknown>>("nodes");
    for (const id of cards) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
    }
  });
  return d;
}

function counter() {
  let archives = 0;
  let notices = 0;
  let logs = 0;
  return {
    read: () => ({ archives, notices, logs }),
    env: {
      serializeDoc: () => "{}",
      writeConflictCopy: async () => {
        archives += 1;
      },
      notify: () => {
        notices += 1;
      },
      today: () => "2026-02-02",
      logger: {
        debug: () => {},
        warn: () => {
          logs += 1;
        },
      },
    },
  };
}

describe("WP28 AC3 blind1 — the archive count over a full epoch matrix", () => {
  it("144 merges produce exactly 66 conflict copies", async () => {
    const probe = counter();
    let expected = 0;
    for (const local of EPOCH_RANGE) {
      for (const remote of EPOCH_RANGE) {
        if (local < remote) expected += 1;
        const a = doc(local, ["x"]);
        const b = doc(remote, ["y"]);
        await resolveEpochConflict({ doc: a, winner: b, canvasPath: BOARD, env: probe.env });
        a.destroy();
        b.destroy();
      }
    }

    expect(expected).toBe(66);
    const { archives, notices, logs } = probe.read();
    expect(
      archives,
      `${archives} conflict copies for 144 merges. 144 means the implementation archives ` +
        "on EVERY merge; 132 means it archives whenever the epochs differ; 66 is the " +
        "number of merges that are actually conflicts",
    ).toBe(66);
    expect(notices).toBe(66);
    expect(logs).toBe(66);
  });

  it("the 12 equal-epoch pairs on the diagonal produce nothing at all", async () => {
    const probe = counter();
    for (const epoch of EPOCH_RANGE) {
      const a = doc(epoch, ["x"]);
      const b = doc(epoch, ["y"]);
      const outcome = await resolveEpochConflict({
        doc: a,
        winner: b,
        canvasPath: BOARD,
        env: probe.env,
      });
      expect(outcome.verdict, `epoch ${epoch}`).toBe("equal");
      expect(outcome.adopted).toBe(false);
      a.destroy();
      b.destroy();
    }
    expect(probe.read()).toEqual({ archives: 0, notices: 0, logs: 0 });
  });

  it("DIVERGENT CONTENT at equal epochs is still not a conflict", async () => {
    const probe = counter();
    const mine = doc(6, ["a", "b", "c", "d", "e"]);
    const theirs = doc(6, ["v", "w", "x", "y", "z"]);

    const outcome = await resolveEpochConflict({
      doc: mine,
      winner: theirs,
      canvasPath: BOARD,
      env: probe.env,
    });

    expect(outcome.verdict).toBe("equal");
    expect(
      probe.read().archives,
      "two related replicas holding different records were treated as a fork — that is " +
        "every live session there has ever been",
    ).toBe(0);
    expect([...mine.getMap("nodes").keys()].sort()).toEqual(["a", "b", "c", "d", "e"]);
    mine.destroy();
    theirs.destroy();
  });

  it("an EMPTY replica meeting a full one at the same epoch is still not a conflict", async () => {
    const probe = counter();
    const empty = doc(2, []);
    const full = doc(2, ["a", "b", "c"]);

    await resolveEpochConflict({ doc: empty, winner: full, canvasPath: BOARD, env: probe.env });

    expect(probe.read().archives).toBe(0);
    expect([...empty.getMap("nodes").keys()]).toEqual([]);
    empty.destroy();
    full.destroy();
  });

  it("unstamped-vs-unstamped is the most common merge there is, and archives nothing", async () => {
    const probe = counter();
    for (let i = 0; i < 20; i++) {
      const a = doc(undefined, [`a${i}`]);
      const b = doc(undefined, [`b${i}`]);
      await resolveEpochConflict({ doc: a, winner: b, canvasPath: BOARD, env: probe.env });
      a.destroy();
      b.destroy();
    }
    expect(probe.read()).toEqual({ archives: 0, notices: 0, logs: 0 });
  });

  it("the local doc is never mutated on the equal or local-wins paths", async () => {
    const probe = counter();
    for (const [local, remote] of [
      [4, 4],
      [9, 1],
      [0, 0],
      [11, 10],
    ] as const) {
      const a = doc(local, ["keep-me"]);
      const b = doc(remote, ["theirs"]);
      let mutated = false;
      a.on("afterTransaction", () => {
        mutated = true;
      });

      await resolveEpochConflict({ doc: a, winner: b, canvasPath: BOARD, env: probe.env });

      expect(mutated, `local=${local} remote=${remote} opened a transaction`).toBe(false);
      expect([...a.getMap("nodes").keys()]).toEqual(["keep-me"]);
      a.destroy();
      b.destroy();
    }
    expect(probe.read().archives).toBe(0);
  });
});
