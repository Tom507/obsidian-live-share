// WP123 tp01 — THE INSTRUMENT GAP, EXECUTED. Workflow §3.9.
//
// Every row in this file was written and run GREEN against UNMODIFIED HEAD
// (`eb16fa5`), before a line of the records clause existed. That ordering is what
// makes it a demonstration of the gap rather than a test of the repair, and it is
// why the rows below assert the OLD behaviour rather than the new one.
//
// Three claims, none of them argued:
//
//   ├── tp01a  the same records have three byte spellings, and the oracle this
//   │            rig ships calls two of them DIVERGED
//   ├── tp01b  `contains` — the only clause that can name a coordinate today —
//   │            is RED for a board that is in sync, which is §3.2 executed
//   └── tp01c  `parseCanvas` degrades to empty and never throws, so the naive
//                "parse both sides, compare records" reads EQUAL for two files
//                NEITHER OF WHICH COULD BE READ. This is BK1's failure mode, and
//                it is demonstrated here on production code before the clause
//                that has to defend against it exists.
//
// These rows stay green after the repair too — they are statements about the
// PRE-EXISTING surfaces (`evaluatePeerAgreement`, `contains`, `parseCanvas`),
// none of which WP123 changes. If one of them ever goes red, the premise of the
// package changed and this report is stale.

import { describe, expect, it } from "vitest";

import { parseCanvas, parseCanvasReport, decodeCanvasDataToFlat } from "../../../files/canvas-sync";
import {
  CONVERGENCE_VERDICT,
  evaluatePeerAgreement,
  judgeConvergence,
} from "../../../testing/e2e-control";
import {
  AUTHORED_GEOMETRY,
  MOVED_N1,
  SAME_RECORDS,
  SPELLING_AUTHOR,
  SPELLING_CANONICAL,
  SPELLING_OBSIDIAN,
  UNPARSEABLE,
  reading,
  sha256,
} from "./boards";

const flatNodes = (content: string): Record<string, Record<string, unknown>> =>
  decodeCanvasDataToFlat(parseCanvas(content)).nodes;

describe("WP123 tp01 — the gap the instrument closes, demonstrated on unmodified HEAD", () => {
  it("tp01a: three byte spellings, ONE set of records — and the shipped oracle calls them DIVERGED", () => {
    // The premise, measured rather than quoted: three different byte forms.
    const digests = new Set(SAME_RECORDS.map(sha256));
    const sizes = SAME_RECORDS.map((s) => Buffer.byteLength(s, "utf8"));
    expect(digests.size).toBe(3);
    expect(new Set(sizes).size).toBe(3);

    // ...carrying records that production's own parser reads as identical.
    const [a, b, c] = SAME_RECORDS.map(flatNodes);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    for (const [id, geometry] of Object.entries(AUTHORED_GEOMETRY)) {
      expect(a[id]).toMatchObject(geometry);
    }

    // THE GAP. `peersAgree` is `sameFileObservation`, which compares sha256,
    // size AND content, so two peers holding the same board in two spellings
    // read as disagreeing.
    const peers = SAME_RECORDS.map((s, i) => reading(`peer-${i}`, s));
    expect(evaluatePeerAgreement(peers).agree).toBe(false);

    const judgement = judgeConvergence(peers, {
      origin: "the board this test authored, written down before any peer was read",
      exists: true,
      atLeastBytes: 100,
    });
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.DIVERGED);
    expect(judgement.converged).toBe(false);
    // Every clause the caller COULD state is satisfied. The board is in sync and
    // the oracle says otherwise, for reasons that are entirely about spelling.
    expect(judgement.violations).toStrictEqual([]);
  });

  it("tp01b: `contains` is a byte oracle wearing a record's clothes (§3.2)", () => {
    // The only way to name a coordinate in the pre-WP123 expectation vocabulary.
    const stated = { origin: "the round moved n1 to x=100", exists: true, contains: ['"x": 100'] };

    // GREEN for the author's spelling...
    const author = judgeConvergence([reading("a", SPELLING_AUTHOR), reading("b", SPELLING_AUTHOR)], stated);
    expect(author.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);

    // ...RED for the canonical spelling of the SAME x. `"x":100` is not `"x": 100`.
    expect(flatNodes(SPELLING_CANONICAL).n1.x).toBe(100);
    const canonical = judgeConvergence(
      [reading("a", SPELLING_CANONICAL), reading("b", SPELLING_CANONICAL)],
      stated,
    );
    expect(canonical.verdict).toBe(CONVERGENCE_VERDICT.AGREED_ON_WRONG_BYTES);
    expect(canonical.violations).toStrictEqual(["contains"]);

    // ...and GREEN for Obsidian's spelling of a board where n1 was MOVED, because
    // the substring it was told to look for is not the one that moved.
    expect(flatNodes(MOVED_N1).n1.y).toBe(399);
    const moved = judgeConvergence([reading("a", MOVED_N1), reading("b", MOVED_N1)], stated);
    expect(moved.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
  });

  it("tp01c: BK1's failure mode, on production code — `parseCanvas` degrades to empty and never throws", () => {
    // The trap named in the charter, executed rather than described.
    expect(() => parseCanvas(UNPARSEABLE)).not.toThrow();
    expect(parseCanvas(UNPARSEABLE).nodes).toStrictEqual({});
    // The one fact that separates "the board is empty" from "the bytes were not
    // readable" exists, and it is on the REPORT, not on `parseCanvas`.
    expect(parseCanvasReport(UNPARSEABLE).degraded).toBe(true);
    expect(Object.keys(parseCanvas(SPELLING_OBSIDIAN).nodes)).toStrictEqual(["n1", "n2"]);

    // THE VACUOUS COMPOSITION, spelt out: "parse both sides, compare records"
    // returns EQUAL for two files neither of which could be read.
    const naiveEqual = (l: string, r: string) =>
      JSON.stringify(flatNodes(l)) === JSON.stringify(flatNodes(r));
    expect(naiveEqual(UNPARSEABLE, '{"nodes":[{"id":"n9",')).toBe(true);
    // ...so an oracle built out of it is green on a board it never examined.

    // AND THE SECOND HALF, found by running this row rather than by reasoning:
    // a whole-record comparison done by serialising the parsed record is STILL a
    // spelling oracle. The flat record preserves the source's KEY ORDER, so the
    // author's and the canonical spelling of one identical board serialise
    // differently — W2's objection to `recordSignature` (which sorts keys but
    // hashes every one of them) is the same defect one level up. This is the
    // measured reason the clause compares NAMED FIELDS and nothing else.
    expect(naiveEqual(SPELLING_AUTHOR, SPELLING_CANONICAL)).toBe(false);
    expect(flatNodes(SPELLING_CANONICAL)).toEqual(flatNodes(SPELLING_AUTHOR));
  });
});
