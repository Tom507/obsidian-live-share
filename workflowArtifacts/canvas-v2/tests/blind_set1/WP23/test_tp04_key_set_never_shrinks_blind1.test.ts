// WP23 blind1, WP22 link — I7 as a MONOTONICITY property over the whole run,
// not as a check on the record a capture happened to touch.
//
// The visible test asks whether the captured record still has its keys. That
// names a record and a moment. The real invariant is broader and easier to state:
// ACROSS A WHOLE RUN, NO RECORD'S DOC KEY SET EVER SHRINKS unless the record was
// explicitly rebuilt by the one op class that rebuilds records.
//
// Stated that way it catches things the narrow form cannot:
//
//   ├── a sweep in a code path the capture op does not go through,
//   ├── a removal that only manifests on an INTEGRATING replica rather than on
//   │      the author, and
//   └── a record losing a key it gained mid-run rather than one it started with.
//
// The measurement is taken per window rather than only at the end, so a key that
// disappears and is later rewritten is still caught.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb1_2304;
const OPS = [
  "partialCapture",
  "moveViaSave",
  "resizeViaSave",
  "relabelViaSave",
  "rerouteViaSave",
  "createNodeViaSave",
  "moveRegisterOnly",
];

describe("WP23 blind1 — a record's key set never shrinks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("no key ever disappears from any record on any replica", async () => {
    let observations = 0;

    for (let index = 0; index < 24; index++) {
      // The high-water mark of every record's key set, per replica.
      const seen = new Map<string, Set<string>>();

      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        onWindowSettled: (replicas) => {
          for (const replica of replicas) {
            for (const kind of ["node", "edge"] as const) {
              const map = kind === "node" ? replica.nodes() : replica.edges();
              for (const [id, record] of map) {
                const key = `${replica.index}|${kind}|${id}`;
                const now = new Set<string>(record.keys());
                const before = seen.get(key);
                if (before) {
                  const lost = [...before].filter((field) => !now.has(field));
                  expect(
                    lost,
                    `replica ${replica.index}: ${kind} "${id}" lost ${lost.join(", ")}. A capture ` +
                      `is a PARTIAL OBSERVATION — absence carries no intent, and a removal ` +
                      `propagates to every replica exactly like any other write.`,
                  ).toEqual([]);
                }
                seen.set(key, before ? new Set([...before, ...now]) : now);
                observations += 1;
              }
            }
          }
        },
      });
      expect(
        result.violations.map((violation) => `[${violation.family}] ${violation.message}`),
        `seed ${SEED + index}`,
      ).toEqual([]);
    }

    expect(observations, "no record was ever observed — the run was empty").toBeGreaterThan(100);
  }, FUZZ_TEST_TIMEOUT_MS);
});
