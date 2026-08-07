import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind2 — same claim as the visible test (sort key is `ord`, not
// `id`), different angle: asserted at the SERIALIZED TEXT level (line
// order in the tab-indented output) rather than on the intermediate
// `buildCanvasData` array, so the claim is pinned end to end through
// `serializeCanvas` too.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

function setNode(nodes: Y.Map<Y.Map<unknown>>, fields: Record<string, unknown>): void {
  const record = new Y.Map<unknown>();
  nodes.set(fields.id as string, record);
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
}

describe("WP17 AC1 blind2 — the serialized text itself carries ord order, not id order", () => {
  it("id \"n-id-appears-last\" (ord first) precedes id \"n-id-appears-first\" (ord last) in the raw text", () => {
    const { nodes, edges } = makeDoc();

    setNode(nodes, {
      id: "n-id-appears-first",
      type: "text",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      ord: "Z",
    });
    setNode(nodes, {
      id: "n-id-appears-last",
      type: "text",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      ord: "A",
    });

    const text = serializeCanvas(nodes, edges);
    const indexOfLastId = text.indexOf('"n-id-appears-last"');
    const indexOfFirstId = text.indexOf('"n-id-appears-first"');

    expect(indexOfLastId).toBeGreaterThan(-1);
    expect(indexOfFirstId).toBeGreaterThan(-1);
    expect(indexOfLastId).toBeLessThan(indexOfFirstId);
  });
});
