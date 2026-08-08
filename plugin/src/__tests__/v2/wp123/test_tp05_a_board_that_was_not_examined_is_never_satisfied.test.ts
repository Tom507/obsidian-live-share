// WP123 tp05 / tp06 — A5 and A6. THE PACKAGE'S OWN FAILURE MODE, AND S155.
//
// 🔴 A5 IS THE DISCRIMINATOR OF THIS WHOLE PACKAGE. The instrument being built
// exists to stop greens that cannot fail; the way IT would produce one is by
// reporting `satisfied` for a board it never read. `parseCanvas` degrades to
// empty records and never throws, so "parse both sides, compare" answers EQUAL
// for two files NEITHER OF WHICH COULD BE READ.
//
// tp05d is BK1's row: two peers holding byte-identical UNPARSEABLE content —
// which means `peersAgree` (bytes) is TRUE — must not come back agreeing on
// records. If that row ever goes green while the readability guard is removed,
// every verdict this oracle has ever produced is worthless.
//
// A6 is tp06: the records row exists in EVERY branch, `stated:false /
// satisfied:null` when nobody asked, including the branch with no peer reading
// at all, and `satisfied` is null exactly when `stated` is false.

import { describe, expect, it } from "vitest";

import {
  CONVERGENCE_VERDICT,
  type ExpectedContent,
  evaluatePeerAgreement,
  evaluateRecordAgreement,
  judgeConvergence,
  judgeFileAgainstExpectation,
  readCanvasRecords,
  routeCommand,
} from "../../../testing/e2e-control";
import {
  NO_NODES_KEY,
  SPELLING_AUTHOR,
  UNPARSEABLE,
  reading,
} from "./boards";

const STATED: ExpectedContent = {
  origin: "the round authored n1 at (100,200) and is asking whether it is still there",
  records: { nodes: [{ id: "n1", x: 100, y: 200 }] },
};

const recordsClause = (j: { clauses: { clause: string }[] }) =>
  j.clauses.find((c) => c.clause === "records") as {
    clause: string;
    stated: boolean;
    satisfied: boolean | null;
    detail: string;
  };

describe("WP123 tp05 — A5: a board that was not examined never reads as satisfied", () => {
  it("tp05a: `content: null` — nothing came back, so nothing is satisfied", () => {
    const j = judgeConvergence(
      [reading("a", null), reading("b", null)],
      STATED,
    );
    expect(j.converged).toBe(false);
    expect(j.violations).toContain("records");
    const clause = recordsClause(j);
    expect(clause.stated).toBe(true);
    expect(clause.satisfied).toBe(false);
    expect(clause.detail).toContain("NOT EXAMINED");
    expect(j.peersAgreeOnRecords).toBe(false);
  });

  it("tp05b: an ABSENT file is not an empty board", () => {
    const absent = { peer: "a", file: { exists: false, sha256: "", size: 0, content: null } };
    const j = judgeConvergence([absent, { ...absent, peer: "b" }], STATED);
    expect(j.converged).toBe(false);
    expect(recordsClause(j).satisfied).toBe(false);
    expect(j.peersAgreeOnRecords).toBe(false);
  });

  it("tp05c: UNPARSEABLE JSON — `parseCanvas` degrades to empty and the clause refuses it", () => {
    const j = judgeConvergence(
      [reading("a", UNPARSEABLE), reading("b", UNPARSEABLE)],
      STATED,
    );
    expect(j.converged).toBe(false);
    expect(recordsClause(j).satisfied).toBe(false);
    expect(recordsClause(j).detail).toContain("DEGRADED");
    // The reading itself says so, so a caller can tell the two empties apart.
    const read = readCanvasRecords(reading("a", UNPARSEABLE).file);
    expect(read.readable).toBe(false);
    expect(read.nodes).toStrictEqual({});
  });

  it("tp05d: 🔴 BK1's ROW — two peers neither of which could be read do NOT agree on records", () => {
    const peers = [reading("a", UNPARSEABLE), reading("b", UNPARSEABLE)];
    // The trap, set: byte-identical unreadable content. The BYTE oracle says the
    // peers agree perfectly, exactly as S119's three clients did.
    expect(evaluatePeerAgreement(peers).agree).toBe(true);

    const j = judgeConvergence(peers, STATED);
    // ...and the record oracle refuses to claim agreement about a board it never
    // examined. This is the naive "parse both, compare" composition, refused.
    expect(j.peersAgreeOnRecords).toBe(false);
    expect(j.peersAgree).toBe(true);
    expect(j.verdict).toBe(CONVERGENCE_VERDICT.DIVERGED);
    expect(j.converged).toBe(false);
    expect(j.reason).toContain("could not be read");
  });

  it("tp05e: well-formed JSON with NO `nodes` array is not a board either", () => {
    const j = judgeConvergence(
      [reading("a", NO_NODES_KEY), reading("b", NO_NODES_KEY)],
      STATED,
    );
    expect(j.converged).toBe(false);
    expect(recordsClause(j).satisfied).toBe(false);
    expect(recordsClause(j).detail).toContain("no `nodes` ARRAY");
    expect(j.peersAgreeOnRecords).toBe(false);
  });

  it("tp05f: an expectation that names NO node is refused, not satisfied empty-against-empty", () => {
    for (const records of [
      { nodes: [] },
      { nodes: [{ id: "n1" }] },
      { nodes: [{ id: "" }] },
      { nodes: [{ x: 1, y: 2 }] },
      { nodes: [{ id: "n1", x: "100" }] },
      { nodes: "n1" },
      [{ id: "n1", x: 1 }],
      "n1",
      42,
    ]) {
      const j = judgeConvergence(
        [reading("a", SPELLING_AUTHOR), reading("b", SPELLING_AUTHOR)],
        { origin: "a caller who wrote the clause wrong", records } as unknown as ExpectedContent,
      );
      const clause = recordsClause(j);
      // STATED and NOT satisfied — never silently "nobody asked".
      expect(clause.stated, JSON.stringify(records)).toBe(true);
      expect(clause.satisfied, JSON.stringify(records)).toBe(false);
      expect(clause.detail).toContain("CANNOT BE APPLIED");
      expect(j.converged).toBe(false);
      // A malformed expectation is not a record question, so no record
      // agreement is claimed about it either.
      expect(j.peersAgreeOnRecords).toBeNull();
    }
  });

  it("tp05h: ONE peer, however readable, is not a record-AGREEMENT claim", () => {
    // This row exists because a plant found nothing. Flipping the `<2 readings`
    // guard in `evaluateRecordAgreement` from `agree:false` to `agree:true` left
    // the whole 3374-test suite green: `judgeConvergence` refuses a one-peer
    // round as UNJUDGEABLE before anything acts on the verdict, so the vacuous
    // value was invisible — but it is REPORTED, and `peersAgreeOnRecords: true`
    // on a round with nobody to agree with is exactly the reading this field
    // exists to prevent. The break is now isolated instead of subsumed.
    const one = judgeConvergence([reading("a", SPELLING_AUTHOR)], STATED);
    expect(one.verdict).toBe(CONVERGENCE_VERDICT.UNJUDGEABLE);
    expect(one.peersAgreeOnRecords).toBe(false);
    expect(evaluateRecordAgreement([reading("a", SPELLING_AUTHOR)], STATED.records?.nodes ?? []).agree).toBe(
      false,
    );
    expect(evaluateRecordAgreement([], STATED.records?.nodes ?? []).agree).toBe(false);
  });

  it("tp05g: a malformed `records` over the wire is a judged failure, never a crash or a green", async () => {
    const out = await routeCommand({} as never, {
      cmd: "convergence.judge",
      args: {
        peers: [reading("a", SPELLING_AUTHOR), reading("b", SPELLING_AUTHOR)],
        expected: { origin: "wrong on purpose", records: { nodes: [{ id: 7 }] } },
      },
    });
    expect(out.status).toBe(200);
    const result = (out.body as { result: { converged: boolean; violations: string[] } }).result;
    expect(result.converged).toBe(false);
    expect(result.violations).toContain("records");
  });
});

describe("WP123 tp06 — A6: S155's shape holds in every branch", () => {
  it("tp06a: nobody asked → `stated:false`, `satisfied:null`, and a populated detail", () => {
    const j = judgeConvergence(
      [reading("a", SPELLING_AUTHOR), reading("b", SPELLING_AUTHOR)],
      { origin: "a round that only cared that the file exists", exists: true },
    );
    const clause = recordsClause(j);
    expect(clause.stated).toBe(false);
    expect(clause.satisfied).toBeNull();
    expect(clause.detail.length).toBeGreaterThan(0);
    expect(j.peersAgreeOnRecords).toBeNull();
    expect(j.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
  });

  it("tp06b: THE NO-PEER-READING BRANCH carries the row too", () => {
    const j = judgeConvergence([], STATED);
    expect(j.verdict).toBe(CONVERGENCE_VERDICT.UNJUDGEABLE);
    expect(j.clauses.map((c) => c.clause)).toStrictEqual([
      "exists",
      "sha256",
      "contains",
      "atLeastBytes",
      "records",
      "emptiness-must-be-asserted",
    ]);
    const clause = recordsClause(j);
    expect(clause.stated).toBe(false);
    expect(clause.satisfied).toBeNull();
    expect(clause.detail).toContain("no peer reading was supplied");
  });

  it("tp06c: `satisfied === null` exactly when `stated` is false, across every shape", () => {
    const shapes: ExpectedContent[] = [
      { origin: "o" },
      { origin: "o", exists: true },
      STATED,
      { origin: "o", records: { nodes: [{ id: "n1", width: 250 }] } },
      { origin: "o", records: { nodes: [] } },
      { origin: "o", exists: true, records: { nodes: [{ id: "nope", x: 1 }] } },
    ];
    const files = [
      reading("a", SPELLING_AUTHOR).file,
      reading("a", UNPARSEABLE).file,
      reading("a", null).file,
      { exists: false, sha256: "", size: 0, content: null },
    ];
    for (const expected of shapes) {
      for (const file of files) {
        const clauses = judgeFileAgainstExpectation(file, expected);
        expect(clauses.map((c) => c.clause)).toStrictEqual([
          "exists",
          "sha256",
          "contains",
          "atLeastBytes",
          "records",
          "emptiness-must-be-asserted",
        ]);
        for (const clause of clauses) {
          expect(clause.detail.length).toBeGreaterThan(0);
          expect(clause.satisfied === null).toBe(!clause.stated);
        }
      }
    }
  });

  it("tp06d: an unstated records row never joins `violations` and never blocks a CONVERGED", () => {
    // The additive half (S155 / charter §3.3): landing this clause must not
    // change the answer for a single caller that does not state it.
    const j = judgeConvergence(
      [reading("a", SPELLING_AUTHOR), reading("b", SPELLING_AUTHOR)],
      { origin: "a pre-WP123 caller", exists: true, atLeastBytes: 10 },
    );
    expect(j.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
    expect(j.violations).toStrictEqual([]);
    expect(j.peersAgreeOnRecords).toBeNull();
  });
});
