import { describe, expect, it } from "vitest";

import { canonicalizeCanvasData, canonicalizeRecord } from "../../../canvas/canvas-canonical";

// ===========================================================================
// WP3 AC2 (second half) — "no field gains or loses a value through
// canonicalisation."
//
// The dangerous failure mode of a canonicaliser is a silent filter: a key it
// does not know about (a future Obsidian field, a plugin field) gets dropped and
// the next disk write deletes user data on every peer. Canonicalisation is a
// REORDERING and nothing else — values are passed through by identity.
// ===========================================================================

type Rec = Record<string, unknown>;

describe("WP3 AC2 — canonicalisation preserves every field and value", () => {
  it("keeps the exact key set and the exact values (by identity) for a node", () => {
    const nested = { deep: true };
    const input: Rec = {
      id: "n1",
      type: "text",
      x: 12,
      y: -3,
      width: 250,
      height: 60,
      color: "#ff0000",
      text: "line one\nline two",
      styleAttributes: nested,
      flags: [1, 2, 3],
      pinned: false,
      note: null,
      empty: "",
      zero: 0,
    };

    const out = canonicalizeRecord(input, "node");

    expect(new Set(Object.keys(out))).toEqual(new Set(Object.keys(input)));
    for (const key of Object.keys(input)) {
      expect(Object.is(out[key], input[key])).toBe(true);
    }
    // Falsy values are values, not absences.
    expect(out.pinned).toBe(false);
    expect(out.note).toBeNull();
    expect(out.empty).toBe("");
    expect(out.zero).toBe(0);
    // Object values are passed through, not cloned-and-stripped.
    expect(out.styleAttributes).toBe(nested);
  });

  it("keeps unknown edge fields instead of filtering them out", () => {
    const input: Rec = {
      id: "e1",
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
      futureObsidianField: "keep me",
      weight: 3,
    };

    const out = canonicalizeRecord(input, "edge");

    expect(out.futureObsidianField).toBe("keep me");
    expect(out.weight).toBe(3);
    expect(Object.keys(out)).toHaveLength(Object.keys(input).length);
  });

  it("does not mutate the input record", () => {
    const input: Rec = { height: 4, id: "n1", width: 3, y: 2, x: 1, type: "text", text: "t" };
    const before = Object.keys(input).join(",");

    const out = canonicalizeRecord(input, "node");

    expect(out).not.toBe(input);
    expect(Object.keys(input).join(",")).toBe(before);
  });

  it("omits only keys whose value is undefined (JSON has no such value)", () => {
    const input: Rec = { id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1, color: undefined };

    const out = canonicalizeRecord(input, "node");

    expect("color" in out).toBe(false);
    expect(Object.keys(out)).toEqual(["id", "type", "x", "y", "width", "height"]);
  });

  it("preserves the full record population across a whole canvas", () => {
    const data = {
      nodes: [
        { id: "b", type: "text", x: 0, y: 0, width: 1, height: 1, text: "b" },
        { id: "a", type: "file", x: 0, y: 0, width: 1, height: 1, file: "A.md", subpath: "#h" },
      ] as Rec[],
      edges: [{ id: "e", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" }] as Rec[],
    };

    const out = canonicalizeCanvasData(data);

    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toHaveLength(1);
    expect(out.nodes.find((n) => n.id === "a")?.subpath).toBe("#h");
    // New arrays, new records — the caller's snapshot is untouched.
    expect(out.nodes).not.toBe(data.nodes);
    expect(out.nodes[0]).not.toBe(data.nodes[0]);
  });
});
