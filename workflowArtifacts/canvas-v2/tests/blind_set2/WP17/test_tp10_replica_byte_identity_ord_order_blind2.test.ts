import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC3 blind2 — same claim as the visible test (byte-identical output
// across replicas, ordered by ord not id), different angle: FIVE records
// and a THIRD replica (not just two), so pairwise agreement is checked
// across all three, and per-record key insertion order also differs on the
// third replica.

interface Peer {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
}

const RECORDS: Record<string, { fields: Record<string, unknown>; ord: string }> = {
  r1: { fields: { id: "r1", type: "text", x: 0, y: 0, width: 1, height: 1 }, ord: "5" },
  r2: { fields: { id: "r2", type: "text", x: 1, y: 1, width: 1, height: 1 }, ord: "3" },
  r3: { fields: { id: "r3", type: "text", x: 2, y: 2, width: 1, height: 1 }, ord: "1" },
  r4: { fields: { id: "r4", type: "text", x: 3, y: 3, width: 1, height: 1 }, ord: "4" },
  r5: { fields: { id: "r5", type: "text", x: 4, y: 4, width: 1, height: 1 }, ord: "2" },
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

describe("WP17 AC3 blind2 — byte identity holds pairwise across three differently-integrated replicas", () => {
  it("five records, ord order unrelated to id or insertion order, agree on all three replicas", () => {
    const replicaA = peer(["r1", "r2", "r3", "r4", "r5"], false);
    const replicaB = peer(["r5", "r4", "r3", "r2", "r1"], true);
    const replicaC = peer(["r3", "r1", "r5", "r2", "r4"], false);

    const textA = serializeCanvas(replicaA.nodes, replicaA.edges);
    const textB = serializeCanvas(replicaB.nodes, replicaB.edges);
    const textC = serializeCanvas(replicaC.nodes, replicaC.edges);

    expect(textA).toBe(textB);
    expect(textB).toBe(textC);

    const parsed = JSON.parse(textA) as { nodes: Array<{ id: string }> };
    // ord ascending: r3(1) < r5(2) < r2(3) < r4(4) < r1(5)
    expect(parsed.nodes.map((n) => n.id)).toEqual(["r3", "r5", "r2", "r4", "r1"]);
  });
});
