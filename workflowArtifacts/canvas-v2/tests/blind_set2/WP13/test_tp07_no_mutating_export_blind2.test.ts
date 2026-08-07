// WP13 / AC4 — blind counterpart 2. Different angle from both siblings:
// asserts every export is a FUNCTION (so no exported mutable object/constant
// could serve as a hidden rewrite handle), probes a THIRD list of candidate
// mutator names, and proves statelessness by interleaving many `allocateOrd`
// calls between two `compareOrd` calls on a fixed pair — showing allocation
// volume has no effect on a previously-established comparison, i.e. there is
// no internal counter/log that an "update" could be rewriting.

import { describe, expect, it } from "vitest";

import { allocateOrd, compareOrd } from "../../../../../plugin/src/canvas/canvas-ord";
import * as CanvasOrd from "../../../../../plugin/src/canvas/canvas-ord";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

describe("WP13 AC4 blind2 — every export is a function, a third mutator-name blocklist is absent, and comparisons are unaffected by allocation volume", () => {
  it("every own enumerable export value is of type 'function' — no exported mutable object/constant exists", () => {
    for (const [name, value] of Object.entries(CanvasOrd)) {
      expect(typeof value).toBe("function");
      void name;
    }
  });

  it("a third list of plausible mutator names is absent from the module", () => {
    const candidateNames = ["assign", "clearOrd", "deleteOrd", "removeOrd", "resetOrd", "forceOrd", "setValue"];
    for (const candidate of candidateNames) {
      expect(candidate in CanvasOrd).toBe(false);
    }
  });

  it("interleaving 50 unrelated allocations between two compareOrd calls on a fixed pair changes nothing", () => {
    const rng = makeRng(4242424);
    const left = allocateOrd(undefined, undefined, "peer-left", rng);
    const right = allocateOrd(left, undefined, "peer-right", rng);

    const before = compareOrd(left, right);

    for (let i = 0; i < 50; i++) {
      allocateOrd(left, right, `peer-noise-${i}`, rng);
    }

    const after = compareOrd(left, right);
    expect(after).toBe(before);
  });
});
