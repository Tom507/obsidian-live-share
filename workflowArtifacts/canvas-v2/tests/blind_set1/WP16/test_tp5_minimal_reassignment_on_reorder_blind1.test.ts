// WP16 AC3 blind1 — same claim, different angle: the moved record comes from
// the MIDDLE of the sequence and lands at the tail (not head-to-tail), so a
// fix special-cased for "first element moves to front" is still caught.

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
    state = (state + 0x9e3779b9) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

describe("WP16 AC3 blind1 — moving a middle record to the tail reassigns only that record", () => {
  it("['a','b','c','d','e'] -> ['a','b','d','e','c'] touches only 'c'", () => {
    const rng = makeRng(6006);
    const before = parseCanvas(
      JSON.stringify({
        nodes: [node("a", 1), node("b", 2), node("c", 3), node("d", 4), node("e", 5)],
        edges: [],
      }),
    );
    const baseline = deriveOrdAssignments([], before.order.nodes, "client-mid", rng);
    const previous: OrdIdEntry[] = before.order.nodes.map((id) => ({ id, ord: baseline.get(id)! }));

    const after = parseCanvas(
      JSON.stringify({
        nodes: [node("a", 1), node("b", 2), node("d", 4), node("e", 5), node("c", 3)],
        edges: [],
      }),
    );

    const reassignments = deriveOrdAssignments(previous, after.order.nodes, "client-mid", rng);

    expect([...reassignments.keys()]).toEqual(["c"]);

    const resulting: OrdIdEntry[] = previous
      .filter((entry) => entry.id !== "c")
      .concat([{ id: "c", ord: reassignments.get("c")! }]);
    const sortedIds = [...resulting].sort(compareOrdId).map((entry) => entry.id);
    expect(sortedIds).toEqual(["a", "b", "d", "e", "c"]);
  });
});
