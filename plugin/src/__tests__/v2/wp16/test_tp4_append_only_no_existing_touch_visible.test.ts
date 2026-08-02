// WP16 / AC2 (positive case) — "... appending new records allocates new
// `ord` values at the end and touches no existing record's `ord`."
//
// Parses a two-node document, then a three-node document that is the SAME
// two nodes plus one appended at the end. The reassignment map must contain
// EXACTLY the new id — not the two pre-existing ones — and the new id's ord
// must sort AFTER the last existing ord (a real append, not an arbitrary
// insertion).

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../canvas/canvas-ord";
import { compareOrd } from "../../../canvas/canvas-ord";
import { deriveOrdAssignments, parseCanvas } from "../../../files/canvas-sync";

function node(id: string, n: number) {
  return { id, x: n, y: n, width: 10, height: 10, type: "text", text: id };
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("WP16 AC2 — appending a new record allocates only its own ord", () => {
  it("appending 'c' after ['a','b'] reassigns only 'c', placed after 'b'", () => {
    const rng = makeRng(2002);
    const before = parseCanvas(JSON.stringify({ nodes: [node("a", 1), node("b", 2)], edges: [] }));
    const baseline = deriveOrdAssignments([], before.order.nodes, "client-1", rng);
    const previous: OrdIdEntry[] = before.order.nodes.map((id) => ({ id, ord: baseline.get(id)! }));

    const after = parseCanvas(
      JSON.stringify({ nodes: [node("a", 1), node("b", 2), node("c", 3)], edges: [] }),
    );
    expect(after.order.nodes).toEqual(["a", "b", "c"]);

    const reassignments = deriveOrdAssignments(previous, after.order.nodes, "client-1", rng);

    expect([...reassignments.keys()]).toEqual(["c"]);
    expect(reassignments.has("a")).toBe(false);
    expect(reassignments.has("b")).toBe(false);

    const bOrd = previous.find((entry) => entry.id === "b")!.ord;
    const cOrd = reassignments.get("c")!;
    expect(compareOrd(cOrd, bOrd)).toBeGreaterThan(0);
  });
});
