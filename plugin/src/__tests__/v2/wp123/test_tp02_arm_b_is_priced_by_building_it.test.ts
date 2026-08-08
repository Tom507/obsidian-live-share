// WP123 tp02 — ARM (b), BUILT FAR ENOUGH TO MEASURE. Charter §2, WP122's method.
//
// The fork: (a) put the records judgement in `ExpectedContent`'s clause ledger
// and amend the pins that count the rows, or (b) land it OUTSIDE that ledger so
// no pin is touched.
//
// An argued rejection is §3.7 "argued". So arm (b) is CONSTRUCTED here — out of
// the real production parser and the real shipped `judgeConvergence`, no doubles
// — and its cost is measured rather than asserted. `armB` below is a faithful
// arm (b): a correct record oracle that lives beside the clause ledger instead of
// inside it. It is not a strawman, and tp02a proves it answers correctly.
//
// The cost is tp02b and tp02c: the surface the live tester actually calls is
// unchanged by it, so the SAME round returns `converged: true` from one object
// and "the card did not arrive" from the other, with nothing in either of them
// naming the other's existence. That is S155's defect — "not asked" and "asked
// and passed" reading the same — reconstituted at the level of whole answers.

import { describe, expect, it } from "vitest";

import { decodeCanvasDataToFlat, parseCanvasReport } from "../../../files/canvas-sync";
import {
  CONVERGENCE_VERDICT,
  judgeConvergence,
  routeCommand,
} from "../../../testing/e2e-control";
import { AUTHORED_GEOMETRY, MOVED_N1, SPELLING_AUTHOR, reading } from "./boards";

// ---------------------------------------------------------------------------
// ARM (b), constructed. A separate module's worth of oracle, reached separately.
// ---------------------------------------------------------------------------

interface ArmBVerdict {
  ok: boolean;
  mismatches: string[];
}

/** Arm (b): a correct record oracle that is NOT a row in the clause ledger. */
function armB(content: string | null, expected: Record<string, { x: number; y: number }>): ArmBVerdict {
  if (content === null) return { ok: false, mismatches: ["<no content was read back>"] };
  const report = parseCanvasReport(content);
  if (report.degraded) return { ok: false, mismatches: ["<the bytes did not parse>"] };
  const nodes = decodeCanvasDataToFlat(report.data).nodes;
  const mismatches: string[] = [];
  for (const [id, want] of Object.entries(expected)) {
    const got = nodes[id];
    if (!got) {
      mismatches.push(`${id}: absent`);
      continue;
    }
    for (const field of ["x", "y"] as const) {
      if (got[field] !== want[field]) mismatches.push(`${id}.${field}: ${String(got[field])} != ${want[field]}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

const WANT = { n1: { x: 100, y: 200 }, n2: { x: 400, y: 200 } };

/** The expectation a live round can state WITHOUT a records clause — all of it. */
const EVERYTHING_ELSE = {
  origin: "the board this test authored before the round, spelled out in boards.ts",
  exists: true,
  contains: ["n1", "n2", "e1"],
  atLeastBytes: 100,
};

describe("WP123 tp02 — arm (b) priced by construction, not by argument", () => {
  it("tp02a: arm (b) is NOT a strawman — built correctly, it answers correctly", () => {
    expect(armB(SPELLING_AUTHOR, WANT).ok).toBe(true);
    const moved = armB(MOVED_N1, WANT);
    expect(moved.ok).toBe(false);
    expect(moved.mismatches).toStrictEqual(["n1.y: 399 != 200"]);
    // ...and it refuses the boards it could not read, exactly as arm (a) must.
    expect(armB(null, WANT).ok).toBe(false);
    expect(armB('{"nodes":[{"id"', WANT).ok).toBe(false);
    // The geometry it is judged against is the authored one, not a peer reading.
    expect(WANT.n1.x).toBe(AUTHORED_GEOMETRY.n1.x);
    expect(WANT.n1.y).toBe(AUTHORED_GEOMETRY.n1.y);
  });

  it("tp02b: THE PRICE — the surface the live tester calls is CONVERGED on the moved board", async () => {
    // Two peers in perfect agreement on a board whose card was moved 199 px.
    // Every clause a pre-WP123 caller can state is satisfied, because none of
    // them is about geometry.
    const peers = [reading("host", MOVED_N1), reading("guest", MOVED_N1)];
    const judgement = judgeConvergence(peers, EVERYTHING_ELSE);
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
    expect(judgement.converged).toBe(true);

    // And the same answer comes back over the envelope WP119's tester drives.
    const out = await routeCommand({} as never, {
      cmd: "convergence.judge",
      args: { peers, expected: EVERYTHING_ELSE },
    });
    const result = (out.body as { result: { converged: boolean } }).result;
    expect(result.converged).toBe(true);

    // Arm (b), asked separately about the same round, says the opposite.
    expect(armB(MOVED_N1, WANT).ok).toBe(false);

    // THE SPLIT LEDGER, MEASURED. Under arm (b) the object the tester reads has
    // no row naming the geometry at all: not "asked and passed", not "not
    // asked" — absent. Under arm (a) (this tree) there is exactly one, and it
    // says `stated:false / satisfied:null`, which is the whole of S155's rule.
    const geometryRows = judgement.clauses.filter((c) => c.clause === "records");
    expect(geometryRows).toHaveLength(1);
    expect(geometryRows[0].stated).toBe(false);
    expect(geometryRows[0].satisfied).toBeNull();
    expect(geometryRows[0].detail.length).toBeGreaterThan(0);
  });

  it("tp02c: arm (b) is not reachable without ALSO editing routeCommand — 'no pin touched' is not free", async () => {
    // Arm (b)'s premise is that nothing in `e2e-control.ts` changes. Then the
    // live tester cannot reach it: the control server answers exactly the
    // commands this file routes, and a records command is not one of them.
    const out = await routeCommand({} as never, {
      cmd: "convergence.judgeRecords",
      args: { content: SPELLING_AUTHOR, expected: WANT },
    });
    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
    // So arm (b) costs a second command and a second round trip anyway, and buys
    // in exchange two answers about one round that nothing reconciles.
  });
});
