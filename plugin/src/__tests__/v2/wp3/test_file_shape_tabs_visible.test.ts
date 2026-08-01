import { describe, expect, it } from "vitest";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";
import { parseCanvas } from "../../../files/canvas-sync";

// ===========================================================================
// WP3 AC4 (second half) — "the existing tab indentation and overall file shape
// are unchanged."
//
// P0 changes only the byte-level determinism of our output. `.canvas` stays
// `{"nodes": [...], "edges": [...]}`, tab-indented, no trailing newline —
// exactly what `JSON.stringify(data, null, "\t")` produces today
// (`canvas-sync.ts:132-137`). This test pins the bytes, not the intent.
// ===========================================================================

type Rec = Record<string, unknown>;

const INPUT = {
  nodes: [
    { id: "n2", type: "text", x: 300, y: 40, width: 250, height: 60, text: "second" },
    { id: "n1", type: "file", x: -120, y: 0, width: 400, height: 400, file: "Notes/A.md" },
  ] as Rec[],
  edges: [{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" }] as Rec[],
};

const EXPECTED = [
  "{",
  '\t"nodes": [',
  "\t\t{",
  '\t\t\t"id": "n1",',
  '\t\t\t"type": "file",',
  '\t\t\t"x": -120,',
  '\t\t\t"y": 0,',
  '\t\t\t"width": 400,',
  '\t\t\t"height": 400,',
  '\t\t\t"file": "Notes/A.md"',
  "\t\t},",
  "\t\t{",
  '\t\t\t"id": "n2",',
  '\t\t\t"type": "text",',
  '\t\t\t"x": 300,',
  '\t\t\t"y": 40,',
  '\t\t\t"width": 250,',
  '\t\t\t"height": 60,',
  '\t\t\t"text": "second"',
  "\t\t}",
  "\t],",
  '\t"edges": [',
  "\t\t{",
  '\t\t\t"id": "e1",',
  '\t\t\t"fromNode": "n1",',
  '\t\t\t"fromSide": "right",',
  '\t\t\t"toNode": "n2",',
  '\t\t\t"toSide": "left"',
  "\t\t}",
  "\t]",
  "}",
].join("\n");

describe("WP3 AC4 — the `.canvas` file shape is unchanged", () => {
  it("emits exactly the tab-indented Obsidian shape, byte for byte", () => {
    expect(serializeCanonicalCanvas(INPUT)).toBe(EXPECTED);
  });

  it("has no trailing newline and no space indentation anywhere", () => {
    const out = serializeCanonicalCanvas(INPUT);

    expect(out.endsWith("}")).toBe(true);
    expect(out.endsWith("\n")).toBe(false);
    expect(out).not.toContain("\r");
    for (const line of out.split("\n")) {
      expect(line).not.toMatch(/^ /);
    }
  });

  it("keeps exactly the two top-level containers, `nodes` before `edges`", () => {
    const parsed = JSON.parse(serializeCanonicalCanvas(INPUT)) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual(["nodes", "edges"]);
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
  });

  it("is re-stringify stable — the output is already in canonical text form", () => {
    const out = serializeCanonicalCanvas(INPUT);

    expect(JSON.stringify(JSON.parse(out), null, "\t")).toBe(out);
  });

  it("round-trips through the unchanged `parseCanvas` reader", () => {
    const data = parseCanvas(serializeCanonicalCanvas(INPUT));

    expect(Object.keys(data.nodes).sort()).toEqual(["n1", "n2"]);
    expect(Object.keys(data.edges)).toEqual(["e1"]);
    expect(data.nodes.n1.file).toBe("Notes/A.md");
    expect(data.edges.e1.toSide).toBe("left");
  });

  it("emits an empty canvas as two empty arrays", () => {
    expect(serializeCanonicalCanvas({ nodes: [], edges: [] })).toBe(
      ["{", '\t"nodes": [],', '\t"edges": []', "}"].join("\n"),
    );
  });
});
