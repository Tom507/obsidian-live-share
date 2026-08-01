// WP49 AC2 (blind set 1) — green on a richer canvas, and the verdict's own shape.
// Angle: the visible test uses two nodes and one edge. Here the canvas carries a
// group, a file node and two edges, and the test also pins the verdict object shape
// so a caller can branch on it without guessing.
import { describe, expect, it } from "vitest";

import { evaluateCanvasConvergence } from "../../testing/e2e-control";

const NODES = [
  { id: "g1", type: "group", x: -40, y: -40, width: 900, height: 400, label: "Sprint" },
  { id: "n1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "alpha" },
  { id: "n2", type: "file", x: 400, y: 0, width: 250, height: 60, file: "notes/beta.md" },
];
const EDGES = [
  { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" },
  { id: "e2", fromNode: "n2", fromSide: "bottom", toNode: "n1", toSide: "bottom" },
];

const CONTENT = JSON.stringify({ nodes: NODES, edges: EDGES }, null, 2);
const FILE = {
  exists: true,
  sha256: "9".repeat(64),
  size: Buffer.byteLength(CONTENT, "utf8"),
  content: CONTENT,
};

describe("WP49 AC2 blind1 — a rich canvas that genuinely converged", () => {
  it("groups, file nodes and multiple edges all converge", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: NODES, edges: EDGES }, file: { ...FILE } },
      { doc: { nodes: NODES, edges: EDGES }, file: { ...FILE } },
    );
    expect(verdict.converged).toBe(true);
    expect(verdict.docConverged).toBe(true);
    expect(verdict.fileConverged).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("the verdict exposes exactly the four documented fields", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: NODES, edges: EDGES }, file: { ...FILE } },
      { doc: { nodes: NODES, edges: EDGES }, file: { ...FILE } },
    );
    expect(Object.keys(verdict).sort()).toEqual(
      ["converged", "docConverged", "fileConverged", "reason"].sort(),
    );
  });

  it("edge array order does not affect the doc verdict", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: NODES, edges: EDGES }, file: { ...FILE } },
      { doc: { nodes: NODES, edges: [EDGES[1], EDGES[0]] }, file: { ...FILE } },
    );
    expect(verdict.converged).toBe(true);
  });
});
