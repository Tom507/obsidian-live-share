import { describe, expect, it } from "vitest";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";
import { decodeEndpointToFile } from "../../../canvas/canvas-registers";
import { decodeCanvasDataToFlat, parseCanvas } from "../../../files/canvas-sync";

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
    // WP59 amendment (extended licence, 2026-08-02): `parseCanvas` is a V2
    // reader since WP16, and WP10 AC5 made a side-less `{fromNode}` a WHOLE
    // endpoint register — `*Node` alone decides presence — so this bare,
    // edge-only record now reads `{from, id, to}`. This assertion previously
    // passed only because `toV2Edge` keeps an edge's flat keys when the
    // endpoint register FAILS to build: pre-AC5 a side-less endpoint failed to
    // build, so `fromNode` survived. The green was produced by the very defect
    // AC5 exists to fix. The file bytes are identical either way; the test's
    // stated subject — that an edge-only canvas stays readable, endpoints
    // intact — survives verbatim, read through the sanctioned inverse.
    const flat = decodeCanvasDataToFlat(parsed);

    expect(Object.keys(parsed.nodes)).toEqual([]);
    expect(Object.keys(parsed.edges)).toEqual(["e-only"]);
    expect(flat.edges["e-only"].fromNode).toBe("ghost-a");
    // Added strictness (WP59 AC6): the bare edge's FULL flat key set, exact and
    // whole-collection — the side-less round trip is pinned as a whole rather
    // than one field at a time, so a spurious `fromSide`/`fromEnd` is caught
    // here even if `fromNode` itself survives.
    expect(Object.keys(flat.edges["e-only"]).sort()).toEqual(["fromNode", "id", "toNode"]);
    // Added strictness (WP59 AC6): pin AC5's actual contract, which nothing
    // pinned here before — a side-less endpoint decodes to its `*Node` key and
    // NO `*Side`/`*End` key at all. An implementation that re-emitted
    // `fromSide: null` or `fromSide: ""` would still satisfy the read above but
    // fails this exact whole-object `toEqual`.
    expect(decodeEndpointToFile("from", parsed.edges["e-only"].from)).toEqual({
      fromNode: "ghost-a",
    });
  });
});
