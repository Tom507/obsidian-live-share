import { describe, expect, it } from "vitest";

import { canonicalizeCanvasData, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC1 — byte identity for independently ordered inputs.
// Angle: a seeded Fisher-Yates shuffle over an eight-record pool, so the two
// "clients" differ by an arbitrary permutation rather than a hand-picked one,
// and a pool that deliberately contains near-duplicate records (identical in
// every field but the id) to catch a canonicaliser that de-duplicates.

type Rec = Record<string, unknown>;

function xorshift(seed: number): () => number {
  let state = seed >>> 0 || 0x9e37_79b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const next = xorshift(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

const twin = (id: string): Rec => ({
  id,
  type: "text",
  x: 100,
  y: 100,
  width: 250,
  height: 60,
  text: "identical payload",
});

const POOL: Rec[] = [
  twin("t1"),
  twin("t2"),
  twin("t3"),
  { id: "g1", type: "group", x: -900, y: -900, width: 1800, height: 1800, label: "Frame" },
  { id: "f1", type: "file", x: 0, y: 0, width: 400, height: 400, file: "A.md", subpath: "#top" },
  { id: "f2", type: "file", x: 5, y: 5, width: 400, height: 400, file: "B.md" },
  { id: "u1", type: "link", x: 700, y: 0, width: 400, height: 400, url: "https://one.test" },
  { id: "u2", type: "link", x: 700, y: 500, width: 400, height: 400, url: "https://two.test" },
];

const EDGE_POOL: Rec[] = [
  { id: "x1", fromNode: "t1", fromSide: "right", toNode: "f1", toSide: "left" },
  { id: "x2", fromNode: "f2", fromSide: "bottom", toNode: "u1", toSide: "top", label: "see" },
  { id: "x3", fromNode: "g1", fromSide: "top", toNode: "u2", toSide: "bottom" },
];

describe("AC1 — arbitrary permutations serialise to the same bytes", () => {
  it("agrees for four independently seeded shuffles", () => {
    const outputs = [11, 2027, 65_535, 7].map((seed) =>
      serializeCanonicalCanvas({
        nodes: shuffled(POOL, seed),
        edges: shuffled(EDGE_POOL, seed + 1),
      }),
    );

    expect(new Set(outputs).size).toBe(1);
  });

  it("keeps all three near-duplicate records", () => {
    const out = canonicalizeCanvasData({ nodes: shuffled(POOL, 4242), edges: [] });

    expect(out.nodes).toHaveLength(POOL.length);
    expect(out.nodes.filter((n) => n.text === "identical payload").map((n) => n.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("makes canonicalise-then-serialise and serialise-directly the same operation", () => {
    const shuffledData = { nodes: shuffled(POOL, 99), edges: shuffled(EDGE_POOL, 100) };

    expect(serializeCanonicalCanvas(canonicalizeCanvasData(shuffledData))).toBe(
      serializeCanonicalCanvas(shuffledData),
    );
  });

  it("never depends on the shuffle actually changing anything", () => {
    const identity = serializeCanonicalCanvas({ nodes: POOL, edges: EDGE_POOL });
    const permuted = serializeCanonicalCanvas({
      nodes: shuffled(POOL, 5),
      edges: shuffled(EDGE_POOL, 6),
    });

    expect(permuted).toBe(identity);
    // Guard the premise: at least one seeded shuffle really reorders the pool.
    expect(shuffled(POOL, 5).map((n) => n.id)).not.toEqual(POOL.map((n) => n.id));
  });
});
