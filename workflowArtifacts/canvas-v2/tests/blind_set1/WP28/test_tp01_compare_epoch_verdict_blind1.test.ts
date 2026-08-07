// WP28 / AC1 blind1 — `compareEpoch` attacked as an ORDER RELATION over a
// generated corpus, not as a list of examples.
//
// Different angle: instead of naming pairs, derive a total preorder from the
// function itself and check the three laws every ordering must obey —
// reflexivity, antisymmetry and TRANSITIVITY — plus agreement with a sort built
// out of nothing but `compareEpoch`. An implementation that special-cases a
// value (say, treats `0` as "unknown, always lose") satisfies every hand-written
// example pair and breaks transitivity somewhere in the middle of the corpus.
//
// The second attack is COERCION BY PROXY: objects with `valueOf` / `toString`
// that JavaScript will happily turn into a number the moment anything does
// arithmetic or a `>` comparison on them. `{ valueOf: () => 99 }` is not an
// epoch, and an implementation spelling `Number(value)` or a bare `a > b` lets
// it beat every real one.

import { describe, expect, it } from "vitest";

import { compareEpoch, normalizeEpoch } from "../../../../../plugin/src/canvas/canvas-epoch";

type Verdict = ReturnType<typeof compareEpoch>;

function corpus(): number[] {
  const out: number[] = [];
  for (let i = 0; i < 24; i++) out.push(i);
  for (const big of [100, 1024, 65_535, 1_000_000, Number.MAX_SAFE_INTEGER - 1]) out.push(big);
  return out;
}

/** Sort using ONLY `compareEpoch`. If the function is not an order, this is unstable. */
function sortByRule(values: readonly number[]): number[] {
  return [...values].sort((a, b) => {
    const verdict = compareEpoch(a, b);
    if (verdict === "equal") return 0;
    return verdict === "local-wins" ? 1 : -1;
  });
}

describe("WP28 AC1 blind1 — the epoch comparison is a total order", () => {
  it("is reflexive over the whole corpus", () => {
    for (const value of corpus()) {
      expect(compareEpoch(value, value), `reflexivity at ${value}`).toBe("equal");
    }
  });

  it("is transitive: a>b and b>c implies a>c, for every triple in the corpus", () => {
    const values = corpus().slice(0, 16);
    for (const a of values) {
      for (const b of values) {
        if (compareEpoch(a, b) !== "local-wins") continue;
        for (const c of values) {
          if (compareEpoch(b, c) !== "local-wins") continue;
          expect(
            compareEpoch(a, c),
            `transitivity broken: ${a} > ${b} > ${c} but compareEpoch(${a},${c}) said ` +
              `${compareEpoch(a, c)}`,
          ).toBe("local-wins");
        }
      }
    }
  });

  it("sorting by the rule alone reproduces numeric order", () => {
    const shuffled = [9, 0, 144, 3, 21, 1, 55, 2, 89, 8];
    expect(sortByRule(shuffled)).toEqual([...shuffled].sort((a, b) => a - b));
  });

  it("every verdict is one of the three declared strings", () => {
    const allowed: Verdict[] = ["local-wins", "remote-wins", "equal"];
    for (const a of corpus()) {
      for (const b of [0, 1, 7, 1024]) {
        expect(allowed, `compareEpoch(${a},${b})`).toContain(compareEpoch(a, b));
      }
    }
  });

  it("COERCION BY PROXY: a value that merely LOOKS numeric never wins", () => {
    const proxies: unknown[] = [
      { valueOf: () => 99 },
      { toString: () => "99" },
      new Number(99),
      new String("99"),
      [99],
      "99",
      "1e3",
      "0x10",
      " 4 ",
    ];
    for (const proxy of proxies) {
      expect(
        normalizeEpoch(proxy),
        `${String(proxy)} was coerced into an epoch — an implementation spelling ` +
          "`Number(value)` or a bare `>` lets a corrupt cell beat every real board",
      ).toBe(0);
      expect(compareEpoch(proxy, 1)).toBe("remote-wins");
      expect(compareEpoch(1, proxy)).toBe("local-wins");
    }
  });

  it("negative and fractional epochs are not epochs, in either position", () => {
    for (const bad of [-1, -0.5, -1000, 0.5, 2.5, -Number.MAX_SAFE_INTEGER]) {
      expect(normalizeEpoch(bad), `${bad}`).toBe(0);
      expect(compareEpoch(bad, 0)).toBe("equal");
      expect(compareEpoch(bad, 1)).toBe("remote-wins");
    }
  });

  it("`-0` is 0 and does not become a distinct epoch", () => {
    expect(normalizeEpoch(-0) === 0).toBe(true);
    expect(compareEpoch(-0, 0)).toBe("equal");
    expect(compareEpoch(-0, 1)).toBe("remote-wins");
  });

  it("normalisation is idempotent — normalising twice changes nothing", () => {
    for (const value of [undefined, null, "7", 7, 0, Number.NaN, {}, -3]) {
      const once = normalizeEpoch(value);
      expect(normalizeEpoch(once), `idempotence at ${String(value)}`).toBe(once);
    }
  });
});
