// WP16 AC1 blind2 — same claim, different edge case: fractional / negative
// geometry that must be normalised through the OWNING codec's rounding rule
// (`encodePos`/`encodeSize`, `canvas-registers.ts`), not re-implemented by
// `parseCanvas`. If `parseCanvas` rounded geometry its own way, this test
// would still pass by accident only if the two roundings happen to agree —
// so the expectation is computed via the codec itself, never a literal
// number, to keep this test honest about which module owns rounding.

import { describe, expect, it } from "vitest";

import { encodePos, encodeSize } from "../../../../../plugin/src/canvas/canvas-registers";
import { parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

describe("WP16 AC1 blind2 — V2 record shape, fractional and negative geometry", () => {
  it("fractional coordinates land in the pos register normalised by encodePos, not a hand-rolled Math.round", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "frac", x: 10.6, y: -3.4, width: 99.5, height: 0.4, type: "text", text: "F" },
      ],
      edges: [],
    });

    const data = parseCanvas(content);
    const node = data.nodes.frac;

    expect(node.pos).toEqual(encodePos(10.6, -3.4));
    expect(node.size).toEqual(encodeSize(99.5, 0.4));
  });

  it("a -0 coordinate normalises to 0 exactly as the codec defines, and no flat key survives", () => {
    const content = JSON.stringify({
      nodes: [{ id: "zero", x: -0, y: 0, width: 1, height: 1, type: "text", text: "Z" }],
      edges: [],
    });

    const data = parseCanvas(content);
    const node = data.nodes.zero;

    expect(node.pos).toEqual(encodePos(-0, 0));
    expect(Object.is((node.pos as readonly [number, number])[0], -0)).toBe(false);
    expect("x" in node).toBe(false);
    expect("y" in node).toBe(false);
  });
});
