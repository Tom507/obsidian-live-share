import { describe, expect, it } from "vitest";

import { roundCanvasGeometry } from "../../../canvas/canvas-canonical";

// ===========================================================================
// WP3 AC3 (second half) — "...and is idempotent (rounding a rounded value
// changes nothing)."
//
// Idempotence is what makes the helper safe to call at every capture boundary
// without coordination. If it were not idempotent, a value that has already
// been through it would drift on the second pass and produce a phantom delta —
// exactly the "rounding reads as intent" failure §4.4 forbids.
//
// Test data channel: a deterministic seeded generator (LCG). No Math.random, no
// clock, no wall-clock sleeps — the same 240 samples on every run and machine.
// ===========================================================================

type Rec = Record<string, unknown>;

/** Deterministic 32-bit LCG (Numerical Recipes constants). Same seed → same stream. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("WP3 AC3 — geometry rounding is idempotent", () => {
  it("is a fixed point after one application, over 240 deterministic samples", () => {
    const next = seeded(0x5eed_1234);

    for (let i = 0; i < 240; i++) {
      const record: Rec = {
        id: `n${i}`,
        type: "text",
        x: next() * 4000 - 2000,
        y: next() * 4000 - 2000,
        width: next() * 1200,
        height: next() * 1200,
        text: "unchanged",
      };

      const once = roundCanvasGeometry(record);
      const twice = roundCanvasGeometry(once);

      expect(twice).toEqual(once);
      for (const key of ["x", "y", "width", "height"]) {
        expect(Object.is(twice[key], once[key])).toBe(true);
        expect(Number.isInteger(once[key] as number)).toBe(true);
        // -0 would compare equal with toEqual/=== but serialise differently on
        // a peer that produced +0, so it must not survive the first pass.
        expect(Object.is(once[key], -0)).toBe(false);
      }
    }
  });

  it("leaves an already-whole record structurally identical", () => {
    const whole: Rec = { id: "n1", type: "text", x: 40, y: -120, width: 250, height: 60, text: "t" };

    const out = roundCanvasGeometry(whole);

    expect(out).toEqual(whole);
    expect(Object.keys(out)).toEqual(Object.keys(whole));
  });

  it("stays a fixed point at the tie-breaking boundaries", () => {
    const boundary: Rec = { id: "n1", x: 0.5, y: -0.5, width: 1.5, height: -1.5 };

    const once = roundCanvasGeometry(boundary);
    const twice = roundCanvasGeometry(once);
    const thrice = roundCanvasGeometry(twice);

    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
  });
});
