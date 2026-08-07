// WP16 AC2 blind2 — same claim, different angle: the append happens on the
// EDGE kind while the NODE kind is independently unchanged in the same
// document, proving the two record kinds are reassigned independently (an
// edge append must not touch node ords and vice versa).

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../../../plugin/src/canvas/canvas-ord";
import { deriveOrdAssignments, parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("WP16 AC2 blind2 — appending an edge does not touch node ords, and vice versa", () => {
  it("a new edge appended alongside unchanged nodes reassigns only the new edge", () => {
    const rng = makeRng(3003);
    const nodesJson = [
      { id: "n1", x: 0, y: 0, width: 10, height: 10, type: "text", text: "N1" },
      { id: "n2", x: 20, y: 20, width: 10, height: 10, type: "text", text: "N2" },
    ];

    const before = parseCanvas(
      JSON.stringify({
        nodes: nodesJson,
        edges: [{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" }],
      }),
    );
    const nodeBaseline = deriveOrdAssignments([], before.order.nodes, "client-3", rng);
    const edgeBaseline = deriveOrdAssignments([], before.order.edges, "client-3", rng);
    const nodePrevious: OrdIdEntry[] = before.order.nodes.map((id) => ({
      id,
      ord: nodeBaseline.get(id)!,
    }));
    const edgePrevious: OrdIdEntry[] = before.order.edges.map((id) => ({
      id,
      ord: edgeBaseline.get(id)!,
    }));

    const after = parseCanvas(
      JSON.stringify({
        nodes: nodesJson, // unchanged
        edges: [
          { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" },
          { id: "e2", fromNode: "n2", fromSide: "right", toNode: "n1", toSide: "left" },
        ],
      }),
    );

    const nodeReassignments = deriveOrdAssignments(nodePrevious, after.order.nodes, "client-3", rng);
    const edgeReassignments = deriveOrdAssignments(edgePrevious, after.order.edges, "client-3", rng);

    expect(nodeReassignments.size).toBe(0);
    expect([...edgeReassignments.keys()]).toEqual(["e2"]);
  });
});
