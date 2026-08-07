// WP30 / AC4 (ownership) blind1 — the guard attacked as an EXHAUSTIVE PRODUCT
// over a value corpus rather than as a handful of examples.
//
// The visible test lists the values it rejects. This one never lists an expected
// answer at all: it takes a corpus of 12 values, forms all 144 availability
// shapes, and asserts the guard agrees with ONE closed-form specification —
// available if and only if `owned === true` and `degraded === false`, by
// identity. Any implementation with a truthiness test, a `!=` instead of `!==`,
// a coercion, or a special case for one value disagrees on at least one cell of
// the product, and the failure message names the cell.
//
// The second attack is REASON PRECEDENCE AS A TOTAL FUNCTION: the reason is
// never `undefined`, never throws, and is `unowned` on every shape where
// ownership is not established — including the shapes where degradation is also
// wrong. A guard that reports "degraded" for a board this client does not even
// hold tells the user their data is broken when the truth is that they are
// looking at somebody else's board.

import { describe, expect, it } from "vitest";

import {
  IMPORT_UNAVAILABLE,
  type ImportAvailability,
  canImportFromFile,
  importUnavailableReason,
} from "../../../../../plugin/src/canvas/canvas-import-command";

const CORPUS: unknown[] = [
  true,
  false,
  undefined,
  null,
  0,
  1,
  "",
  "true",
  "false",
  Number.NaN,
  {},
  [],
];

function label(value: unknown): string {
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[]" : "{}";
  return String(value);
}

describe("WP30 tp02 blind1 — ownership over the whole value product", () => {
  it("agrees with the closed form on all 144 shapes", () => {
    const disagreements: string[] = [];
    for (const owned of CORPUS) {
      for (const degraded of CORPUS) {
        const shape = { owned, degraded } as unknown as ImportAvailability;
        const expected = owned === true && degraded === false;
        if (canImportFromFile(shape) !== expected) {
          disagreements.push(`owned=${label(owned)} degraded=${label(degraded)}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("permits exactly one of the 144 shapes", () => {
    let permitted = 0;
    for (const owned of CORPUS) {
      for (const degraded of CORPUS) {
        if (canImportFromFile({ owned, degraded } as unknown as ImportAvailability)) permitted++;
      }
    }
    expect(permitted).toBe(1);
  });

  it("blames ownership first on every shape where ownership is not established", () => {
    for (const owned of CORPUS) {
      if (owned === true) continue;
      for (const degraded of CORPUS) {
        expect(
          importUnavailableReason({ owned, degraded } as unknown as ImportAvailability),
          `owned=${label(owned)} degraded=${label(degraded)}`,
        ).toBe(IMPORT_UNAVAILABLE.UNOWNED);
      }
    }
  });

  it("is a total function: never throws, never returns undefined", () => {
    const junk: unknown[] = [
      null,
      undefined,
      0,
      "",
      "owned",
      [],
      {},
      { owned: true },
      { degraded: false },
      Object.create(null),
      new Map(),
      Symbol("availability"),
    ];
    for (const value of junk) {
      let reason: unknown;
      expect(() => {
        reason = importUnavailableReason(value as unknown as ImportAvailability);
      }, label(value)).not.toThrow();
      expect(reason, label(value)).not.toBeUndefined();
    }
  });

  it("the reason and the predicate never disagree", () => {
    for (const owned of CORPUS) {
      for (const degraded of CORPUS) {
        const shape = { owned, degraded } as unknown as ImportAvailability;
        expect(canImportFromFile(shape), `${label(owned)}/${label(degraded)}`).toBe(
          importUnavailableReason(shape) === null,
        );
      }
    }
  });

  it("an extra, unknown field never grants access", () => {
    const shape = {
      owned: false,
      degraded: false,
      force: true,
      admin: true,
    } as unknown as ImportAvailability;
    expect(canImportFromFile(shape)).toBe(false);
    expect(importUnavailableReason(shape)).toBe(IMPORT_UNAVAILABLE.UNOWNED);
  });
});
