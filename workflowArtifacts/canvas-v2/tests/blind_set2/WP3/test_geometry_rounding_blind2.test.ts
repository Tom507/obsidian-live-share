import { describe, expect, it } from "vitest";

import {
  canonicalizeRecord,
  roundCanvasGeometry,
  serializeCanonicalCanvas,
} from "../../../canvas/canvas-canonical";

// AC3 (whole pixels) — angle: the helper as the FIRST stage of the capture
// pipeline (round → canonicalise → serialise), plus key-name traps: fields whose
// names merely start with or contain a geometry key ("xx", "x2", "heights",
// "maxWidth") must not be rounded, which a prefix/substring match would get
// wrong.

type Rec = Record<string, unknown>;

describe("AC3 — rounding hits geometry and only geometry", () => {
  it("is not fooled by key names that look like geometry", () => {
    const out = roundCanvasGeometry({
      id: "n1",
      x: 3.7,
      y: 3.7,
      width: 3.7,
      height: 3.7,
      xx: 3.7,
      x2: 3.7,
      X: 3.7,
      heights: 3.7,
      maxWidth: 3.7,
      "y ": 3.7,
    });

    expect(out.x).toBe(4);
    expect(out.height).toBe(4);
    for (const key of ["xx", "x2", "X", "heights", "maxWidth", "y "]) {
      expect(out[key]).toBe(3.7);
    }
  });

  it("feeds a whole-pixel record into the canonical writer", () => {
    const captured = roundCanvasGeometry({
      text: "drag result",
      height: 60.500001,
      width: 249.5,
      y: -0.75,
      x: 1279.5,
      type: "text",
      id: "dragged",
    });

    const out = serializeCanonicalCanvas({ nodes: [captured], edges: [] });

    expect(out).toContain('"x": 1280');
    expect(out).toContain('"y": -1');
    expect(out).toContain('"width": 250');
    expect(out).toContain('"height": 61');
    expect(out).toContain('"text": "drag result"');
  });

  it("commutes with canonicalisation — round-then-order equals order-then-round", () => {
    const raw: Rec = { text: "t", height: 60.4, width: 250.6, y: -3.5, x: 12.5, type: "text", id: "n" };

    const roundedFirst = canonicalizeRecord(roundCanvasGeometry(raw), "node");
    const orderedFirst = roundCanvasGeometry(canonicalizeRecord(raw, "node"));

    expect(JSON.stringify(roundedFirst)).toBe(JSON.stringify(orderedFirst));
  });

  it("rounds a group node's very large geometry without precision drift", () => {
    const out = roundCanvasGeometry({
      id: "g",
      type: "group",
      x: -32_768.5,
      y: 32_767.5,
      width: 65_535.5,
      height: 1.999_999_999,
      label: "Frame",
    });

    expect(out.x).toBe(-32_768);
    expect(out.y).toBe(32_768);
    expect(out.width).toBe(65_536);
    expect(out.height).toBe(2);
    expect(out.label).toBe("Frame");
  });

  it("changes nothing at all for a record that is already whole", () => {
    const already: Rec = { id: "n", type: "text", x: -12, y: 0, width: 250, height: 60, text: "t" };

    expect(JSON.stringify(roundCanvasGeometry(already))).toBe(JSON.stringify(already));
  });
});
