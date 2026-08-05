// WP85 / AC2 (first half) — the writer-attach verdict is a PURE CORE with a
// CLOSED answer set, and the table below is exhaustive over its input space.
//
// On the `manifest-purge-decision.test.ts` / `wp79/test_tp01` precedent: the
// four booleans give 2^4 = 16 rows and all sixteen are written out, so a verdict
// cannot be changed for one combination without a named row going red. The
// unknown-input rows are NOT decoration — `hasWriter: undefined` is exactly what
// a wiring mistake produces, and under a truthiness test it would read as "no
// writer" and attach, or as "has one" and never attach, depending on which way
// the author happened to spell the check.
//
// WHAT THIS FILE DOES NOT PROVE: that anything calls this function. A pure core
// nothing consults is this run's signature failure, and it is why
// `test_tp02_...` exists and drives the real `syncCanvasPresences`.
//
// PRODUCTION LINE <-> ASSERTION: `plugin/src/files/canvas-writer-attach-decision.ts`.
// Reordering rows 1-5 of `decideCanvasWriterAttach` reddens the ordering block;
// relaxing any `=== true` to a truthiness test reddens the unknown-input block;
// collapsing NOT_SHARED and NOT_SUBSCRIBED into one string reddens the closed-set
// block.

import { describe, expect, it } from "vitest";

import {
  WRITER_ATTACH_VERDICT,
  type WriterAttachVerdict,
  decideCanvasWriterAttach,
} from "../../../files/canvas-writer-attach-decision";

type Row = [hasPath: boolean, isShared: boolean, isSubscribed: boolean, hasWriter: boolean];

const V = WRITER_ATTACH_VERDICT;

/** All sixteen combinations, written out rather than generated. */
const TABLE: Array<{ row: Row; verdict: WriterAttachVerdict }> = [
  // hasPath === false — nothing to decide about, whatever else is true.
  { row: [false, false, false, false], verdict: V.NO_PATH },
  { row: [false, false, false, true], verdict: V.NO_PATH },
  { row: [false, false, true, false], verdict: V.NO_PATH },
  { row: [false, false, true, true], verdict: V.NO_PATH },
  { row: [false, true, false, false], verdict: V.NO_PATH },
  { row: [false, true, false, true], verdict: V.NO_PATH },
  { row: [false, true, true, false], verdict: V.NO_PATH },
  { row: [false, true, true, true], verdict: V.NO_PATH },
  // a path, but not inside the shared folder.
  { row: [true, false, false, false], verdict: V.NOT_SHARED },
  { row: [true, false, false, true], verdict: V.NOT_SHARED },
  // subscribed but unshared is REAL: `canvas.open` in the rig subscribes a path
  // directly, and a canvas moved out of the shared folder keeps its
  // subscription. It is still not this session's file.
  { row: [true, false, true, false], verdict: V.NOT_SHARED },
  { row: [true, false, true, true], verdict: V.NOT_SHARED },
  // shared, but `CanvasSync` does not own it — the lazy-subscribe branch's job.
  { row: [true, true, false, false], verdict: V.NOT_SUBSCRIBED },
  { row: [true, true, false, true], verdict: V.NOT_SUBSCRIBED },
  // shared + subscribed: the two rows WP85 exists for.
  { row: [true, true, true, true], verdict: V.ALREADY_ATTACHED },
  { row: [true, true, true, false], verdict: V.ATTACH },
];

function call(row: Row): WriterAttachVerdict {
  const [hasPath, isShared, isSubscribed, hasWriter] = row;
  return decideCanvasWriterAttach({ hasPath, isShared, isSubscribed, hasWriter });
}

describe("WP85 AC2 — decideCanvasWriterAttach, exhaustive", () => {
  it("covers the whole input space: 16 rows, no duplicates", () => {
    expect(TABLE).toHaveLength(16);
    const keys = new Set(TABLE.map(({ row }) => row.join("/")));
    expect(keys.size).toBe(16);
  });

  for (const { row, verdict } of TABLE) {
    const [hasPath, isShared, isSubscribed, hasWriter] = row;
    it(`hasPath=${hasPath} isShared=${isShared} isSubscribed=${isSubscribed} hasWriter=${hasWriter} -> ${verdict}`, () => {
      expect(call(row)).toBe(verdict);
    });
  }

  it("licenses an attach on EXACTLY ONE of the sixteen rows", () => {
    const attaching = TABLE.filter(({ row }) => call(row) === V.ATTACH);
    expect(attaching.map(({ row }) => row.join("/"))).toEqual(["true/true/true/false"]);
  });

  it("names 'already attached' as a verdict of its own, not as silence", () => {
    // The vacuity risk AC2 names by hand: if idempotence were left to
    // `attachCanvasWriter`'s internal early return, this row and the ATTACH row
    // would be indistinguishable to every caller and to every test.
    expect(call([true, true, true, true])).not.toBe(call([true, true, true, false]));
    expect(call([true, true, true, true])).toBe(V.ALREADY_ATTACHED);
  });

  it("the answer set is closed — every row lands in the five owned strings", () => {
    const owned = new Set<string>(Object.values(V));
    expect(owned.size).toBe(5);
    for (const { row } of TABLE) expect(owned.has(call(row))).toBe(true);
  });
});

describe("WP85 AC2 — every unknown input is a NON-ATTACH", () => {
  const ATTACHABLE = { hasPath: true, isShared: true, isSubscribed: true, hasWriter: false };

  it("the base row really does attach (positive control for this block)", () => {
    expect(decideCanvasWriterAttach(ATTACHABLE)).toBe(V.ATTACH);
  });

  const UNKNOWNS: Array<[label: string, value: unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["missing", Symbol.for("omit")],
    ["the string 'true'", "true"],
    ["the number 1", 1],
    ["an empty object", {}],
    ["NaN", Number.NaN],
  ];

  for (const field of ["hasPath", "isShared", "isSubscribed"] as const) {
    const expected =
      field === "hasPath" ? V.NO_PATH : field === "isShared" ? V.NOT_SHARED : V.NOT_SUBSCRIBED;
    for (const [label, value] of UNKNOWNS) {
      it(`${field} = ${label} -> ${expected}`, () => {
        const probe: Record<string, unknown> = { ...ATTACHABLE };
        if (value === Symbol.for("omit")) delete probe[field];
        else probe[field] = value;
        expect(
          decideCanvasWriterAttach(probe as unknown as Parameters<typeof decideCanvasWriterAttach>[0]),
        ).toBe(expected);
      });
    }
  }

  // hasWriter is the one field whose fail-closed direction points the OTHER way:
  // an unanswerable "is a writer attached?" must not suppress the attach,
  // because `attachCanvasWriter`'s own per-path guard is a backstop for a
  // duplicate and there is no backstop for an absence. Stated as its own block
  // so the asymmetry is a decision on the record, not an oversight.
  for (const [label, value] of UNKNOWNS) {
    it(`hasWriter = ${label} -> attach (no backstop exists for an absence)`, () => {
      const probe: Record<string, unknown> = { ...ATTACHABLE };
      if (value === Symbol.for("omit")) delete probe.hasWriter;
      else probe.hasWriter = value;
      expect(
        decideCanvasWriterAttach(probe as unknown as Parameters<typeof decideCanvasWriterAttach>[0]),
      ).toBe(V.ATTACH);
    });
  }

  for (const [label, value] of [
    ["null", null],
    ["undefined", undefined],
    ["a string", "leaf"],
    ["a number", 7],
  ] as Array<[string, unknown]>) {
    it(`a ${label} observation -> no-path, never a throw`, () => {
      expect(() =>
        decideCanvasWriterAttach(value as unknown as Parameters<typeof decideCanvasWriterAttach>[0]),
      ).not.toThrow();
      expect(
        decideCanvasWriterAttach(value as unknown as Parameters<typeof decideCanvasWriterAttach>[0]),
      ).toBe(V.NO_PATH);
    });
  }

  it("does not mutate its argument", () => {
    const probe = { ...ATTACHABLE };
    decideCanvasWriterAttach(probe);
    expect(probe).toEqual(ATTACHABLE);
  });
});
