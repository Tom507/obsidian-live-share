import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { decodeEndpointToFile } from "../../../../../plugin/src/canvas/canvas-registers";
import {
  buildCanvasData,
  parseCanvas,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC4 blind1 — same claim as the visible test (round-trip preserves
// records and relative order), different angle: EDGES are included, and the
// oracle also checks `data.order.edges` (not only `.nodes`), plus an
// endpoint value survives the round trip via WP10's own decoder. Edge ids
// are deliberately the exact reverse of their intended ord order ("e-aaa-"
// sorts first alphabetically but last by ord; "e-zzz-" the opposite), so an
// id-only sort cannot satisfy this by coincidence.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC4 blind1 — round trip preserves edge order and endpoint content", () => {
  it("two edges with reordering ords round-trip to the same relative order and endpoints", () => {
    const { nodes, edges } = makeDoc();

    for (const [id, ord] of [
      ["n1", "A"],
      ["n2", "B"],
    ] as const) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("type", "text");
      record.set("x", 0);
      record.set("y", 0);
      record.set("width", 10);
      record.set("height", 10);
      record.set("ord", ord);
    }

    // id "e-aaa-late" sorts alphabetically FIRST but carries the HIGHER ord
    // (should end up LAST); "e-zzz-early" is the reverse.
    const eLate = new Y.Map<unknown>();
    edges.set("e-aaa-late", eLate);
    eLate.set("id", "e-aaa-late");
    eLate.set("fromNode", "n1");
    eLate.set("fromSide", "right");
    eLate.set("toNode", "n2");
    eLate.set("toSide", "left");
    eLate.set("ord", "Z");

    const eEarly = new Y.Map<unknown>();
    edges.set("e-zzz-early", eEarly);
    eEarly.set("id", "e-zzz-early");
    eEarly.set("fromNode", "n2");
    eEarly.set("fromSide", "top");
    eEarly.set("toNode", "n1");
    eEarly.set("toSide", "bottom");
    eEarly.set("ord", "C");

    const built = buildCanvasData(nodes, edges);
    const expectedEdgeOrder = built.edges.map((e) => (e as Record<string, unknown>).id);
    expect(expectedEdgeOrder).toEqual(["e-zzz-early", "e-aaa-late"]);

    const text = serializeCanvas(nodes, edges);
    const parsed = parseCanvas(text);

    expect(parsed.order.edges).toEqual(expectedEdgeOrder);
    expect(decodeEndpointToFile("from", parsed.edges["e-zzz-early"].from).fromSide).toBe("top");
    expect(decodeEndpointToFile("to", parsed.edges["e-aaa-late"].to).toSide).toBe("left");
  });
});
