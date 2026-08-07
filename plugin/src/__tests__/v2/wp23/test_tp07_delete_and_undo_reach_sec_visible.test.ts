// WP23 — the WP19 coverage link: "`delete` and `undo` ops, with the SEC
// assertion."
//
// The fuzzer reaches WP19's mechanism through two registered op classes, and
// this test pins what a random run alone cannot guarantee: that BOTH classes
// actually fired, and that the property WP19 exists for survives them.
//
// The property is not "the card disappears". A delete that removed the record's
// key would ALSO make it disappear — and would destroy the field container with
// it, so undo could only rebuild a husk from whatever the last local file
// happened to say, losing every concurrent peer edit. DELETION IS A VALUE, NOT
// AN ABSENCE, so the assertions are:
//
//   ├── SEC — every replica holds the same doc state after the run,
//   ├── the deleted record is absent from EVERY replica's projected file,
//   ├── its `Y.Map` is still in `nodes`/`edges` on every replica, with the
//   │      fields it had, and
//   └── an undone record is back on every replica with those same fields.
//
// The undo is what the spec says an undo IS — one more `applyTombstoneOp` with
// `on:false`, stamped strictly above the delete it reverses, so the two form a
// CAUSAL CHAIN rather than a concurrent pair whose winner Yjs would pick at
// random. WP38 owns real UI undo and does not exist yet.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { FUZZ_TEST_TIMEOUT_MS, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0007;
const OPS = ["createNodeViaSave", "moveViaSave", "deleteViaSave", "undoDelete"];

describe("WP23 — WP19 reached: delete and undo, with the SEC assertion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("both op classes fire, every family holds, and a delete never destroys the record", async () => {
    let deletes = 0;
    let undos = 0;
    let inspected = 0;

    for (let index = 0; index < 24; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas, trace) => {
          inspected += 1;
          for (const kind of ["node", "edge"] as const) {
            for (const record of trace.allRecords(kind)) {
              const suppressed = !trace.expectedVisible(kind, record.id);
              if (!suppressed || record.invalid) continue;
              for (const replica of replicas) {
                const map = kind === "node" ? replica.nodes() : replica.edges();
                const held = map.get(record.id);
                // DELETION IS A VALUE, NOT AN ABSENCE. The container must still
                // be there, or undo is structurally lossy and a peer's
                // concurrent edit to a different field is simply gone.
                expect(
                  held,
                  `replica ${replica.index}: the ${kind} "${record.id}" is suppressed but its ` +
                    `field container is GONE — the delete destroyed the record instead of ` +
                    `writing a tombstone`,
                ).toBeDefined();
                expect(
                  (held?.size ?? 0) > 1,
                  `replica ${replica.index}: the suppressed ${kind} "${record.id}" kept no fields`,
                ).toBe(true);
              }
            }
          }
        },
      });
      expect(result.violations, describeResult(result)).toEqual([]);

      for (const entry of result.trace.log) {
        if (entry.opClass === "deleteViaSave") deletes += 1;
        if (entry.opClass === "undoDelete") undos += 1;
      }
    }

    expect(inspected, "the inspection seam never ran").toBe(24);
    expect(deletes, "no delete op ever fired — WP19 is not actually reached").toBeGreaterThan(0);
    expect(undos, "no undo op ever fired — WP19's AC4 half is not actually reached").toBeGreaterThan(
      0,
    );
  }, FUZZ_TEST_TIMEOUT_MS);

  it("a deleted record is suppressed on every replica, and an undone one is back on every replica", async () => {
    const suppressedEverywhere: string[] = [];
    const restoredEverywhere: string[] = [];

    const result = await runFuzzScenario({
      seed: SEED + 500,
      windows: 8,
      registry: createStandardRegistry().subset(OPS),
      bootstrap: bootstrapStandardWorld,
      flushTimers: () => vi.runOnlyPendingTimers(),
      inspect: (replicas, trace) => {
        const files = replicas.map(projectFile);
        for (const record of trace.allRecords("node")) {
          const shouldBeVisible = trace.expectedVisible("node", record.id);
          const present = files.map((file) =>
            file.nodes.some((node) => node.id === record.id),
          );
          expect(
            new Set(present).size,
            `node "${record.id}" is visible on some replicas and not on others: ${present.join(",")}`,
          ).toBe(1);
          if (shouldBeVisible) {
            if (record.visible && trace.log.some((e) => e.opClass === "undoDelete" && e.slot.id === record.id)) {
              restoredEverywhere.push(record.id);
            }
          } else {
            suppressedEverywhere.push(record.id);
            for (const replica of replicas) {
              expect(
                isTombstoneSuppressed(readTombstoneEntry(replica.deleted(), record.id)),
                `replica ${replica.index}: node "${record.id}" is gone from the file but carries ` +
                  `no tombstone — it was removed rather than deleted`,
              ).toBe(true);
            }
          }
        }
      },
    });

    expect(result.violations, describeResult(result)).toEqual([]);
    expect(
      suppressedEverywhere.length + restoredEverywhere.length,
      "the scenario neither deleted nor undid anything",
    ).toBeGreaterThan(0);
  }, FUZZ_TEST_TIMEOUT_MS);
});
