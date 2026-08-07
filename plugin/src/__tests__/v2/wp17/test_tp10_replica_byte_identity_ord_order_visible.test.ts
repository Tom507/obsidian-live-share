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
// WP17 AC3 — "Two replicas with the same doc state produce byte-identical
// files ..."
//
// Same technique as the frozen `v2/wp3/test_two_client_bytes_visible.test.ts`
// (different Y.Map integration order, different per-record key insertion
// order) but with ids picked so `ord` order is the EXACT REVERSE of `id`
// order — the WP3 fixture's ids happen to have no `ord` at all, so it can't
// tell an id-sort from an ord-sort apart. This one can: if either replica's
// serialiser silently fell back to id-sort (e.g. by still routing the final
// array through WP3's `canonicalizeCanvasData`, which re-sorts by id and
// discards a pre-sort), the two replicas would still agree with EACH OTHER
// but the shared output would be in the WRONG (id, not ord) order — so this
// test checks both: cross-replica equality AND the actual emitted order.
// ===========================================================================

interface Peer {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
}

const RECORDS: Record<string, { fields: Record<string, unknown>; ord: string }> = {
  "n-aaa": { fields: { id: "n-aaa", type: "text", x: 0, y: 0, width: 1, height: 1 }, ord: "T" },
  "n-mmm": { fields: { id: "n-mmm", type: "text", x: 1, y: 1, width: 1, height: 1 }, ord: "M" },
  "n-zzz": { fields: { id: "n-zzz", type: "text", x: 2, y: 2, width: 1, height: 1 }, ord: "B" },
};

function peer(order: string[], reverseKeys: boolean): Peer {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  doc.transact(() => {
    for (const id of order) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      const entries = Object.entries({ ...RECORDS[id].fields, ord: RECORDS[id].ord });
      for (const [key, value] of reverseKeys ? entries.reverse() : entries) record.set(key, value);
    }
  });
  return { nodes, edges };
}

describe("WP17 AC3 — byte-identical output across replicas, in ord order", () => {
  it("two differently-integrated replicas serialise to the same bytes, ordered by ord not id", () => {
    const replicaA = peer(["n-mmm", "n-zzz", "n-aaa"], false);
    const replicaB = peer(["n-aaa", "n-mmm", "n-zzz"], true);

    // Premise: the raw CRDT iteration orders really do differ.
    expect([...replicaA.nodes.keys()]).not.toEqual([...replicaB.nodes.keys()]);

    const textA = serializeCanvas(replicaA.nodes, replicaA.edges);
    const textB = serializeCanvas(replicaB.nodes, replicaB.edges);

    expect(textA).toBe(textB);

    const parsed = JSON.parse(textA) as { nodes: Array<{ id: string }> };
    expect(parsed.nodes.map((n) => n.id)).toEqual(["n-zzz", "n-mmm", "n-aaa"]);
  });
});
