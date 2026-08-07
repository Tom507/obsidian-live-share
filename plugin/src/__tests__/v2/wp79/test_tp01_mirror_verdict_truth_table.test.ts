// WP79 / AC1 — "the verdict is taken by a pure core, it is a closed set, and it
// is fail-closed."
//
// The subject is `decideCanvasMirror` in
// `plugin/src/files/canvas-mirror-decision.ts` — a dependency-free function, in
// the precedent of `decideSeed`. Every row of its truth table is written out
// rather than generated, INCLUDING every unknown-input row, because a guard that
// is right on three rows of four is exactly how R4 was re-armed once already,
// and a test that passes when one conjunct is deleted has not tested a
// conjunction.
//
// PRODUCTION LINE <-> ASSERTION:
//   `probe.role === "host"` + `localFileExists === true`  -> the PUBLISH rows
//   `probe.localFileExists !== false`                     -> the SKIP_LOCAL_FILE rows
//   `probe.identityResolves !== true`                     -> the identity rows
//   `probe.docHasRecords !== true`                        -> the empty-doc rows
// Deleting any one of those four lines reddens a named row below.

import { describe, expect, it } from "vitest";

import {
  type CanvasMirrorObservation,
  MIRROR_VERDICT,
  type MirrorVerdict,
  admitsCanvasMirror,
  decideCanvasMirror,
} from "../../../files/canvas-mirror-decision";

type Row = {
  name: string;
  observation: CanvasMirrorObservation;
  expected: MirrorVerdict;
};

/** The guest's three-condition table, all eight rows, spelled out. */
const GUEST_TABLE: Row[] = [
  {
    name: "guest, no file, identity resolves, doc has records -> MATERIALISE",
    observation: {
      role: "guest",
      localFileExists: false,
      identityResolves: true,
      docHasRecords: true,
    },
    expected: MIRROR_VERDICT.MATERIALISE,
  },
  {
    name: "guest, no file, identity resolves, EMPTY doc -> skip (no source)",
    observation: {
      role: "guest",
      localFileExists: false,
      identityResolves: true,
      docHasRecords: false,
    },
    expected: MIRROR_VERDICT.SKIP_NO_SOURCE,
  },
  {
    name: "guest, no file, NO identity, doc has records -> skip (no source)",
    observation: {
      role: "guest",
      localFileExists: false,
      identityResolves: false,
      docHasRecords: true,
    },
    expected: MIRROR_VERDICT.SKIP_NO_SOURCE,
  },
  {
    name: "guest, no file, NO identity, empty doc -> skip (no source)",
    observation: {
      role: "guest",
      localFileExists: false,
      identityResolves: false,
      docHasRecords: false,
    },
    expected: MIRROR_VERDICT.SKIP_NO_SOURCE,
  },
  {
    name: "guest, FILE PRESENT, identity resolves, doc has records -> skip (local file)",
    observation: {
      role: "guest",
      localFileExists: true,
      identityResolves: true,
      docHasRecords: true,
    },
    expected: MIRROR_VERDICT.SKIP_LOCAL_FILE,
  },
  {
    name: "guest, FILE PRESENT, identity resolves, empty doc -> skip (local file)",
    observation: {
      role: "guest",
      localFileExists: true,
      identityResolves: true,
      docHasRecords: false,
    },
    expected: MIRROR_VERDICT.SKIP_LOCAL_FILE,
  },
  {
    name: "guest, FILE PRESENT, no identity, doc has records -> skip (local file)",
    observation: {
      role: "guest",
      localFileExists: true,
      identityResolves: false,
      docHasRecords: true,
    },
    expected: MIRROR_VERDICT.SKIP_LOCAL_FILE,
  },
  {
    name: "guest, FILE PRESENT, no identity, empty doc -> skip (local file)",
    observation: {
      role: "guest",
      localFileExists: true,
      identityResolves: false,
      docHasRecords: false,
    },
    expected: MIRROR_VERDICT.SKIP_LOCAL_FILE,
  },
];

/** The host's table. The host publishes what it holds and nothing else. */
const HOST_TABLE: Row[] = [
  {
    name: "host, file present, identity resolves, doc has records -> PUBLISH",
    observation: {
      role: "host",
      localFileExists: true,
      identityResolves: true,
      docHasRecords: true,
    },
    expected: MIRROR_VERDICT.PUBLISH,
  },
  {
    name: "host, file present, NO identity yet, empty doc -> PUBLISH (this is the mint case)",
    observation: {
      role: "host",
      localFileExists: true,
      identityResolves: false,
      docHasRecords: false,
    },
    expected: MIRROR_VERDICT.PUBLISH,
  },
  {
    name: "host, NO local file, identity resolves, doc has records -> skip (no source)",
    observation: {
      role: "host",
      localFileExists: false,
      identityResolves: true,
      docHasRecords: true,
    },
    expected: MIRROR_VERDICT.SKIP_NO_SOURCE,
  },
  {
    name: "host, NO local file, no identity, empty doc -> skip (no source)",
    observation: {
      role: "host",
      localFileExists: false,
      identityResolves: false,
      docHasRecords: false,
    },
    expected: MIRROR_VERDICT.SKIP_NO_SOURCE,
  },
];

describe("WP79 AC1 - decideCanvasMirror: the guest's truth table, row by row", () => {
  for (const row of GUEST_TABLE) {
    it(row.name, () => {
      expect(decideCanvasMirror(row.observation)).toBe(row.expected);
    });
  }
});

describe("WP79 AC1 - decideCanvasMirror: the host's truth table, row by row", () => {
  for (const row of HOST_TABLE) {
    it(row.name, () => {
      expect(decideCanvasMirror(row.observation)).toBe(row.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED. Every input that is missing, `undefined`, `null` or not a boolean
// yields a SKIP, never a MATERIALISE. A truthiness test would pass most of the
// rows above and fail every one of these.
// ---------------------------------------------------------------------------

const UNKNOWN_VALUES: unknown[] = [undefined, null, 0, 1, "", "true", "false", {}, []];

describe("WP79 AC1 - fail-closed: an unanswered probe never materialises", () => {
  it("a null observation skips", () => {
    expect(decideCanvasMirror(null as unknown as CanvasMirrorObservation)).toBe(
      MIRROR_VERDICT.SKIP_NO_SOURCE,
    );
  });

  it("a non-object observation skips", () => {
    expect(decideCanvasMirror("guest" as unknown as CanvasMirrorObservation)).toBe(
      MIRROR_VERDICT.SKIP_NO_SOURCE,
    );
  });

  it("an empty object skips (every field missing)", () => {
    expect(decideCanvasMirror({} as unknown as CanvasMirrorObservation)).toBe(
      MIRROR_VERDICT.SKIP_NO_SOURCE,
    );
  });

  for (const value of UNKNOWN_VALUES) {
    it(`role = ${JSON.stringify(value)} skips rather than guessing a role`, () => {
      expect(
        decideCanvasMirror({
          role: value,
          localFileExists: false,
          identityResolves: true,
          docHasRecords: true,
        } as unknown as CanvasMirrorObservation),
      ).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    });
  }

  for (const value of UNKNOWN_VALUES) {
    it(`guest, localFileExists = ${JSON.stringify(value)} -> skip (local file), never a write`, () => {
      expect(
        decideCanvasMirror({
          role: "guest",
          localFileExists: value,
          identityResolves: true,
          docHasRecords: true,
        } as unknown as CanvasMirrorObservation),
      ).toBe(MIRROR_VERDICT.SKIP_LOCAL_FILE);
    });
  }

  for (const value of UNKNOWN_VALUES) {
    it(`guest, identityResolves = ${JSON.stringify(value)} -> skip (no source)`, () => {
      expect(
        decideCanvasMirror({
          role: "guest",
          localFileExists: false,
          identityResolves: value,
          docHasRecords: true,
        } as unknown as CanvasMirrorObservation),
      ).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    });
  }

  for (const value of UNKNOWN_VALUES) {
    it(`guest, docHasRecords = ${JSON.stringify(value)} -> skip (no source), no empty file`, () => {
      expect(
        decideCanvasMirror({
          role: "guest",
          localFileExists: false,
          identityResolves: true,
          docHasRecords: value,
        } as unknown as CanvasMirrorObservation),
      ).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    });
  }

  for (const value of UNKNOWN_VALUES) {
    it(`host, localFileExists = ${JSON.stringify(value)} -> skip, never publishes what it may not hold`, () => {
      expect(
        decideCanvasMirror({
          role: "host",
          localFileExists: value,
          identityResolves: true,
          docHasRecords: true,
        } as unknown as CanvasMirrorObservation),
      ).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    });
  }
});

describe("WP79 AC1 - the core is a pure function", () => {
  it("does not mutate its argument", () => {
    const observation: CanvasMirrorObservation = {
      role: "guest",
      localFileExists: false,
      identityResolves: true,
      docHasRecords: true,
    };
    const before = JSON.stringify(observation);
    decideCanvasMirror(observation);
    expect(JSON.stringify(observation)).toBe(before);
  });

  it("has no state between calls - the same input answers the same twice", () => {
    const observation: CanvasMirrorObservation = {
      role: "guest",
      localFileExists: false,
      identityResolves: true,
      docHasRecords: true,
    };
    expect(decideCanvasMirror(observation)).toBe(decideCanvasMirror(observation));
    expect(decideCanvasMirror(observation)).toBe(MIRROR_VERDICT.MATERIALISE);
  });

  it("never throws, for any shape at all", () => {
    for (const value of [...UNKNOWN_VALUES, Symbol("x"), () => undefined]) {
      expect(() =>
        decideCanvasMirror(value as unknown as CanvasMirrorObservation),
      ).not.toThrow();
    }
  });

  it("the verdict set is closed - every answer is one of the four constants", () => {
    const allowed = new Set(Object.values(MIRROR_VERDICT));
    const roles: unknown[] = ["host", "guest", "HOST", undefined, null];
    const bools: unknown[] = [true, false, undefined, null, "x"];
    for (const role of roles) {
      for (const f of bools) {
        for (const i of bools) {
          for (const d of bools) {
            const verdict = decideCanvasMirror({
              role,
              localFileExists: f,
              identityResolves: i,
              docHasRecords: d,
            } as unknown as CanvasMirrorObservation);
            expect(allowed.has(verdict)).toBe(true);
          }
        }
      }
    }
  });
});

describe("WP79 AC1 - admitsCanvasMirror is derived from the same rules", () => {
  it("admits a guest with no local file and a resolvable identity", () => {
    expect(
      admitsCanvasMirror({ role: "guest", localFileExists: false, identityResolves: true }),
    ).toBe(true);
  });

  it("refuses a guest that already has the file - no doc is opened for it", () => {
    expect(
      admitsCanvasMirror({ role: "guest", localFileExists: true, identityResolves: true }),
    ).toBe(false);
  });

  it("refuses a guest with no resolvable identity - a skip, never a fallback", () => {
    expect(
      admitsCanvasMirror({ role: "guest", localFileExists: false, identityResolves: false }),
    ).toBe(false);
  });

  it("admits a host that holds the file, even with no identity yet (it mints)", () => {
    expect(
      admitsCanvasMirror({ role: "host", localFileExists: true, identityResolves: false }),
    ).toBe(true);
  });

  it("refuses a host that does not hold the file", () => {
    expect(
      admitsCanvasMirror({ role: "host", localFileExists: false, identityResolves: true }),
    ).toBe(false);
  });

  it("agrees with decideCanvasMirror on every combination it can be asked", () => {
    const roles = ["host", "guest"] as const;
    for (const role of roles) {
      for (const localFileExists of [true, false]) {
        for (const identityResolves of [true, false]) {
          const admitted = admitsCanvasMirror({ role, localFileExists, identityResolves });
          const verdict = decideCanvasMirror({
            role,
            localFileExists,
            identityResolves,
            docHasRecords: true,
          });
          const acts =
            verdict === MIRROR_VERDICT.PUBLISH || verdict === MIRROR_VERDICT.MATERIALISE;
          expect(admitted).toBe(acts);
        }
      }
    }
  });
});
