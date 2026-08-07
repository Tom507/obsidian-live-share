import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC1 (part 3) — "... ord does not appear in the file."
//
// `ord` is a doc-only field (BUILD_SPEC §4.3) and leaking it would corrupt
// every real user's `.canvas` file with a foreign key Obsidian does not
// expect. This is asserted explicitly and at the byte level, not merely via
// a deep-equal that could coincidentally pass: today `buildCanvasData`
// copies every Y.Map key straight through with no filtering, so a node or
// edge carrying an `ord` field serialises it verbatim into the "unknown key"
// tail of the canonical record — this test fails for that reason today.
// ===========================================================================

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC1 — ord is never written to the file", () => {
  it("a node and an edge both carrying ord produce output with no ord key anywhere", () => {
    const { nodes, edges } = makeDoc();

    const node = new Y.Map<unknown>();
    nodes.set("n1", node);
    node.set("id", "n1");
    node.set("type", "text");
    node.set("x", 0);
    node.set("y", 0);
    node.set("width", 10);
    node.set("height", 10);
    node.set("ord", "M");

    const node2 = new Y.Map<unknown>();
    nodes.set("n2", node2);
    node2.set("id", "n2");
    node2.set("type", "text");
    node2.set("x", 5);
    node2.set("y", 5);
    node2.set("width", 10);
    node2.set("height", 10);
    node2.set("ord", "T");

    const edge = new Y.Map<unknown>();
    edges.set("e1", edge);
    edge.set("id", "e1");
    edge.set("fromNode", "n1");
    edge.set("fromSide", "right");
    edge.set("toNode", "n2");
    edge.set("toSide", "left");
    edge.set("ord", "Q");

    const data = buildCanvasData(nodes, edges);
    for (const record of [...data.nodes, ...data.edges]) {
      expect(record as Record<string, unknown>).not.toHaveProperty("ord");
    }

    const text = serializeCanvas(nodes, edges);
    expect(text).not.toMatch(/"ord"\s*:/);
  });
});
