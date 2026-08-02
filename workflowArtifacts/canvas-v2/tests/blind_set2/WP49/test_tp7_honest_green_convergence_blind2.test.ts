// WP49 AC2 (blind set 2) — the empty canvas.
// Angle: the degenerate case. Two empty canvases with identical empty files are the
// most common state at the start of a run, and an oracle that treats "nothing to
// compare" as a failure would make every run start red — or, worse, treat it as a
// pass by accident when only one side is empty.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  DOC_CONVERGED_FILE_DIVERGED,
  evaluateCanvasConvergence,
} from "../../testing/e2e-control";

const EMPTY_CONTENT = '{\n\t"nodes":[],\n\t"edges":[]\n}';

function obs(content: string) {
  return {
    exists: true,
    sha256: createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex"),
    size: Buffer.byteLength(content, "utf8"),
    content,
  };
}

describe("WP49 AC2 blind2 — empty canvases", () => {
  it("two empty docs with identical empty files converge", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [], edges: [] }, file: obs(EMPTY_CONTENT) },
      { doc: { nodes: [], edges: [] }, file: obs(EMPTY_CONTENT) },
    );
    expect(verdict.docConverged).toBe(true);
    expect(verdict.fileConverged).toBe(true);
    expect(verdict.converged).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("one empty doc and one populated doc do not converge", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [], edges: [] }, file: obs(EMPTY_CONTENT) },
      {
        doc: { nodes: [{ id: "n1", x: 0, y: 0, width: 10, height: 10 }], edges: [] },
        file: obs(EMPTY_CONTENT),
      },
    );
    expect(verdict.docConverged).toBe(false);
    expect(verdict.converged).toBe(false);
  });

  it("both docs empty but only one file written is still the D17 class", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: { nodes: [], edges: [] }, file: obs(EMPTY_CONTENT) },
      {
        doc: { nodes: [], edges: [] },
        file: { exists: false, sha256: "", size: 0, content: null },
      },
    );
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).toBe(DOC_CONVERGED_FILE_DIVERGED);
  });
});
