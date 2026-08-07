import { describe, expect, it } from "vitest";

import { canonicalizeCanvasData, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC4 (deterministic order without `ord`) — angle: the ordering RULE rather than
// a hand-written expectation. `Array.prototype.sort` with no comparator is the
// language's own UTF-16 code-unit order, so it is an independent oracle for the
// rule "sort by id, by code unit". Tested at scale and across the punctuation /
// non-ASCII ids Obsidian never generates but a plugin or an import can.

type Rec = Record<string, unknown>;

const node = (id: string): Rec => ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, text: id });

const EXOTIC = ["~tilde", "-dash", "0zero", "Alpha", "alpha", "_under", "Ünicode", "ünicode", " lead"];

describe("AC4 — record order follows the id, by code unit, at any scale", () => {
  it("matches the language's own default string sort for exotic ids", () => {
    const out = canonicalizeCanvasData({ nodes: EXOTIC.map(node), edges: [] });

    expect(out.nodes.map((n) => n.id)).toEqual([...EXOTIC].sort());
  });

  it("separates ids that differ only in case", () => {
    const out = canonicalizeCanvasData({ nodes: [node("alpha"), node("Alpha")], edges: [] });

    // Uppercase 'A' (0x41) sorts before lowercase 'a' (0x61); a case-insensitive
    // collator would call these equal and leave the order to chance.
    expect(out.nodes.map((n) => n.id)).toEqual(["Alpha", "alpha"]);
  });

  it("agrees with the oracle for 120 generated ids in a rotated input", () => {
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) ids.push(`${i % 7}-${(i * 37) % 101}-${i}`);
    const rotate = (offset: number) => [...ids.slice(offset), ...ids.slice(0, offset)];

    const first = canonicalizeCanvasData({ nodes: rotate(0).map(node), edges: [] });
    const second = canonicalizeCanvasData({ nodes: rotate(77).map(node), edges: [] });

    expect(first.nodes.map((n) => n.id)).toEqual([...ids].sort());
    expect(second.nodes.map((n) => n.id)).toEqual(first.nodes.map((n) => n.id));
  });

  it("orders nodes and edges by their own ids and mentions no `ord`", () => {
    const text = serializeCanonicalCanvas({
      nodes: [node("n-z"), node("n-a")],
      edges: [
        { id: "b-edge", fromNode: "n-z", toNode: "n-a" },
        { id: "a-edge", fromNode: "n-a", toNode: "n-z" },
      ],
    });
    const parsed = JSON.parse(text) as { nodes: Rec[]; edges: Rec[] };

    expect(parsed.nodes.map((n) => n.id)).toEqual(["n-a", "n-z"]);
    expect(parsed.edges.map((e) => e.id)).toEqual(["a-edge", "b-edge"]);
    expect(text.includes('"ord"')).toBe(false);
  });

  it("is unaffected by where a record sat in the input", () => {
    const ids = ["q", "b", "k", "d"];
    const outputs = ids.map((_, offset) =>
      serializeCanonicalCanvas({
        nodes: [...ids.slice(offset), ...ids.slice(0, offset)].map(node),
        edges: [],
      }),
    );

    expect(new Set(outputs).size).toBe(1);
  });
});
