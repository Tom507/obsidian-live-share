import { describe, expect, it } from "vitest";

import { CANONICAL_NODE_KEY_ORDER, canonicalizeRecord } from "../../../canvas/canvas-canonical";

// AC2 (key order) — angle: SPARSE records (most canonical keys absent) and the
// order read back out of the SERIALISED TEXT rather than out of Object.keys, so
// a canonicaliser that only reorders an in-memory object but lets the writer
// re-scramble it is still caught.

type Rec = Record<string, unknown>;

/** Key names in the order they appear in a JSON.stringify'd record. */
function keysInText(record: Rec, kind: "node" | "edge"): string[] {
  const text = JSON.stringify(canonicalizeRecord(record, kind), null, "\t");
  return [...text.matchAll(/^\t"([^"]+)":/gm)].map((m) => m[1]);
}

describe("canonical key order (AC2)", () => {
  it("orders a sparse group node as a subsequence of the canonical order", () => {
    const keys = keysInText({ label: "Sprint", height: 700, id: "g1", width: 900, type: "group" }, "node");

    expect(keys).toEqual(["id", "type", "width", "height", "label"]);
    const positions = keys.map((k) => CANONICAL_NODE_KEY_ORDER.indexOf(k));
    expect([...positions].sort((l, r) => l - r)).toEqual(positions);
  });

  it("puts a link node's url after its geometry, not where it was inserted", () => {
    expect(keysInText({ url: "https://a.test", x: 5, id: "l1", y: 6, type: "link" }, "node")).toEqual([
      "id",
      "type",
      "x",
      "y",
      "url",
    ]);
  });

  it("orders an edge's endpoints from-before-to whatever the input order", () => {
    expect(
      keysInText({ toSide: "top", toNode: "b", fromSide: "bottom", fromNode: "a", id: "e" }, "edge"),
    ).toEqual(["id", "fromNode", "fromSide", "toNode", "toSide"]);
  });

  it("appends unknown keys in code-unit order, uppercase before lowercase", () => {
    const keys = keysInText(
      { zz: 1, Zz: 2, aa: 3, Aa: 4, id: "n1", type: "text", "0k": 5 },
      "node",
    );

    // '0'(0x30) < 'A'(0x41) < 'Z'(0x5A) < 'a'(0x61) < 'z'(0x7A).
    expect(keys).toEqual(["id", "type", "0k", "Aa", "Zz", "aa", "zz"]);
  });

  it("produces one deterministic order for a record given twice in two shapes", () => {
    const first = canonicalizeRecord({ id: "n", type: "text", text: "t", x: 1, y: 2 }, "node");
    const second = canonicalizeRecord({ y: 2, text: "t", x: 1, type: "text", id: "n" }, "node");

    expect(Object.keys(second)).toEqual(Object.keys(first));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
