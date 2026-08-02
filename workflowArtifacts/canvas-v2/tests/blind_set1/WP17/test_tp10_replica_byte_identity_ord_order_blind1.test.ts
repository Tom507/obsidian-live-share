import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC3 blind1 — same claim as the visible test (byte-identical output
// across replicas, ordered by ord not id), different angle: EDGES are
// included this time, with their own ords diverging from their ids, and the
// two replicas differ in edge insertion order as well as node order.

interface Peer {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
}

function fillNode(
  target: Y.Map<Y.Map<unknown>>,
  fields: Record<string, unknown>,
  reverseKeys: boolean,
): void {
  const record = new Y.Map<unknown>();
  target.set(fields.id as string, record);
  const entries = Object.entries(fields);
  for (const [key, value] of reverseKeys ? entries.reverse() : entries) record.set(key, value);
}

function peer(nodeOrder: string[], edgeOrder: string[], reverseKeys: boolean): Peer {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  const nodeFields: Record<string, Record<string, unknown>> = {
    "n-x": { id: "n-x", type: "text", x: 0, y: 0, width: 1, height: 1, ord: "T" },
    "n-y": { id: "n-y", type: "text", x: 1, y: 1, width: 1, height: 1, ord: "M" },
  };
  const edgeFields: Record<string, Record<string, unknown>> = {
    "e-p": { id: "e-p", fromNode: "n-x", fromSide: "right", toNode: "n-y", toSide: "left", ord: "L" },
    "e-q": { id: "e-q", fromNode: "n-y", fromSide: "right", toNode: "n-x", toSide: "left", ord: "C" },
  };
  doc.transact(() => {
    for (const id of nodeOrder) fillNode(nodes, nodeFields[id], reverseKeys);
    for (const id of edgeOrder) fillNode(edges, edgeFields[id], reverseKeys);
  });
  return { nodes, edges };
}

describe("WP17 AC3 blind1 — byte-identical output including edges, ordered by ord", () => {
  it("two replicas with different node AND edge integration order still agree, ord-first", () => {
    const replicaA = peer(["n-x", "n-y"], ["e-p", "e-q"], false);
    const replicaB = peer(["n-y", "n-x"], ["e-q", "e-p"], true);

    const textA = serializeCanvas(replicaA.nodes, replicaA.edges);
    const textB = serializeCanvas(replicaB.nodes, replicaB.edges);
    expect(textA).toBe(textB);

    const parsed = JSON.parse(textA) as {
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string }>;
    };
    expect(parsed.nodes.map((n) => n.id)).toEqual(["n-y", "n-x"]); // ord M < T
    expect(parsed.edges.map((e) => e.id)).toEqual(["e-q", "e-p"]); // ord C < L
  });
});
