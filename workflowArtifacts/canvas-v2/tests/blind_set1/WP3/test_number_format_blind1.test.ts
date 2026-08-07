import { describe, expect, it } from "vitest";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC2 (number format) — angle: read the numeric TOKENS back out of the emitted
// text with a regex instead of comparing whole lines, and use values that only
// a formatter with an exponent / decimal bug would get wrong.

type Rec = Record<string, unknown>;

const node = (extra: Rec): Rec => ({
  id: "n1",
  type: "text",
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  text: "t",
  ...extra,
});

/** All numeric tokens in the emitted document, in order. */
function numericTokens(data: { nodes: Rec[]; edges: Rec[] }): string[] {
  const out = serializeCanonicalCanvas(data);
  return [...out.matchAll(/:\s(-?[\d.eE+]+)(?=,?$)/gm)].map((m) => m[1]);
}

describe("Obsidian number format (AC2)", () => {
  it("emits whole values with no decimal point at all", () => {
    const tokens = numericTokens({
      nodes: [node({ x: 1_000_000, y: -960, width: 24 * 25, height: 1e3 })],
      edges: [],
    });

    expect(tokens).toEqual(["1000000", "-960", "600", "1000"]);
    for (const token of tokens) expect(token).not.toContain(".");
  });

  it("never falls back to exponent notation for canvas-scale coordinates", () => {
    const tokens = numericTokens({
      nodes: [node({ x: 1e15, y: -1e15, width: 1e-1 * 10, height: 2 ** 31 })],
      edges: [],
    });

    expect(tokens).toEqual(["1000000000000000", "-1000000000000000", "1", "2147483648"]);
    for (const token of tokens) expect(token.toLowerCase()).not.toContain("e");
  });

  it("collapses -0 to 0 while keeping genuine negatives", () => {
    const tokens = numericTokens({
      nodes: [node({ x: -0, y: -1, width: 0 * -1, height: -0.0 })],
      edges: [],
    });

    expect(tokens).toEqual(["0", "-1", "0", "0"]);
  });

  it("does not quantise a fractional value that is genuinely in the doc", () => {
    const tokens = numericTokens({
      nodes: [node({ x: 0.5, y: -119.75, width: 1, height: 1 })],
      edges: [],
    });

    expect(tokens).toEqual(["0.5", "-119.75", "1", "1"]);
  });

  it("re-reads every number as the identical double", () => {
    const values = { x: 2 ** 53 - 1, y: -0.1, width: 1 / 3, height: 12 };
    const parsed = JSON.parse(serializeCanonicalCanvas({ nodes: [node(values)], edges: [] })) as {
      nodes: Rec[];
    };

    for (const [key, value] of Object.entries(values)) {
      expect(Object.is(parsed.nodes[0][key], value)).toBe(true);
    }
  });
});
