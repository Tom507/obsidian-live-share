import { describe, expect, it } from "vitest";

import { canonicalizeCanvasData, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC1 — byte identity across independently ordered inputs.
// Angle: THREE permutations of a node-only canvas (never reason from two
// samples), a record set whose only distinguishing field is an unknown key, and
// a canvas whose edges array is empty.

type Rec = Record<string, unknown>;

const FACTS: Rec[] = [
  { id: "card-04", type: "text", x: 0, y: 0, width: 260, height: 80, text: "four", color: "3" },
  { id: "card-01", type: "link", x: 640, y: -220, width: 400, height: 400, url: "https://x.test" },
  { id: "card-11", type: "file", x: -90, y: 55, width: 300, height: 300, file: "Deep/Note.md" },
  { id: "card-02", type: "text", x: 12, y: 900, width: 260, height: 80, text: "two", tag: "beta" },
  { id: "card-09", type: "text", x: 12, y: 900, width: 260, height: 80, text: "two", tag: "alpha" },
];

/** Same records, rotated by `n`, with the keys of every record rotated too. */
function permute(records: Rec[], n: number): Rec[] {
  const rotated = [...records.slice(n), ...records.slice(0, n)];
  return rotated.map((record) => {
    const entries = Object.entries(record);
    const shifted = [...entries.slice(n % entries.length), ...entries.slice(0, n % entries.length)];
    return Object.fromEntries(shifted) as Rec;
  });
}

describe("canonical serialisation ignores input order (AC1)", () => {
  it("agrees across three different permutations of the same five records", () => {
    const p0 = serializeCanonicalCanvas({ nodes: permute(FACTS, 0), edges: [] });
    const p2 = serializeCanonicalCanvas({ nodes: permute(FACTS, 2), edges: [] });
    const p4 = serializeCanonicalCanvas({ nodes: permute(FACTS, 4), edges: [] });

    expect(p2).toBe(p0);
    expect(p4).toBe(p0);
  });

  it("distinguishes records that differ only in an unknown field", () => {
    const out = JSON.parse(serializeCanonicalCanvas({ nodes: permute(FACTS, 3), edges: [] })) as {
      nodes: Rec[];
    };
    const two = out.nodes.find((n) => n.id === "card-02");
    const nine = out.nodes.find((n) => n.id === "card-09");

    expect(two?.tag).toBe("beta");
    expect(nine?.tag).toBe("alpha");
    expect(out.nodes).toHaveLength(5);
  });

  it("is idempotent — canonicalising an already-canonical snapshot is a no-op", () => {
    const once = canonicalizeCanvasData({ nodes: permute(FACTS, 1), edges: [] });
    const twice = canonicalizeCanvasData(once);

    expect(twice).toEqual(once);
    expect(serializeCanonicalCanvas(twice)).toBe(serializeCanonicalCanvas(once));
  });

  it("agrees character by character, not merely by length", () => {
    const left = serializeCanonicalCanvas({ nodes: permute(FACTS, 1), edges: [] });
    const right = serializeCanonicalCanvas({ nodes: permute(FACTS, 4), edges: [] });

    expect(right.length).toBe(left.length);
    let firstDifference = -1;
    for (let i = 0; i < left.length; i++) {
      if (left.charCodeAt(i) !== right.charCodeAt(i)) {
        firstDifference = i;
        break;
      }
    }
    expect(firstDifference).toBe(-1);
  });
});
