import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind2 — same claim as the visible test (no-ord records sort by
// id alone), different angle: applied to EDGES rather than nodes, and with
// a single record (the degenerate one-element case, which must not throw
// or produce an empty array).

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

function setNode(nodes: Y.Map<Y.Map<unknown>>, id: string): void {
  const record = new Y.Map<unknown>();
  nodes.set(id, record);
  record.set("id", id);
  record.set("type", "text");
  record.set("x", 0);
  record.set("y", 0);
  record.set("width", 10);
  record.set("height", 10);
}

function setEdge(edges: Y.Map<Y.Map<unknown>>, id: string, from: string, to: string): void {
  const record = new Y.Map<unknown>();
  edges.set(id, record);
  record.set("id", id);
  record.set("fromNode", from);
  record.set("fromSide", "right");
  record.set("toNode", to);
  record.set("toSide", "left");
}

describe("WP17 AC1 blind2 — no-ord edges sort by id; a single record does not degenerate", () => {
  it("three un-migrated edges (no ord) sort id-ascending", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");
    setEdge(edges, "e-charlie", "n1", "n2");
    setEdge(edges, "e-alpha", "n1", "n2");
    setEdge(edges, "e-bravo", "n1", "n2");

    const data = buildCanvasData(nodes, edges);

    expect(data.edges.map((e) => (e as Record<string, unknown>).id)).toEqual([
      "e-alpha",
      "e-bravo",
      "e-charlie",
    ]);
  });

  it("a single un-migrated node serialises as a one-element array, not empty", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "only-one");

    const data = buildCanvasData(nodes, edges);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual(["only-one"]);
  });
});
