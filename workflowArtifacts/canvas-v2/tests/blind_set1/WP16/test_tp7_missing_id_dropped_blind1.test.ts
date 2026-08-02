// WP16 AC4 blind1 — same claim, different angle: an EMPTY STRING id. The
// existing implementation drops on `if (node.id)`, a truthiness check, so
// `""` (falsy) is already dropped today — this pins that exact edge case so
// the V2 rewrite cannot accidentally switch to a strict `!== undefined`
// check and start keeping empty-string ids.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

describe("WP16 AC4 blind1 — an empty-string id is dropped, matching the existing truthiness check", () => {
  it("a node with id: '' is dropped, not kept as a record with an empty key", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "", x: 0, y: 0, width: 10, height: 10, type: "text", text: "empty id" },
        { id: "real", x: 1, y: 1, width: 10, height: 10, type: "text", text: "kept" },
      ],
      edges: [],
    });

    const data = parseCanvas(content);

    expect(Object.keys(data.nodes)).toEqual(["real"]);
    expect(data.order.nodes).toEqual(["real"]);
    expect("" in data.nodes).toBe(false);
  });

  it("an edge with id: '' is dropped the same way", () => {
    const content = JSON.stringify({
      nodes: [{ id: "n1", x: 0, y: 0, width: 10, height: 10, type: "text", text: "N" }],
      edges: [
        { id: "", fromNode: "n1", fromSide: "right", toNode: "n1", toSide: "left" },
        { id: "e-real", fromNode: "n1", fromSide: "right", toNode: "n1", toSide: "left" },
      ],
    });

    const data = parseCanvas(content);

    expect(Object.keys(data.edges)).toEqual(["e-real"]);
    expect(data.order.edges).toEqual(["e-real"]);
  });
});
