// WP16 / AC4 (part 2) — "... and entries without an `id` are dropped."
//
// Pre-existing behaviour that must not regress. Also covers the new `order`
// field: a dropped entry must not leave a gap or a phantom id in the order
// observation either — only ids that actually made it into `data.nodes` /
// `data.edges` may appear in `order.nodes` / `order.edges`.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../files/canvas-sync";

describe("WP16 AC4 — entries without an id are dropped, from both the records and the order", () => {
  it("a node with no id key is dropped; the surviving node is unaffected", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "ok", x: 0, y: 0, width: 10, height: 10, type: "text", text: "kept" },
        { x: 1, y: 1, width: 10, height: 10, type: "text", text: "dropped, no id" },
      ],
      edges: [],
    });

    const data = parseCanvas(content);

    expect(Object.keys(data.nodes)).toEqual(["ok"]);
    expect(data.order.nodes).toEqual(["ok"]);
  });

  it("an edge with no id key is dropped; the surviving edge is unaffected", () => {
    const content = JSON.stringify({
      nodes: [{ id: "n1", x: 0, y: 0, width: 10, height: 10, type: "text", text: "N" }],
      edges: [
        { id: "e-ok", fromNode: "n1", fromSide: "right", toNode: "n1", toSide: "left" },
        { fromNode: "n1", fromSide: "right", toNode: "n1", toSide: "left" },
      ],
    });

    const data = parseCanvas(content);

    expect(Object.keys(data.edges)).toEqual(["e-ok"]);
    expect(data.order.edges).toEqual(["e-ok"]);
  });
});
