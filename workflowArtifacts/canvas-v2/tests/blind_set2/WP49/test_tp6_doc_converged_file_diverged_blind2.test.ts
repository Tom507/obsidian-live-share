// WP49 AC2 (blind set 2) — same size, different bytes.
// Angle: the cheapest possible file comparison is `size`, and it is wrong. Here both
// vaults wrote files of identical byte length whose content differs by a single
// coordinate digit — the doc oracle passes, a size-based file oracle passes, and the
// run is still the D17 defect. Only a digest/byte comparison catches it.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  DOC_CONVERGED_FILE_DIVERGED,
  evaluateCanvasConvergence,
} from "../../testing/e2e-control";

const DOC = {
  nodes: [{ id: "n1", type: "text", x: 100, y: 0, width: 250, height: 60, text: "same" }],
  edges: [],
};

const CONTENT_A = '{"nodes":[{"id":"n1","x":100,"y":0}],"edges":[]}';
const CONTENT_B = '{"nodes":[{"id":"n1","x":900,"y":0}],"edges":[]}';

function obs(content: string) {
  return {
    exists: true,
    sha256: createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex"),
    size: Buffer.byteLength(content, "utf8"),
    content,
  };
}

describe("WP49 AC2 blind2 — equal size is not equal content", () => {
  it("the fixture really is same-size, different-bytes", () => {
    expect(obs(CONTENT_A).size).toBe(obs(CONTENT_B).size);
    expect(obs(CONTENT_A).sha256).not.toBe(obs(CONTENT_B).sha256);
  });

  it("is caught and named as the D17 class", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: DOC, file: obs(CONTENT_A) },
      { doc: DOC, file: obs(CONTENT_B) },
    );
    expect(verdict.docConverged).toBe(true);
    expect(verdict.fileConverged).toBe(false);
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).toBe(DOC_CONVERGED_FILE_DIVERGED);
  });

  it("identical bytes on both sides of the same fixture do converge (control)", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: DOC, file: obs(CONTENT_A) },
      { doc: DOC, file: obs(CONTENT_A) },
    );
    expect(verdict.converged).toBe(true);
    expect(verdict.reason).toBeNull();
  });
});
