// WP16 / AC2 (negative case — the highest-value test for this AC) —
// "`ord` is reassigned ONLY when the relative order of existing ids in the
// save has demonstrably changed."
//
// Churn on an UNCHANGED document is exactly the failure AC2 exists to
// prevent, and it is invisible unless asserted directly: a re-parse of
// byte-identical content must produce ZERO ord reassignments. This is a
// full round trip through `parseCanvas`'s order observation feeding
// `deriveOrdAssignments` (the conservative ord capture policy), which is
// literally the Definition of Done: "order round-trips through the file
// without churn on unchanged documents."

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../canvas/canvas-ord";
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

describe("WP16 AC2 — reparsing an unchanged document reassigns zero existing ord values", () => {
  it("a second parse of byte-identical content produces no reassignments for any existing id", () => {
    const rng = makeRng(1001);
    const content = JSON.stringify({
      nodes: [node("a", 1), node("b", 2), node("c", 3)],
      edges: [],
    });

    const first = parseCanvas(content);
    const baseline = deriveOrdAssignments([], first.order.nodes, "client-1", rng);
    expect(baseline.size).toBe(3); // first-ever parse: every id is newly assigned

    const previous: OrdIdEntry[] = first.order.nodes.map((id) => ({
      id,
      ord: baseline.get(id)!,
    }));

    const second = parseCanvas(content); // byte-identical re-parse
    expect(second.order.nodes).toEqual(first.order.nodes);

    const reassignments = deriveOrdAssignments(previous, second.order.nodes, "client-1", rng);

    expect(reassignments.size).toBe(0);
  });
});
