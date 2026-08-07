// ===========================================================================
// WP80 AC1 — THE TRUTH TABLE, ASSERTED ROW BY ROW.
//
// Not the acceptance evidence (that is two live Obsidian instances, AC3/AC4);
// this is the honest tool for the one thing a live run cannot show cheaply — an
// exhaustive table over a pure function, including every unknown-input row.
//
// A guard that is right on three rows of four is how R4 was re-armed once
// already in this project, and a test that still passes when one conjunct is
// deleted has not tested a conjunction. So each row is its own assertion, and
// the two witnesses are exercised independently AND in their absence.
// ===========================================================================

import { describe, expect, it } from "vitest";

import {
  PUBLICATION_DECISION,
  type PublicationKnowledge,
  decidePublication,
} from "../files/manifest-purge-decision";

/** The canonical PURGE-licensed shape: host, entered as host, nothing foreign. */
function baseline(overrides: Partial<PublicationKnowledge> = {}): PublicationKnowledge {
  return {
    manifestConnected: true,
    manifestSynced: true,
    isHost: true,
    enteredSessionAsHost: true,
    purgeRequested: true,
    foreignPublicationSinceConnect: false,
    manifestPaths: ["shared/a.md", "shared/gone.md"],
    localPaths: ["shared/a.md"],
    readFailures: 0,
    ...overrides,
  };
}

describe("WP80 decidePublication — the licensed rows", () => {
  it("WITNESS 1: entered as host, no foreign publication since connect -> PURGE", () => {
    const v = decidePublication(baseline());
    expect(v.decision).toBe(PUBLICATION_DECISION.PURGE);
    expect(v.reason).not.toBe("");
    // The unaccounted key is reported even when the purge is granted: it is
    // what the purge is about to delete.
    expect(v.unaccounted).toEqual(["shared/gone.md"]);
  });

  it("WITNESS 1: entered as host, empty room -> PURGE (startSession)", () => {
    const v = decidePublication(baseline({ manifestPaths: [], localPaths: ["shared/a.md"] }));
    expect(v.decision).toBe(PUBLICATION_DECISION.PURGE);
    expect(v.unaccounted).toEqual([]);
  });

  it("WITNESS 2: entered as GUEST but every manifest entry is accounted for -> PURGE", () => {
    const v = decidePublication(
      baseline({
        enteredSessionAsHost: false,
        foreignPublicationSinceConnect: true,
        manifestPaths: ["shared/a.md"],
        localPaths: ["shared/a.md", "shared/new.md"],
      }),
    );
    expect(v.decision).toBe(PUBLICATION_DECISION.PURGE);
    expect(v.unaccounted).toEqual([]);
  });
});

describe("WP80 decidePublication — THE DEFECT ROW and its neighbours", () => {
  it("THE DEFECT: a peer promoted mid-sync (entered as guest, entries unaccounted) -> ADDITIVE", () => {
    const v = decidePublication(
      baseline({
        enteredSessionAsHost: false,
        foreignPublicationSinceConnect: true,
        manifestPaths: ["shared/a.md", "shared/not-yet-here.md"],
        localPaths: ["shared/a.md"],
      }),
    );
    expect(v.decision).toBe(PUBLICATION_DECISION.ADDITIVE);
    expect(v.unaccounted).toEqual(["shared/not-yet-here.md"]);
    expect(v.reason).toContain("not accounted for locally");
  });

  it("the same peer AFTER its first additive publication still refuses (sticky foreign flag)", () => {
    // The attestation now carries this peer's OWN id — the shape a
    // "is the attestation mine?" test would wrongly read as standing.
    const v = decidePublication(
      baseline({
        enteredSessionAsHost: false,
        foreignPublicationSinceConnect: true,
        manifestPaths: ["shared/a.md", "shared/not-yet-here.md"],
        localPaths: ["shared/a.md"],
      }),
    );
    expect(v.decision).toBe(PUBLICATION_DECISION.ADDITIVE);
  });

  it("a HOST-origin peer that has seen a foreign publication refuses (S25 churn made harmless)", () => {
    const v = decidePublication(
      baseline({ foreignPublicationSinceConnect: true }),
    );
    expect(v.decision).toBe(PUBLICATION_DECISION.ADDITIVE);
    expect(v.reason).toContain("has seen another peer publish");
  });

  it("a REPLAYED foreign attestation does NOT close witness 1 — that is the room's persistence, not a live peer", () => {
    // The distinction D2 already draws with `seqAtConnect`, reused rather than
    // re-derived. Latching on the replay instead was MEASURED to disable the
    // host's own deletion propagation for whole sessions after one role flip.
    const v = decidePublication(baseline({ foreignPublicationSinceConnect: false }));
    expect(v.decision).toBe(PUBLICATION_DECISION.PURGE);
  });
});

describe("WP80 decidePublication — each conjunct removed individually", () => {
  // Each row below flips exactly ONE field of the PURGE-licensed baseline.
  // Deleting the corresponding conjunct from the implementation turns exactly
  // one of these green-to-red, which is what makes this a conjunction test
  // rather than an example.
  const rows: Array<[string, Partial<PublicationKnowledge>, string]> = [
    ["manifest not connected", { manifestConnected: false }, PUBLICATION_DECISION.NOTHING_TO_PUBLISH],
    ["manifest replay not landed", { manifestSynced: false }, PUBLICATION_DECISION.ADDITIVE],
    ["not the host", { isHost: false }, PUBLICATION_DECISION.ADDITIVE],
    ["purge not requested", { purgeRequested: false }, PUBLICATION_DECISION.ADDITIVE],
    ["one local file failed to read", { readFailures: 1 }, PUBLICATION_DECISION.ADDITIVE],
    [
      "entered as guest and entries unaccounted",
      { enteredSessionAsHost: false },
      PUBLICATION_DECISION.ADDITIVE,
    ],
    ["a foreign peer has published", { foreignPublicationSinceConnect: true }, PUBLICATION_DECISION.ADDITIVE],
  ];

  for (const [name, override, expected] of rows) {
    it(`${name} -> ${expected}`, () => {
      const v = decidePublication(baseline(override));
      expect(v.decision).toBe(expected);
      expect(v.reason.length).toBeGreaterThan(0);
    });
  }
});

describe("WP80 decidePublication — every unknown resolves to ADDITIVE, never PURGE", () => {
  // `!== true` / `!== false` discipline: a probe that cannot answer is not
  // evidence of completeness. Asserted per field, individually, because a
  // truthiness test would pass most of these by accident.
  const unknowns: Array<[string, Record<string, unknown>]> = [
    ["manifestSynced undefined", { manifestSynced: undefined }],
    ["manifestSynced null", { manifestSynced: null }],
    ["manifestSynced 1 (truthy non-boolean)", { manifestSynced: 1 }],
    ["isHost undefined", { isHost: undefined }],
    ["isHost 'host' (truthy string)", { isHost: "host" }],
    ["enteredSessionAsHost undefined", { enteredSessionAsHost: undefined }],
    ["enteredSessionAsHost 1", { enteredSessionAsHost: 1 }],
    ["purgeRequested undefined", { purgeRequested: undefined }],
    ["foreignPublicationSinceConnect undefined", { foreignPublicationSinceConnect: undefined }],
    ["foreignPublicationSinceConnect null", { foreignPublicationSinceConnect: null }],
    ["foreignPublicationSinceConnect 0 (falsy non-boolean)", { foreignPublicationSinceConnect: 0 }],
    ["readFailures undefined", { readFailures: undefined }],
    ["readFailures NaN", { readFailures: Number.NaN }],
    ["readFailures '0' (string)", { readFailures: "0" }],
    ["manifestPaths undefined", { manifestPaths: undefined }],
    ["manifestPaths not an array", { manifestPaths: "shared/a.md" }],
    ["manifestPaths holding a non-string", { manifestPaths: ["shared/a.md", 7] }],
    ["localPaths undefined", { localPaths: undefined }],
    ["localPaths not an array", { localPaths: {} }],
  ];

  for (const [name, override] of unknowns) {
    it(`${name} -> never PURGE`, () => {
      const v = decidePublication(baseline(override as Partial<PublicationKnowledge>));
      expect(v.decision).not.toBe(PUBLICATION_DECISION.PURGE);
      expect(v.reason.length).toBeGreaterThan(0);
    });
  }

  it("a null knowledge object -> ADDITIVE, not a throw", () => {
    const v = decidePublication(null as unknown as PublicationKnowledge);
    expect(v.decision).toBe(PUBLICATION_DECISION.ADDITIVE);
    expect(v.reason.length).toBeGreaterThan(0);
  });

  it("a non-object knowledge probe -> ADDITIVE, not a throw", () => {
    const v = decidePublication("complete" as unknown as PublicationKnowledge);
    expect(v.decision).toBe(PUBLICATION_DECISION.ADDITIVE);
  });

  it("an empty object -> NOTHING_TO_PUBLISH (manifestConnected is not true), never PURGE", () => {
    const v = decidePublication({} as PublicationKnowledge);
    expect(v.decision).toBe(PUBLICATION_DECISION.NOTHING_TO_PUBLISH);
  });
});

describe("WP80 decidePublication — the pure-core contract", () => {
  it("does not mutate its argument", () => {
    const knowledge = baseline();
    const snapshot = JSON.stringify(knowledge);
    decidePublication(knowledge);
    expect(JSON.stringify(knowledge)).toBe(snapshot);
  });

  it("is stateless between calls", () => {
    const a = decidePublication(baseline());
    decidePublication(baseline({ enteredSessionAsHost: false }));
    const b = decidePublication(baseline());
    expect(b).toEqual(a);
  });

  it("never returns an empty reason, in any branch reachable from the table above", () => {
    for (const override of [
      {},
      { manifestConnected: false },
      { isHost: false },
      { purgeRequested: false },
      { readFailures: 3 },
      { manifestSynced: false },
      { enteredSessionAsHost: false },
      { foreignPublicationSinceConnect: true },
      { manifestPaths: undefined as unknown as string[] },
    ]) {
      expect(decidePublication(baseline(override)).reason.length).toBeGreaterThan(0);
    }
  });
});
