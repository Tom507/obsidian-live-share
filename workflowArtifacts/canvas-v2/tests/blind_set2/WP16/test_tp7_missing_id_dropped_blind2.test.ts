// WP16 AC4 blind2 — same claim, different angle: MULTIPLE id-less entries
// interspersed among survivors (not just one, not only at an edge of the
// array), verifying `order.nodes` reflects the survivors' relative order
// with the gaps closed — never an empty slot, never a shifted mismatch
// against `data.nodes`.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

describe("WP16 AC4 blind2 — interspersed id-less entries are dropped, survivors keep relative order", () => {
  it("dropping entries 1, 3 and 5 of a five-entry array leaves entries 2 and 4 in their relative order", () => {
    const content = JSON.stringify({
      nodes: [
        { x: 0, y: 0, width: 1, height: 1, type: "text", text: "drop-1" },
        { id: "keep-a", x: 1, y: 1, width: 1, height: 1, type: "text", text: "keep-a" },
        { x: 2, y: 2, width: 1, height: 1, type: "text", text: "drop-2" },
        { id: "keep-b", x: 3, y: 3, width: 1, height: 1, type: "text", text: "keep-b" },
        { x: 4, y: 4, width: 1, height: 1, type: "text", text: "drop-3" },
      ],
      edges: [],
    });

    const data = parseCanvas(content);

    expect(Object.keys(data.nodes).sort()).toEqual(["keep-a", "keep-b"]);
    expect(data.order.nodes).toEqual(["keep-a", "keep-b"]);
  });
});
