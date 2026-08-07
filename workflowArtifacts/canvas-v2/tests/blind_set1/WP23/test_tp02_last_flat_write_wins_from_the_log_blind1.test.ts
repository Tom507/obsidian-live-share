// WP23 AC5 blind1 — the collision class judged WITHOUT the oracle module.
//
// The visible test for this class asserts through `checkAllFamilies`. That is
// one implementation of the intent-trace idea, and a test that only exercises it
// cannot tell "the property holds" from "the oracle agrees with itself". So this
// one re-derives the expectation IN THE TEST, from the op log, in four lines:
// walk the log, keep the last write per (record, field), and require the
// projected file to hold exactly that.
//
// The op sequence comes from the registry's `dualSpellingWrite` class alone, so
// every record under test carries BOTH the flat and the register spelling of its
// position, with the register deliberately STALE and the insertion order varied.
// That is the shape a `migrateV1ToV2`-migrated record has in production, and the
// shape whose collision used to be resolved by `Y.Map` insertion order — a
// function of local integration history, not of state.
//
// The check is universal over every dual record the run created, on every
// replica, and it is a check on the FILE, not on the doc: the doc holds the right
// answer under one spelling and the wrong one under the other, so a doc-level
// oracle would call the document perfectly healthy.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb1_2302;

describe("WP23 blind1 — the last FLAT write wins, re-derived from the op log", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("every dual-spelled record shows the value the last op authored, on every replica", async () => {
    let recordsChecked = 0;
    let createdBothOrders = { flatFirst: 0, registerFirst: 0 };

    for (let index = 0; index < 24; index++) {
      await runFuzzScenario({
        seed: SEED + index,
        windows: 7,
        registry: createStandardRegistry().subset(["dualSpellingWrite"]),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas, trace) => {
          // THE EXPECTATION, re-derived here from the log and nothing else.
          const lastWrite = new Map<string, unknown>();
          for (const entry of trace.log) {
            if (entry.slot.pseudo || entry.contested) continue;
            lastWrite.set(`${entry.slot.kind}|${entry.slot.id}|${entry.slot.field}`, entry.value);
          }

          for (const record of trace.allRecords("node")) {
            if (record.shape !== "dual") continue;
            if (!trace.expectedVisible("node", record.id)) continue;
            createdBothOrders[record.keyOrder] += 1;
            recordsChecked += 1;
            for (const [replicaIndex, file] of replicas.map(projectFile).entries()) {
              const projected = file.nodes.find((node) => node.id === record.id);
              expect(
                projected,
                `replica ${replicaIndex}: the dual-spelled node "${record.id}" is not in the file`,
              ).toBeDefined();
              for (const field of ["x", "y"]) {
                const expected = lastWrite.get(`node|${record.id}|${field}`);
                if (expected === undefined) continue;
                expect(
                  projected?.[field],
                  `replica ${replicaIndex}: node "${record.id}" (${record.keyOrder}) shows ` +
                    `${field}=${JSON.stringify(projected?.[field])}, but the last op to write that ` +
                    `field authored ${JSON.stringify(expected)}. The register spelling is a stale ` +
                    `translation; which key was inserted first is not a merge rule.`,
                ).toBe(expected);
              }
            }
          }
        },
      });
    }

    expect(recordsChecked, "no dual-spelled record was ever checked").toBeGreaterThan(0);
    // AC5 requires the insertion order to be VARIED, not merely parameterised.
    expect(
      createdBothOrders.flatFirst,
      "no record was ever built with the flat keys inserted first",
    ).toBeGreaterThan(0);
    expect(
      createdBothOrders.registerFirst,
      "no record was ever built with the register inserted first",
    ).toBeGreaterThan(0);
  }, FUZZ_TEST_TIMEOUT_MS);
});
