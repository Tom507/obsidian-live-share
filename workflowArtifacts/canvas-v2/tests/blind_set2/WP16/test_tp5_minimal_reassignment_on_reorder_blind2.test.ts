// WP16 AC3 blind2 — same claim, different angle: an adjacent-pair SWAP.
// Either element of the swapped pair is a valid minimal choice to move (the
// algorithm need not pick a specific one), so this test asserts the
// discriminating property that generalises across implementations: exactly
// ONE of the two touched ids is reassigned (never both, never zero), and the
// resulting total order matches the new file order regardless of which one
// moved.

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../../../plugin/src/canvas/canvas-ord";
import { compareOrdId } from "../../../../../plugin/src/canvas/canvas-ord";
import { deriveOrdAssignments, parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

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

describe("WP16 AC3 blind2 — swapping one adjacent pair reassigns exactly one record, never all four", () => {
  it("['a','b','c','d'] -> ['a','c','b','d'] touches exactly one of {'b','c'}", () => {
    const rng = makeRng(7007);
    const before = parseCanvas(
      JSON.stringify({
        nodes: [node("a", 1), node("b", 2), node("c", 3), node("d", 4)],
        edges: [],
      }),
    );
    const baseline = deriveOrdAssignments([], before.order.nodes, "client-swap", rng);
    const previous: OrdIdEntry[] = before.order.nodes.map((id) => ({ id, ord: baseline.get(id)! }));

    const after = parseCanvas(
      JSON.stringify({
        nodes: [node("a", 1), node("c", 3), node("b", 2), node("d", 4)],
        edges: [],
      }),
    );

    const reassignments = deriveOrdAssignments(previous, after.order.nodes, "client-swap", rng);

    expect(reassignments.size).toBe(1);
    const [movedId] = [...reassignments.keys()];
    expect(["b", "c"]).toContain(movedId);
    // Neither 'a' nor 'd' — the pair not involved in the swap — is ever touched.
    expect(reassignments.has("a")).toBe(false);
    expect(reassignments.has("d")).toBe(false);

    const resulting: OrdIdEntry[] = previous
      .filter((entry) => entry.id !== movedId)
      .concat([{ id: movedId, ord: reassignments.get(movedId)! }]);
    const sortedIds = [...resulting].sort(compareOrdId).map((entry) => entry.id);
    expect(sortedIds).toEqual(["a", "c", "b", "d"]);
  });
});
