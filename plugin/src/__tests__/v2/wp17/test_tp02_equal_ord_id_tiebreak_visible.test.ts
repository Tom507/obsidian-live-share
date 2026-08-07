import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData } from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC1 (part 1) — "Records are emitted sorted by (ord, id) ..."
//
// Two records with the SAME `ord` must be ordered by `id` ascending — the
// tiebreak half of WP13's `compareOrdId`. This is what makes the total
// order total: allocation makes equal `ord`s vanishingly unlikely, not
// impossible, and WP17 AC3's byte-equality guarantee admits no undefined
// case. Records are inserted in the OPPOSITE of the expected tie order, so
// a sort that dropped the id tiebreak (or used array/insertion order
// instead) fails this test.
// ===========================================================================

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

describe("WP17 AC1 — equal ord falls back to id ascending", () => {
  it("two records sharing the same ord sort by id, and a distinct lower ord still sorts first", () => {
    const { nodes, edges } = makeDoc();

    // Inserted n2 before n1 on purpose: insertion order must not leak through.
    setNode(nodes, { id: "n2", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "M" });
    setNode(nodes, { id: "n1", type: "text", x: 1, y: 1, width: 1, height: 1, ord: "M" });
    setNode(nodes, { id: "n3", type: "text", x: 2, y: 2, width: 1, height: 1, ord: "A" });

    const data = buildCanvasData(nodes, edges);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual(["n3", "n1", "n2"]);
  });
});
