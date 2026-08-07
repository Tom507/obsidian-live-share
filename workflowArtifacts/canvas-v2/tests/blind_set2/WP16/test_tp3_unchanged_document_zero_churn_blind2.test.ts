// WP16 AC2 blind2 — same claim, different angle: the second "unchanged"
// parse is byte-DIFFERENT at the JSON level (the outer object's `nodes` and
// `edges` keys are swapped, and unrelated node fields are re-serialised in a
// different property order) while the ARRAY ORDER inside each list is
// identical. Zero churn must depend on the semantic order observation, not
// on string/byte equality of the source content.

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../../../plugin/src/canvas/canvas-ord";
import { deriveOrdAssignments, parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

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

describe("WP16 AC2 blind2 — zero churn survives a byte-different but order-identical re-serialisation", () => {
  it("swapping the outer JSON key order and per-field order still yields zero reassignments", () => {
    const rng = makeRng(777);

    const contentA = JSON.stringify({
      nodes: [
        { id: "x", x: 1, y: 1, width: 10, height: 10, type: "text", text: "X" },
        { id: "y", x: 2, y: 2, width: 10, height: 10, type: "text", text: "Y" },
      ],
      edges: [],
    });

    // Same records, same array order — but the outer object's keys are
    // swapped and each node's fields are serialised in reverse order.
    const contentB = JSON.stringify({
      edges: [],
      nodes: [
        { text: "X", type: "text", height: 10, width: 10, y: 1, x: 1, id: "x" },
        { text: "Y", type: "text", height: 10, width: 10, y: 2, x: 2, id: "y" },
      ],
    });

    expect(contentA).not.toBe(contentB);

    const first = parseCanvas(contentA);
    const baseline = deriveOrdAssignments([], first.order.nodes, "client-b", rng);
    const previous: OrdIdEntry[] = first.order.nodes.map((id) => ({
      id,
      ord: baseline.get(id)!,
    }));

    const second = parseCanvas(contentB);
    expect(second.order.nodes).toEqual(first.order.nodes);

    const reassignments = deriveOrdAssignments(previous, second.order.nodes, "client-b", rng);
    expect(reassignments.size).toBe(0);
  });
});
