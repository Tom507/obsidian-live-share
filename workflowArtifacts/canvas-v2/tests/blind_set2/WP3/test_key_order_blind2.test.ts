import { describe, expect, it } from "vitest";

import {
  CANONICAL_EDGE_KEY_ORDER,
  CANONICAL_NODE_KEY_ORDER,
  canonicalizeRecord,
} from "../../../canvas/canvas-canonical";

// AC2 (key order) — angle: derive the expectation FROM the exported constant
// instead of restating a literal list, and feed each record its keys in exactly
// reverse-canonical order (the worst case). A record carrying every declared key
// must come back as the constant itself.

type Rec = Record<string, unknown>;

/** Build a record whose keys are inserted in reverse canonical order. */
function reversedRecord(order: readonly string[]): Rec {
  const record: Rec = {};
  for (const key of [...order].reverse()) record[key] = `v:${key}`;
  return record;
}

describe("AC2 — emitted key order is exactly the declared canonical order", () => {
  it("returns the full node order for a record carrying every declared key", () => {
    const out = canonicalizeRecord(reversedRecord(CANONICAL_NODE_KEY_ORDER), "node");

    expect(Object.keys(out)).toEqual([...CANONICAL_NODE_KEY_ORDER]);
  });

  it("returns the full edge order for a record carrying every declared key", () => {
    const out = canonicalizeRecord(reversedRecord(CANONICAL_EDGE_KEY_ORDER), "edge");

    expect(Object.keys(out)).toEqual([...CANONICAL_EDGE_KEY_ORDER]);
  });

  it("keeps a partial record's order equal to the constant filtered to present keys", () => {
    const present = ["height", "id", "x"];
    const record: Rec = {};
    for (const key of present) record[key] = 1;

    const out = canonicalizeRecord(record, "node");

    expect(Object.keys(out)).toEqual(CANONICAL_NODE_KEY_ORDER.filter((k) => present.includes(k)));
  });

  it("orders an edge's optional end markers with their own endpoint, not at the end", () => {
    const out = canonicalizeRecord(
      {
        toEnd: "arrow",
        label: "flows into",
        toNode: "b",
        fromEnd: "none",
        id: "e1",
        toSide: "top",
        fromNode: "a",
        fromSide: "bottom",
      },
      "edge",
    );
    const keys = Object.keys(out);

    expect(keys.indexOf("fromEnd")).toBeGreaterThan(keys.indexOf("fromNode"));
    expect(keys.indexOf("fromEnd")).toBeLessThan(keys.indexOf("toNode"));
    expect(keys.indexOf("toEnd")).toBeGreaterThan(keys.indexOf("toSide"));
    expect(keys.indexOf("label")).toBe(keys.length - 1);
  });

  it("treats node and edge as different schemas for the same record", () => {
    const ambiguous: Rec = { label: "L", color: "2", id: "r1", type: "group" };

    const asNode = Object.keys(canonicalizeRecord(ambiguous, "node"));
    const asEdge = Object.keys(canonicalizeRecord(ambiguous, "edge"));

    // `type` is a node field; as an edge it is unknown and moves to the tail.
    expect(asNode).toEqual(["id", "type", "color", "label"]);
    expect(asEdge).toEqual(["id", "color", "label", "type"]);
  });
});
