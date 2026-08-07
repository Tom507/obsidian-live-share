import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../../../plugin/src/canvas/canvas-registers";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind2 — same claim as the visible test (pos/size registers
// expand to flat x/y/width/height), different angle: a MIXED doc — one node
// still carries the flat V1-style keys directly (no registers at all, the
// pre-WP18-migration shape) alongside one node using registers — proving
// register expansion does not corrupt a record that never had registers to
// begin with.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC1 blind2 — register expansion and flat-key passthrough coexist", () => {
  it("a flat-key node and a register-only node both serialise to the same flat shape", () => {
    const { nodes, edges } = makeDoc();

    const flatNode = new Y.Map<unknown>();
    nodes.set("n-flat", flatNode);
    flatNode.set("id", "n-flat");
    flatNode.set("type", "text");
    flatNode.set("x", 7);
    flatNode.set("y", 8);
    flatNode.set("width", 9);
    flatNode.set("height", 11);

    const registerNode = new Y.Map<unknown>();
    nodes.set("n-reg", registerNode);
    registerNode.set("id", "n-reg");
    registerNode.set("type", "text");
    registerNode.set("pos", encodePos(7, 8));
    registerNode.set("size", encodeSize(9, 11));

    const data = buildCanvasData(nodes, edges);
    const flatOut = data.nodes.find((n) => (n as Record<string, unknown>).id === "n-flat");
    const regOut = data.nodes.find((n) => (n as Record<string, unknown>).id === "n-reg");

    const shape = { x: 7, y: 8, width: 9, height: 11 };
    expect(flatOut).toMatchObject(shape);
    expect(regOut).toMatchObject(shape);
    expect(regOut).not.toHaveProperty("pos");
    expect(regOut).not.toHaveProperty("size");
  });
});
