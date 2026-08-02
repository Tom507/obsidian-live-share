import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC3 blind2 — same claim as the visible test (byte identity survives
// a reorder), different angle: a full REVERSAL of a three-record sequence
// (every ord changes, not just one record's), and the "after" replicas
// additionally vary per-record key insertion order (not just record
// insertion order), matching the P0 `test_two_client_bytes_visible` style.

interface Peer {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
}

function peer(
  records: Array<{ id: string; ord: string }>,
  insertOrder: number[],
  reverseKeys: boolean,
): Peer {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  doc.transact(() => {
    for (const index of insertOrder) {
      const { id, ord } = records[index];
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      const entries = Object.entries({
        id,
        type: "text",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        ord,
      });
      for (const [key, value] of reverseKeys ? entries.reverse() : entries) record.set(key, value);
    }
  });
  return { nodes, edges };
}

const BEFORE = [
  { id: "p", ord: "B" },
  { id: "q", ord: "M" },
  { id: "r", ord: "T" },
];
// Full reversal: every ord changes.
const AFTER = [
  { id: "p", ord: "T" },
  { id: "q", ord: "M" },
  { id: "r", ord: "B" },
];

describe("WP17 AC3 blind2 — byte identity survives a full three-record reversal", () => {
  it("agrees before, agrees after full reversal, and the order is exactly reversed", () => {
    const beforeA = peer(BEFORE, [0, 1, 2], false);
    const beforeB = peer(BEFORE, [2, 0, 1], true);
    const beforeTextA = serializeCanvas(beforeA.nodes, beforeA.edges);
    expect(beforeTextA).toBe(serializeCanvas(beforeB.nodes, beforeB.edges));
    expect((JSON.parse(beforeTextA) as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)).toEqual(
      ["p", "q", "r"],
    );

    const afterA = peer(AFTER, [0, 1, 2], false);
    const afterB = peer(AFTER, [1, 0, 2], true);
    const afterTextA = serializeCanvas(afterA.nodes, afterA.edges);
    const afterTextB = serializeCanvas(afterB.nodes, afterB.edges);
    expect(afterTextA).toBe(afterTextB);

    const afterIds = (JSON.parse(afterTextA) as { nodes: Array<{ id: string }> }).nodes.map(
      (n) => n.id,
    );
    expect(afterIds).toEqual(["r", "q", "p"]);
    expect(afterTextA).not.toBe(beforeTextA);
  });
});
