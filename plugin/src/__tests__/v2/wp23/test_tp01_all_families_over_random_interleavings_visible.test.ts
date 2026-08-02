// WP23 / AC1 + AC2 + AC5 (headline) — "convergence of the V2 model is checked
// over INTERLEAVINGS, not examples, and correctness is checked against INTENT
// rather than against consensus."
//
// This is the fuzzer itself, run over its budgeted scenario count. Each scenario
// draws 3–5 replicas (never 2), a random op sequence from the pluggable
// registry, random partitions, reordered and duplicated deltas and randomised
// Obsidian saves — including saves made from a deliberately STALE view model —
// and then asserts FIVE families on EVERY replica:
//
//   ├── sec          — identical doc state,
//   ├── schema       — no endpoint-less edge, no record without a position,
//   ├── bytes        — identical canonical serialisation,
//   ├── shadow       — no replica ever pushed a stale field, and
//   └── intent-trace — every field the ops touched holds the value the LAST OP
//                      on that field wrote, as computed by the harness from its
//                      OWN op log.
//
// The fifth is the one that can fail while the other four are green, which is
// the reason it exists: the WP18 batch found a real corruption bug of exactly
// that shape. It is asserted here as one list, so a failure names the family and
// carries the seed that reproduces it.
//
// No wall-clock sleeps and no new timing constants: the debounced audit is
// driven by vitest's fake timers, flushed at every synchronisation point.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, FUZZ_BUDGET, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { familiesHit } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

/** Base seed for the visible suite. Changing it changes WHICH interleavings run. */
const BASE_SEED = 0x5eed_23;

describe("WP23 AC1/AC2/AC5 — the convergence fuzzer over random interleavings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("every assertion family holds on every replica, over the budgeted scenarios", async () => {
    const failures: string[] = [];
    const exercised = new Set<string>();
    let replicaCounts = new Set<number>();
    let totalOps = 0;

    for (let index = 0; index < FUZZ_BUDGET.scenarios; index++) {
      const result = await runFuzzScenario({
        seed: BASE_SEED + index,
        registry: createStandardRegistry(),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
      });
      for (const name of result.opsUsed) exercised.add(name);
      replicaCounts.add(result.replicaCount);
      totalOps += result.opsApplied;
      if (result.violations.length > 0) failures.push(describeResult(result));
    }

    expect(failures.join("\n\n"), "the fuzzer found a counter-example").toBe("");

    // The run has to have been a real one. A fuzzer that declined every op would
    // also report zero violations, and that is the failure mode a green suite
    // hides best.
    expect(totalOps, "the fuzzer applied no ops at all — the green is vacuous").toBeGreaterThan(
      FUZZ_BUDGET.scenarios,
    );
    expect(
      exercised.size,
      `too few op classes were ever drawn (${[...exercised].join(", ")})`,
    ).toBeGreaterThanOrEqual(8);
    // AC1: 3–5 replicas, NEVER 2.
    expect([...replicaCounts].sort(), "the replica count left the 3–5 band").toEqual(
      [...replicaCounts].filter((count) => count >= 3 && count <= 5).sort(),
    );
    expect(replicaCounts.has(2), "a scenario ran with two replicas").toBe(false);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("reports which family caught a violation, so a failure is diagnosable", async () => {
    // A pure structural check on the reporting surface: with nothing broken the
    // family set is empty, which is also the baseline the fault-injection matrix
    // is measured against.
    const result = await runFuzzScenario({
      seed: BASE_SEED,
      registry: createStandardRegistry(),
      bootstrap: bootstrapStandardWorld,
      flushTimers: () => vi.runOnlyPendingTimers(),
    });
    expect([...familiesHit(result.violations)], describeResult(result)).toEqual([]);
    expect(result.quiesced, "the scenario never reached quiescence").toBe(true);
  }, FUZZ_TEST_TIMEOUT_MS);
});
