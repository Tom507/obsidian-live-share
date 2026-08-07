import { describe, expect, it } from "vitest";

import { canonicalizeCanvasData, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC4 (deterministic order without `ord`) — angle: NUMERIC-LOOKING ids, which is
// where a "natural sort" or `localeCompare(..., {numeric: true})` diverges from
// code-unit order, plus Obsidian's real id alphabet (16 hex chars) at scale.

type Rec = Record<string, unknown>;

const node = (id: string): Rec => ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, text: id });

describe("record order is deterministic in P0 (AC4)", () => {
  it("orders numeric-looking ids by code unit, not by numeric value", () => {
    const out = canonicalizeCanvasData({
      nodes: [node("n2"), node("n10"), node("n1"), node("n02")],
      edges: [],
    });

    // Natural/numeric collation would answer n1, n02, n2, n10.
    expect(out.nodes.map((n) => n.id)).toEqual(["n02", "n1", "n10", "n2"]);
  });

  it("orders a realistic hex id set identically from three different inputs", () => {
    const ids = [
      "f0a1b2c3d4e5f607",
      "0a1b2c3d4e5f6071",
      "9f8e7d6c5b4a3928",
      "1234567890abcdef",
      "abcdef1234567890",
    ];
    const expected = [...ids].sort();

    const forward = canonicalizeCanvasData({ nodes: ids.map(node), edges: [] });
    const backward = canonicalizeCanvasData({ nodes: [...ids].reverse().map(node), edges: [] });
    const shuffled = canonicalizeCanvasData({
      nodes: [ids[3], ids[0], ids[4], ids[1], ids[2]].map(node),
      edges: [],
    });

    expect(forward.nodes.map((n) => n.id)).toEqual(expected);
    expect(backward.nodes.map((n) => n.id)).toEqual(expected);
    expect(shuffled.nodes.map((n) => n.id)).toEqual(expected);
  });

  it("sorts the edges array on its own id, not on its endpoints", () => {
    const out = canonicalizeCanvasData({
      nodes: [node("zzz"), node("aaa")],
      edges: [
        { id: "e-c", fromNode: "aaa", toNode: "zzz" },
        { id: "e-a", fromNode: "zzz", toNode: "aaa" },
        { id: "e-b", fromNode: "aaa", toNode: "aaa" },
      ],
    });

    expect(out.edges.map((e) => e.id)).toEqual(["e-a", "e-b", "e-c"]);
    expect(out.edges.map((e) => e.fromNode)).toEqual(["zzz", "aaa", "aaa"]);
  });

  it("needs no `ord` field and emits none", () => {
    const text = serializeCanonicalCanvas({
      nodes: [node("beta"), node("alpha")],
      edges: [],
    });

    expect(text).not.toContain('"ord"');
    expect(JSON.parse(text).nodes.map((n: Rec) => n.id)).toEqual(["alpha", "beta"]);
  });

  it("puts a record with no id first and keeps such records in input order", () => {
    const out = canonicalizeCanvasData({
      nodes: [
        node("m"),
        { type: "text", x: 0, y: 0, width: 1, height: 1, text: "orphan-one" },
        node("a"),
        { type: "text", x: 0, y: 0, width: 1, height: 1, text: "orphan-two" },
      ],
      edges: [],
    });

    expect(out.nodes.map((n) => n.text)).toEqual(["orphan-one", "orphan-two", "a", "m"]);
  });
});
