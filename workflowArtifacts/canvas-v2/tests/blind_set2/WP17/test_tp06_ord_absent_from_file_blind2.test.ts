import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData, serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind2 — same claim as the visible test (ord never reaches the
// file), different angle: a larger doc (three nodes, two edges, ALL
// carrying ord) so a leak in even one record is caught, and the check
// re-parses the emitted text and walks every record's own key list rather
// than trusting `buildCanvasData`'s in-memory return value.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

function setNode(nodes: Y.Map<Y.Map<unknown>>, id: string, ord: string): void {
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

function setEdge(
  edges: Y.Map<Y.Map<unknown>>,
  id: string,
  from: string,
  to: string,
  ord: string,
): void {
  const record = new Y.Map<unknown>();
  edges.set(id, record);
  record.set("id", id);
  record.set("fromNode", from);
  record.set("fromSide", "right");
  record.set("toNode", to);
  record.set("toSide", "left");
  record.set("ord", ord);
}

describe("WP17 AC1 blind2 — no ord leak anywhere in a multi-record doc, re-parsed from disk text", () => {
  it("every one of three nodes and two edges is ord-free after a full parse of the written bytes", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1", "A");
    setNode(nodes, "n2", "M");
    setNode(nodes, "n3", "Z");
    setEdge(edges, "e1", "n1", "n2", "B");
    setEdge(edges, "e2", "n2", "n3", "Y");

    const text = serializeCanvas(nodes, edges);
    const reparsed = JSON.parse(text) as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };

    expect(reparsed.nodes).toHaveLength(3);
    expect(reparsed.edges).toHaveLength(2);
    for (const record of [...reparsed.nodes, ...reparsed.edges]) {
      expect(Object.keys(record)).not.toContain("ord");
    }

    // Cross-check against the in-memory builder too.
    const data = buildCanvasData(nodes, edges);
    for (const record of [...data.nodes, ...data.edges]) {
      expect(record as Record<string, unknown>).not.toHaveProperty("ord");
    }
  });
});
