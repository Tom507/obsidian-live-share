// WP23 AC5 blind2 — the headline property over a DIFFERENT seed band, with the
// coverage requirement stated as a precondition rather than as a hope.
//
// A fuzzer's green is only as good as what it actually drew. The visible
// headline runs one seed band; if that band happened to miss the collision class
// — the op producing a record with BOTH spellings of one fact — the run would be
// green and would have proved nothing about the defect the whole AC exists for.
//
// So this run asserts the precondition FIRST and the property second:
//
//   ├── the collision class was drawn, in BOTH insertion orders,
//   ├── a delete, an undo, a fault injection, a partial capture and a stale-view
//   │      save were all drawn — i.e. every WP link is genuinely exercised, and
//   └── then, and only then: every field the ops touched holds the value the LAST
//          op on that field wrote, on every replica.
//
// The last clause is the one that separates correctness from consensus. Every
// replica agreeing on a value is necessary and is not sufficient: the WP18 batch
// found a real bug where all four convergence families were green over a
// corrupted document.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb2_2305;
const SCENARIOS = 96;

/** Every op class that must be drawn somewhere in the band for the run to count. */
const REQUIRED_CLASSES = [
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
  "injectInvalidEdge",
  "repairInvalidEdge",
  "staleObsidianSave",
  "contendedFieldWrite",
  "contendedAtomicRegister",
];

describe("WP23 blind2 — intent is honoured, over a fresh seed band", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("draws every op class and every insertion order, and then honours the op log", async () => {
    const drawn = new Set<string>();
    const keyOrders = new Set<string>();
    const failures: string[] = [];
    let totalOps = 0;
    let totalWrites = 0;

    for (let index = 0; index < SCENARIOS; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 9,
        registry: createStandardRegistry(),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (_replicas, trace) => {
          for (const record of trace.allRecords("node")) {
            if (record.shape === "dual") keyOrders.add(record.keyOrder);
          }
        },
      });
      for (const name of result.opsUsed) drawn.add(name);
      totalOps += result.opsApplied;
      totalWrites += result.loggedWrites;
      if (result.violations.length > 0) failures.push(describeResult(result));
    }

    // PRECONDITION: the band actually reached everything it claims to.
    const missing = REQUIRED_CLASSES.filter((name) => !drawn.has(name));
    expect(
      missing,
      `these op classes were never drawn across ${SCENARIOS} scenarios, so the green below says ` +
        `nothing about them: ${missing.join(", ")}`,
    ).toEqual([]);
    expect(
      [...keyOrders].sort(),
      "the collision class was not produced in BOTH insertion orders — AC5 requires the order to " +
        "be VARIED, because insertion order is a function of local integration history",
    ).toEqual(["flatFirst", "registerFirst"]);
    expect(totalOps, "the band applied almost no ops").toBeGreaterThan(SCENARIOS * 2);
    expect(totalWrites, "the op log recorded almost no writes").toBeGreaterThan(SCENARIOS * 20);

    // THE PROPERTY.
    expect(failures.join("\n\n"), "the fuzzer found a counter-example").toBe("");
  }, FUZZ_TEST_TIMEOUT_MS);
});
