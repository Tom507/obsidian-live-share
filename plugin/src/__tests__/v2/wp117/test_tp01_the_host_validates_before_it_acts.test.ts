// WP117 / A3 — THE HOST VALIDATES BEFORE IT ACTS, and "validates" means a truth
// table asserted row by row rather than one happy path and one refusal.
//
// A guest is not trusted to name a path. Every claim in a creation request is
// re-derived on the host, and each clause is exercised in BOTH directions here:
// the row that refuses, and the same observation with only that field repaired,
// which must then reach the next clause instead of the same refusal. A guard
// that refuses everything satisfies every one-sided refusal row ever written.
//
// PRODUCTION LINE <-> ASSERTION: `files/canvas-create-decision.ts`,
// `decideCanvasCreate`. Deleting any single clause reddens exactly the rows for
// that clause and nothing else — break table B1..B7 in the WP117 report.

import { describe, expect, it } from "vitest";

import {
  CANVAS_CREATE_REFUSALS,
  CANVAS_CREATE_VERDICT,
  type CanvasCreateObservation,
  decideCanvasCreate,
} from "../../../files/canvas-create-decision";

/** Everything satisfied. Each row below spoils exactly one field. */
const ADMITTED: CanvasCreateObservation = {
  role: "host",
  canvasPath: true,
  pathSafe: true,
  protectedPath: false,
  sharedPath: true,
  contentBytes: 4_096,
  maxBytes: 512 * 1024,
  parsable: true,
  localFileExists: false,
};

function decide(patch: Partial<CanvasCreateObservation>): string {
  return decideCanvasCreate({ ...ADMITTED, ...patch } as CanvasCreateObservation).verdict;
}

describe("WP117 A3 — the positive control: the admitted observation is admitted", () => {
  it("a valid request materialises, and says why in a sentence", () => {
    const decision = decideCanvasCreate(ADMITTED);
    expect(decision.verdict).toBe(CANVAS_CREATE_VERDICT.MATERIALISE);
    // Every branch is reasoned, including the one that says yes. A verdict with
    // an empty reason is the thing S105 named: an outcome nothing can attribute.
    expect(decision.reason.length).toBeGreaterThan(20);
  });

  it("every refusal in the closed set is REACHABLE — no dead verdict", () => {
    const reached = new Set(
      [
        decide({ role: "guest" }),
        decide({ canvasPath: false }),
        decide({ pathSafe: false }),
        decide({ protectedPath: true }),
        decide({ sharedPath: false }),
        decide({ contentBytes: 512 * 1024 + 1 }),
        decide({ parsable: false }),
        decide({ localFileExists: true }),
      ],
    );
    expect([...reached].sort()).toEqual([...CANVAS_CREATE_REFUSALS].sort());
  });
});

describe("WP117 A3 — one clause at a time, in both directions", () => {
  it("1. AUTHORITY: a guest refuses, and it is the FIRST thing asked", () => {
    expect(decide({ role: "guest" })).toBe(CANVAS_CREATE_VERDICT.NOT_HOST);
    // A guest handed an otherwise indefensible request still answers `not-host`
    // and never the more specific reason: a peer with no authority must not act
    // as a validator, or two peers answer one request.
    expect(
      decide({ role: "guest", pathSafe: false, protectedPath: true, sharedPath: false }),
    ).toBe(CANVAS_CREATE_VERDICT.NOT_HOST);
  });

  it("2. SHAPE: a non-canvas refuses; repairing it reaches the safety clause", () => {
    expect(decide({ canvasPath: false })).toBe(CANVAS_CREATE_VERDICT.NOT_CANVAS);
    expect(decide({ canvasPath: false, pathSafe: false })).toBe(
      CANVAS_CREATE_VERDICT.NOT_CANVAS,
    );
    expect(decide({ pathSafe: false })).toBe(CANVAS_CREATE_VERDICT.UNSAFE_PATH);
  });

  it("3. PROTECTION is asked BEFORE membership, so the answer cannot depend on the share", () => {
    expect(decide({ protectedPath: true })).toBe(CANVAS_CREATE_VERDICT.PROTECTED_PATH);
    // The ordering claim itself: protected AND outside the share reports
    // PROTECTED. Swap the two clauses and this row alone goes red.
    expect(decide({ protectedPath: true, sharedPath: false })).toBe(
      CANVAS_CREATE_VERDICT.PROTECTED_PATH,
    );
  });

  it("4. MEMBERSHIP: outside the shared tree refuses", () => {
    expect(decide({ sharedPath: false })).toBe(CANVAS_CREATE_VERDICT.OUTSIDE_SHARE);
  });

  it("5. SIZE: at the bound is admitted, one unit over is refused", () => {
    expect(decide({ contentBytes: 512 * 1024 })).toBe(CANVAS_CREATE_VERDICT.MATERIALISE);
    expect(decide({ contentBytes: 512 * 1024 + 1 })).toBe(CANVAS_CREATE_VERDICT.TOO_LARGE);
    // …and the size clause runs BEFORE the parse, so an oversized payload is
    // never walked. Unparsable AND oversized reports TOO_LARGE.
    expect(decide({ contentBytes: 512 * 1024 + 1, parsable: false })).toBe(
      CANVAS_CREATE_VERDICT.TOO_LARGE,
    );
  });

  it("6. CONTENT: bytes that are not a canvas document refuse", () => {
    expect(decide({ parsable: false })).toBe(CANVAS_CREATE_VERDICT.NOT_A_CANVAS_DOCUMENT);
  });

  it("7. COLLISION is asked LAST, so a refusal never leaks the host's disk", () => {
    expect(decide({ localFileExists: true })).toBe(CANVAS_CREATE_VERDICT.ALREADY_EXISTS);
    // A path that is protected AND already present reports PROTECTED. Nothing
    // about the host's own disk is derivable from a refusal taken earlier.
    expect(decide({ localFileExists: true, protectedPath: true })).toBe(
      CANVAS_CREATE_VERDICT.PROTECTED_PATH,
    );
    expect(decide({ localFileExists: true, sharedPath: false })).toBe(
      CANVAS_CREATE_VERDICT.OUTSIDE_SHARE,
    );
  });
});

describe("WP117 A3 — fail-closed: an unanswered probe is not a permission", () => {
  it("null, undefined and a non-object all refuse rather than throw", () => {
    for (const bad of [null, undefined, 42, "host", []] as unknown[]) {
      expect(() => decideCanvasCreate(bad as CanvasCreateObservation)).not.toThrow();
      expect(decideCanvasCreate(bad as CanvasCreateObservation).verdict).toBe(
        CANVAS_CREATE_VERDICT.NOT_HOST,
      );
    }
  });

  it("every boolean clause refuses on `undefined` — a missing field is not a `false`", () => {
    // Each row deletes ONE field. Truthiness would read `undefined` as "no" for
    // `protectedPath` — i.e. NOT protected — and admit a write into `.obsidian`.
    const rows: Array<[keyof CanvasCreateObservation, string]> = [
      ["role", CANVAS_CREATE_VERDICT.NOT_HOST],
      ["canvasPath", CANVAS_CREATE_VERDICT.NOT_CANVAS],
      ["pathSafe", CANVAS_CREATE_VERDICT.UNSAFE_PATH],
      ["protectedPath", CANVAS_CREATE_VERDICT.PROTECTED_PATH],
      ["sharedPath", CANVAS_CREATE_VERDICT.OUTSIDE_SHARE],
      ["contentBytes", CANVAS_CREATE_VERDICT.TOO_LARGE],
      ["maxBytes", CANVAS_CREATE_VERDICT.TOO_LARGE],
      ["parsable", CANVAS_CREATE_VERDICT.NOT_A_CANVAS_DOCUMENT],
      ["localFileExists", CANVAS_CREATE_VERDICT.ALREADY_EXISTS],
    ];
    for (const [field, expected] of rows) {
      const observation = { ...ADMITTED } as Record<string, unknown>;
      delete observation[field];
      expect(
        decideCanvasCreate(observation as unknown as CanvasCreateObservation).verdict,
        `deleting \`${String(field)}\` must refuse with ${expected}`,
      ).toBe(expected);
    }
  });

  it("a non-positive or non-finite bound admits NOTHING", () => {
    for (const maxBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(decide({ maxBytes })).toBe(CANVAS_CREATE_VERDICT.TOO_LARGE);
    }
    // …and a payload whose size cannot be stated is likewise refused.
    for (const contentBytes of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(decide({ contentBytes })).toBe(CANVAS_CREATE_VERDICT.TOO_LARGE);
    }
  });

  it("it is pure: the argument is not mutated and repeated calls agree", () => {
    const observation = { ...ADMITTED };
    const before = JSON.stringify(observation);
    const first = decideCanvasCreate(observation);
    const second = decideCanvasCreate(observation);
    expect(JSON.stringify(observation)).toBe(before);
    expect(first).toEqual(second);
  });
});
