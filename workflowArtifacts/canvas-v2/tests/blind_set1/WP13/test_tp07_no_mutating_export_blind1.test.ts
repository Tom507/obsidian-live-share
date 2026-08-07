// WP13 / AC4 — blind counterpart 1. Different angle from the visible test:
// instead of a regex blocklist, this asserts an explicit ALLOWLIST via
// `Object.getOwnPropertyNames` (every exported name must be one of exactly
// three known symbols) and separately probes named-membership for a list of
// plausible mutator names one by one — the same explicit-membership style as
// WP9's `"GEOMETRY_KEYS" in CanvasRegisters` pin, applied here to a blocklist
// of ord-mutation candidate names instead.

import { describe, expect, it } from "vitest";

import * as CanvasOrd from "../../../../../plugin/src/canvas/canvas-ord";

describe("WP13 AC4 blind1 — canvas-ord's export surface is closed to exactly the allocator and its comparators", () => {
  it("every own enumerable export name is in the fixed allowlist", () => {
    const allowlist = new Set(["allocateOrd", "compareOrd", "compareOrdId"]);
    const actualNames = Object.getOwnPropertyNames(CanvasOrd).filter((name) => name !== "__esModule");

    for (const name of actualNames) {
      expect(allowlist.has(name)).toBe(true);
    }
  });

  it("none of a list of plausible in-place-rewrite operation names is exported", () => {
    const candidateMutatorNames = [
      "setOrd",
      "updateOrd",
      "rewriteOrd",
      "mutateOrd",
      "reassignOrd",
      "overwriteOrd",
      "patchOrd",
      "editOrd",
    ];

    for (const candidate of candidateMutatorNames) {
      expect(candidate in CanvasOrd).toBe(false);
    }
  });

  it("allocateOrd is a fresh-value factory: two calls with the same before/after/clientID and independent rng instances of the same seed produce the same value, proving no hidden mutable module state is being 'updated'", () => {
    const makeRng = () => {
      let state = 9 >>> 0;
      return () => {
        state = (state + 0x9e3779b9) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
        t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
        return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
      };
    };

    const seedRng = makeRng();
    const lo = CanvasOrd.allocateOrd(undefined, undefined, "author-lo", seedRng);
    const hi = CanvasOrd.allocateOrd(lo, undefined, "author-hi", seedRng);

    const first = CanvasOrd.allocateOrd(lo, hi, "author-repeat", makeRng());
    const second = CanvasOrd.allocateOrd(lo, hi, "author-repeat", makeRng());

    expect(first).toBe(second);
  });
});
