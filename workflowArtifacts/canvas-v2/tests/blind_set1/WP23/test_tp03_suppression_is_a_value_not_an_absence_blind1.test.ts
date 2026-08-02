// WP23 blind1, WP19 link — the delete property read from the TOMBSTONE
// CONTAINER instead of from the file.
//
// The visible test asks the file whether a deleted record is gone. That is the
// user-visible half and it is satisfiable by an implementation that removes the
// record's key — which also destroys its field container, makes undo lossy, and
// gives the delete no author and no time to merge with.
//
// So this asserts the same property one level down, where the difference is
// visible:
//
//   ├── every suppressed id has a tombstone ENTRY on EVERY replica, and the
//   │      entries are byte-identical across replicas (agreement, never "replica
//   │      1's op won" — `by` is a `random.uint32()` coin flip),
//   ├── the record's `Y.Map` is still in its container with more than its id, and
//   └── the two sets agree EXACTLY: suppressed-in-the-container ⇔ absent-from-
//          the-file, for every record and every replica. A record that is hidden
//          on disk without a tombstone was removed rather than deleted; a record
//          with a tombstone that is still on disk means the projection ignores it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb1_2303;
const OPS = ["createNodeViaSave", "deleteViaSave", "undoDelete", "rerouteViaSave", "moveViaSave"];

describe("WP23 blind1 — deletion is a value, and the value agrees with the file", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("suppressed-in-the-container and absent-from-the-file are the same set on every replica", async () => {
    let suppressedSeen = 0;
    let containersKept = 0;

    for (let index = 0; index < 24; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas, trace) => {
          const files = replicas.map(projectFile);
          for (const kind of ["node", "edge"] as const) {
            for (const record of trace.allRecords(kind)) {
              const entries = replicas.map((replica) =>
                readTombstoneEntry(replica.deleted(), record.id),
              );
              // AGREEMENT on the entry itself, across every replica.
              for (let i = 1; i < entries.length; i++) {
                expect(
                  entries[i],
                  `replica ${i}: a different tombstone entry for ${kind} "${record.id}"`,
                ).toEqual(entries[0]);
              }

              const suppressed = isTombstoneSuppressed(entries[0]);
              if (suppressed) suppressedSeen += 1;

              for (const [replicaIndex, replica] of replicas.entries()) {
                const map = kind === "node" ? replica.nodes() : replica.edges();
                const container = map.get(record.id);
                if (suppressed) {
                  // DELETION IS A VALUE: the container survives its own delete.
                  expect(
                    container,
                    `replica ${replicaIndex}: ${kind} "${record.id}" is suppressed and its field ` +
                      `container is gone — undo could only rebuild a husk`,
                  ).toBeDefined();
                  if (container && container.size > 1) containersKept += 1;
                }
                const onDisk = (kind === "node" ? files[replicaIndex].nodes : files[replicaIndex].edges).some(
                  (projected) => projected.id === record.id,
                );
                if (suppressed) {
                  expect(
                    onDisk,
                    `replica ${replicaIndex}: ${kind} "${record.id}" carries a tombstone and is ` +
                      `STILL on disk — the projection ignores the suppression rule`,
                  ).toBe(false);
                }
              }
            }
          }
        },
      });
      expect(
        result.violations.map((violation) => `[${violation.family}] ${violation.message}`),
        `seed ${SEED + index}`,
      ).toEqual([]);
    }

    expect(suppressedSeen, "no record was ever suppressed — the delete path is not reached").toBeGreaterThan(
      0,
    );
    expect(
      containersKept,
      "no suppressed record kept its fields — every delete destroyed its record",
    ).toBeGreaterThan(0);
  }, FUZZ_TEST_TIMEOUT_MS);
});
