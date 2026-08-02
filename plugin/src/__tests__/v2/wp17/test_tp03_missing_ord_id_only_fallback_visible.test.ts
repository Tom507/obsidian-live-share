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
// WP17 AC1 (part 1), backward-compatibility guard —
//
// A record that predates the `ord` field (no P1 migration has touched it
// yet) must still serialise deterministically. The existing, frozen P0
// suite (`v2/wp3/test_two_client_bytes_visible.test.ts`, "buildCanvasData
// returns canonical, id-sorted records") builds exactly this fixture — no
// node carries `ord` at all — and asserts pure id-ascending order. WP17
// must not regress that: when every record's `ord` is absent, the `(ord,
// id)` sort must degenerate to id-only order, not throw and not reorder
// arbitrarily. This test pins the same guarantee directly against WP17's
// own AC1 wording, independent of the P0 suite continuing to pass.
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

describe("WP17 AC1 — records with no ord field sort deterministically by id", () => {
  it("three un-migrated records (no ord key at all) sort id-ascending, not by insertion order", () => {
    const { nodes, edges } = makeDoc();

    setNode(nodes, { id: "n-charlie", type: "text", x: 0, y: 0, width: 1, height: 1 });
    setNode(nodes, { id: "n-alpha", type: "text", x: 1, y: 1, width: 1, height: 1 });
    setNode(nodes, { id: "n-bravo", type: "text", x: 2, y: 2, width: 1, height: 1 });

    const data = buildCanvasData(nodes, edges);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual([
      "n-alpha",
      "n-bravo",
      "n-charlie",
    ]);
  });
});
