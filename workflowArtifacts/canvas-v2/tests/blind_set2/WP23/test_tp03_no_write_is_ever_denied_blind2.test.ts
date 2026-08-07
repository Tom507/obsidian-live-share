// WP23 blind2, WP21 link — the removed write gate, checked as an ABSENCE OF
// EVIDENCE FOR IT rather than as "the seam is gone".
//
// WP21's premise is that locks became pure UX because the DATA MODEL resolves
// same-register conflicts by itself. The seam's removal is pinned by that WP's
// own tests; what a fuzzer can add — and only a fuzzer can add — is the
// empirical half: over many concurrent interleavings, no artefact of a write
// gate is ever observable.
//
// A write gate leaves three fingerprints, and all three are looked for here:
//
//   ├── DENIAL — a local write that does not appear in its own author's doc.
//   ├── BASELINE-HOLD — the echo baseline withheld after a refused write, so the
//   │      next save of the identical bytes replays the whole file as intent
//   │      instead of being recognised as this client's own write.
//   └── HELD-BACK LOCAL STATE — the losing author's doc still carrying its own
//          value after the mesh has settled, i.e. a replica that did not
//          converge.
//
// And the convergence claim itself: the settled value is one of the values
// somebody actually wrote — never a third. WHICH one is deliberately not
// asserted anywhere: Yjs tie-breaks on `clientID = random.uint32()`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb2_2303;
const OPS = [
  "contendedFieldWrite",
  "contendedAtomicRegister",
  "moveViaSave",
  "relabelViaSave",
  "createNodeViaSave",
];

describe("WP23 blind2 — no artefact of a write gate is ever observable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("over 32 concurrent interleavings: no denial, no baseline-hold, no held-back state", async () => {
    let localWrites = 0;
    let contestedSlots = 0;

    for (let index = 0; index < 32; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas, trace) => {
          for (const replica of replicas) {
            localWrites += replica.writeAdmissions.length;
            const denied = replica.writeAdmissions.filter(
              (admission) => !Object.is(admission.landed, admission.intended),
            );
            expect(
              denied.map(
                (admission) =>
                  `${admission.kind}/${admission.id}.${admission.field}: wanted ` +
                  `${JSON.stringify(admission.intended)}, doc held ${JSON.stringify(admission.landed)}`,
              ),
              `replica ${replica.index}: a local write did not reach its own author's doc`,
            ).toEqual([]);
            expect(
              replica.lwwArtefacts,
              `replica ${replica.index}: the echo baseline was held back after a write`,
            ).toEqual([]);
          }

          // HELD-BACK LOCAL STATE would show up as a replica whose file differs.
          const texts = new Set(replicas.map((replica) => projectFile(replica).text));
          expect(
            texts.size,
            "a replica is still holding its own value after the mesh settled — that is exactly " +
              "the state a write gate used to produce",
          ).toBe(1);

          // LWW-CONSISTENCY: the winner is one of the submitted values.
          const files = replicas.map(projectFile);
          const candidates = new Map<string, Set<unknown>>();
          for (const entry of trace.log) {
            if (!entry.contested || entry.slot.pseudo) continue;
            const key = `${entry.slot.kind}|${entry.slot.id}|${entry.slot.field}`;
            const held = candidates.get(key) ?? new Set<unknown>();
            held.add(entry.value);
            candidates.set(key, held);
          }
          for (const [key, values] of candidates) {
            const [kind, id, field] = key.split("|");
            const expectation = trace.expect({ kind: kind as "node" | "edge", id, field });
            if (expectation?.kind !== "contested") continue;
            contestedSlots += 1;
            const record = (kind === "node" ? files[0].nodes : files[0].edges).find(
              (candidate) => candidate.id === id,
            );
            if (!record) continue;
            expect(
              [...values].some((value) => Object.is(value, record[field])),
              `${kind}/${id}.${field} settled on ${JSON.stringify(record[field])}, which neither ` +
                `concurrent author wrote (${JSON.stringify([...values])})`,
            ).toBe(true);
          }
        },
      });
      expect(
        result.violations.map((violation) => `[${violation.family}] ${violation.message}`),
        `seed ${SEED + index}`,
      ).toEqual([]);
    }

    expect(localWrites, "no local write was ever observed — nothing was checked for denial").toBeGreaterThan(
      0,
    );
    expect(
      contestedSlots,
      "no concurrent same-field write survived to the end — WP21's premise is untested",
    ).toBeGreaterThan(0);
  }, FUZZ_TEST_TIMEOUT_MS);
});
