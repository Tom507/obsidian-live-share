// WP49 AC2 (blind set 1) — D17 with an ABSENT file on one side.
// Angle: the visible test diverges on content. Here vault B never wrote the file at
// all — the doc oracle is perfectly happy, and on disk one vault has a canvas and
// the other has nothing. Same verdict, same named reason.
import { describe, expect, it } from "vitest";

import {
  DOC_CONVERGED_FILE_DIVERGED,
  evaluateCanvasConvergence,
} from "../../testing/e2e-control";

const DOC = {
  nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "shared" }],
  edges: [],
};

const CONTENT = JSON.stringify(DOC, null, 2);

const PRESENT = {
  exists: true,
  sha256: "1".repeat(64),
  size: Buffer.byteLength(CONTENT, "utf8"),
  content: CONTENT,
};
const ABSENT = { exists: false, sha256: "", size: 0, content: null };

describe("WP49 AC2 blind1 — one vault has no file at all", () => {
  it("present vs absent is a file divergence, reported as the D17 class", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: DOC, file: PRESENT },
      { doc: DOC, file: ABSENT },
    );
    expect(verdict.docConverged).toBe(true);
    expect(verdict.fileConverged).toBe(false);
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).toBe(DOC_CONVERGED_FILE_DIVERGED);
  });

  it("the same holds with the roles swapped — the verdict is symmetric", () => {
    const verdict = evaluateCanvasConvergence(
      { doc: DOC, file: ABSENT },
      { doc: DOC, file: PRESENT },
    );
    expect(verdict.converged).toBe(false);
    expect(verdict.reason).toBe(DOC_CONVERGED_FILE_DIVERGED);
  });

  it("two files that differ only by a trailing newline still diverge — no normalisation", () => {
    const withNewline = { ...PRESENT, sha256: "2".repeat(64), size: PRESENT.size + 1, content: `${CONTENT}\n` };
    const verdict = evaluateCanvasConvergence(
      { doc: DOC, file: PRESENT },
      { doc: DOC, file: withNewline },
    );
    expect(verdict.fileConverged).toBe(false);
    expect(verdict.reason).toBe(DOC_CONVERGED_FILE_DIVERGED);
  });
});
