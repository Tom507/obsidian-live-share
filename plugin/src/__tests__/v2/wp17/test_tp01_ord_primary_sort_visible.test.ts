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
// The sort key is `ord`, NOT `id`. This test picks ids whose alphabetical
// order is the EXACT REVERSE of the intended `ord` order, and inserts them
// into the Y.Map in a third, unrelated order — so an implementation that
// still sorts by `id` alone (WP3/P0's `canonicalizeCanvasData`, which this
// WP must stop relying on for array order) or that reflects raw Y.Map
// iteration order fails this test immediately, while a correct `(ord, id)`
// sort — importing WP13's `compareOrd`/`compareOrdId`, never `<` on a
// differently-derived string or `localeCompare` — passes.
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

describe("WP17 AC1 — records are emitted sorted by ord, not by id", () => {
  it("ord ascending order wins even though it is the exact reverse of id-alphabetical order", () => {
    const { nodes, edges } = makeDoc();

    // id order (alphabetical): n-aaa, n-mmm, n-zzz
    // ord order (ascending):    B (n-zzz), M (n-mmm), T (n-aaa)  -- exact reverse
    setNode(nodes, { id: "n-mmm", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "M" });
    setNode(nodes, { id: "n-aaa", type: "text", x: 1, y: 1, width: 1, height: 1, ord: "T" });
    setNode(nodes, { id: "n-zzz", type: "text", x: 2, y: 2, width: 1, height: 1, ord: "B" });

    const data = buildCanvasData(nodes, edges);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual([
      "n-zzz",
      "n-mmm",
      "n-aaa",
    ]);
  });
});
