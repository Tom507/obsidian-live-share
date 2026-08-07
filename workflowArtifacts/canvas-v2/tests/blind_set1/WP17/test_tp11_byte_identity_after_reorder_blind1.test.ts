import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC3 blind1 — same claim as the visible test (byte-identical output
// survives a reorder), different angle: the reorder moves the FIRST record
// to the END (visible test moved the last one to the front), and there are
// four records instead of three.

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
  { id: "w", ord: "B" },
  { id: "x", ord: "F" },
  { id: "y", ord: "M" },
  { id: "z", ord: "T" },
];
// The reorder: "w" moves to the end. Every other ord is unchanged.
const AFTER = [
  { id: "w", ord: "Z" },
  { id: "x", ord: "F" },
  { id: "y", ord: "M" },
  { id: "z", ord: "T" },
];

describe("WP17 AC3 blind1 — byte identity survives moving the first record to the end", () => {
  it("agrees across replicas before and after, and the order actually flipped", () => {
    const beforeA = peer(BEFORE, [0, 1, 2, 3]);
    const beforeB = peer(BEFORE, [3, 1, 0, 2]);
    expect(serializeCanvas(beforeA.nodes, beforeA.edges)).toBe(
      serializeCanvas(beforeB.nodes, beforeB.edges),
    );

    const afterA = peer(AFTER, [0, 1, 2, 3]);
    const afterB = peer(AFTER, [2, 3, 1, 0]);
    const afterTextA = serializeCanvas(afterA.nodes, afterA.edges);
    const afterTextB = serializeCanvas(afterB.nodes, afterB.edges);
    expect(afterTextA).toBe(afterTextB);

    const afterIds = (JSON.parse(afterTextA) as { nodes: Array<{ id: string }> }).nodes.map(
      (n) => n.id,
    );
    expect(afterIds).toEqual(["x", "y", "z", "w"]);
  });
});
