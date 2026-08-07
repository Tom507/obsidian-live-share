// WP49 AC2 (blind set 1) — doc divergence in the EDGES, files identical.
// Angle: the visible test diverges on nodes. Edges are the collection where a
// dangling-edge prune can silently differ between the doc and what got serialised,
// so a doc-side edge divergence with identical bytes on disk is a realistic shape.
import { describe, expect, it } from "vitest";

import {
  DOC_CONVERGED_FILE_DIVERGED,
  evaluateCanvasConvergence,
} from "../../testing/e2e-control";

const NODES = [
  { id: "n1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "alpha" },
  { id: "n2", type: "text", x: 400, y: 0, width: 250, height: 60, text: "beta" },
];
const EDGE = { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" };

const CONTENT = JSON.stringify({ nodes: NODES, edges: [] }, null, 2);
const SAME_FILE = {
  exists: true,
  sha256: "7".repeat(64),
  size: Buffer.byteLength(CONTENT, "utf8"),
  content: CONTENT,
};

describe("WP49 AC2 blind1 — identical bytes, different edge sets in the docs", () => {
  it("fails the run without claiming the D17 class", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: NODES, edges: [EDGE] }, file: { ...SAME_FILE } },
      { doc: { nodes: NODES, edges: [] }, file: { ...SAME_FILE } },
    );
    expect(verdict.fileConverged).toBe(true);
    expect(verdict.docConverged).toBe(false);
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).not.toBe(DOC_CONVERGED_FILE_DIVERGED);
  });

  it("an edge that changed one endpoint is a divergence, not a match", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: NODES, edges: [EDGE] }, file: { ...SAME_FILE } },
      { doc: { nodes: NODES, edges: [{ ...EDGE, toSide: "top" }] }, file: { ...SAME_FILE } },
    );
    expect(verdict.docConverged).toBe(false);
    expect(verdict.converged).toBe(false);
  });

  it("both projections wrong at once is still a single not-converged verdict", () => {
    const other = { ...SAME_FILE, sha256: "8".repeat(64), content: `${CONTENT} ` };
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: NODES, edges: [EDGE] }, file: { ...SAME_FILE } },
      { doc: { nodes: [NODES[0]], edges: [] }, file: other },
    );
    expect(verdict.docConverged).toBe(false);
    expect(verdict.fileConverged).toBe(false);
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).not.toBe(DOC_CONVERGED_FILE_DIVERGED);
  });
});
