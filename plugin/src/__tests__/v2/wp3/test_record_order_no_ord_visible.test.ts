import { describe, expect, it } from "vitest";

import { canonicalizeCanvasData, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// ===========================================================================
// WP3 AC4 (first half) — "Record order is deterministic in P0 without requiring
// `ord` (which does not exist until P1)."
//
// P1 introduces the fractional index and sorts by `(ord, id)` (WP17). Until
// then the ONLY order information both clients provably share is the record id,
// so P0 sorts by id alone.
//
// The comparison must be by UTF-16 code unit, NOT `localeCompare`: a collator's
// result depends on the host ICU data and locale, so two peers on different
// machines could order the same ids differently and break AC1 in a way no unit
// test on one machine would ever show.
// ===========================================================================

type Rec = Record<string, unknown>;

const node = (id: string): Rec => ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, text: id });
const edge = (id: string): Rec => ({ id, fromNode: "B2", toNode: "Z1" });

describe("WP3 AC4 — deterministic record order without `ord`", () => {
  it("sorts nodes by id in UTF-16 code-unit order", () => {
    const out = canonicalizeCanvasData({
      nodes: [node("a1"), node("_x"), node("Z1"), node("B2")],
      edges: [],
    });

    // 'B'(0x42) < 'Z'(0x5A) < '_'(0x5F) < 'a'(0x61). A locale collator would
    // answer ["_x", "a1", "B2", "Z1"] — that ordering must NOT appear here.
    expect(out.nodes.map((n) => n.id)).toEqual(["B2", "Z1", "_x", "a1"]);
  });

  it("sorts edges by id independently of the node order", () => {
    const out = canonicalizeCanvasData({
      nodes: [node("z"), node("a")],
      edges: [edge("e-9"), edge("e-1"), edge("E-5")],
    });

    expect(out.nodes.map((n) => n.id)).toEqual(["a", "z"]);
    expect(out.edges.map((e) => e.id)).toEqual(["E-5", "e-1", "e-9"]);
  });

  it("produces the same order from any input permutation, with no `ord` anywhere", () => {
    const ids = ["m", "c", "q", "b", "x"];
    const forward = serializeCanonicalCanvas({ nodes: ids.map(node), edges: [] });
    const backward = serializeCanonicalCanvas({ nodes: [...ids].reverse().map(node), edges: [] });
    const rotated = serializeCanonicalCanvas({
      nodes: [...ids.slice(2), ...ids.slice(0, 2)].map(node),
      edges: [],
    });

    expect(backward).toBe(forward);
    expect(rotated).toBe(forward);
    expect(forward).not.toContain("ord");
    expect(JSON.parse(forward).nodes.map((n: Rec) => n.id)).toEqual(["b", "c", "m", "q", "x"]);
  });

  it("keeps records with equal ids in their input order (stable sort)", () => {
    const out = canonicalizeCanvasData({
      nodes: [
        { id: "dup", type: "text", x: 0, y: 0, width: 1, height: 1, text: "first" },
        { id: "dup", type: "text", x: 0, y: 0, width: 1, height: 1, text: "second" },
      ],
      edges: [],
    });

    expect(out.nodes.map((n) => n.text)).toEqual(["first", "second"]);
  });

  it("handles an empty canvas and a canvas with no edges", () => {
    expect(canonicalizeCanvasData({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
    expect(canonicalizeCanvasData({ nodes: [node("a")], edges: [] }).edges).toEqual([]);
  });
});
