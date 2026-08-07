// WP29 / AC1 blind2 — the guard checked against an INDEPENDENT REFERENCE and
// then fuzzed.
//
// The reference below is written from the acceptance criterion's own words —
// "seeding happens only when neither a sidecar nor any peer knows the doc" — as
// a lookup table keyed by a string, with no shared helper and no shared shape
// with the implementation. Agreement between two independently authored
// statements of the same rule is a much narrower target than agreement with a
// table that was transcribed from the code.
//
// The fuzz half is what a hand-written table cannot do: it generates knowledge
// objects out of a pool of values that includes getters, prototype-less objects,
// boxed booleans and a `Symbol`, and asserts two things about every one of them
// — the decision never throws, and it is SEED_FROM_FILE only for the exact pair
// of primitive `false`s. A guard written with `!knowledge.sidecarKnowsDoc` is
// green on the table and red here, because `new Boolean(false)` and `0` are
// falsy and are not `false`.

import { describe, expect, it } from "vitest";

import {
  SEED_DECISION,
  type SeedKnowledge,
  decideSeed,
} from "../../../../../plugin/src/files/canvas-seed-decision";

/** The AC restated as a lookup, authored independently of the implementation. */
const REFERENCE = new Map<string, string>([
  ["no sidecar, no peer", "seed-from-file"],
  ["no sidecar, a peer", "load-or-merge"],
  ["a sidecar, no peer", "load-or-merge"],
  ["a sidecar, a peer", "load-or-merge"],
]);

function describeShape(sidecar: boolean, peer: boolean): string {
  return `${sidecar ? "a sidecar" : "no sidecar"}, ${peer ? "a peer" : "no peer"}`;
}

describe("WP29 AC1 blind2 — agreement with an independent statement of the rule", () => {
  it("agrees with the reference on every shape the reference names", () => {
    for (const sidecar of [false, true]) {
      for (const peer of [false, true]) {
        const key = describeShape(sidecar, peer);
        expect(
          decideSeed({ sidecarKnowsDoc: sidecar, peerKnowsDoc: peer }),
          `disagreed with the acceptance criterion for "${key}"`,
        ).toBe(REFERENCE.get(key));
      }
    }
  });

  it("the reference itself allows seeding on exactly one shape", () => {
    // Guards the guard: a reference that permitted seeding twice would make the
    // agreement above meaningless.
    expect([...REFERENCE.values()].filter((v) => v === "seed-from-file")).toHaveLength(1);
  });

  describe("fuzz over hostile knowledge objects", () => {
    const VALUES: { label: string; make: () => unknown }[] = [
      { label: "primitive false", make: () => false },
      { label: "primitive true", make: () => true },
      { label: "number 0", make: () => 0 },
      { label: "number 1", make: () => 1 },
      { label: "empty string", make: () => "" },
      { label: '"false"', make: () => "false" },
      { label: "null", make: () => null },
      { label: "undefined", make: () => undefined },
      { label: "NaN", make: () => Number.NaN },
      { label: "boxed false", make: () => new Boolean(false) },
      { label: "empty array", make: () => [] },
      { label: "symbol", make: () => Symbol("no") },
      { label: "a thunk", make: () => () => false },
    ];

    const CONTAINERS: { label: string; wrap: (a: unknown, b: unknown) => unknown }[] = [
      { label: "plain object", wrap: (a, b) => ({ sidecarKnowsDoc: a, peerKnowsDoc: b }) },
      {
        label: "prototype-less object",
        wrap: (a, b) => Object.assign(Object.create(null), { sidecarKnowsDoc: a, peerKnowsDoc: b }),
      },
      {
        label: "getter-backed object",
        wrap: (a, b) => ({
          get sidecarKnowsDoc() {
            return a;
          },
          get peerKnowsDoc() {
            return b;
          },
        }),
      },
    ];

    it("never throws, whatever it is handed", () => {
      for (const container of CONTAINERS) {
        for (const left of VALUES) {
          for (const right of VALUES) {
            const shape = container.wrap(left.make(), right.make());
            expect(() => decideSeed(shape as SeedKnowledge)).not.toThrow();
          }
        }
      }
    });

    it("seeds for the primitive false/false pair and for nothing else", () => {
      for (const container of CONTAINERS) {
        for (const left of VALUES) {
          for (const right of VALUES) {
            const shape = container.wrap(left.make(), right.make());
            const verdict = decideSeed(shape as SeedKnowledge);
            const shouldSeed =
              left.label === "primitive false" && right.label === "primitive false";
            expect(
              verdict === SEED_DECISION.SEED_FROM_FILE,
              `${container.label}: (${left.label}, ${right.label}) -> ${verdict}`,
            ).toBe(shouldSeed);
          }
        }
      }
    });

    it("a boxed `false` is knowledge, not ignorance", () => {
      // Called out on its own because it is the one value a truthiness-based
      // guard gets exactly backwards: `new Boolean(false)` is TRUTHY in
      // JavaScript, so `!value` is false and a `!` guard refuses to seed — while
      // `value === false` also refuses. Both happen to be safe here; the pair
      // below is the one that separates them.
      expect(
        decideSeed({
          sidecarKnowsDoc: 0,
          peerKnowsDoc: 0,
        } as unknown as SeedKnowledge),
        "a numeric zero was read as a definite 'no sidecar, no peer'",
      ).toBe(SEED_DECISION.LOAD_OR_MERGE);
    });
  });

  it("the two verdicts are plain strings a consumer can switch on", () => {
    // WP30 imports this vocabulary. A verdict that is an object, a symbol or a
    // number cannot be compared across a module boundary the way the ownership
    // contract assumes.
    for (const value of Object.values(SEED_DECISION)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
