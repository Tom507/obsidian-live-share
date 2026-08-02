import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind1 — same claim as the visible test (sort key is `ord`, not
// `id`), different angle: five records and ords spanning the full base-62
// alphabet class boundaries (digit, uppercase, lowercase), with ids again
// the exact reverse of the intended ord order.

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

describe("WP17 AC1 blind1 — ord decides order across digit/upper/lower boundaries", () => {
  it("five records sort by ord (0 < A < Z < a < z), reverse of their id order", () => {
    const { nodes, edges } = makeDoc();

    setNode(nodes, { id: "id-e", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "0" });
    setNode(nodes, { id: "id-d", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "A" });
    setNode(nodes, { id: "id-c", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "Z" });
    setNode(nodes, { id: "id-b", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "a" });
    setNode(nodes, { id: "id-a", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "z" });

    const data = buildCanvasData(nodes, edges);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual([
      "id-e",
      "id-d",
      "id-c",
      "id-b",
      "id-a",
    ]);
  });
});
