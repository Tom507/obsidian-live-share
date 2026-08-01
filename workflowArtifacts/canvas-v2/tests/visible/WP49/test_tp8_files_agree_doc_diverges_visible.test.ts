// WP49 / C49 AC2 — the inverse case.
//
// The file oracle is ADDITIONAL to the doc oracle, not a replacement for it (AC2:
// "in addition to the doc state"). When the bytes on disk happen to agree while the
// shared docs do not, the run must still fail — and it must NOT be reported as the
// D17 class, which is reserved for the case the doc oracle would have passed.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
// Pure: no doc, no clock, no filesystem, no CRDT tie-break.
import { describe, expect, it } from "vitest";

import {
  DOC_CONVERGED_FILE_DIVERGED,
  evaluateCanvasConvergence,
} from "../../testing/e2e-control";

const NODE_1 = { id: "n1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "alpha" };
const NODE_2 = { id: "n2", type: "text", x: 400, y: 0, width: 250, height: 60, text: "beta" };

// Both writers happen to hold the same (stale) bytes.
const FILE = JSON.stringify({ nodes: [NODE_1], edges: [] }, null, 2);
const SHARED = {
  exists: true,
  sha256: "d".repeat(64),
  size: Buffer.byteLength(FILE, "utf8"),
  content: FILE,
};

describe("WP49 AC2 — disk agrees but the docs do not → still a failed run", () => {
  it("converged:false with docConverged:false and fileConverged:true", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [NODE_1, NODE_2], edges: [] }, file: { ...SHARED } },
      { doc: { nodes: [NODE_1], edges: [] }, file: { ...SHARED } },
    );

    expect(verdict.fileConverged).toBe(true);
    expect(verdict.docConverged).toBe(false);
    expect(verdict.converged).toBe(false);
  });

  it("is not misreported as the D17 class", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [NODE_1, NODE_2], edges: [] }, file: { ...SHARED } },
      { doc: { nodes: [NODE_1], edges: [] }, file: { ...SHARED } },
    );
    expect(verdict.reason).not.toBe(DOC_CONVERGED_FILE_DIVERGED);
    expect(verdict.reason).toBeNull();
  });

  it("a single differing geometry value on one node is enough to break doc convergence", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [NODE_1], edges: [] }, file: { ...SHARED } },
      { doc: { nodes: [{ ...NODE_1, x: 12 }], edges: [] }, file: { ...SHARED } },
    );
    expect(verdict.docConverged).toBe(false);
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).not.toBe(DOC_CONVERGED_FILE_DIVERGED);
  });
});
