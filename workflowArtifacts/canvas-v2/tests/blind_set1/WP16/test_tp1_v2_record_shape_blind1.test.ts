// WP16 AC1 blind1 — same claim as the visible test (parseCanvas emits V2
// registers, not flat file keys), different angle: TWO nodes joined by an
// edge that carries the optional `end` (arrowhead) component on BOTH
// endpoints, and the "flat keys are gone" check is done via a full
// `Object.keys` snapshot comparison rather than individual `in` probes.

import { describe, expect, it } from "vitest";

import { encodeEndpointFromFile, encodePos, encodeSize } from "../../../../../plugin/src/canvas/canvas-registers";
import { parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

describe("WP16 AC1 blind1 — V2 record shape, two-node edge with arrowheads", () => {
  it("both endpoint registers carry their optional end marker and no flat endpoint keys remain", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "left", x: -5, y: -5, width: 40, height: 40, type: "text", text: "L" },
        { id: "right", x: 400, y: 400, width: 40, height: 40, type: "text", text: "R" },
      ],
      edges: [
        {
          id: "arrow",
          fromNode: "left",
          fromSide: "right",
          fromEnd: "none",
          toNode: "right",
          toSide: "left",
          toEnd: "arrow",
        },
      ],
    });

    const data = parseCanvas(content);
    const edge = data.edges.arrow;

    expect(edge.from).toEqual(
      encodeEndpointFromFile("from", { fromNode: "left", fromSide: "right", fromEnd: "none" }),
    );
    expect(edge.to).toEqual(
      encodeEndpointFromFile("to", { toNode: "right", toSide: "left", toEnd: "arrow" }),
    );

    const edgeKeys = Object.keys(edge).sort();
    expect(edgeKeys).not.toContain("fromNode");
    expect(edgeKeys).not.toContain("fromSide");
    expect(edgeKeys).not.toContain("fromEnd");
    expect(edgeKeys).not.toContain("toNode");
    expect(edgeKeys).not.toContain("toSide");
    expect(edgeKeys).not.toContain("toEnd");
  });

  it("both nodes' registers match the owning codec exactly", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "left", x: -5, y: -5, width: 40, height: 40, type: "text", text: "L" },
        { id: "right", x: 400, y: 400, width: 40, height: 40, type: "text", text: "R" },
      ],
      edges: [],
    });

    const data = parseCanvas(content);

    expect(data.nodes.left.pos).toEqual(encodePos(-5, -5));
    expect(data.nodes.left.size).toEqual(encodeSize(40, 40));
    expect(data.nodes.right.pos).toEqual(encodePos(400, 400));
    expect(data.nodes.right.size).toEqual(encodeSize(40, 40));

    const nodeKeys = Object.keys(data.nodes.left).sort();
    expect(nodeKeys).not.toContain("x");
    expect(nodeKeys).not.toContain("y");
    expect(nodeKeys).not.toContain("width");
    expect(nodeKeys).not.toContain("height");
  });
});
