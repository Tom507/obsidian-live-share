// WP23 — two coverage links in one place, because they are the two halves of
// AC2 that a fuzzer is uniquely able to check:
//
//   ├── WP17 — "the canonical-serialisation byte-equality family." Every replica
//   │      must produce the byte-identical `.canvas` text from the converged doc.
//   │      This is not cosmetic: byte equality IS V2's echo breaker, so two peers
//   │      writing different bytes for the same truth means every write echoes
//   │      back as a change nobody made.
//   └── WP4/WP5 — the SHADOW family, the W1 discriminant. A save made from a
//          DELIBERATELY STALE view model must have its stale fields DISCARDED,
//          not pushed back over the newer values the doc already holds.
//
// The stale save is the one op in the registry that can only be judged against
// knowledge the implementation does not have: whether the surface it came from
// was current. The harness knows, because the harness built that surface — it
// replays a snapshot of the simulated Obsidian view that is at least two windows
// old, carrying one genuinely new intent so the byte echo breaker does not
// (correctly) recognise the file as this client's own last write and skip the
// pass entirely.
//
// Both are asserted with EVIDENCE that the mechanism ran, not merely that
// nothing broke: a stale save that was silently skipped would also produce zero
// stale pushes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0011;
const OPS = ["moveViaSave", "resizeViaSave", "relabelViaSave", "staleObsidianSave", "reorderRecord"];

describe("WP23 — WP17 byte identity and the stale-save discriminant", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("every replica serialises the byte-identical file, and reordering does not change that", async () => {
    let comparisons = 0;
    for (let index = 0; index < 32; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas) => {
          const texts = replicas.map((replica) => projectFile(replica).text);
          for (let i = 1; i < texts.length; i++) {
            comparisons += 1;
            expect(
              texts[i],
              `replica ${i} serialised different bytes from replica 0 for the same converged doc — ` +
                `byte equality is V2's echo breaker, so this makes every write echo back as a ` +
                `change nobody made`,
            ).toBe(texts[0]);
          }
          // And it is a real file, not two empty ones matching vacuously.
          expect(JSON.parse(texts[0]).nodes.length, "the converged file has no records").toBeGreaterThan(
            0,
          );
        },
      });
      expect(result.violations, describeResult(result)).toEqual([]);
    }
    expect(comparisons, "no cross-replica byte comparison ever ran").toBeGreaterThan(32);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("a save from a stale view model is discarded, never pushed — and the pass provably ran", async () => {
    let staleSaves = 0;
    let discardSignatures = 0;

    for (let index = 0; index < 32; index++) {
      const result = await runFuzzScenario({
        seed: SEED + 400 + index,
        windows: 9,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas) => {
          for (const replica of replicas) {
            expect(
              replica.stalePushes,
              `replica ${replica.index} pushed a field its own surface had gone stale on, over the ` +
                `newer value the doc already held — that is the Symptom-2 cascade`,
            ).toEqual([]);
            discardSignatures += replica.signatures.filter((line) =>
              line.startsWith("SHADOW STALE:"),
            ).length;
          }
        },
      });
      expect(result.violations, describeResult(result)).toEqual([]);
      staleSaves += result.trace.log.filter(
        (entry) => entry.opClass === "staleObsidianSave",
      ).length;
    }

    expect(
      staleSaves,
      "no stale-view save ever ran — the W1 discriminant is not actually exercised",
    ).toBeGreaterThan(0);
    // The capture path emits `SHADOW STALE:` for a pass with at least one
    // DIVERGENT discard, i.e. a field the save re-stated at the shadow's value
    // while the CRDT had genuinely moved on. Its presence is the proof that the
    // stale save was classified rather than skipped by the byte echo breaker.
    expect(
      discardSignatures,
      "no pass ever reported a divergent discard, so nothing proves a stale field was seen and " +
        "rejected rather than never noticed",
    ).toBeGreaterThan(0);
  }, FUZZ_TEST_TIMEOUT_MS);
});
