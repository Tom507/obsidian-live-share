import { describe, expect, it } from "vitest";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// ===========================================================================
// WP3 AC2 (number format) — "numbers in Obsidian's format (integers without
// decimal places)".
//
// Two clients must not disagree on the TEXT of a number. Two traps:
//   ├── an integral value must never acquire a ".0" tail, and
//   └── `-0` (the natural output of Math.round on a small negative) must not
//       reach the file as "-0" — Obsidian writes "0" and a peer that rounded
//       the same value differently would produce a different byte string.
//
// The serializer must NOT round: rounding lives on the CAPTURE side (AC3) so it
// can never be mistaken for user intent. A fractional value that is genuinely
// in the doc is written out faithfully.
// ===========================================================================

type Rec = Record<string, unknown>;

const lineFor = (out: string, key: string): string | undefined =>
  out.split("\n").find((l) => l.includes(`"${key}":`));

describe("WP3 AC2 — Obsidian number format", () => {
  it("writes integral values without a decimal tail", () => {
    const out = serializeCanonicalCanvas({
      nodes: [
        { id: "n1", type: "text", x: 600 / 3, y: 0, width: 250, height: 60.0, text: "t" },
      ] as Rec[],
      edges: [],
    });

    expect(lineFor(out, "x")?.trim()).toBe('"x": 200,');
    expect(lineFor(out, "height")?.trim()).toBe('"height": 60,');
    expect(out).not.toMatch(/\.0\b/);
  });

  it("normalises negative zero to 0", () => {
    const out = serializeCanonicalCanvas({
      nodes: [{ id: "n1", type: "text", x: -0, y: 0, width: 1, height: 1, text: "t" }] as Rec[],
      edges: [],
    });

    expect(out).not.toContain("-0");
    expect(lineFor(out, "x")?.trim()).toBe('"x": 0,');
  });

  it("does not round on the write side — a fractional doc value is written faithfully", () => {
    const out = serializeCanonicalCanvas({
      nodes: [
        { id: "n1", type: "text", x: 12.5, y: -3.25, width: 250, height: 60, text: "t" },
      ] as Rec[],
      edges: [],
    });

    expect(lineFor(out, "x")?.trim()).toBe('"x": 12.5,');
    expect(lineFor(out, "y")?.trim()).toBe('"y": -3.25,');
  });

  it("keeps large and negative integers in plain decimal notation", () => {
    const out = serializeCanonicalCanvas({
      nodes: [
        { id: "n1", type: "text", x: -123456, y: 100000000000, width: 1, height: 1, text: "t" },
      ] as Rec[],
      edges: [],
    });

    expect(lineFor(out, "x")?.trim()).toBe('"x": -123456,');
    expect(lineFor(out, "y")?.trim()).toBe('"y": 100000000000,');
    expect(out).not.toContain("e+");
  });

  it("round-trips every number bit-exactly", () => {
    const nodes: Rec[] = [
      { id: "n1", type: "text", x: 0, y: -7, width: 250, height: 60, text: "t", ratio: 0.1 + 0.2 },
    ];

    const parsed = JSON.parse(serializeCanonicalCanvas({ nodes, edges: [] })) as { nodes: Rec[] };

    expect(parsed.nodes[0].ratio).toBe(0.1 + 0.2);
    expect(parsed.nodes[0].y).toBe(-7);
  });
});
