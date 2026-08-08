// WP123 tp03 — A2, A3, A4. THE ORACLE JUDGES GEOMETRY, AND IT CAN SAY NO.
//
// The sentence the next reader can check, executed in tp03a and tp03e:
// *an expectation stating node `n1` is at (100, 200) is judged by the oracle,
// and tp03e is the test that proves the oracle says NO when it isn't.*
//
// NO DOUBLES. Every row calls the shipped `judgeConvergence` / `routeCommand`
// and the shipped production parser. The only thing constructed is the input,
// and the input is authored in `boards.ts` — never read off a peer under test.

import { describe, expect, it } from "vitest";

import {
  CONVERGENCE_VERDICT,
  type ExpectedContent,
  evaluatePeerAgreement,
  evaluateRecordAgreement,
  judgeConvergence,
  readCanvasRecords,
  routeCommand,
} from "../../../testing/e2e-control";
import {
  MOVED_N1,
  MOVED_N1_CANONICAL,
  SAME_RECORDS,
  SPELLING_AUTHOR,
  SPELLING_CANONICAL,
  SPELLING_OBSIDIAN,
  reading,
} from "./boards";

/**
 * The expectation, in the caller's own words. `origin` is mandatory and names
 * the gesture; nothing in `records` was read back off a peer.
 */
const GUEST_MOVED_NOTHING: ExpectedContent = {
  origin: "the board this test authored before the round: n1 at (100,200), n2 at (400,200)",
  records: {
    nodes: [
      { id: "n1", x: 100, y: 200 },
      { id: "n2", x: 400, y: 200 },
    ],
  },
};

/** The same round, after the guest dragged n1 down. THIS is what a live round states. */
const GUEST_MOVED_N1: ExpectedContent = {
  origin: "the drag this round issued on the guest: n1 from (100,200) to (100,399)",
  records: { nodes: [{ id: "n1", x: 100, y: 399 }] },
};

describe("WP123 tp03 — A2: geometry is judgeable, and the live tester can reach it", () => {
  it("tp03a: a records expectation returns a VERDICT, not `unjudgeable`", () => {
    const judgement = judgeConvergence(
      [reading("host", SPELLING_AUTHOR), reading("guest", SPELLING_AUTHOR)],
      GUEST_MOVED_NOTHING,
    );
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
    expect(judgement.converged).toBe(true);
    expect(judgement.matchesExpectation).toBe(true);
    const clause = judgement.clauses.find((c) => c.clause === "records");
    expect(clause?.stated).toBe(true);
    expect(clause?.satisfied).toBe(true);
    // A2: it reports WHAT IT COMPARED, not merely that it was happy.
    expect(clause?.detail).toContain("n1.x, n1.y, n2.x, n2.y");
  });

  it("tp03b: `records` alone is a clause — the origin is still mandatory", () => {
    const peers = [reading("host", SPELLING_AUTHOR), reading("guest", SPELLING_AUTHOR)];
    // It is a stated clause: an expectation carrying only `records` is judgeable.
    expect(judgeConvergence(peers, GUEST_MOVED_NOTHING).verdict).toBe(
      CONVERGENCE_VERDICT.CONVERGED,
    );
    // ...and the defect `origin` exists to make visible is still refused.
    const noOrigin = judgeConvergence(peers, { ...GUEST_MOVED_NOTHING, origin: "   " });
    expect(noOrigin.verdict).toBe(CONVERGENCE_VERDICT.UNJUDGEABLE);
    expect(noOrigin.converged).toBe(false);
    expect(noOrigin.reason).toContain("provenance");
  });

  it("tp03c: A2 — reachable over `convergence.judge`, the surface WP119's tester drives", async () => {
    // Argument shape, over the wire, exactly as the Python driver sends it.
    const args = {
      peers: [reading("host", SPELLING_CANONICAL), reading("guest", SPELLING_OBSIDIAN)],
      expected: GUEST_MOVED_NOTHING,
    };
    const out = await routeCommand({} as never, {
      cmd: "convergence.judge",
      args: JSON.parse(JSON.stringify(args)),
    });
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    const result = (
      out.body as {
        result: { verdict: string; converged: boolean; peersAgree: boolean; peersAgreeOnRecords: boolean | null };
      }
    ).result;
    expect(result.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
    expect(result.converged).toBe(true);
    // Both facts survive the JSON round trip, and they are DIFFERENT facts.
    expect(result.peersAgree).toBe(false);
    expect(result.peersAgreeOnRecords).toBe(true);
  });

  it("tp03d: A3 — THREE SPELLINGS, ONE VERDICT (the row a byte oracle cannot pass)", () => {
    const peers = SAME_RECORDS.map((s, i) => reading(`peer-${i}`, s));
    // The premise: the bytes really do differ. Nothing here is normalised.
    expect(evaluatePeerAgreement(peers).agree).toBe(false);
    expect(new Set(peers.map((p) => p.file.sha256)).size).toBe(3);

    const judgement = judgeConvergence(peers, GUEST_MOVED_NOTHING);
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
    expect(judgement.converged).toBe(true);
    expect(judgement.peersAgree).toBe(false);
    expect(judgement.peersAgreeOnRecords).toBe(true);
    expect(judgement.violations).toStrictEqual([]);
    // The reason says which agreement drove the verdict — an unqualified
    // "the peers agree" next to `peersAgree: false` is how a reader is misled.
    expect(judgement.reason).toContain("agree on the records");
  });
});

describe("WP123 tp04 — A4: THE ORACLE CAN FAIL, and it names the id and the field", () => {
  it("tp04a: the expectation says n1 is at y=200 and the board says 399 → NOT satisfied", () => {
    const judgement = judgeConvergence(
      [reading("host", MOVED_N1), reading("guest", MOVED_N1)],
      GUEST_MOVED_NOTHING,
    );
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.AGREED_ON_WRONG_BYTES);
    expect(judgement.converged).toBe(false);
    expect(judgement.violations).toStrictEqual(["records"]);
    const clause = judgement.clauses.find((c) => c.clause === "records");
    expect(clause?.satisfied).toBe(false);
    // NAMED: the id AND the field AND both values.
    expect(clause?.detail).toContain("n1.y: expected 200, observed 399");
    // ...and the mismatch list holds that one field and nothing else, while the
    // "compared" prefix still names all four fields that WERE examined.
    expect(clause?.detail).toContain("compared n1.x, n1.y, n2.x, n2.y");
    const mismatches = (clause?.detail ?? "").split("): ")[1];
    expect(mismatches).toBe("n1.y: expected 200, observed 399");
  });

  it("tp04b: AN ID-SET COMPARISON PASSES THIS BOARD — so the clause is not one", () => {
    // The discriminator the AC asks for, executed: the ids are IDENTICAL on both
    // boards. A records clause that only compared id sets would score the moved
    // card as converged, which is every geometry defect this project has.
    const still = readCanvasRecords(reading("x", SPELLING_AUTHOR).file);
    const moved = readCanvasRecords(reading("x", MOVED_N1).file);
    expect(still.ids).toStrictEqual(["n1", "n2"]);
    expect(moved.ids).toStrictEqual(still.ids);
    // ...and the clause says NO anyway.
    expect(
      judgeConvergence(
        [reading("a", MOVED_N1), reading("b", MOVED_N1)],
        GUEST_MOVED_NOTHING,
      ).violations,
    ).toStrictEqual(["records"]);
  });

  it("tp04c: the card that did NOT arrive — one peer moved, the other did not → DIVERGED", () => {
    // The live question, spelt as a round: the guest dragged n1 and the host
    // never got it. The two peers hold DIFFERENT records, not merely different
    // bytes, and the verdict must say so and name what differs.
    const judgement = judgeConvergence(
      [reading("guest", MOVED_N1), reading("host", SPELLING_AUTHOR)],
      GUEST_MOVED_N1,
    );
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.DIVERGED);
    expect(judgement.converged).toBe(false);
    expect(judgement.peersAgreeOnRecords).toBe(false);
    expect(judgement.reason).toContain("n1.y");
    expect(judgement.reason).toContain("host");
  });

  it("tp04d: and the SAME move, respelt, is NOT a divergence — spelling never decides", () => {
    // guest wrote the move in the author's spelling, host in the canonical one.
    const judgement = judgeConvergence(
      [reading("guest", MOVED_N1), reading("host", MOVED_N1_CANONICAL)],
      GUEST_MOVED_N1,
    );
    expect(judgement.peersAgree).toBe(false);
    expect(judgement.peersAgreeOnRecords).toBe(true);
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
  });

  it("tp04e: a node the board does not have is ABSENT, not a silent pass", () => {
    const judgement = judgeConvergence(
      [reading("a", SPELLING_AUTHOR), reading("b", SPELLING_AUTHOR)],
      {
        origin: "the round created n3 and waited for it",
        records: { nodes: [{ id: "n3", x: 0, y: 0 }] },
      },
    );
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.AGREED_ON_WRONG_BYTES);
    expect(judgement.clauses.find((c) => c.clause === "records")?.detail).toContain(
      "node 'n3' is ABSENT",
    );
  });

  it("tp04f: an extra node ON ONE PEER is a record divergence, even for the named-field clause", () => {
    const withExtra = SPELLING_CANONICAL.replace(
      '"edges":',
      '"__ignored":0,"edges":',
    ).replace(
      '{"type":"text","id":"n2"',
      '{"type":"text","id":"n3","width":10,"height":10,"x":9,"y":9,"text":"stray"},{"type":"text","id":"n2"',
    );
    expect(readCanvasRecords(reading("x", withExtra).file).ids).toStrictEqual(["n1", "n2", "n3"]);
    const agreement = evaluateRecordAgreement(
      [reading("a", SPELLING_AUTHOR), reading("b", withExtra)],
      GUEST_MOVED_NOTHING.records?.nodes ?? [],
    );
    expect(agreement.agree).toBe(false);
    expect(agreement.detail).toContain("node id set");
  });
});
