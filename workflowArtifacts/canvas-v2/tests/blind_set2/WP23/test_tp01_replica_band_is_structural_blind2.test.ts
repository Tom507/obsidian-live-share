// WP23 AC1 blind2 — the replica band as a property of the CORE, not of the caller.
//
// The visible test checks that the drawn count lands in 3–5 and that 2 is
// refused. Both are true of a core that merely happens to draw well. This one
// asks the harder question: is the band enforced where it cannot be bypassed?
//
//   ├── an EXPLICIT `replicaCount` of 0, 1 or 2 is refused — the caller cannot
//   │      opt out, and the refusal names the reason rather than throwing a
//   │      generic error,
//   ├── over a large seed band the drawn count is ALWAYS in range and every
//   │      value in the band actually occurs — a "3–5" that only ever draws 3 is
//   │      a three-replica harness with a wider type, and
//   └── the property under test survives at each count: with 3, 4 and 5 replicas
//          the same seed's op log is honoured on every replica.
//
// Why the band matters at all: with two peers, an agreed-but-WRONG outcome and a
// genuinely converged one produce the same picture, and the interleaving class
// where one replica receives two others' concurrent verdicts and must treat
// neither as news does not exist below three.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_BUDGET, FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb2_2301;

function run(seed: number, replicaCount?: number) {
  return runFuzzScenario({
    seed,
    replicaCount,
    windows: 5,
    registry: createStandardRegistry(),
    bootstrap: bootstrapStandardWorld,
    flushTimers: () => vi.runOnlyPendingTimers(),
  });
}

describe("WP23 blind2 — 3 to 5 replicas is enforced by the core", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("an explicit sub-band replica count is refused, with the reason named", async () => {
    for (const count of [0, 1, 2]) {
      await expect(
        run(SEED, count),
        `a caller asked for ${count} replicas and the core allowed it`,
      ).rejects.toThrow(/never/);
    }
    await expect(run(SEED, 2)).rejects.toThrow(/agreed-but-wrong/);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("over 60 seeds the drawn count is always in band, and all three values occur", async () => {
    const histogram = new Map<number, number>();
    for (let index = 0; index < 60; index++) {
      const result = await run(SEED + index);
      expect(result.replicaCount).toBeGreaterThanOrEqual(FUZZ_BUDGET.minReplicas);
      expect(result.replicaCount).toBeLessThanOrEqual(FUZZ_BUDGET.maxReplicas);
      histogram.set(result.replicaCount, (histogram.get(result.replicaCount) ?? 0) + 1);
    }
    for (const count of [3, 4, 5]) {
      expect(
        histogram.get(count) ?? 0,
        `${count} replicas was never drawn over 60 seeds — the band is nominal`,
      ).toBeGreaterThan(0);
    }
  }, FUZZ_TEST_TIMEOUT_MS);

  it("the property holds at every count in the band, over the same seed", async () => {
    for (const replicaCount of [3, 4, 5]) {
      const result = await run(SEED + 900, replicaCount);
      expect(
        result.violations.map((violation) => `[${violation.family}] ${violation.message}`),
        `${replicaCount} replicas, seed ${SEED + 900}`,
      ).toEqual([]);
      expect(result.replicaCount).toBe(replicaCount);
      expect(result.quiesced, `${replicaCount} replicas never settled`).toBe(true);
    }
  }, FUZZ_TEST_TIMEOUT_MS);
});
