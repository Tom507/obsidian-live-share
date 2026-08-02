// WP16 / AC3 — "When a reorder IS detected, the number of reassigned `ord`
// values is minimal for the observed change."
//
// This is the discriminating test called out by the task design: without it,
// AC2 and AC3 both pass trivially on a reassign-everything implementation.
// Moving ONE record from the end of a five-record document to the front is
// the classic case a naive implementation gets wrong (renumbering all five).
// The correct, minimal result touches only the moved record; the other four
// keep their original ord unchanged.

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../canvas/canvas-ord";
import { compareOrdId } from "../../../canvas/canvas-ord";
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

describe("WP16 AC3 — moving one record from end to front reassigns only that record", () => {
  it("['a','b','c','d','e'] -> ['e','a','b','c','d'] touches only 'e'", () => {
    const rng = makeRng(5005);
    const before = parseCanvas(
      JSON.stringify({
        nodes: [node("a", 1), node("b", 2), node("c", 3), node("d", 4), node("e", 5)],
        edges: [],
      }),
    );
    const baseline = deriveOrdAssignments([], before.order.nodes, "client-1", rng);
    const previous: OrdIdEntry[] = before.order.nodes.map((id) => ({ id, ord: baseline.get(id)! }));

    const after = parseCanvas(
      JSON.stringify({
        nodes: [node("e", 5), node("a", 1), node("b", 2), node("c", 3), node("d", 4)],
        edges: [],
      }),
    );
    expect(after.order.nodes).toEqual(["e", "a", "b", "c", "d"]);

    const reassignments = deriveOrdAssignments(previous, after.order.nodes, "client-1", rng);

    // Minimal: exactly the moved record, never the whole set.
    expect([...reassignments.keys()]).toEqual(["e"]);

    // And the resulting total order genuinely matches the new file order.
    const resulting: OrdIdEntry[] = previous
      .filter((entry) => entry.id !== "e")
      .concat([{ id: "e", ord: reassignments.get("e")! }]);
    const sortedIds = [...resulting].sort(compareOrdId).map((entry) => entry.id);
    expect(sortedIds).toEqual(["e", "a", "b", "c", "d"]);
  });
});
