// WP23 / AC1 (first clause) — "the fuzzer runs 3–5 simulated replicas (NEVER 2)".
//
// This is not a stylistic preference and it is not "more is better". With two
// peers, an agreed-but-WRONG outcome and a genuinely converged one produce the
// same picture, and the interleaving classes that only exist from three peers
// upward are precisely where a repair pass goes wrong: replica 1 acts, replica 2
// acts concurrently, and replica 3 receives BOTH and must treat neither as news.
// A two-peer harness cannot construct that state at all.
//
// So the band is enforced in the core, not left to the caller's discretion, and
// asking for two is refused loudly rather than quietly honoured.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, FUZZ_BUDGET, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0001;

function scenario(seed: number, replicaCount?: number) {
  return runFuzzScenario({
    seed,
    replicaCount,
    windows: 4,
    registry: createStandardRegistry(),
    bootstrap: bootstrapStandardWorld,
    flushTimers: () => vi.runOnlyPendingTimers(),
  });
}

describe("WP23 AC1 — 3 to 5 replicas, never 2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refuses a two-replica run outright", async () => {
    await expect(scenario(SEED, 2)).rejects.toThrow(/3.5 replicas, never 2/);
    await expect(scenario(SEED, 1)).rejects.toThrow(/never 1/);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("declares the band as a constant, and the drawn count always lies inside it", async () => {
    expect(FUZZ_BUDGET.minReplicas, "the lower bound is not 3").toBe(3);
    expect(FUZZ_BUDGET.maxReplicas, "the upper bound is not 5").toBe(5);

    const drawn = new Set<number>();
    for (let index = 0; index < 32; index++) {
      const result = await scenario(SEED + index);
      drawn.add(result.replicaCount);
      expect(result.replicaCount, `seed ${SEED + index} drew ${result.replicaCount} replicas`)
        .toBeGreaterThanOrEqual(3);
      expect(result.replicaCount).toBeLessThanOrEqual(5);
    }
    // All three counts must actually occur, or the band is nominal rather than real.
    expect([...drawn].sort(), "the fuzzer never drew all three replica counts").toEqual([3, 4, 5]);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("every count in the band converges and satisfies every family", async () => {
    for (const replicaCount of [3, 4, 5]) {
      const result = await scenario(SEED + 100 + replicaCount, replicaCount);
      expect(result.violations, describeResult(result)).toEqual([]);
      expect(result.replicaCount).toBe(replicaCount);
    }
  }, FUZZ_TEST_TIMEOUT_MS);
});
