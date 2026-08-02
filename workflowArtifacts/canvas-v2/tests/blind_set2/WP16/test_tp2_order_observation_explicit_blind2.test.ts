// WP16 AC1 blind2 — same claim, different angle: two SEPARATE parseCanvas
// calls on two differently-shuffled documents (same id set) must each report
// their OWN literal array order, proving the observation reflects the
// argument just parsed rather than some memoised/first-call value or a
// stable sort keyed by id.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

function node(id: string, n: number) {
  return { id, x: n, y: n, width: 1, height: 1, type: "text", text: id };
}

describe("WP16 AC1 blind2 — order observation reflects each call's own document, not a memoised value", () => {
  it("two different shuffles of the same ids produce two different order observations", () => {
    const shuffleOne = JSON.stringify({
      nodes: [node("p", 1), node("q", 2), node("r", 3)],
      edges: [],
    });
    const shuffleTwo = JSON.stringify({
      nodes: [node("r", 3), node("p", 1), node("q", 2)],
      edges: [],
    });

    const dataOne = parseCanvas(shuffleOne);
    const dataTwo = parseCanvas(shuffleTwo);

    expect(dataOne.order.nodes).toEqual(["p", "q", "r"]);
    expect(dataTwo.order.nodes).toEqual(["r", "p", "q"]);
    expect(dataTwo.order.nodes).not.toEqual(dataOne.order.nodes);
  });

  it("the record maps themselves hold the same ids regardless of the order they arrived in", () => {
    const shuffleOne = JSON.stringify({
      nodes: [node("p", 1), node("q", 2), node("r", 3)],
      edges: [],
    });
    const shuffleTwo = JSON.stringify({
      nodes: [node("r", 3), node("p", 1), node("q", 2)],
      edges: [],
    });

    const dataOne = parseCanvas(shuffleOne);
    const dataTwo = parseCanvas(shuffleTwo);

    expect(Object.keys(dataOne.nodes).sort()).toEqual(Object.keys(dataTwo.nodes).sort());
  });
});
