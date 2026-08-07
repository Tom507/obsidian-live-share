import { describe, expect, it } from "vitest";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC4 (file shape unchanged) — angle: an exact expected document for the two
// node shapes the other fixtures do not use (link + group) and a labelled edge,
// checked as a whole string AND as a structural profile (a per-line tab-depth
// signature), so a writer that changed the separator style but kept the JSON
// semantics is still caught.

type Rec = Record<string, unknown>;

const INPUT = {
  nodes: [
    { type: "link", id: "b-link", url: "https://example.test/x", x: 0, y: -40, width: 400, height: 400 },
    { label: "Frame", type: "group", id: "a-group", x: -100, y: -100, width: 900, height: 700 },
  ] as Rec[],
  edges: [
    { label: "ref", toSide: "top", toNode: "b-link", fromSide: "bottom", fromNode: "a-group", id: "z-edge" },
  ] as Rec[],
};

const EXPECTED = [
  "{",
  '\t"nodes": [',
  "\t\t{",
  '\t\t\t"id": "a-group",',
  '\t\t\t"type": "group",',
  '\t\t\t"x": -100,',
  '\t\t\t"y": -100,',
  '\t\t\t"width": 900,',
  '\t\t\t"height": 700,',
  '\t\t\t"label": "Frame"',
  "\t\t},",
  "\t\t{",
  '\t\t\t"id": "b-link",',
  '\t\t\t"type": "link",',
  '\t\t\t"x": 0,',
  '\t\t\t"y": -40,',
  '\t\t\t"width": 400,',
  '\t\t\t"height": 400,',
  '\t\t\t"url": "https://example.test/x"',
  "\t\t}",
  "\t],",
  '\t"edges": [',
  "\t\t{",
  '\t\t\t"id": "z-edge",',
  '\t\t\t"fromNode": "a-group",',
  '\t\t\t"fromSide": "bottom",',
  '\t\t\t"toNode": "b-link",',
  '\t\t\t"toSide": "top",',
  '\t\t\t"label": "ref"',
  "\t\t}",
  "\t]",
  "}",
].join("\n");

describe("AC4 — the emitted document is the unchanged Obsidian file shape", () => {
  it("matches the expected document exactly", () => {
    expect(serializeCanonicalCanvas(INPUT)).toBe(EXPECTED);
  });

  it("has the expected tab-depth profile per line", () => {
    const profile = serializeCanonicalCanvas(INPUT)
      .split("\n")
      .map((line) => (line.match(/^\t*/) as RegExpMatchArray)[0].length);

    expect(profile[0]).toBe(0);
    expect(profile[1]).toBe(1);
    expect(profile[2]).toBe(2);
    expect(profile[3]).toBe(3);
    expect(profile[profile.length - 1]).toBe(0);
    expect(Math.max(...profile)).toBe(3);
  });

  it("carries no trailing whitespace, no BOM and no CRLF", () => {
    const out = serializeCanonicalCanvas(INPUT);

    expect(out.charCodeAt(0)).toBe("{".charCodeAt(0));
    expect(out).not.toContain("\r");
    for (const line of out.split("\n")) {
      expect(line).toBe(line.replace(/[ \t]+$/, ""));
    }
  });

  it("uses `: ` after every key and no space before it", () => {
    for (const line of serializeCanonicalCanvas(INPUT).split("\n")) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('"')) continue;
      expect(trimmed).toMatch(/^"[^"]+": /);
    }
  });

  it("keeps the shape when a canvas has one node and no edges", () => {
    expect(
      serializeCanonicalCanvas({
        nodes: [{ id: "solo", type: "text", x: 0, y: 0, width: 1, height: 1, text: "s" }],
        edges: [],
      }).split("\n"),
    ).toHaveLength(14);
  });
});
