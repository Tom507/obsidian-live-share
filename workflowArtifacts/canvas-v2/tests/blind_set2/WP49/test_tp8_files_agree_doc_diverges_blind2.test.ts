// WP49 AC2 (blind set 2) — a doc that is a strict superset on one side.
// Angle: the visible test removes a node; here one side has everything the other has
// PLUS an extra record, which is the shape a missed delta actually takes. A verdict
// built on "every record of A is in B" instead of a set comparison passes this by
// accident in one direction, so the test asserts both directions.
import { describe, expect, it } from "vitest";

import {
  DOC_CONVERGED_FILE_DIVERGED,
  evaluateCanvasConvergence,
} from "../../testing/e2e-control";

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "alpha" };
const N2 = { id: "n2", type: "text", x: 400, y: 0, width: 250, height: 60, text: "beta" };
const N3 = { id: "n3", type: "text", x: 800, y: 0, width: 250, height: 60, text: "gamma" };

const CONTENT = JSON.stringify({ nodes: [N1, N2], edges: [] });
const FILE = {
  exists: true,
  sha256: "5".repeat(64),
  size: Buffer.byteLength(CONTENT, "utf8"),
  content: CONTENT,
};

describe("WP49 AC2 blind2 — a superset doc is a divergence in both directions", () => {
  it("A has the extra node", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [N1, N2, N3], edges: [] }, file: { ...FILE } },
      { doc: { nodes: [N1, N2], edges: [] }, file: { ...FILE } },
    );
    expect(verdict.docConverged).toBe(false);
    expect(verdict.fileConverged).toBe(true);
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).not.toBe(DOC_CONVERGED_FILE_DIVERGED);
  });

  it("B has the extra node", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [N1, N2], edges: [] }, file: { ...FILE } },
      { doc: { nodes: [N1, N2, N3], edges: [] }, file: { ...FILE } },
    );
    expect(verdict.docConverged).toBe(false);
    expect(verdict.converged).toBe(false);
  });

  it("a record present on both sides but with one extra key does not converge", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [N1], edges: [] }, file: { ...FILE } },
      { doc: { nodes: [{ ...N1, color: "4" }], edges: [] }, file: { ...FILE } },
    );
    expect(verdict.docConverged).toBe(false);
    expect(verdict.converged).toBe(false);
  });
});
