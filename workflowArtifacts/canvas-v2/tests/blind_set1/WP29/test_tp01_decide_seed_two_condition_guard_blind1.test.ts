// WP29 / AC1 blind1 — the two-condition guard attacked as a SENSITIVITY
// property instead of as a truth table.
//
// A table says "these four inputs give these four answers". A sensitivity
// property says something the table does not: that BOTH inputs are load-bearing.
// For each of the two fields there must exist a pair of knowledge shapes that
// differ only in that field and disagree in their verdict. An implementation
// that ignores `sidecarKnowsDoc` entirely still satisfies three of the four
// table rows; it satisfies ZERO of the sensitivity pairs for that field.
//
// The second attack is DIRECTIONAL: seeding is the destructive branch, so the
// guard must be monotone in the safe direction — adding knowledge can only ever
// move a verdict TOWARDS load-or-merge, never away from it. That is stated over
// the whole 2x2 lattice, so a guard spelled with an `||` where an `&&` belongs
// (or a negation dropped) breaks it even where the table rows happen to line up.

import { describe, expect, it } from "vitest";

import {
  NOTHING_KNOWS_DOC,
  SEED_DECISION,
  type SeedKnowledge,
  decideSeed,
} from "../../../../../plugin/src/files/canvas-seed-decision";

const FIELDS = ["sidecarKnowsDoc", "peerKnowsDoc"] as const;
type Field = (typeof FIELDS)[number];

function knowledge(sidecar: boolean, peer: boolean): SeedKnowledge {
  return { sidecarKnowsDoc: sidecar, peerKnowsDoc: peer };
}

const LATTICE: SeedKnowledge[] = [
  knowledge(false, false),
  knowledge(false, true),
  knowledge(true, false),
  knowledge(true, true),
];

function knows(shape: SeedKnowledge): number {
  return (shape.sidecarKnowsDoc ? 1 : 0) + (shape.peerKnowsDoc ? 1 : 0);
}

function flip(shape: SeedKnowledge, field: Field): SeedKnowledge {
  return { ...shape, [field]: !shape[field] };
}

describe("WP29 AC1 blind1 — both conditions are load-bearing", () => {
  it.each(FIELDS)("%s changes the verdict for at least one partner value", (field) => {
    const disagreeing = LATTICE.filter(
      (shape) => decideSeed(shape) !== decideSeed(flip(shape, field)),
    );
    expect(
      disagreeing.length,
      `\`${field}\` is not consulted at all — the guard checks only one condition`,
    ).toBeGreaterThan(0);
  });

  it("the verdict is monotone: knowing more never moves back towards seeding", () => {
    for (const shape of LATTICE) {
      for (const field of FIELDS) {
        const richer = { ...shape, [field]: true };
        if (knows(richer) <= knows(shape)) continue;
        if (decideSeed(shape) === SEED_DECISION.LOAD_OR_MERGE) {
          expect(
            decideSeed(richer),
            `learning ${field} turned a refusal back into a seed: ${JSON.stringify(richer)}`,
          ).toBe(SEED_DECISION.LOAD_OR_MERGE);
        }
      }
    }
  });

  it("exactly the ignorant corner of the lattice seeds", () => {
    const seeding = LATTICE.filter((s) => decideSeed(s) === SEED_DECISION.SEED_FROM_FILE);
    expect(seeding).toHaveLength(1);
    expect(knows(seeding[0]), "a shape that already knows something was allowed to seed").toBe(0);
  });

  it("the exported both-false constant sits in that corner", () => {
    expect(knows(NOTHING_KNOWS_DOC)).toBe(0);
    expect(decideSeed(NOTHING_KNOWS_DOC)).toBe(SEED_DECISION.SEED_FROM_FILE);
  });

  it("the two verdict strings are distinct and stable across the lattice", () => {
    const seen = new Set(LATTICE.map((s) => decideSeed(s)));
    expect([...seen].sort()).toEqual([SEED_DECISION.LOAD_OR_MERGE, SEED_DECISION.SEED_FROM_FILE]);
    expect(SEED_DECISION.LOAD_OR_MERGE).not.toBe(SEED_DECISION.SEED_FROM_FILE);
  });

  describe("degenerate answers resolve to the safe branch", () => {
    // A knowledge probe that cannot answer is not evidence of an unknown board.
    const degenerate = [
      { label: "both fields missing", value: {} },
      { label: "sidecar field missing", value: { peerKnowsDoc: false } },
      { label: "peer field missing", value: { sidecarKnowsDoc: false } },
      { label: "a null object", value: null },
      { label: "string 'no'", value: { sidecarKnowsDoc: "no", peerKnowsDoc: "no" } },
      { label: "zeroes", value: { sidecarKnowsDoc: 0, peerKnowsDoc: 0 } },
    ];

    it.each(degenerate)("$label does not seed", ({ value }) => {
      expect(decideSeed(value as unknown as SeedKnowledge)).toBe(SEED_DECISION.LOAD_OR_MERGE);
    });
  });

  it("a thousand alternating calls never drift", () => {
    // Guards against a memoised or accumulating implementation, which a
    // four-row table run in fresh test bodies cannot see.
    for (let i = 0; i < 1000; i++) {
      const shape = LATTICE[i % LATTICE.length];
      expect(decideSeed(shape)).toBe(
        knows(shape) === 0 ? SEED_DECISION.SEED_FROM_FILE : SEED_DECISION.LOAD_OR_MERGE,
      );
    }
  });
});
