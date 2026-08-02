// WP16 / AC1 (part 1) — "Parsing produces V2 records (`pos`, `size`, `from`,
// `to`)."
//
// `parseCanvas` must translate the FILE's flat geometry/endpoint keys (`x`,
// `y`, `width`, `height`, `fromNode`, `fromSide`, `fromEnd`, `toNode`,
// `toSide`, `toEnd`) into the atomic V2 doc registers WP9/WP10 own
// (`canvas-registers.ts`) — not merely copy the flat JSON through. This test
// asserts BOTH halves: the register values are correct (via the owning
// module's own codec, so this test can never disagree with WP9/WP10 about
// what "correct" means) AND the flat keys are gone from the returned record
// (proving a real conversion happened, not a passthrough with extra fields
// bolted on).

import { describe, expect, it } from "vitest";

import { encodeEndpointFromFile, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { parseCanvas } from "../../../files/canvas-sync";

describe("WP16 AC1 — parseCanvas produces V2-shaped records (pos/size/from/to)", () => {
  it("a node's flat x/y/width/height become one pos register and one size register", () => {
    const content = JSON.stringify({
      nodes: [
        {
          id: "n1",
          x: 12,
          y: 34,
          width: 200,
          height: 80,
          type: "file",
          file: "notes/a.md",
        },
      ],
      edges: [],
    });

    const data = parseCanvas(content);
    const node = data.nodes.n1;

    expect(node).toBeDefined();
    expect(node.id).toBe("n1");
    expect(node.type).toBe("file");
    expect(node.pos).toEqual(encodePos(12, 34));
    expect(node.size).toEqual(encodeSize(200, 80));

    // The flat file keys must not survive into the V2 record.
    expect("x" in node).toBe(false);
    expect("y" in node).toBe(false);
    expect("width" in node).toBe(false);
    expect("height" in node).toBe(false);
  });

  it("an edge's flat fromNode/fromSide/toNode/toSide become one from register and one to register", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "n1", x: 0, y: 0, width: 10, height: 10, type: "text", text: "A" },
      ],
      edges: [{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n1", toSide: "left" }],
    });

    const data = parseCanvas(content);
    const edge = data.edges.e1;

    expect(edge).toBeDefined();
    expect(edge.id).toBe("e1");
    expect(edge.from).toEqual(
      encodeEndpointFromFile("from", { fromNode: "n1", fromSide: "right" }),
    );
    expect(edge.to).toEqual(encodeEndpointFromFile("to", { toNode: "n1", toSide: "left" }));

    expect("fromNode" in edge).toBe(false);
    expect("fromSide" in edge).toBe(false);
    expect("toNode" in edge).toBe(false);
    expect("toSide" in edge).toBe(false);
  });
});
