import { describe, expect, it } from "vitest";

import { canonicalizeCanvasData, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";
import { parseCanvas } from "../../../files/canvas-sync";

// AC2 (no field gains or loses a value) — angle: a full write/read round trip
// through the real reader (`parseCanvas`) rather than in-memory inspection, with
// payloads that break naive string handling: emoji (surrogate pairs), combining
// marks, embedded quotes/backslashes/newlines, and a very long text body.

type Rec = Record<string, unknown>;

const LONG = "λ".repeat(5000);

const NODES: Rec[] = [
  {
    id: "emoji",
    type: "text",
    x: 0,
    y: 0,
    width: 250,
    height: 60,
    text: "👩‍👩‍👧‍👦 family · 🇩🇪 flag · é combining",
  },
  {
    id: "quotes",
    type: "text",
    x: 10,
    y: 10,
    width: 250,
    height: 60,
    text: 'he said "hi"\\ then\nnewline\ttab',
  },
  { id: "long", type: "text", x: 20, y: 20, width: 250, height: 60, text: LONG },
  {
    id: "paths",
    type: "file",
    x: 30,
    y: 30,
    width: 400,
    height: 400,
    file: "Ordner mit Leerzeichen/Übersicht – v2.md",
    subpath: "#Überschrift",
  },
];

describe("AC2 — a full round trip loses no field and no character", () => {
  it("returns every node byte-for-byte through serialise → parseCanvas", () => {
    const parsed = parseCanvas(serializeCanonicalCanvas({ nodes: NODES, edges: [] }));

    expect(Object.keys(parsed.nodes).sort()).toEqual(["emoji", "long", "paths", "quotes"]);
    for (const original of NODES) {
      const back = parsed.nodes[original.id as string];
      expect(Object.keys(back).sort()).toEqual(Object.keys(original).sort());
      for (const [key, value] of Object.entries(original)) {
        expect(back[key]).toBe(value);
      }
    }
  });

  it("keeps the exact code-unit length of a long unicode payload", () => {
    const parsed = parseCanvas(serializeCanonicalCanvas({ nodes: NODES, edges: [] }));

    expect((parsed.nodes.long.text as string).length).toBe(5000);
    expect(parsed.nodes.long.text).toBe(LONG);
  });

  it("preserves an edge's optional fields and adds none", () => {
    const edges: Rec[] = [
      { id: "full", fromNode: "a", fromSide: "right", fromEnd: "none", toNode: "b", toSide: "left", toEnd: "arrow", color: "5", label: "über" },
      { id: "bare", fromNode: "a", toNode: "b" },
    ];

    const parsed = parseCanvas(serializeCanonicalCanvas({ nodes: [], edges }));

    expect(Object.keys(parsed.edges.full).sort()).toEqual(
      ["color", "fromEnd", "fromNode", "fromSide", "id", "label", "toEnd", "toNode", "toSide"],
    );
    expect(Object.keys(parsed.edges.bare).sort()).toEqual(["fromNode", "id", "toNode"]);
    expect(parsed.edges.full.label).toBe("über");
  });

  it("does not deep-clone away a value the caller still holds a reference to", () => {
    const shared = { keepMe: [1, 2, 3] };
    const nodes: Rec[] = [
      { id: "n", type: "text", x: 0, y: 0, width: 1, height: 1, text: "t", extra: shared },
    ];

    const out = canonicalizeCanvasData({ nodes, edges: [] });

    expect(out.nodes[0].extra).toBe(shared);
  });
});
