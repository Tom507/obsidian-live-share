// WP16 AC2 blind1 — same claim as the visible test (zero churn on an
// unchanged document), different angle: exercises BOTH record kinds at once
// (five nodes and two edges) so a fix that only special-cases the node path
// (or only the edge path) is still caught.

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../../../plugin/src/canvas/canvas-ord";
import { deriveOrdAssignments, parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

function node(id: string, n: number) {
  return { id, x: n, y: n, width: 5, height: 5, type: "text", text: id };
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

describe("WP16 AC2 blind1 — zero churn on an unchanged document, both node and edge kinds", () => {
  it("neither node ord nor edge ord is touched by reparsing the same five-node, two-edge document", () => {
    const rng = makeRng(4242);
    const content = JSON.stringify({
      nodes: [node("n1", 1), node("n2", 2), node("n3", 3), node("n4", 4), node("n5", 5)],
      edges: [
        { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" },
        { id: "e2", fromNode: "n2", fromSide: "right", toNode: "n3", toSide: "left" },
      ],
    });

    const first = parseCanvas(content);

    const nodeBaselineMap = deriveOrdAssignments([], first.order.nodes, "client-a", rng);
    const edgeBaselineMap = deriveOrdAssignments([], first.order.edges, "client-a", rng);
    const nodePrevious: OrdIdEntry[] = first.order.nodes.map((id) => ({
      id,
      ord: nodeBaselineMap.get(id)!,
    }));
    const edgePrevious: OrdIdEntry[] = first.order.edges.map((id) => ({
      id,
      ord: edgeBaselineMap.get(id)!,
    }));

    const second = parseCanvas(content);

    const nodeReassignments = deriveOrdAssignments(nodePrevious, second.order.nodes, "client-a", rng);
    const edgeReassignments = deriveOrdAssignments(edgePrevious, second.order.edges, "client-a", rng);

    expect(nodeReassignments.size).toBe(0);
    expect(edgeReassignments.size).toBe(0);
  });
});
