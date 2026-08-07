import { describe, expect, it } from "vitest";

import { roundCanvasGeometry, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC3 (idempotence) — angle: the property stated the way the system actually
// relies on it. A drag is captured, written, read back and captured AGAIN; if
// rounding were not a fixed point the second capture would produce a delta the
// user never made, and the byte-equality echo breaker would never settle.
//
// Data channel: a deterministic middle-square-free 32-bit generator, distinct
// seed and range from any other suite, 300 records in one canvas.

type Rec = Record<string, unknown>;

function stream(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 48_271) % 0x7f_ff_ff_ff) >>> 0;
    return state / 0x7f_ff_ff_ff;
  };
}

function canvasOf(seed: number, count: number): Rec[] {
  const next = stream(seed);
  const nodes: Rec[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `node-${String(i).padStart(4, "0")}`,
      type: "text",
      x: (next() - 0.5) * 20_000,
      y: (next() - 0.5) * 20_000,
      width: next() * 800 + 0.5,
      height: next() * 800,
      text: `payload ${i}`,
    });
  }
  return nodes;
}

describe("AC3 — a second capture of a captured record produces no delta", () => {
  it("writes identical bytes for capture and re-capture over 300 records", () => {
    const raw = canvasOf(0x1357_9bdf, 300);
    const captured = raw.map((node) => roundCanvasGeometry(node));
    const recaptured = captured.map((node) => roundCanvasGeometry(node));

    expect(serializeCanonicalCanvas({ nodes: recaptured, edges: [] })).toBe(
      serializeCanonicalCanvas({ nodes: captured, edges: [] }),
    );
  });

  it("differs from the un-rounded write, so the rounding is really happening", () => {
    const raw = canvasOf(0x2468_ace0, 40);
    const captured = raw.map((node) => roundCanvasGeometry(node));

    expect(serializeCanonicalCanvas({ nodes: captured, edges: [] })).not.toBe(
      serializeCanonicalCanvas({ nodes: raw, edges: [] }),
    );
  });

  it("produces only whole pixels, stable under a third and fourth pass", () => {
    const captured = canvasOf(0x0f0f_0f0f, 60).map((node) => roundCanvasGeometry(node));
    const fourth = captured
      .map((node) => roundCanvasGeometry(node))
      .map((node) => roundCanvasGeometry(node))
      .map((node) => roundCanvasGeometry(node));

    expect(fourth).toEqual(captured);
    for (const node of captured) {
      for (const key of ["x", "y", "width", "height"]) {
        expect(Number.isInteger(node[key] as number)).toBe(true);
        expect(Object.is(node[key], -0)).toBe(false);
      }
    }
  });

  it("never touches the text payload on any pass", () => {
    const captured = canvasOf(0x1111_2222, 10).map((node) => roundCanvasGeometry(node));
    const again = captured.map((node) => roundCanvasGeometry(node));

    expect(again.map((n) => n.text)).toEqual(captured.map((n) => n.text));
    expect(again[0].text).toBe("payload 0");
  });
});
