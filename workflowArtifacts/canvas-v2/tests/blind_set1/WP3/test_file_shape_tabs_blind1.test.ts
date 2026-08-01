import { describe, expect, it } from "vitest";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";
import { parseCanvas } from "../../../files/canvas-sync";

// AC4 (file shape unchanged) — angle: structural assertions over the emitted
// LINES (depth per line, delimiter placement) plus the degenerate canvases an
// exact-string fixture never covers: empty, nodes-only, edges-only.

type Rec = Record<string, unknown>;

const depth = (line: string): number => line.length - line.replace(/^\t+/, "").length;

describe("the `.canvas` file shape and tab indentation are unchanged (AC4)", () => {
  it("emits an empty canvas as two inline empty arrays", () => {
    expect(serializeCanonicalCanvas({ nodes: [], edges: [] })).toBe(
      '{\n\t"nodes": [],\n\t"edges": []\n}',
    );
  });

  it("emits a nodes-only canvas with an inline empty edges array", () => {
    const out = serializeCanonicalCanvas({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1, text: "t" }],
      edges: [],
    });

    const lines = out.split("\n");
    expect(lines[lines.length - 2]).toBe('\t"edges": []');
    expect(lines[lines.length - 1]).toBe("}");
  });

  it("indents by exactly one tab per nesting level and never by spaces", () => {
    const out = serializeCanonicalCanvas({
      nodes: [
        { id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1, text: "t" },
        { id: "n2", type: "text", x: 1, y: 1, width: 1, height: 1, text: "u" },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
    });
    const lines = out.split("\n");

    expect(lines[0]).toBe("{");
    expect(lines[lines.length - 1]).toBe("}");
    expect(lines[1]).toBe('\t"nodes": [');
    for (const line of lines) {
      expect(line).not.toMatch(/^[ ]/);
      expect(line).not.toContain("\r");
      expect(depth(line)).toBeLessThanOrEqual(3);
      if (depth(line) === 3) expect(line.trimStart().startsWith('"')).toBe(true);
    }
  });

  it("is byte-stable through a parse/re-stringify cycle", () => {
    const data = {
      nodes: [
        { id: "b", type: "file", x: -5, y: 5, width: 400, height: 400, file: "N.md" },
        { id: "a", type: "text", x: 0, y: 0, width: 250, height: 60, text: "a\tb\n\"q\"" },
      ] as Rec[],
      edges: [{ id: "e", fromNode: "a", fromSide: "top", toNode: "b", toSide: "bottom" }] as Rec[],
    };

    const out = serializeCanonicalCanvas(data);

    expect(JSON.stringify(JSON.parse(out), null, "\t")).toBe(out);
    // Escapes inside a value must not be confused with the layout tabs.
    expect(out).toContain('\\t');
    expect(out).toContain('\\n');
  });

  it("stays readable by the unchanged parseCanvas, including edge-only content", () => {
    const out = serializeCanonicalCanvas({
      nodes: [],
      edges: [{ id: "e-only", fromNode: "ghost-a", toNode: "ghost-b" }],
    });
    const parsed = parseCanvas(out);

    expect(Object.keys(parsed.nodes)).toEqual([]);
    expect(Object.keys(parsed.edges)).toEqual(["e-only"]);
    expect(parsed.edges["e-only"].fromNode).toBe("ghost-a");
  });
});
