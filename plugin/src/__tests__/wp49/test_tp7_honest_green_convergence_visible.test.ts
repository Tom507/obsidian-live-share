// WP49 / C49 AC2 — the honest-green case.
//
// An oracle that only ever fails is worthless. When the two instances hold the same
// doc AND their writers produced the same bytes, the verdict must be converged with
// no reason. Doc comparison stays order-independent and id-keyed (mirroring the
// existing `_compare` in the MCP driver); file comparison stays byte/digest exact —
// nothing is normalised to make the comparison succeed (charter §2 non-goal).
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
// Pure: no doc, no clock, no filesystem, no CRDT tie-break.
import { describe, expect, it } from "vitest";

import { evaluateCanvasConvergence } from "../../testing/e2e-control";

const NODE_1 = { id: "n1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "alpha" };
const NODE_2 = { id: "n2", type: "text", x: 400, y: 0, width: 250, height: 60, text: "beta" };
const EDGE_1 = { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" };

const FILE = JSON.stringify({ nodes: [NODE_1, NODE_2], edges: [EDGE_1] }, null, 2);
const FILE_SHA = "c".repeat(64);

function fileObs() {
  return {
    exists: true,
    sha256: FILE_SHA,
    size: Buffer.byteLength(FILE, "utf8"),
    content: FILE,
  };
}

describe("WP49 AC2 — doc converged and disk converged → green", () => {
  it("converged:true with no reason when both projections agree", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [NODE_1, NODE_2], edges: [EDGE_1] }, file: fileObs() },
      { doc: { nodes: [NODE_1, NODE_2], edges: [EDGE_1] }, file: fileObs() },
    );

    expect(verdict.docConverged).toBe(true);
    expect(verdict.fileConverged).toBe(true);
    expect(verdict.converged).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("doc comparison is id-keyed and order-independent, not array-order sensitive", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [NODE_1, NODE_2], edges: [EDGE_1] }, file: fileObs() },
      { doc: { nodes: [NODE_2, NODE_1], edges: [EDGE_1] }, file: fileObs() },
    );
    expect(verdict.docConverged).toBe(true);
    expect(verdict.converged).toBe(true);
  });

  it("record key order does not affect the doc verdict either", () => {
    const reordered = { height: 60, width: 250, y: 0, x: 0, text: "alpha", type: "text", id: "n1" };
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [NODE_1], edges: [] }, file: fileObs() },
      { doc: { nodes: [reordered], edges: [] }, file: fileObs() },
    );
    expect(verdict.docConverged).toBe(true);
    expect(verdict.converged).toBe(true);
  });
});
