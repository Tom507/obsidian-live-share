// WP49 / C49 AC2 — the D17 defect class, which is the whole reason this WP exists.
//
// On the lightweight host the doc IS the system. On real Obsidian the doc, the view
// and the file are three projections and only the file is durable. A doc-only oracle
// therefore goes green while the two vaults hold different bytes on disk. That run
// must FAIL, and it must fail under the named reason `DOC_CONVERGED_FILE_DIVERGED`
// (T3 contract §7) — never as a bare exception and never as "passed".
//
// Required surface (WP49): a pure exported verdict function over one `canvas.state`
// result plus one `canvas.file` result per instance, and the reason string mirrored
// verbatim from the contract enum.
//
// Staged to `plugin/src/__tests__/wp49/`, so relative imports are `../../testing/...`.
// Pure: no doc, no clock, no filesystem, no CRDT tie-break.
import { describe, expect, it } from "vitest";

import {
  DOC_CONVERGED_FILE_DIVERGED,
  evaluateCanvasConvergence,
} from "../../testing/e2e-control";

const NODES = [
  { id: "n1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "alpha" },
  { id: "n2", type: "text", x: 400, y: 0, width: 250, height: 60, text: "beta" },
];

/** What vault A's writer actually put on disk. */
const FILE_A = JSON.stringify({ nodes: NODES, edges: [] }, null, 2);
/** Vault B's writer never caught up: n2 is still at its pre-move x. */
const FILE_B = JSON.stringify(
  { nodes: [NODES[0], { ...NODES[1], x: 120 }], edges: [] },
  null,
  2,
);

function fileObs(content: string, sha256: string) {
  return { exists: true, sha256, size: Buffer.byteLength(content, "utf8"), content };
}

describe("WP49 AC2 — doc converged, disk diverged → the run fails (D17)", () => {
  it("reports not-converged with the named DOC_CONVERGED_FILE_DIVERGED reason", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: NODES, edges: [] }, file: fileObs(FILE_A, "a".repeat(64)) },
      { doc: { nodes: NODES, edges: [] }, file: fileObs(FILE_B, "b".repeat(64)) },
    );

    expect(verdict.docConverged).toBe(true);
    expect(verdict.fileConverged).toBe(false);
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).toBe(DOC_CONVERGED_FILE_DIVERGED);
  });

  it("the reason string is the contract enum value verbatim", () => {
    expect(DOC_CONVERGED_FILE_DIVERGED).toBe("DOC_CONVERGED_FILE_DIVERGED");
  });

  it("a doc-only oracle would have passed this exact case — that is the defect", () => {
    // Same inputs, doc side only: identical. Proving the doc oracle is blind here is
    // what makes the file oracle load-bearing rather than decorative.
    const docOnlyA = JSON.stringify({ nodes: NODES, edges: [] });
    const docOnlyB = JSON.stringify({ nodes: NODES, edges: [] });
    expect(docOnlyA).toBe(docOnlyB);

    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: NODES, edges: [] }, file: fileObs(FILE_A, "a".repeat(64)) },
      { doc: { nodes: NODES, edges: [] }, file: fileObs(FILE_B, "b".repeat(64)) },
    );
    expect(verdict.converged).toBe(false);
  });
});
