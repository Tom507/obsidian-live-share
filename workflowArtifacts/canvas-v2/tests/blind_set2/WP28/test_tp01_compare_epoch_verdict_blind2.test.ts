// WP28 / AC1 blind2 — `compareEpoch` checked against an INDEPENDENT REFERENCE
// RULE that this file states in three lines and owns outright.
//
// Different angle: rather than asserting example pairs or order laws, define the
// rule the AC describes — "an epoch is a non-negative finite integer, anything
// else is 0, the higher one wins" — as a tiny local function, then drive 400+
// ordered pairs (drawn from a corpus that is mostly NOT numbers) through both and
// demand agreement on every single one.
//
// The reference is deliberately written from the AC text and imports nothing, so
// it cannot agree with the implementation by sharing code with it. That is the
// same discipline the WP23 intent-trace oracle applies: an oracle that borrows
// the thing under test cannot disagree with it.
//
// The second property is TOTALITY: `compareEpoch` never throws. It sits on the
// merge path, and a merge path that can throw on a malformed `meta.epoch` turns a
// corrupt byte in one peer's doc into a canvas nobody can open.

import { describe, expect, it } from "vitest";

import { compareEpoch, normalizeEpoch } from "../../../../../plugin/src/canvas/canvas-epoch";

/** The rule, as the AC states it. Written here, from the text, importing nothing. */
function referenceRank(value: unknown): number {
  if (typeof value !== "number") return 0;
  if (!Number.isInteger(value)) return 0;
  if (value < 0) return 0;
  return value;
}

function referenceVerdict(local: unknown, remote: unknown): string {
  const a = referenceRank(local);
  const b = referenceRank(remote);
  if (a > b) return "local-wins";
  if (a < b) return "remote-wins";
  return "equal";
}

const CORPUS: unknown[] = [
  0,
  1,
  2,
  17,
  9_999,
  Number.MAX_SAFE_INTEGER,
  -1,
  -9_999,
  0.1,
  3.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  "0",
  "1",
  "17",
  "",
  " ",
  "epoch",
  null,
  undefined,
  true,
  false,
  {},
  { epoch: 5 },
  [],
  [1],
  [1, 2],
  () => 5,
  Symbol.iterator,
  new Date(0),
  new Number(3),
];

describe("WP28 AC1 blind2 — the rule agrees with an independently stated reference", () => {
  it("agrees on every ordered pair of a 30-value corpus", () => {
    let checked = 0;
    for (const local of CORPUS) {
      for (const remote of CORPUS) {
        expect(
          compareEpoch(local, remote),
          `compareEpoch(${String(local)}, ${String(remote)}) disagrees with the AC's own rule`,
        ).toBe(referenceVerdict(local, remote));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("`normalizeEpoch` agrees with the reference rank on every corpus value", () => {
    for (const value of CORPUS) {
      expect(normalizeEpoch(value), String(value)).toBe(referenceRank(value));
    }
  });

  it("is TOTAL — it never throws, on any corpus value, in either position", () => {
    for (const value of CORPUS) {
      expect(() => compareEpoch(value, 3), `local=${String(value)}`).not.toThrow();
      expect(() => compareEpoch(3, value), `remote=${String(value)}`).not.toThrow();
      expect(() => normalizeEpoch(value), `normalize ${String(value)}`).not.toThrow();
    }
  });

  it("a getter that throws on read cannot take the merge path down", () => {
    const hostile = {
      get valueOf() {
        throw new Error("boom");
      },
    };
    expect(() => compareEpoch(hostile, 1)).not.toThrow();
    expect(compareEpoch(hostile, 1)).toBe("remote-wins");
  });

  it("the verdict never depends on argument identity, only on the ranks", () => {
    const boxed = new Number(5);
    expect(compareEpoch(boxed, boxed)).toBe("equal");
    expect(compareEpoch(5, 5)).toBe("equal");
    expect(compareEpoch(boxed, 5)).toBe("remote-wins");
  });

  it("large but legal epochs still compare correctly", () => {
    expect(compareEpoch(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)).toBe("local-wins");
    expect(compareEpoch(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)).toBe("remote-wins");
    expect(compareEpoch(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe("equal");
  });
});
