// WP23 blind1, WP17 link — byte equality restated as a CARDINALITY.
//
// "Replica i serialises the same text as replica 0" is a pairwise assertion that
// grows weaker the more replicas there are: with five peers it is four
// comparisons against one arbitrarily privileged replica. The property is
// simpler than that and stronger stated directly: ACROSS THE WHOLE MESH THERE IS
// EXACTLY ONE DISTINCT SERIALISATION.
//
// It is also checked at every window boundary rather than only at the end,
// because byte equality is V2's ECHO BREAKER: a mesh that disagrees on the bytes
// for one window and re-agrees later has, in that window, made every write echo
// back as a change nobody made. A run that only looks at the end state cannot
// see that at all.
//
// Two further things are required, so the cardinality cannot be satisfied
// vacuously by an empty file:
//
//   ├── the single serialisation parses and holds records, and
//   └── `ord`, which exists only in the doc, never appears in it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb1_2305;

describe("WP23 blind1 — exactly one distinct serialisation, at every window boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the mesh never holds two different `.canvas` texts, in any settled window", async () => {
    let boundaries = 0;
    let recordsSeen = 0;

    for (let index = 0; index < 24; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry(),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        onWindowSettled: (replicas, window) => {
          boundaries += 1;
          const texts = new Set(replicas.map((replica) => projectFile(replica).text));
          expect(
            texts.size,
            `window ${window}: the mesh holds ${texts.size} different \`.canvas\` texts for one ` +
              `converged doc. Byte equality is V2's echo breaker, so in this window every write ` +
              `echoes back as a change nobody made.\n${[...texts].join("\n---\n")}`,
          ).toBe(1);

          const parsed = JSON.parse([...texts][0]) as {
            nodes: Record<string, unknown>[];
            edges: Record<string, unknown>[];
          };
          recordsSeen += parsed.nodes.length + parsed.edges.length;
          for (const record of [...parsed.nodes, ...parsed.edges]) {
            expect(
              Object.prototype.hasOwnProperty.call(record, "ord"),
              `record "${String(record.id)}" carried the doc-only \`ord\` key to disk`,
            ).toBe(false);
            expect(
              Object.prototype.hasOwnProperty.call(record, "pos"),
              `record "${String(record.id)}" carried the doc-only \`pos\` register to disk`,
            ).toBe(false);
          }
        },
      });
      expect(
        result.violations.map((violation) => `[${violation.family}] ${violation.message}`),
        `seed ${SEED + index}`,
      ).toEqual([]);
    }

    expect(boundaries, "no window boundary was ever inspected").toBeGreaterThan(24 * 8);
    expect(recordsSeen, "every inspected file was empty").toBeGreaterThan(24 * 8);
  }, FUZZ_TEST_TIMEOUT_MS);
});
