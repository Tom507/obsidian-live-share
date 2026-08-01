import { describe, expect, it } from "vitest";

import { roundCanvasGeometry, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC2 (number format) — angle: a DIFFERENTIAL test. Obsidian writes its canvas
// with the platform JSON writer, so "Obsidian's format" is definitionally what
// `JSON.stringify` produces for the same double. Compare our emitted token
// against that reference for a table of values instead of hard-coding strings,
// and then check the whole capture→write pipeline emits integer geometry only.

type Rec = Record<string, unknown>;

const VALUES = [0, -0, 1, -1, 12, -12, 1024, -1024, 250, 60, 4096, 1_000_000, -999_999];

const node = (id: string, x: number, y: number): Rec => ({
  id,
  type: "text",
  x,
  y,
  width: 250,
  height: 60,
  text: id,
});

/** The value of one key as it literally appears in the emitted document. */
function emittedToken(record: Rec, key: string): string {
  const out = serializeCanonicalCanvas({ nodes: [record], edges: [] });
  const line = out.split("\n").find((l) => l.trimStart().startsWith(`"${key}":`));
  return (line ?? "").trimStart().replace(`"${key}": `, "").replace(/,$/, "");
}

describe("AC2 — numbers are written in the platform JSON format Obsidian uses", () => {
  it("matches JSON.stringify token for token", () => {
    for (const value of VALUES) {
      const reference = JSON.stringify(value);
      expect(emittedToken(node("n", value, 0), "x")).toBe(reference);
    }
  });

  it("never writes a decimal point for a whole coordinate", () => {
    for (const value of VALUES) {
      expect(emittedToken(node("n", value, value), "y")).not.toContain(".");
    }
  });

  it("writes 0, not -0, for the negative zero JSON cannot represent", () => {
    expect(emittedToken(node("n", -0, -0), "x")).toBe("0");
    expect(JSON.stringify(-0)).toBe("0");
  });

  it("emits integer-only geometry once the capture-side rounding has run", () => {
    const captured = [
      roundCanvasGeometry(node("a", 10.3, -10.3)),
      roundCanvasGeometry(node("b", -0.4, 0.6)),
      roundCanvasGeometry(node("c", 1919.9, -1080.1)),
    ];

    const out = serializeCanonicalCanvas({ nodes: captured, edges: [] });

    for (const key of ["x", "y", "width", "height"]) {
      for (const line of out.split("\n").filter((l) => l.trimStart().startsWith(`"${key}":`))) {
        expect(line.trimStart().replace(/,$/, "")).toMatch(
          new RegExp(`^"${key}": -?(0|[1-9]\\d*)$`),
        );
      }
    }
  });

  it("leaves a fractional value fractional when nothing rounded it", () => {
    expect(emittedToken(node("n", 33.75, 0), "x")).toBe("33.75");
    expect(emittedToken(node("n", -0.5, 0), "x")).toBe("-0.5");
  });
});
