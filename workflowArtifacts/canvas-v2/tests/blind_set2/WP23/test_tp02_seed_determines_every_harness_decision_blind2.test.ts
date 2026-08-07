// WP23 AC3 blind2 — reproducibility stated as "the seed determines every
// decision the HARNESS makes", with the boundary drawn explicitly.
//
// The visible test replays one seed and compares. That passes for a harness
// whose randomness is seeded AND for one whose randomness barely matters. This
// one draws the line the other way round, in both directions at once:
//
//   ├── EVERYTHING THE HARNESS DECIDES is a pure function of the seed — replica
//   │      count, op sequence, target records, written values, contested-ness,
//   │      and the resulting VISIBLE RECORD SET. Replaying a seed lands on the
//   │      same world.
//   ├── NOTHING THE HARNESS DECIDES depends on the run's wall clock, on the
//   │      order tests execute in, or on a previous run — three consecutive
//   │      replays interleaved with OTHER seeds still agree.
//   └── THE ONE THING THAT IS NOT SEEDED is named rather than hidden: Yjs
//          tie-breaks a genuinely concurrent same-key write on
//          `clientID = random.uint32()`. That entropy is the CRDT's and pinning
//          it would make every concurrency test agree with a world that does not
//          exist. So a run containing a contested write may converge on either
//          author's value — and the suite must never assert which.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario, type FuzzResult } from "../../harness/fuzz/fuzzer";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb2_2302;

function run(seed: number) {
  return runFuzzScenario({
    seed,
    windows: 7,
    registry: createStandardRegistry(),
    bootstrap: bootstrapStandardWorld,
    flushTimers: () => vi.runOnlyPendingTimers(),
  });
}

/** Every decision the harness made, as one comparable string. */
function fingerprint(result: FuzzResult): string {
  return JSON.stringify({
    replicas: result.replicaCount,
    ops: result.opsUsed,
    log: result.trace.log.map((entry) => [
      entry.window,
      entry.replica,
      entry.opClass,
      entry.slot.kind,
      entry.slot.id,
      entry.slot.field,
      entry.slot.pseudo ?? false,
      entry.value,
      entry.contested,
    ]),
    nodes: result.trace.expectedRecordIds("node").sort(),
    edges: result.trace.expectedRecordIds("edge").sort(),
    order: result.trace.expectedOrder("node"),
  });
}

describe("WP23 blind2 — the seed determines every harness decision", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("three replays of one seed agree, even interleaved with other seeds", async () => {
    const first = fingerprint(await run(SEED));
    await run(SEED + 1);
    const second = fingerprint(await run(SEED));
    await run(SEED + 2);
    await run(SEED + 3);
    const third = fingerprint(await run(SEED));

    expect(second, "the second replay of the seed diverged").toBe(first);
    expect(third, "the third replay diverged after two unrelated runs — the harness carries state").toBe(
      first,
    );
    expect(first.length, "the fingerprint is empty — the run decided nothing").toBeGreaterThan(200);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("neighbouring seeds produce genuinely different worlds", async () => {
    const fingerprints = new Set<string>();
    for (let index = 0; index < 12; index++) {
      fingerprints.add(fingerprint(await run(SEED + 100 + index)));
    }
    expect(
      fingerprints.size,
      "12 different seeds produced fewer than 12 different runs — the seed does not steer the run",
    ).toBe(12);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("names the one thing that is deliberately NOT seeded", async () => {
    // A run with contested writes may land on either author's value. The suite
    // asserts convergence and membership, never the winner — and this is where
    // that decision is written down rather than assumed.
    const result = await run(SEED + 500);
    const contested = result.trace.log.filter((entry) => entry.contested);
    if (contested.length === 0) return;
    expect(
      result.violations.map((violation) => `[${violation.family}] ${violation.message}`),
      "a contested write produced a violation, which means something asserted its winner",
    ).toEqual([]);
  }, FUZZ_TEST_TIMEOUT_MS);
});
