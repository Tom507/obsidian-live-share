import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanvas } from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC3 — "... including after a reorder."
//
// Two replicas start in the SAME order, then both receive the identical
// `ord` reassignment for a reorder (as WP13's allocator/`deriveOrdAssignments`
// would produce and propagate via the CRDT) — built independently here, with
// different Y.Map integration order, to simulate two clients converging.
// The test checks THREE things: the pre-reorder bytes agree, the
// post-reorder bytes agree, and the post-reorder bytes are actually
// DIFFERENT from the pre-reorder bytes and reflect the new sequence — so an
// implementation that produces byte equality only by ignoring `ord`
// entirely (e.g. always falling back to id order) cannot pass this test.
// ===========================================================================

interface Peer {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
}

function peer(records: Array<{ id: string; ord: string }>, insertOrder: number[]): Peer {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  doc.transact(() => {
    for (const index of insertOrder) {
      const { id, ord } = records[index];
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("type", "text");
      record.set("x", 0);
      record.set("y", 0);
      record.set("width", 1);
      record.set("height", 1);
      record.set("ord", ord);
    }
  });
  return { nodes, edges };
}

const BEFORE = [
  { id: "n-a", ord: "B" },
  { id: "n-b", ord: "M" },
  { id: "n-c", ord: "T" },
];
// The reorder: n-c moves to the front. Only its ord changes (minimal
// reassignment, WP16's own policy) — n-a and n-b keep their ords.
const AFTER = [
  { id: "n-a", ord: "B" },
  { id: "n-b", ord: "M" },
  { id: "n-c", ord: "A" },
];

describe("WP17 AC3 — byte-identical output across replicas survives a reorder", () => {
  it("agrees before the reorder, agrees after, and the order actually changed", () => {
    const beforeA = peer(BEFORE, [0, 1, 2]);
    const beforeB = peer(BEFORE, [2, 0, 1]);
    const beforeTextA = serializeCanvas(beforeA.nodes, beforeA.edges);
    const beforeTextB = serializeCanvas(beforeB.nodes, beforeB.edges);
    expect(beforeTextA).toBe(beforeTextB);
    expect((JSON.parse(beforeTextA) as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)).toEqual(
      ["n-a", "n-b", "n-c"],
    );

    const afterA = peer(AFTER, [0, 1, 2]);
    const afterB = peer(AFTER, [1, 2, 0]);
    const afterTextA = serializeCanvas(afterA.nodes, afterA.edges);
    const afterTextB = serializeCanvas(afterB.nodes, afterB.edges);
    expect(afterTextA).toBe(afterTextB);

    const afterIds = (JSON.parse(afterTextA) as { nodes: Array<{ id: string }> }).nodes.map(
      (n) => n.id,
    );
    expect(afterIds).toEqual(["n-c", "n-a", "n-b"]);
    expect(afterTextA).not.toBe(beforeTextA);
  });
});
