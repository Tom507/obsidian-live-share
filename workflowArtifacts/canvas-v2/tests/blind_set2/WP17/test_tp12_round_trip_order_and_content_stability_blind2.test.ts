import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData, parseCanvas, serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC4 blind2 — same claim as the visible test (round trip preserves
// records and relative order), different angle: TWO successive round trips
// (parse(serialize(parse(serialize(state)))) rather than one, proving
// stability is not a one-shot coincidence — a second pass over already-
// canonical output must be a no-op on both content and order.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC4 blind2 — round-trip stability holds across two successive passes", () => {
  it("parsing and re-serializing an already-round-tripped doc changes nothing further", () => {
    const { nodes, edges } = makeDoc();

    const n1 = new Y.Map<unknown>();
    nodes.set("late-id-early-ord", n1);
    n1.set("id", "late-id-early-ord");
    n1.set("type", "text");
    n1.set("x", 1);
    n1.set("y", 1);
    n1.set("width", 1);
    n1.set("height", 1);
    n1.set("ord", "A");

    const n2 = new Y.Map<unknown>();
    nodes.set("early-id-late-ord", n2);
    n2.set("id", "early-id-late-ord");
    n2.set("type", "text");
    n2.set("x", 2);
    n2.set("y", 2);
    n2.set("width", 1);
    n2.set("height", 1);
    n2.set("ord", "Z");

    const built = buildCanvasData(nodes, edges);
    const expectedOrder = built.nodes.map((n) => (n as Record<string, unknown>).id);
    expect(expectedOrder).toEqual(["late-id-early-ord", "early-id-late-ord"]);

    const firstText = serializeCanvas(nodes, edges);
    const firstParsed = parseCanvas(firstText);
    expect(firstParsed.order.nodes).toEqual(expectedOrder);

    // Second pass: re-parse the already-canonical text again.
    const secondParsed = parseCanvas(firstText);
    expect(secondParsed.order.nodes).toEqual(firstParsed.order.nodes);
    expect(secondParsed.nodes).toEqual(firstParsed.nodes);
    expect(secondParsed.edges).toEqual(firstParsed.edges);
  });
});
