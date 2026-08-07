import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind1 — same claim as the visible test (equal ord falls back to
// id ascending), different angle: a THREE-way tie, inserted in a scrambled
// order, so a correct implementation must actually sort all three by id
// rather than getting lucky with a two-way comparator call. A fourth record
// carries a distinct, LOWER ord and an id ("zulu") that sorts alphabetically
// LAST among all four — an id-only sort (ignoring ord entirely) would place
// it last, while the correct (ord, id) sort places it first, so this is a
// genuine falsifier, not just a same-ord tiebreak in disguise.

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

describe("WP17 AC1 blind1 — a three-way ord tie sorts entirely by id, and a distinct lower ord still wins overall", () => {
  it("three records sharing the same ord sort id-ascending regardless of insertion order", () => {
    const { nodes, edges } = makeDoc();

    setNode(nodes, { id: "gamma", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "K" });
    setNode(nodes, { id: "alpha", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "K" });
    setNode(nodes, { id: "beta", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "K" });

    const data = buildCanvasData(nodes, edges);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("a fourth record with a distinct lower ord sorts first even though its id sorts last", () => {
    const { nodes, edges } = makeDoc();

    setNode(nodes, { id: "gamma", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "K" });
    setNode(nodes, { id: "alpha", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "K" });
    setNode(nodes, { id: "beta", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "K" });
    setNode(nodes, { id: "zulu", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "A" });

    const data = buildCanvasData(nodes, edges);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual([
      "zulu",
      "alpha",
      "beta",
      "gamma",
    ]);
  });
});
