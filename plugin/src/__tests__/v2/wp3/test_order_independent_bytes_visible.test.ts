import { describe, expect, it } from "vitest";

import { serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// ===========================================================================
// WP3 AC1 — "Two independently ordered inputs describing the same records
// serialise to byte-identical strings."
//
// This is the whole point of the canonical form: two clients hold the same doc
// state but their Y.Map iteration order (and the key insertion order inside each
// record) is a function of the LOCAL integration history, not of the state. If
// the serializer just walks that order, two clients write different bytes for
// the same truth and the byte-equality echo breaker (D9) can never work.
//
// Pure data test: no Obsidian, no Yjs, no clock.
// ===========================================================================

type Rec = Record<string, unknown>;

const CLIENT_A = {
  nodes: [
    { id: "n-b", type: "text", x: 10, y: 20, width: 200, height: 100, text: "beta" },
    { id: "n-a", type: "file", x: -40, y: 0, width: 400, height: 400, file: "Notes/A.md" },
    { id: "n-c", type: "group", x: 0, y: 0, width: 800, height: 600, label: "Cluster" },
  ] as Rec[],
  edges: [
    { id: "e-2", fromNode: "n-b", fromSide: "left", toNode: "n-c", toSide: "top" },
    { id: "e-1", fromNode: "n-a", fromSide: "right", toNode: "n-b", toSide: "left" },
  ] as Rec[],
};

// Exactly the same facts. Different array order AND different key insertion
// order inside every single record.
const CLIENT_B = {
  nodes: [
    { height: 400, width: 400, y: 0, x: -40, file: "Notes/A.md", type: "file", id: "n-a" },
    { label: "Cluster", id: "n-c", height: 600, width: 800, y: 0, x: 0, type: "group" },
    { text: "beta", type: "text", id: "n-b", width: 200, height: 100, x: 10, y: 20 },
  ] as Rec[],
  edges: [
    { toSide: "left", toNode: "n-b", fromSide: "right", fromNode: "n-a", id: "e-1" },
    { id: "e-2", toNode: "n-c", toSide: "top", fromNode: "n-b", fromSide: "left" },
  ] as Rec[],
};

describe("WP3 AC1 — canonical serialisation is independent of input order", () => {
  it("emits byte-identical strings for the same records ordered two different ways", () => {
    const a = serializeCanonicalCanvas(CLIENT_A);
    const b = serializeCanonicalCanvas(CLIENT_B);

    // The premise: the two inputs really are different JS objects with a
    // different traversal order. Without that this test proves nothing.
    expect(JSON.stringify(CLIENT_A)).not.toBe(JSON.stringify(CLIENT_B));

    expect(a).toBe(b);
  });

  it("loses nothing while normalising the order", () => {
    const parsed = JSON.parse(serializeCanonicalCanvas(CLIENT_A)) as {
      nodes: Rec[];
      edges: Rec[];
    };

    expect(parsed.nodes.map((n) => n.id).sort()).toEqual(["n-a", "n-b", "n-c"]);
    expect(parsed.edges.map((e) => e.id).sort()).toEqual(["e-1", "e-2"]);
    expect(parsed.nodes.find((n) => n.id === "n-a")).toEqual({
      id: "n-a",
      type: "file",
      x: -40,
      y: 0,
      width: 400,
      height: 400,
      file: "Notes/A.md",
    });
  });

  it("is stable under repeated calls and under a reversed copy of the same input", () => {
    const once = serializeCanonicalCanvas(CLIENT_A);
    const twice = serializeCanonicalCanvas(CLIENT_A);
    const reversed = serializeCanonicalCanvas({
      nodes: [...CLIENT_A.nodes].reverse(),
      edges: [...CLIENT_A.edges].reverse(),
    });

    expect(twice).toBe(once);
    expect(reversed).toBe(once);
  });

  it("does not mutate the caller's arrays or records", () => {
    const nodes: Rec[] = [
      { id: "z", type: "text", x: 1, y: 2, width: 3, height: 4, text: "t" },
      { id: "a", type: "text", x: 5, y: 6, width: 7, height: 8, text: "u" },
    ];
    const snapshot = JSON.stringify(nodes);

    serializeCanonicalCanvas({ nodes, edges: [] });

    expect(JSON.stringify(nodes)).toBe(snapshot);
    expect(nodes[0].id).toBe("z");
  });
});
