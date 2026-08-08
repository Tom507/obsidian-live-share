// WP117 / A6 — `adopt-local-file` replaces `skip-local-file` for EXACTLY ONE
// case, and the whole rest of WP79's verdict table is byte-identical.
//
// `SKIP_LOCAL_FILE` is a safety rule: a `.canvas` already at that path licenses
// no write of any kind, "not a byte-identical one". Widening it is the sort of
// change that looks small and destroys user files, so the assertions here are
// symmetric — one set says the new verdict is reachable, the other set
// enumerates every remaining combination of inputs and pins that it answers what
// it answered before.
//
// PRODUCTION LINES <-> ASSERTIONS: `files/canvas-mirror-decision.ts`
// (`decideCanvasMirror`'s guest clause, `admitsCanvasMirror`) and
// `files/canvas-mirror.ts` (`mirrorOne`'s adopt arm and the `adopted` count).

import { describe, expect, it } from "vitest";

import {
  MIRROR_VERDICT,
  type CanvasMirrorObservation,
  admitsCanvasMirror,
  decideCanvasMirror,
} from "../../../files/canvas-mirror-decision";

const BOOLS = [true, false];

function observe(patch: Partial<CanvasMirrorObservation>): CanvasMirrorObservation {
  return {
    role: "guest",
    localFileExists: true,
    identityResolves: true,
    docHasRecords: true,
    ...patch,
  } as CanvasMirrorObservation;
}

describe("WP117 A6 — the new verdict is reachable, and only where it should be", () => {
  it("guest + local file + originated here + identity resolves = ADOPT", () => {
    expect(decideCanvasMirror(observe({ originatedHere: true }))).toBe(
      MIRROR_VERDICT.ADOPT_LOCAL_FILE,
    );
    // …and it does not require records: adoption is about IDENTITY. An empty
    // shared doc simply gives the writer nothing to project, which is the cold
    // open's decision to take and not this one's.
    expect(decideCanvasMirror(observe({ originatedHere: true, docHasRecords: false }))).toBe(
      MIRROR_VERDICT.ADOPT_LOCAL_FILE,
    );
  });

  it("the ADMISSION gate admits it, or the pass would skip before ever asking", () => {
    expect(admitsCanvasMirror({ role: "guest", localFileExists: true, identityResolves: true, originatedHere: true })).toBe(true);
    expect(admitsCanvasMirror({ role: "guest", localFileExists: true, identityResolves: true })).toBe(false);
  });

  it("both fences hold: an unresolved identity, or a path nobody originated, still SKIPS", () => {
    expect(decideCanvasMirror(observe({ originatedHere: true, identityResolves: false }))).toBe(
      MIRROR_VERDICT.SKIP_LOCAL_FILE,
    );
    expect(decideCanvasMirror(observe({ originatedHere: false }))).toBe(
      MIRROR_VERDICT.SKIP_LOCAL_FILE,
    );
    expect(decideCanvasMirror(observe({}))).toBe(MIRROR_VERDICT.SKIP_LOCAL_FILE);
  });

  it("fail-closed: every non-`true` spelling of `originatedHere` keeps the old verdict", () => {
    // Truthiness would admit `"yes"`, `1` and `{}`. `=== true` admits none.
    for (const bad of [undefined, null, 0, 1, "", "true", "yes", {}, []] as unknown[]) {
      expect(
        decideCanvasMirror(observe({ originatedHere: bad as boolean })),
        `\`originatedHere: ${JSON.stringify(bad)}\` must not license an adoption`,
      ).toBe(MIRROR_VERDICT.SKIP_LOCAL_FILE);
    }
  });

  it("the HOST never adopts — the flag is not even consulted on the host arm", () => {
    for (const originatedHere of BOOLS) {
      expect(decideCanvasMirror(observe({ role: "host", originatedHere }))).toBe(
        MIRROR_VERDICT.PUBLISH,
      );
      expect(
        decideCanvasMirror(observe({ role: "host", localFileExists: false, originatedHere })),
      ).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    }
  });
});

describe("WP117 A6 — WP79's table is otherwise byte-identical", () => {
  it("every combination WITHOUT the flag answers exactly what it answered before", () => {
    // The pre-WP117 table, written out rather than derived from the subject.
    const expected = (
      role: "host" | "guest",
      localFileExists: boolean,
      identityResolves: boolean,
      docHasRecords: boolean,
    ): string => {
      if (role === "host") {
        return localFileExists ? MIRROR_VERDICT.PUBLISH : MIRROR_VERDICT.SKIP_NO_SOURCE;
      }
      if (localFileExists) return MIRROR_VERDICT.SKIP_LOCAL_FILE;
      if (!identityResolves) return MIRROR_VERDICT.SKIP_NO_SOURCE;
      if (!docHasRecords) return MIRROR_VERDICT.SKIP_NO_SOURCE;
      return MIRROR_VERDICT.MATERIALISE;
    };

    let rows = 0;
    for (const role of ["host", "guest"] as const) {
      for (const localFileExists of BOOLS) {
        for (const identityResolves of BOOLS) {
          for (const docHasRecords of BOOLS) {
            rows += 1;
            const observation = { role, localFileExists, identityResolves, docHasRecords };
            expect(
              decideCanvasMirror(observation),
              `role=${role} file=${localFileExists} id=${identityResolves} recs=${docHasRecords}`,
            ).toBe(expected(role, localFileExists, identityResolves, docHasRecords));
            // …and with the flag explicitly FALSE, which is what every path
            // nobody asked about reports.
            expect(decideCanvasMirror({ ...observation, originatedHere: false })).toBe(
              expected(role, localFileExists, identityResolves, docHasRecords),
            );
          }
        }
      }
    }
    // A loop that ran zero times passes every assertion inside it (S155).
    expect(rows).toBe(16);
  });

  it("the flag changes the answer for ONE of the sixteen rows, and it is the named one", () => {
    let changed: string[] = [];
    for (const role of ["host", "guest"] as const) {
      for (const localFileExists of BOOLS) {
        for (const identityResolves of BOOLS) {
          for (const docHasRecords of BOOLS) {
            const base = { role, localFileExists, identityResolves, docHasRecords };
            const without = decideCanvasMirror(base);
            const with_ = decideCanvasMirror({ ...base, originatedHere: true });
            if (without !== with_) {
              changed.push(
                `${role}/file=${localFileExists}/id=${identityResolves}/recs=${docHasRecords}: ${without} -> ${with_}`,
              );
            }
          }
        }
      }
    }
    changed = changed.sort();
    expect(changed).toEqual([
      "guest/file=true/id=true/recs=false: skip-local-file -> adopt-local-file",
      "guest/file=true/id=true/recs=true: skip-local-file -> adopt-local-file",
    ]);
  });

  it("a non-object probe still refuses, and nothing throws on any input", () => {
    for (const bad of [null, undefined, 7, "guest", []] as unknown[]) {
      expect(() => decideCanvasMirror(bad as CanvasMirrorObservation)).not.toThrow();
      expect(decideCanvasMirror(bad as CanvasMirrorObservation)).toBe(
        MIRROR_VERDICT.SKIP_NO_SOURCE,
      );
    }
  });
});
