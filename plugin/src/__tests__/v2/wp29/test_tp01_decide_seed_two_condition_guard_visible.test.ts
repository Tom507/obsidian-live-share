// WP29 / AC1 — "Seeding from file happens only when NEITHER a sidecar NOR any
// peer knows the doc; in every other case the client loads/merges instead of
// seeding."
//
// This is a TWO-CONDITION guard, and the whole risk in it is that an
// implementation which checks only ONE of the two conditions still passes a
// test that only varies one of them. The truth table therefore has FOUR rows and
// all four are asserted here — (sidecar, peer) over {false, true}² — so a guard
// spelled `if (!peerKnowsDoc) seed` and a guard spelled `if (!sidecarKnowsDoc)
// seed` each go red on exactly one row.
//
// The subject is a PURE CORE, in the precedent of `canvas/reconcile-plan.ts`: no
// Obsidian, no filesystem, no clock, no Yjs. That is what makes the truth table
// assertable at all — the same question asked through `coldOpen` (tp02) can only
// be asked one scenario at a time.
//
// The second half is the FAIL-CLOSED rule. Seeding is the destructive direction:
// it is the branch that lets a stale local file speak for a board other replicas
// already hold. So "I do not know" must resolve to LOAD_OR_MERGE, never to
// SEED_FROM_FILE. Anything that is not exactly `false` counts as "knows the
// doc". Without this, a knowledge probe that silently returns `undefined` for a
// field — a wiring bug, not a decision bug — reads as "nobody knows this board"
// and re-arms R4 through the back door.
//
// PRODUCTION LINE <-> ASSERTION: `decideSeed` in
// `plugin/src/files/canvas-seed-decision.ts`. Dropping either conjunct from its
// condition reddens exactly one row of the truth table below; replacing
// `!== false` with a truthiness test reddens the fail-closed block.

import { describe, expect, it } from "vitest";

import {
  NOTHING_KNOWS_DOC,
  SEED_DECISION,
  type SeedKnowledge,
  decideSeed,
} from "../../../files/canvas-seed-decision";

/** The four rows of the guard's truth table, written out rather than generated. */
const TRUTH_TABLE: {
  sidecarKnowsDoc: boolean;
  peerKnowsDoc: boolean;
  expected: string;
  why: string;
}[] = [
  {
    sidecarKnowsDoc: false,
    peerKnowsDoc: false,
    expected: SEED_DECISION.SEED_FROM_FILE,
    why: "nothing anywhere knows this board — the file is the only replica there is",
  },
  {
    sidecarKnowsDoc: true,
    peerKnowsDoc: false,
    expected: SEED_DECISION.LOAD_OR_MERGE,
    why: "this client's own sidecar holds a replica — resume it, never re-seed over it",
  },
  {
    sidecarKnowsDoc: false,
    peerKnowsDoc: true,
    expected: SEED_DECISION.LOAD_OR_MERGE,
    why: "a peer holds this board — a rejoin is an ordinary related-replica merge",
  },
  {
    sidecarKnowsDoc: true,
    peerKnowsDoc: true,
    expected: SEED_DECISION.LOAD_OR_MERGE,
    why: "both know it — seeding here is R4 with two witnesses",
  },
];

describe("WP29 AC1 — the seed decision is a two-condition guard", () => {
  it("exposes exactly two decisions and a both-false constant", () => {
    // The vocabulary is pinned so WP30 can import it rather than re-spell it
    // (Shared Ownership Contract §1: WP29 owns the seed decision).
    expect(Object.values(SEED_DECISION).sort()).toEqual(["load-or-merge", "seed-from-file"]);
    expect(NOTHING_KNOWS_DOC).toEqual({ sidecarKnowsDoc: false, peerKnowsDoc: false });
  });

  for (const row of TRUTH_TABLE) {
    it(`sidecar=${row.sidecarKnowsDoc} peer=${row.peerKnowsDoc} -> ${row.expected}`, () => {
      const knowledge: SeedKnowledge = {
        sidecarKnowsDoc: row.sidecarKnowsDoc,
        peerKnowsDoc: row.peerKnowsDoc,
      };
      expect(decideSeed(knowledge), row.why).toBe(row.expected);
    });
  }

  it("SEED_FROM_FILE is reachable on exactly one of the four rows", () => {
    // Stated as a count so a guard that returns SEED_FROM_FILE unconditionally
    // — the "removed the check" defect — cannot pass by satisfying row 1 alone.
    const seeding = TRUTH_TABLE.filter(
      (row) =>
        decideSeed({
          sidecarKnowsDoc: row.sidecarKnowsDoc,
          peerKnowsDoc: row.peerKnowsDoc,
        }) === SEED_DECISION.SEED_FROM_FILE,
    );
    expect(seeding.map((r) => `${r.sidecarKnowsDoc}/${r.peerKnowsDoc}`)).toEqual(["false/false"]);
  });

  it("NOTHING_KNOWS_DOC is the only shape that seeds", () => {
    expect(decideSeed(NOTHING_KNOWS_DOC)).toBe(SEED_DECISION.SEED_FROM_FILE);
  });

  describe("fail-closed — anything that is not exactly `false` counts as knowing", () => {
    const notFalse: unknown[] = [true, undefined, null, 0, "", "false", Number.NaN, {}];

    for (const value of notFalse) {
      it(`sidecarKnowsDoc = ${String(value)} does not seed`, () => {
        const knowledge = {
          sidecarKnowsDoc: value,
          peerKnowsDoc: false,
        } as unknown as SeedKnowledge;
        expect(
          decideSeed(knowledge),
          "an unknown sidecar answer was read as 'no sidecar' and seeded over a live board",
        ).toBe(SEED_DECISION.LOAD_OR_MERGE);
      });

      it(`peerKnowsDoc = ${String(value)} does not seed`, () => {
        const knowledge = {
          sidecarKnowsDoc: false,
          peerKnowsDoc: value,
        } as unknown as SeedKnowledge;
        expect(
          decideSeed(knowledge),
          "an unknown peer answer was read as 'no peers' and seeded over a live board",
        ).toBe(SEED_DECISION.LOAD_OR_MERGE);
      });
    }

    it("a missing knowledge object does not seed either", () => {
      expect(decideSeed(undefined as unknown as SeedKnowledge)).toBe(SEED_DECISION.LOAD_OR_MERGE);
      expect(decideSeed({} as unknown as SeedKnowledge)).toBe(SEED_DECISION.LOAD_OR_MERGE);
    });
  });

  it("is a pure function of its argument — no hidden state between calls", () => {
    // A decision that memoised its first answer would pass every single-row test
    // above and then seed a second board because the first one was unknown.
    expect(decideSeed(NOTHING_KNOWS_DOC)).toBe(SEED_DECISION.SEED_FROM_FILE);
    expect(decideSeed({ sidecarKnowsDoc: true, peerKnowsDoc: true })).toBe(
      SEED_DECISION.LOAD_OR_MERGE,
    );
    expect(decideSeed(NOTHING_KNOWS_DOC)).toBe(SEED_DECISION.SEED_FROM_FILE);
    expect(decideSeed({ sidecarKnowsDoc: false, peerKnowsDoc: true })).toBe(
      SEED_DECISION.LOAD_OR_MERGE,
    );
    expect(decideSeed(NOTHING_KNOWS_DOC)).toBe(SEED_DECISION.SEED_FROM_FILE);
  });

  it("does not mutate the knowledge it is handed", () => {
    const knowledge: SeedKnowledge = { sidecarKnowsDoc: true, peerKnowsDoc: false };
    decideSeed(knowledge);
    expect(knowledge).toEqual({ sidecarKnowsDoc: true, peerKnowsDoc: false });
    // The exported constant is shared by every caller; a decision that wrote
    // through it would poison every later cold open in the session.
    decideSeed(NOTHING_KNOWS_DOC);
    expect(NOTHING_KNOWS_DOC).toEqual({ sidecarKnowsDoc: false, peerKnowsDoc: false });
  });
});
