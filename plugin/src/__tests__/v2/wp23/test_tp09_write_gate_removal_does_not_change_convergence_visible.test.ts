// WP23 — the WP21 coverage link, and the empirical backing for that WP's entire
// premise: "the fuzzer must demonstrate that REMOVING THE WRITE GATE DOES NOT
// CHANGE CONVERGENCE — concurrent writes to the same register converge by honest
// LWW on EVERY replica, with NO baseline-hold artefact and NO held-back local
// state."
//
// WP21 removed the per-node lock's write authority on the argument that the DATA
// MODEL resolves same-register conflicts by itself, so a lock is pure UX. That
// argument is only as good as the evidence for it, and "no test pins the removed
// denial" is not evidence. This one produces it:
//
//   ├── NO DENIAL — after each of two concurrent authors saves, that author's
//   │      OWN doc holds the value it just wrote. Under the removed gate the
//   │      loser's write never reached its own doc at all.
//   ├── NO BASELINE-HOLD — replaying the identical content immediately after
//   │      produces ZERO Yjs updates. The echo baseline advanced with the write.
//   │      Under the removed gate it was WITHHELD, so the next save replayed the
//   │      whole file as intent — the Symptom-2 cascade.
//   ├── CONVERGENCE — every replica ends on the same value, and
//   └── LWW-CONSISTENCY — that value is one of the two somebody actually wrote.
//
// WHAT IS DELIBERATELY NOT ASSERTED: which of the two won. Yjs tie-breaks a
// concurrent same-key write on `clientID = random.uint32()`, so that assertion
// would pass about half the time. A fuzzer that is flaky half the time is worse
// than no fuzzer.
//
// The atomic-register half is stronger than per-field LWW-consistency and is
// checked separately: `pos` is ONE register holding `[x, y]`, so the winner must
// be one author's WHOLE pair. A merged `(A.x, B.y)` is a coordinate NOBODY
// submitted, and checking `x` and `y` separately cannot see it — each half is
// individually a value somebody wrote.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0009;
const OPS = ["contendedFieldWrite", "contendedAtomicRegister", "moveViaSave", "createNodeViaSave"];

describe("WP23 — WP21 reached: removing the write gate did not change convergence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("both concurrent writes land locally, nothing is held back, and every replica converges by LWW", async () => {
    let contests = 0;
    let admissions = 0;
    let atomicContests = 0;

    for (let index = 0; index < 32; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas, trace) => {
          for (const replica of replicas) {
            admissions += replica.writeAdmissions.length;
            // NO DENIAL: every local write reached its own author's doc.
            for (const admission of replica.writeAdmissions) {
              const where =
                `replica ${admission.replica}: its own write to ` +
                `${admission.kind}/${admission.id}.${admission.field}`;
              // WP36 follow-up (B32) — RE-ORACLED for the two collaborative-text
              // fields. "My whole string is what my doc holds" was a statement
              // of the whole-string LWW register: once `text` merges, this
              // replica's own doc may legitimately already carry a peer's
              // characters, and demanding they be gone would demand the
              // destruction C36 AC3 forbids. What WP21 actually asks — was my
              // write ADMITTED or DENIED — is unchanged and is asserted in the
              // only form that still means it.
              if (admission.contribution !== undefined) {
                expect(
                  String(admission.landed),
                  `${where} did not reach its own doc — that is a write-denial artefact, and ` +
                    `WP21 removed the only thing that could produce one`,
                ).toContain(admission.contribution);
              } else {
                expect(
                  admission.landed,
                  `${where} did not reach its own doc — that is a write-denial artefact, and ` +
                    `WP21 removed the only thing that could produce one`,
                ).toBe(admission.intended);
              }
              // And the clause the pre-WP36 register cannot satisfy: the write
              // went through the collaborative-text path and left a nested
              // `Y.Text` behind (C36 AC1 — never replaced by a plain value).
              if (admission.expectYText === true) {
                expect(
                  admission.shape,
                  `${where} flattened the collaborative text back to a plain register`,
                ).toBe("ytext");
              }
            }
            // NO BASELINE-HOLD: replaying the just-saved bytes wrote nothing.
            expect(
              replica.lwwArtefacts,
              `replica ${replica.index} held local state back after a write`,
            ).toEqual([]);
          }

          // CONVERGENCE + LWW-CONSISTENCY on the contested field.
          const files = replicas.map(projectFile);
          const contested = new Map<string, Set<unknown>>();
          for (const entry of trace.log) {
            if (!entry.contested || entry.slot.pseudo) continue;
            const key = `${entry.slot.kind}|${entry.slot.id}|${entry.slot.field}`;
            const held = contested.get(key) ?? new Set<unknown>();
            held.add(entry.value);
            contested.set(key, held);
          }
          contests += contested.size;
          for (const [key, candidates] of contested) {
            const [kind, id, field] = key.split("|");
            const observed = files.map(
              (file) =>
                (kind === "node" ? file.nodes : file.edges).find((record) => record.id === id)?.[
                  field
                ],
            );
            const first = observed[0];
            for (const [replicaIndex, value] of observed.entries()) {
              expect(
                value,
                `replica ${replicaIndex}: the contested ${kind}/${id}.${field} did not converge`,
              ).toEqual(first);
            }
            const superseded = trace.expect({ kind: kind as "node" | "edge", id, field });
            // WP36 follow-up (B32) — THE RE-ORACLED CONTESTED ARM, and it is the
            // strictly stronger half of this whole migration.
            //
            // `[...candidates].includes(first)` says "the winner is one of the
            // two", which is the definition of a last-writer-wins register: it
            // is SATISFIED when one author's edit is destroyed. Under a
            // character-level merge the requirement is the opposite one — BOTH
            // authors' characters must still be there — and a run that passed
            // the old clause by destroying one of them fails this one.
            if (superseded?.kind === "text-merge") {
              for (const author of superseded.lastWindowAuthors) {
                if (author.inserted.length === 0) continue;
                expect(
                  String(first),
                  `${kind}/${id}.${field} converged on ${JSON.stringify(first)}, which lost the ` +
                    `characters replica ${author.replica} typed (${JSON.stringify(author.inserted)}). ` +
                    `A whole-string LWW register keeps exactly one of two concurrent edits; a ` +
                    `character-level merge must keep both.`,
                ).toContain(author.inserted);
              }
              continue;
            }
            if (superseded?.kind !== "contested") continue;
            expect(
              [...candidates].includes(first),
              `${kind}/${id}.${field} converged on ${JSON.stringify(first)}, which neither author ` +
                `wrote (they wrote ${JSON.stringify([...candidates])})`,
            ).toBe(true);
          }

          // ATOMICITY: one author's WHOLE [x, y] wins, never a merged pair.
          //
          // Only the LATEST contest per record still has an opinion — a second
          // contest in a later window is causally after the first and is the
          // unambiguous last writer, so the earlier one's candidates no longer
          // describe the outcome.
          const latestContest = new Map<string, (typeof trace.pairedContests)[number]>();
          for (const contest of trace.pairedContests) {
            const key = `${contest.kind}|${contest.id}`;
            const held = latestContest.get(key);
            if (held === undefined || contest.window >= held.window) latestContest.set(key, contest);
          }
          for (const contest of latestContest.values()) {
            const stillOpen = contest.fields.every(
              (field) =>
                trace.expect({ kind: contest.kind, id: contest.id, field })?.kind === "contested",
            );
            if (!stillOpen) continue;
            atomicContests += 1;
            for (const [replicaIndex, file] of files.entries()) {
              const record = (contest.kind === "node" ? file.nodes : file.edges).find(
                (candidate) => candidate.id === contest.id,
              );
              if (!record) continue;
              const pair = contest.fields.map((field) => record[field]);
              expect(
                contest.candidates.some((candidate) =>
                  candidate.every((value, position) => Object.is(value, pair[position])),
                ),
                `replica ${replicaIndex}: the atomic register ${contest.kind}/${contest.id} ` +
                  `converged on ${JSON.stringify(pair)} — a torn pair nobody submitted`,
              ).toBe(true);
            }
          }
        },
      });
      expect(result.violations, describeResult(result)).toEqual([]);
    }

    expect(contests, "no concurrent same-field write ever happened — WP21 is not reached").toBeGreaterThan(
      0,
    );
    expect(admissions, "no local write was ever checked for denial").toBeGreaterThan(0);
    expect(
      atomicContests,
      "no concurrent atomic-register write survived to the end — I8 is not exercised",
    ).toBeGreaterThan(0);
  }, FUZZ_TEST_TIMEOUT_MS);
});
