// S158 — AN AGREEMENT ORACLE CANNOT TELL CONVERGENCE FROM A SHARED LOSS.
//
// THE ACCEPTANCE CRITERION OF THIS PACKAGE IS ONE ROW, AND IT IS `tp01c`: feed
// the oracle three peers agreeing on the digest of the empty string for a file
// that HAD CONTENT, and it must report a FAILURE. That is not a hypothetical
// input. It is a transcription of `S119`, in which all three live clients
// agreed perfectly on `e3b0c442…` while every `.md` in the share was being
// truncated to nothing — a textbook pass by the oracle that produced every
// `converged` verdict this rig has ever recorded.
//
// THE RECURSION IS THE POINT. This package's product IS an oracle, so
// "can this thing detect the failure it exists to detect?" is simultaneously
// the positive control and the acceptance criterion. `check_signal_register.py`
// is the model: it plants each violation class in a sample and refuses to report
// anything unless all of them are caught.
//
// SO EVERY ROW BELOW COMES IN A PAIR:
//
//   ├── `tp01a` THE OLD ORACLE ON THE S119 INPUT — `converged: true`. The
//   │      defect, executed, not described. If this row ever goes red the
//   │      premise of the whole package has changed and the report is stale.
//   ├── `tp01c` THE NEW ORACLE ON THE SAME INPUT — a FAILURE, named.
//   ├── `tp02*` THE NEGATIVE CONTROLS — an honest green must still be green, or
//   │      the "fix" is just an oracle that always fails, which detects nothing.
//   └── `tp05*` THE REFUSALS — every way of asking a question that cannot be
//          answered lands on UNJUDGEABLE, and UNJUDGEABLE is never green.
//
// NO DOUBLES OF ANY KIND. The subject is a pure function over plain data; every
// row calls the shipped `judgeConvergence` / `evaluateCanvasConvergence` /
// `routeCommand` directly. The only thing constructed here is the input.

import { describe, expect, it } from "vitest";

import {
  CONVERGENCE_VERDICT,
  EMPTY_SHA256,
  type ExpectedContent,
  type PeerFileObservation,
  evaluateCanvasConvergence,
  evaluatePeerAgreement,
  judgeConvergence,
  judgeFileAgainstExpectation,
  routeCommand,
} from "../../../testing/e2e-control";

// ---------------------------------------------------------------------------
// The S119 fixture, transcribed from the signal register.
// ---------------------------------------------------------------------------

/** `hello.md` — 49 bytes of real content, the state BEFORE the round. */
const HELLO_TEXT = "# hello\n\nthis note has content and had it before.";
const HELLO_BYTES = Buffer.byteLength(HELLO_TEXT, "utf8");
/** Not the real digest of the string above; it only has to be "not empty". */
const HELLO_SHA = "a".repeat(64);

/** What all three clients read AFTER the truncation. Zero bytes, in agreement. */
const TRUNCATED = { exists: true, sha256: EMPTY_SHA256, size: 0, content: "" };
/** What they were supposed to hold. */
const INTACT = { exists: true, sha256: HELLO_SHA, size: HELLO_BYTES, content: HELLO_TEXT };

const threePeers = (file: typeof TRUNCATED): PeerFileObservation[] => [
  { peer: "vault-a", file: { ...file } },
  { peer: "vault-b", file: { ...file } },
  { peer: "vault-c", file: { ...file } },
];

/**
 * The census taken BEFORE the round — the external reference point, and the
 * whole of the repair. `origin` says where it came from; nothing in it is read
 * back off a peer under test.
 */
const CENSUS_BEFORE: ExpectedContent = {
  origin: "the pre-round census of _liveshare-test/hello.md, taken at 16:52:00 before any gesture",
  exists: true,
  atLeastBytes: HELLO_BYTES,
};

/** The lazy expectation a hurried caller would write. Deliberately weak. */
const LAZY: ExpectedContent = {
  origin: "the round only recorded that the file is supposed to still be there",
  exists: true,
};

describe("S158 tp01 — the S119 scenario, through both oracles", () => {
  it("tp01a: THE DEFECT, EXECUTED — the peer-to-peer oracle scores the truncation as CONVERGED", () => {
    // Two of the three, because that oracle takes exactly two observations.
    const doc = { nodes: [], edges: [] };
    const verdict = evaluateCanvasConvergence(
      { doc, file: { ...TRUNCATED } },
      { doc, file: { ...TRUNCATED } },
    );

    expect(verdict.fileConverged).toBe(true);
    expect(verdict.converged).toBe(true);
    expect(verdict.reason).toBeNull();
    // ... and it says exactly the same thing about the INTACT run, which is the
    // defect stated as an identity: the two runs are indistinguishable to it.
    const honest = evaluateCanvasConvergence(
      { doc, file: { ...INTACT } },
      { doc, file: { ...INTACT } },
    );
    expect(honest.converged).toBe(verdict.converged);
  });

  it("tp01b: the peers really do agree — the new oracle is not passing for lack of agreement", () => {
    const agreement = evaluatePeerAgreement(threePeers(TRUNCATED));
    expect(agreement.agree).toBe(true);
    expect(agreement.disagreeing).toStrictEqual([]);
    expect(agreement.peers).toStrictEqual(["vault-a", "vault-b", "vault-c"]);
  });

  it("tp01c: ACCEPTANCE — three peers agreeing on the EMPTY DIGEST for a file that had content is a FAILURE", () => {
    const judgement = judgeConvergence(threePeers(TRUNCATED), CENSUS_BEFORE);

    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.AGREED_ON_WRONG_BYTES);
    expect(judgement.converged).toBe(false);
    // The failure is NOT a failure of agreement. Both facts are reported.
    expect(judgement.peersAgree).toBe(true);
    expect(judgement.matchesExpectation).toBe(false);
    expect(judgement.violations).toContain("atLeastBytes");
    expect(judgement.peers).toStrictEqual(["vault-a", "vault-b", "vault-c"]);
    expect(judgement.expectationOrigin).toContain("pre-round census");
    expect(judgement.reason).toContain("agree");
  });

  it("tp01d: even the LAZY expectation fails it — emptiness has to be asserted, never inferred", () => {
    // `exists: true` and nothing else. Under clauses 1–4 alone this passes; the
    // structural clause is what stops a hurried caller from re-creating S158.
    const judgement = judgeConvergence(threePeers(TRUNCATED), LAZY);

    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.AGREED_ON_WRONG_BYTES);
    expect(judgement.converged).toBe(false);
    expect(judgement.violations).toStrictEqual(["emptiness-must-be-asserted"]);
    const clause = judgement.clauses.find((c) => c.clause === "emptiness-must-be-asserted");
    expect(clause?.stated).toBe(true);
    expect(clause?.satisfied).toBe(false);
    expect(clause?.detail).toContain("S119");
  });

  it("tp01e: the empty digest constant is the real one, so the row above is about the real signature", () => {
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    expect(createHash("sha256").update(Buffer.alloc(0)).digest("hex")).toBe(EMPTY_SHA256);
    expect(EMPTY_SHA256.startsWith("e3b0c442")).toBe(true);
  });
});

describe("S158 tp02 — NEGATIVE CONTROLS: an oracle that only ever fails detects nothing", () => {
  it("tp02a: three peers agreeing on the RIGHT bytes is CONVERGED", () => {
    const judgement = judgeConvergence(threePeers(INTACT), CENSUS_BEFORE);

    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
    expect(judgement.converged).toBe(true);
    expect(judgement.peersAgree).toBe(true);
    expect(judgement.matchesExpectation).toBe(true);
    expect(judgement.violations).toStrictEqual([]);
  });

  it("tp02b: an exact-digest expectation is satisfiable, not merely refusable", () => {
    const judgement = judgeConvergence(threePeers(INTACT), {
      origin: "the fixture planted by the round",
      exists: true,
      sha256: HELLO_SHA,
      contains: ["# hello", "had it before"],
      atLeastBytes: HELLO_BYTES,
    });
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
    expect(judgement.clauses.filter((c) => c.stated && c.satisfied === true)).toHaveLength(5);
  });

  it("tp02c: a LEGITIMATELY empty file still passes — when somebody says it should be empty", () => {
    // The cost of the structural clause, paid in full and shown to be payable.
    const asserted = judgeConvergence(threePeers(TRUNCATED), {
      origin: "the round created an empty note on purpose and recorded that it created one",
      exists: true,
      sha256: EMPTY_SHA256,
    });
    expect(asserted.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);

    const viaFloor = judgeConvergence(threePeers(TRUNCATED), {
      origin: "the round created an empty note on purpose",
      exists: true,
      atLeastBytes: 0,
    });
    expect(viaFloor.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
  });

  it("tp02d: an ABSENT file expected absent is converged, and is not confused with an empty one", () => {
    const absent = { exists: false, sha256: "", size: 0, content: null };
    const judgement = judgeConvergence(
      [
        { peer: "a", file: { ...absent } },
        { peer: "b", file: { ...absent } },
      ],
      { origin: "the round deleted it and waited", exists: false },
    );
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.CONVERGED);
    // The emptiness clause is INERT for an absent file — absence and emptiness
    // are different states and an oracle that blurs them is worse than none.
    const clause = judgement.clauses.find((c) => c.clause === "emptiness-must-be-asserted");
    expect(clause?.satisfied).toBe(true);
    expect(clause?.detail).toContain("not empty");
  });
});

describe("S158 tp03 — DIVERGENCE stays a different answer from a shared loss", () => {
  it("tp03a: one peer holding different bytes is DIVERGED, not AGREED_ON_WRONG_BYTES", () => {
    const judgement = judgeConvergence(
      [
        { peer: "a", file: { ...INTACT } },
        { peer: "b", file: { ...TRUNCATED } },
        { peer: "c", file: { ...INTACT } },
      ],
      CENSUS_BEFORE,
    );
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.DIVERGED);
    expect(judgement.converged).toBe(false);
    expect(judgement.peersAgree).toBe(false);
    expect(judgement.reason).toContain("b");
    // It names WHICH peers dissent rather than only that somebody did.
    expect(judgement.reason).not.toContain("c,");
  });

  it("tp03b: a diverged run still reports the expectation clauses, so nothing is silent", () => {
    const judgement = judgeConvergence(
      [
        { peer: "a", file: { ...TRUNCATED } },
        { peer: "b", file: { ...INTACT } },
      ],
      CENSUS_BEFORE,
    );
    expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.DIVERGED);
    expect(judgement.clauses).toHaveLength(5);
    expect(judgement.violations).toContain("atLeastBytes");
  });
});

describe("S158 tp04 — ARRIVAL is still askable (A3: the rig loses no question)", () => {
  it("tp04a: `evaluatePeerAgreement` answers the peer-to-peer question on its own", () => {
    expect(evaluatePeerAgreement(threePeers(TRUNCATED)).agree).toBe(true);
    expect(
      evaluatePeerAgreement([
        { peer: "a", file: { ...INTACT } },
        { peer: "b", file: { ...TRUNCATED } },
      ]).agree,
    ).toBe(false);
  });

  it("tp04b: `evaluateCanvasConvergence` is byte-unchanged — WP49's contract still holds", () => {
    const doc = { nodes: [{ id: "n1", x: 0 }], edges: [] };
    const other = { nodes: [{ id: "n1", x: 1 }], edges: [] };
    const same = evaluateCanvasConvergence(
      { doc, file: { ...INTACT } },
      { doc, file: { ...INTACT } },
    );
    expect(same).toStrictEqual({
      converged: true,
      docConverged: true,
      fileConverged: true,
      reason: null,
    });
    const d17 = evaluateCanvasConvergence(
      { doc, file: { ...INTACT } },
      { doc, file: { ...TRUNCATED } },
    );
    expect(d17.reason).toBe("DOC_CONVERGED_FILE_DIVERGED");
    const docDiverged = evaluateCanvasConvergence(
      { doc, file: { ...INTACT } },
      { doc: other, file: { ...INTACT } },
    );
    expect(docDiverged.converged).toBe(false);
    expect(docDiverged.reason).toBeNull();
  });

  it("tp04c: single-peer CORRECTNESS is expressible without a convergence claim", () => {
    const clauses = judgeFileAgainstExpectation({ ...TRUNCATED }, CENSUS_BEFORE);
    expect(clauses.filter((c) => c.satisfied === false).map((c) => c.clause)).toStrictEqual([
      "atLeastBytes",
      "emptiness-must-be-asserted",
    ]);
  });
});

describe("S158 tp05 — UNJUDGEABLE is never green (S155: no branch is silent)", () => {
  const cases: { name: string; peers: PeerFileObservation[]; expected: ExpectedContent }[] = [
    {
      name: "one peer is not a convergence claim",
      peers: [{ peer: "a", file: { ...INTACT } }],
      expected: CENSUS_BEFORE,
    },
    {
      name: "no peers at all",
      peers: [],
      expected: CENSUS_BEFORE,
    },
    {
      name: "an expectation with no stated origin",
      peers: threePeers(INTACT),
      expected: { origin: "   ", atLeastBytes: 1 },
    },
    {
      name: "an expectation that states nothing about the bytes",
      peers: threePeers(INTACT),
      expected: { origin: "somebody wrote a sentence and no clause" },
    },
  ];

  for (const row of cases) {
    it(`tp05: ${row.name} → UNJUDGEABLE, converged:false`, () => {
      const judgement = judgeConvergence(row.peers, row.expected);
      expect(judgement.verdict).toBe(CONVERGENCE_VERDICT.UNJUDGEABLE);
      expect(judgement.converged).toBe(false);
      expect(judgement.matchesExpectation).toBeNull();
      expect(judgement.reason.length).toBeGreaterThan(20);
      // S155 — the ledger is complete in the do-nothing branch too.
      expect(judgement.clauses).toHaveLength(5);
      for (const clause of judgement.clauses) {
        expect(clause.detail.length).toBeGreaterThan(0);
        expect(clause.satisfied === null).toBe(!clause.stated);
      }
    });
  }

  it("tp05e: there is NO input that yields converged:true without an expectation clause", () => {
    // The structural half of the repair: the weak reading is unreachable
    // through this function, not merely discouraged.
    for (const file of [INTACT, TRUNCATED]) {
      const judgement = judgeConvergence(threePeers(file), { origin: "stated but empty" });
      expect(judgement.converged).toBe(false);
    }
  });
});

describe("S158 tp06 — the ledger obeys S155 in EVERY branch", () => {
  const everyBranch: ExpectedContent[] = [
    CENSUS_BEFORE,
    LAZY,
    { origin: "o", sha256: HELLO_SHA },
    { origin: "o", contains: ["# hello"] },
    { origin: "o", exists: true, sha256: EMPTY_SHA256 },
    { origin: "" },
  ];

  it("tp06a: five clause rows in every branch, stated or not, satisfied or not", () => {
    for (const expected of everyBranch) {
      for (const file of [INTACT, TRUNCATED, { exists: false, sha256: "", size: 0, content: null }]) {
        const judgement = judgeConvergence(threePeers(file as typeof TRUNCATED), expected);
        expect(judgement.clauses.map((c) => c.clause)).toStrictEqual([
          "exists",
          "sha256",
          "contains",
          "atLeastBytes",
          "emptiness-must-be-asserted",
        ]);
        expect(judgement.reason.length).toBeGreaterThan(0);
        // "not asked" and "asked and passed" are never the same reading.
        for (const clause of judgement.clauses) {
          if (!clause.stated) expect(clause.satisfied).toBeNull();
          else expect(typeof clause.satisfied).toBe("boolean");
        }
      }
    }
  });
});

describe("S158 tp07 — the oracle is reachable over the control envelope", () => {
  // The live rounds are driven from Python. A rule that only exists inside a
  // vitest import is a rule the live rig cannot use, and a second copy of it on
  // the driver side is how a rig ends up with two oracles that disagree.
  const host = {} as never;

  it("tp07a: `convergence.judge` returns the FAILURE verdict for the S119 payload", async () => {
    const out = await routeCommand(host, {
      cmd: "convergence.judge",
      args: {
        peers: threePeers(TRUNCATED),
        expected: CENSUS_BEFORE,
      },
    });
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    const result = (out.body as { result: { verdict: string; converged: boolean } }).result;
    expect(result.verdict).toBe(CONVERGENCE_VERDICT.AGREED_ON_WRONG_BYTES);
    expect(result.converged).toBe(false);
  });

  it("tp07b: it is pure — it needs no host method and reaches none", async () => {
    const out = await routeCommand(host, {
      cmd: "convergence.judge",
      args: { peers: threePeers(INTACT), expected: CENSUS_BEFORE },
    });
    expect((out.body as { result: { converged: boolean } }).result.converged).toBe(true);
  });

  it("tp07c: malformed arguments are a structured 400, never a crash and never a green", async () => {
    for (const args of [
      {},
      { peers: "not an array", expected: CENSUS_BEFORE },
      { peers: [], expected: null },
      { peers: [{ peer: "a" }], expected: CENSUS_BEFORE },
      { peers: [1, 2], expected: CENSUS_BEFORE },
    ]) {
      const out = await routeCommand(host, { cmd: "convergence.judge", args });
      expect(out.status).toBe(400);
      expect(out.body.ok).toBe(false);
    }
  });

  it("tp07d: a JSON round-trip does not change the verdict (the wire is the same rule)", async () => {
    const payload = JSON.parse(
      JSON.stringify({ peers: threePeers(TRUNCATED), expected: LAZY }),
    );
    const out = await routeCommand(host, { cmd: "convergence.judge", args: payload });
    const result = (out.body as { result: { verdict: string; violations: string[] } }).result;
    expect(result.verdict).toBe(CONVERGENCE_VERDICT.AGREED_ON_WRONG_BYTES);
    expect(result.violations).toStrictEqual(["emptiness-must-be-asserted"]);
  });
});
