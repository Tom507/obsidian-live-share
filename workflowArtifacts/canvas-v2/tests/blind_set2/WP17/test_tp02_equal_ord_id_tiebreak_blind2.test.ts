import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind2 — same claim as the visible test (equal ord falls back to
// id ascending), different angle: TWO separate tie groups at different ord
// values, so the tiebreak must apply correctly WITHIN each group while the
// groups themselves stay ordered by ord. The "z"-prefixed ids deliberately
// carry the LOWER ord and the "a"-prefixed ids the HIGHER one, so pure
// id-alphabetical order ("a1","a2","z1","z2") is the exact reverse of the
// correct ord-ordered result — an id-only sort cannot pass this by luck.

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

describe("WP17 AC1 blind2 — id-tiebreak applies independently within two separate ord groups", () => {
  it("the low-ord group (z-prefixed ids) sorts entirely before the high-ord group (a-prefixed ids)", () => {
    const { nodes, edges } = makeDoc();

    // z-prefixed ids carry the LOWER ord; a-prefixed ids carry the HIGHER
    // ord — the reverse of what their ids would suggest.
    setNode(nodes, { id: "z2", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "A" });
    setNode(nodes, { id: "a2", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "Z" });
    setNode(nodes, { id: "z1", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "A" });
    setNode(nodes, { id: "a1", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "Z" });

    const data = buildCanvasData(nodes, edges);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual([
      "z1",
      "z2",
      "a1",
      "a2",
    ]);
  });
});
