// WP28 / AC1 (first half) — `compareEpoch` IS the rule. Everything else in this
// WP is downstream of it.
//
// Two properties, and the second is the one that bites:
//
//   ├── ORDER — a strictly higher epoch wins, equal is equal. Trivially true of
//   │      any implementation that spells `>`.
//   └── NORMALISATION — an epoch that is not a non-negative finite integer is
//          NOT an epoch. `undefined` (a doc WP27 never stamped), `null`, `NaN`,
//          `Infinity`, `-1`, `1.5`, `"3"`, `true` and `{}` all read as 0.
//
// Normalisation is where a plausible-looking implementation loses a board.
// `Number(value)` coerces `"9"` to 9 and `true` to 1, so a doc whose `meta.epoch`
// was corrupted into a STRING by a bad writer would win every conflict it ever
// entered and every peer would archive-and-adopt garbage. `a > b` with `a =
// undefined` is `false`, which reads as "not higher" — correct by accident on one
// side and wrong on the other, because `undefined > undefined` is also `false`
// while `compareEpoch` must answer "equal" there.

import { describe, expect, it } from "vitest";

import { compareEpoch, normalizeEpoch } from "../../../canvas/canvas-epoch";

/** Everything a `meta.epoch` cell can hold that is NOT an epoch. */
const NOT_AN_EPOCH: readonly unknown[] = [
  undefined,
  null,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
  -7,
  1.5,
  "3",
  "0",
  "",
  true,
  false,
  {},
  [],
  [5],
];

describe("WP28 AC1 — `compareEpoch` orders two epochs", () => {
  it("the strictly higher epoch wins, from either side", () => {
    expect(compareEpoch(7, 3)).toBe("local-wins");
    expect(compareEpoch(3, 7)).toBe("remote-wins");
    expect(compareEpoch(1, 0)).toBe("local-wins");
    expect(compareEpoch(0, 1)).toBe("remote-wins");
  });

  it("equal epochs are `equal` — at every value, including the unstamped 0", () => {
    for (const value of [0, 1, 2, 9, 1000, Number.MAX_SAFE_INTEGER]) {
      expect(compareEpoch(value, value), `equal at ${value}`).toBe("equal");
    }
  });

  it("is antisymmetric over a generated corpus — no pair agrees on a winner", () => {
    const values = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
    for (const a of values) {
      for (const b of values) {
        const forward = compareEpoch(a, b);
        const backward = compareEpoch(b, a);
        if (a === b) {
          expect(forward, `${a} vs ${b}`).toBe("equal");
          expect(backward, `${b} vs ${a}`).toBe("equal");
          continue;
        }
        expect(
          [forward, backward].sort(),
          `compareEpoch(${a},${b})=${forward} and compareEpoch(${b},${a})=${backward} ` +
            "are not opposite verdicts — the rule is not antisymmetric",
        ).toEqual(["local-wins", "remote-wins"]);
      }
    }
  });

  it("the verdict is one of exactly three strings, never a boolean or a number", () => {
    const seen = new Set<unknown>();
    for (const a of [0, 1, 2]) for (const b of [0, 1, 2]) seen.add(compareEpoch(a, b));
    expect([...seen].sort()).toEqual(["equal", "local-wins", "remote-wins"]);
  });

  // --- normalisation: the half that loses a board ---------------------------

  it("everything that is not a non-negative finite integer normalises to 0", () => {
    for (const value of NOT_AN_EPOCH) {
      expect(
        normalizeEpoch(value),
        `${JSON.stringify(value) ?? String(value)} was accepted as an epoch — ` +
          "a corrupt or coerced cell must never be able to win a conflict",
      ).toBe(0);
    }
    expect(normalizeEpoch(0)).toBe(0);
    expect(normalizeEpoch(41)).toBe(41);
  });

  it('a numeric STRING never wins — `"9"` is not epoch 9', () => {
    expect(compareEpoch("9", 1)).toBe("remote-wins");
    expect(compareEpoch(1, "9")).toBe("local-wins");
    expect(compareEpoch("9", "9")).toBe("equal");
    expect(compareEpoch("9", 0)).toBe("equal");
  });

  it("two docs WP27 never stamped are `equal`, not incomparable", () => {
    expect(compareEpoch(undefined, undefined)).toBe("equal");
    expect(compareEpoch(undefined, 0)).toBe("equal");
    expect(compareEpoch(0, undefined)).toBe("equal");
  });

  it("a stamped doc beats an unstamped one in the right direction", () => {
    expect(compareEpoch(1, undefined)).toBe("local-wins");
    expect(compareEpoch(undefined, 1)).toBe("remote-wins");
    expect(compareEpoch(undefined, Number.NaN)).toBe("equal");
  });
});
