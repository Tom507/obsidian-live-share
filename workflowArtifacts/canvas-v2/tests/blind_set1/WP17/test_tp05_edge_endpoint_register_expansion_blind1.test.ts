import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint } from "../../../../../plugin/src/canvas/canvas-registers";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind1 — same claim as the visible test (from/to registers
// expand to flat endpoint keys), different angle: BOTH endpoints carry an
// `end` (arrowhead) this time, exercising the "present on both sides" path
// the visible test's asymmetric fixture does not cover.

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

describe("WP17 AC1 blind1 — edge endpoint registers with arrowheads on both ends", () => {
  it("fromEnd and toEnd both appear when both registers carry an end", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "start");
    setNode(nodes, "finish");

    const edge = new Y.Map<unknown>();
    edges.set("e-both", edge);
    edge.set("id", "e-both");
    edge.set("from", encodeEndpoint("start", "bottom", "arrow"));
    edge.set("to", encodeEndpoint("finish", "top", "none"));

    const data = buildCanvasData(nodes, edges);
    const out = data.edges[0] as Record<string, unknown>;

    expect(out).toMatchObject({
      id: "e-both",
      fromNode: "start",
      fromSide: "bottom",
      fromEnd: "arrow",
      toNode: "finish",
      toSide: "top",
      toEnd: "none",
    });
    expect(out).not.toHaveProperty("from");
    expect(out).not.toHaveProperty("to");
  });
});
