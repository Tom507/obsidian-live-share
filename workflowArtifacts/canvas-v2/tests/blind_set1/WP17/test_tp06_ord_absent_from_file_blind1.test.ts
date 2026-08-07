import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind1 — same claim as the visible test (ord never reaches the
// file), different angle: only ONE record (a lone node) carries `ord`, and
// the check is a raw substring scan of the emitted text rather than a
// parsed-object key check, closing the gap the visible test's regex leaves
// open (a stray "ord" appearing anywhere, not just as a JSON key).

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC1 blind1 — a lone node's ord never appears in the emitted text", () => {
  it("the serialized string contains no occurrence of the ord value's key", () => {
    const { nodes, edges } = makeDoc();

    const node = new Y.Map<unknown>();
    nodes.set("solo", node);
    node.set("id", "solo");
    node.set("type", "text");
    node.set("x", 1);
    node.set("y", 2);
    node.set("width", 3);
    node.set("height", 4);
    node.set("text", "no ord please");
    node.set("ord", "Zz9");

    const text = serializeCanvas(nodes, edges);

    expect(text).not.toContain('"ord"');
    expect(text).toContain("no ord please"); // sanity: content is not being stripped wholesale
  });
});
