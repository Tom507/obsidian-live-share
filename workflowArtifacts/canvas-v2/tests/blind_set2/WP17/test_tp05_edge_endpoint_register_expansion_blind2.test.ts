import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint } from "../../../../../plugin/src/canvas/canvas-registers";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind2 — same claim as the visible test (from/to registers
// expand to flat endpoint keys), different angle: NEITHER endpoint carries
// an `end`, and the sides are "top"/"bottom" rather than "left"/"right" —
// proving the codec is not hard-coded to a left/right pairing and that
// `fromEnd`/`toEnd` are correctly OMITTED (not written as `undefined`) when
// absent.

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

describe("WP17 AC1 blind2 — endpoint expansion without arrowheads, vertical sides", () => {
  it("fromEnd/toEnd are omitted entirely (not undefined-valued) when neither register carries one", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "top-node");
    setNode(nodes, "bottom-node");

    const edge = new Y.Map<unknown>();
    edges.set("e-vertical", edge);
    edge.set("id", "e-vertical");
    edge.set("from", encodeEndpoint("top-node", "bottom"));
    edge.set("to", encodeEndpoint("bottom-node", "top"));

    const data = buildCanvasData(nodes, edges);
    const out = data.edges[0] as Record<string, unknown>;

    expect(out).toMatchObject({
      id: "e-vertical",
      fromNode: "top-node",
      fromSide: "bottom",
      toNode: "bottom-node",
      toSide: "top",
    });
    expect("fromEnd" in out).toBe(false);
    expect("toEnd" in out).toBe(false);

    // The output really is JSON-clean: no stray undefined-valued keys.
    expect(Object.keys(JSON.parse(JSON.stringify(out)))).toEqual(Object.keys(out));
  });
});
