// WP23 / AC3 — "runs are reproducible from their seed, and any discovered
// counter-example is frozen as a named regression test."
//
// A counter-example a fuzzer cannot re-run is not a counter-example, it is an
// anecdote. Reproducibility is therefore the FIRST property, not a convenience:
// everything else in this suite — the fault-injection matrix, the regression
// freezing, the failure message that names a seed — rests on it.
//
// Two things have to hold, and only asserting the first is a common way to be
// wrong:
//
//   ├── SAME seed ⇒ byte-identical op log AND byte-identical converged file, and
//   └── DIFFERENT seed ⇒ a genuinely different op sequence. A "reproducible"
//          fuzzer whose seed does not actually steer anything is reproducible
//          and useless.
//
// The randomness is a hand-written mulberry32 (`prng.ts`) for exactly this
// reason: `Math.random()` cannot be replayed, and no property-testing library
// may be added (zero new runtime dependencies).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { createRng } from "../../harness/fuzz/prng";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0005;

function run(seed: number) {
  return runFuzzScenario({
    seed,
    windows: 6,
    registry: createStandardRegistry(),
    bootstrap: bootstrapStandardWorld,
    flushTimers: () => vi.runOnlyPendingTimers(),
  });
}

/** The op log as a stable string — the run's whole decision history. */
function logOf(result: Awaited<ReturnType<typeof run>>): string {
  return JSON.stringify(
    result.trace.log.map((entry) => [
      entry.window,
      entry.replica,
      entry.opClass,
      entry.slot.kind,
      entry.slot.id,
      entry.slot.field,
      entry.value,
      entry.contested,
    ]),
  );
}

describe("WP23 AC3 — a run is reproducible from its seed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the PRNG replays exactly, on its own", () => {
    const first = Array.from({ length: 64 }, () => createRng(1234).next());
    const again = Array.from({ length: 64 }, () => createRng(1234).next());
    expect(first, "two streams from one seed diverged").toEqual(again);

    const a = createRng(7);
    const b = createRng(7);
    const drawA = Array.from({ length: 64 }, () => a.int(1000));
    const drawB = Array.from({ length: 64 }, () => b.int(1000));
    expect(drawA, "the seeded integer stream is not replayable").toEqual(drawB);
    expect(new Set(drawA).size, "the stream is degenerate — it draws almost one value").toBeGreaterThan(
      20,
    );
  }, FUZZ_TEST_TIMEOUT_MS);

  it("the same seed replays the identical op log, op classes and replica count", async () => {
    const first = await run(SEED);
    const second = await run(SEED);

    expect(second.replicaCount, "the replica count is not a function of the seed").toBe(
      first.replicaCount,
    );
    expect(logOf(second), "the op log is not a function of the seed").toBe(logOf(first));
    expect(second.opsUsed, "the op classes drawn are not a function of the seed").toEqual(
      first.opsUsed,
    );
  }, FUZZ_TEST_TIMEOUT_MS);

  it("the CONVERGED FILE replays byte for byte — for a run with no contested write", async () => {
    // WHY THE REGISTRY IS NARROWED HERE, and why that is not a dodge.
    //
    // The winner of a GENUINELY CONCURRENT same-key write is tie-broken by Yjs
    // on `clientID = random.uint32()`. That entropy is Yjs's, not the harness's,
    // and it is deliberately NOT seeded — a `Y.Doc` in production gets a random
    // clientID too, and pinning it would make every concurrency test agree with
    // a world that does not exist. So the converged BYTES of a run containing a
    // contested write are not, and must not be, a function of the seed.
    //
    // What IS a function of the seed is everything the harness decides: the
    // replica count, the partition, the op sequence, the values written, the
    // delivery order and the duplication. That is what a frozen regression test
    // replays, and for a run with no contested write it lands on the same file
    // byte for byte.
    const deterministic = createStandardRegistry().subset([
      "createNodeViaSave",
      "moveViaSave",
      "resizeViaSave",
      "rerouteViaSave",
      "relabelViaSave",
      "deleteViaSave",
      "undoDelete",
      "reorderRecord",
      "dualSpellingWrite",
      "moveRegisterOnly",
      "partialCapture",
      "staleObsidianSave",
    ]);
    const settings = {
      windows: 6,
      registry: deterministic,
      bootstrap: bootstrapStandardWorld,
      flushTimers: () => vi.runOnlyPendingTimers(),
    };
    const first = await runFuzzScenario({ seed: SEED + 40, ...settings });
    const second = await runFuzzScenario({ seed: SEED + 40, ...settings });

    expect(
      first.trace.log.some((entry) => entry.contested),
      "this run was supposed to contain no contested write",
    ).toBe(false);
    expect(logOf(second), "the op log is not a function of the seed").toBe(logOf(first));
    expect(second.finalCanvas, "the converged `.canvas` is not a function of the seed").toBe(
      first.finalCanvas,
    );
    expect(first.finalCanvas.length, "the converged file is empty").toBeGreaterThan(64);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("a different seed steers the run somewhere else", async () => {
    const base = await run(SEED);
    let differed = 0;
    for (let index = 1; index <= 8; index++) {
      const other = await run(SEED + index);
      if (logOf(other) !== logOf(base)) differed += 1;
    }
    expect(
      differed,
      "changing the seed did not change the run — the seed does not steer anything and " +
        "'reproducible' is vacuously true",
    ).toBe(8);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("a failure message carries the seed that reproduces it", async () => {
    const result = await run(SEED);
    expect(result.reproduce, "the reproduction hint does not name the seed").toContain(
      `seed: ${SEED}`,
    );
    expect(result.reproduce).toContain(`replicaCount: ${result.replicaCount}`);
  }, FUZZ_TEST_TIMEOUT_MS);
});
