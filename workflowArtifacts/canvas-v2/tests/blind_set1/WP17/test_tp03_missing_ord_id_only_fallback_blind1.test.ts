import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind1 — same claim as the visible test (no-ord records sort by
// id alone), different angle: numeric-LOOKING string ids. A plain object's
// key iteration renumbers all-digit keys into ascending NUMERIC order
// regardless of insertion order — exactly the accidental "order" this
// component must not rely on. If the sort key defaulted to something that
// coerced through numeric-like comparison, "10" would land before "2".

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

describe("WP17 AC1 blind1 — id-only fallback is real string comparison, not numeric", () => {
  it("un-migrated records with numeric-looking ids sort by UTF-16 code unit, not numeric value", () => {
    const { nodes, edges } = makeDoc();

    setNode(nodes, { id: "10", type: "text", x: 0, y: 0, width: 1, height: 1 });
    setNode(nodes, { id: "2", type: "text", x: 0, y: 0, width: 1, height: 1 });
    setNode(nodes, { id: "1", type: "text", x: 0, y: 0, width: 1, height: 1 });

    const data = buildCanvasData(nodes, edges);

    // Code-unit order: "1" < "10" < "2" (NOT numeric 1 < 2 < 10).
    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual(["1", "10", "2"]);
  });
});
