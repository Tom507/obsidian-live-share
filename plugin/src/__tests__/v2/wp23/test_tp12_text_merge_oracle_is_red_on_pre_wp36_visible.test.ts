// WP36 follow-up (B32) — THE PROOF THAT THE MIGRATED TEXT ORACLE IS STRICTLY
// STRONGER THAN THE ONE IT REPLACED.
//
// WP36 made card text a nested `Y.Text`. Thirteen inherited assertions went red,
// and the two fuzzer families among them — `[lww]`'s "my whole write landed
// verbatim" and `[intent-trace]`'s "the value equals what the LAST op wrote" —
// were both restatements of *"`text` is a whole-string LWW register"*, which is
// the property WP36 was chartered to remove. `standard-ops.ts` said so itself,
// on `relabelViaSave`, before this batch existed.
//
// Migrating them is therefore legitimate. Migrating them into something WEAKER
// would not be, and that is the easy mistake: an oracle that re-asserts
// convergence would go green, look reasonable, and be satisfied by exactly the
// data loss WP36 exists to prevent — two replicas agreeing on a string with one
// peer's characters destroyed is a perfectly convergent document.
//
// So the binding condition is that THE REPLACEMENT MUST FAIL ON THE BEHAVIOUR IT
// REPLACES, and this file executes that rather than arguing it:
//
//   ├── RED  — the same seeds, the same ops, the same oracle, with every
//   │      replica built through `CanvasSync.setCollabTextEnabled(false)`: the
//   │      pre-WP36 whole-string LWW register, byte for byte. The `text-merge`
//   │      family must report violations, and at least one of them must be the
//   │      "TWO AUTHORS WROTE THIS FIELD CONCURRENTLY AND ONE OF THEM LOST"
//   │      sentence — the loss itself, not a shape complaint about it.
//   └── GREEN — the identical run on the real build: zero violations, in every
//          family.
//
// A MIGRATION THAT CANNOT FAIL ON THE BEHAVIOUR IT REPLACED HAS MIGRATED
// NOTHING. That sentence is this file's acceptance criterion.
//
// Note on what the RED half proves and what it does not: it proves the loss is
// VISIBLE to the new oracle and INVISIBLE to the four convergence families. It
// is not a claim that the old code was wrong to converge — it converged
// perfectly. That is the point.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { familiesHit } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0012;
const SCENARIOS = 24;

/** The two ops that write `text` concurrently — the whole subject of this file. */
const OPS = ["textEditViaSave", "contendedFieldWrite", "moveViaSave", "relabelViaSave"];

async function runBand(collabText: boolean) {
  const violations: string[] = [];
  const families = new Set<string>();
  let opsUsed = new Set<string>();
  let opsApplied = 0;

  for (let index = 0; index < SCENARIOS; index++) {
    const result = await runFuzzScenario({
      seed: SEED + index,
      windows: 6,
      replicaCount: 3,
      collabText,
      registry: createStandardRegistry().subset(OPS),
      bootstrap: bootstrapStandardWorld,
      flushTimers: () => vi.runOnlyPendingTimers(),
    });
    opsApplied += result.opsApplied;
    opsUsed = new Set([...opsUsed, ...result.opsUsed]);
    for (const violation of result.violations) {
      families.add(violation.family);
      violations.push(`[${violation.family}] ${violation.message}`);
    }
    // The convergence families are the control WITHIN the control: they must
    // stay green on BOTH builds. If the pre-WP36 build went red on `sec` or
    // `bytes` too, this file would be measuring a broken run rather than a lost
    // edit, and the RED half would prove nothing about the oracle.
    for (const family of familiesHit(result.violations)) {
      expect(
        ["sec", "bytes", "schema"].includes(family),
        `seed ${result.seed}: a CONVERGENCE family (${family}) failed. This file's whole ` +
          `argument is that the pre-WP36 text loss is invisible to convergence — a convergence ` +
          `failure here means the run is broken, not that an edit was lost.`,
      ).toBe(false);
    }
  }
  return { violations, families, opsUsed, opsApplied };
}

describe("WP36 follow-up — the migrated text oracle is RED on the whole-string LWW register", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it(
    "GREEN on the real build: every family, including text-merge, holds over the band",
    async () => {
      const green = await runBand(true);

      // Vacuity guard: an oracle that never ran is not an oracle. The op that
      // types two characters into one word has to have been drawn.
      expect(
        green.opsUsed.has("textEditViaSave"),
        "the concurrent character-level edit op never ran — this band proves nothing",
      ).toBe(true);
      expect(green.opsApplied).toBeGreaterThan(0);

      expect(green.violations.join("\n"), "the real build violated a family").toBe("");
    },
    FUZZ_TEST_TIMEOUT_MS,
  );

  it(
    "RED on the pre-WP36 build: the same oracle, the same seeds, one author's characters gone",
    async () => {
      const red = await runBand(false);

      expect(
        red.families.has("text-merge"),
        "THE MIGRATION FAILED ITS OWN TEST. The pre-WP36 whole-string LWW register produced no " +
          "`text-merge` violation at all, which means the replacement oracle cannot fail on the " +
          "behaviour it replaced and is therefore not stronger than it — it is merely different.",
      ).toBe(true);

      // And the violation must be the LOSS, stated as a loss. A `text-merge`
      // family that only ever complained about the shape of the value would be
      // a representation check wearing a correctness check's name.
      const lost = red.violations.filter((message) =>
        message.includes("TWO AUTHORS WROTE THIS FIELD CONCURRENTLY AND ONE OF THEM LOST"),
      );
      expect(
        lost.length,
        "no violation reported a concurrent edit being destroyed. The oracle went red for some " +
          "other reason, and the strictly-stronger claim is unproven.\n" +
          red.violations.slice(0, 5).join("\n"),
      ).toBeGreaterThan(0);

      // The `[lww]` half of the pair, likewise: the pre-WP36 register never
      // leaves a nested `Y.Text` behind (C36 AC1).
      expect(
        red.violations.some((message) =>
          message.includes("not a collaborative text"),
        ),
        "the `[lww]` shape clause did not fire on the pre-WP36 register either",
      ).toBe(true);
    },
    FUZZ_TEST_TIMEOUT_MS,
  );
});
