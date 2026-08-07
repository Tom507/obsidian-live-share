// WP23 — the WP20 coverage link: "the schema-invariant assertion, plus a
// FAULT-INJECTION op that writes an invalid record DIRECTLY into a replica, so
// the auditor's quarantine/lift is exercised under concurrency."
//
// A record that fails the schema cannot arrive through a local write boundary —
// WP18 refuses it there — so the only honest way to exercise the auditor is to
// put it in the doc the way a peer's delta would: directly. That is what
// `injectInvalidEdge` does, in ONE replica, inside a partitioned window, so the
// other replicas meet it as an incoming delta and audit it concurrently.
//
// What is asserted, and what is deliberately NOT:
//
//   ├── the invalid record NEVER reaches any replica's file (the schema
//   │      invariant, "no endpoint-less edge"),
//   ├── every replica ends up holding the SAME tombstone entry for it, and that
//   │      entry is a QUARANTINE (`q:true`) rather than a user delete, and
//   ├── repairing it lifts the quarantine on every replica and the edge comes
//   │      back — a quarantine hides, it never destroys, and
//   └── NOT which replica's quarantine op won. Three replicas writing
//          `deleted[id]` concurrently produce three same-key CRDT writes and Yjs
//          tie-breaks those on a `random.uint32()` clientID. The `by` field is a
//          coin flip and asserting it would pass about a third of the time.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { FUZZ_TEST_TIMEOUT_MS, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0008;
const OPS = ["injectInvalidEdge", "repairInvalidEdge", "moveViaSave", "dualSpellingWrite"];

describe("WP23 — WP20 reached: quarantine and lift under concurrency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("an invalid record injected into one replica is quarantined on all of them, and never reaches a file", async () => {
    let injections = 0;
    let repairs = 0;
    let quarantinesObserved = 0;

    for (let index = 0; index < 24; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas, trace) => {
          const files = replicas.map(projectFile);
          for (const record of trace.allRecords("edge")) {
            if (!record.invalid) continue;
            quarantinesObserved += 1;
            const entries = replicas.map((replica) =>
              readTombstoneEntry(replica.deleted(), record.id),
            );
            for (const [replicaIndex, entry] of entries.entries()) {
              expect(
                isTombstoneQuarantined(entry),
                `replica ${replicaIndex}: the invalid edge "${record.id}" is not quarantined — ` +
                  `the auditor did not converge on it`,
              ).toBe(true);
            }
            // AGREEMENT on the entry, never "replica 1's op won".
            for (let i = 1; i < entries.length; i++) {
              expect(
                entries[i],
                `replica ${i} holds a different quarantine entry from replica 0`,
              ).toEqual(entries[0]);
            }
            for (const [replicaIndex, file] of files.entries()) {
              expect(
                file.edges.some((edge) => edge.id === record.id),
                `replica ${replicaIndex}: the endpoint-less edge "${record.id}" REACHED THE FILE`,
              ).toBe(false);
            }
          }
        },
      });
      expect(result.violations, describeResult(result)).toEqual([]);
      for (const entry of result.trace.log) {
        if (entry.opClass === "injectInvalidEdge") injections += 1;
        if (entry.opClass === "repairInvalidEdge") repairs += 1;
      }
    }

    expect(injections, "the fault-injection op never fired — WP20 is not actually reached").toBeGreaterThan(
      0,
    );
    expect(repairs, "the repair op never fired — the quarantine LIFT is not exercised").toBeGreaterThan(
      0,
    );
    expect(quarantinesObserved, "no scenario ended with a live quarantine to inspect").toBeGreaterThan(
      0,
    );
  }, FUZZ_TEST_TIMEOUT_MS);

  it("a repaired record has its quarantine lifted on every replica and comes back", async () => {
    let liftsChecked = 0;

    for (let index = 0; index < 24; index++) {
      const result = await runFuzzScenario({
        seed: SEED + 900 + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas, trace) => {
          const files = replicas.map(projectFile);
          for (const record of trace.allRecords("edge")) {
            const wasBroken = trace.log.some(
              (entry) => entry.opClass === "injectInvalidEdge" && entry.slot.id === record.id,
            );
            const wasRepaired = trace.log.some(
              (entry) => entry.opClass === "repairInvalidEdge" && entry.slot.id === record.id,
            );
            if (!wasBroken || !wasRepaired || record.invalid) continue;
            if (!trace.expectedVisible("edge", record.id)) continue;
            liftsChecked += 1;
            for (const [replicaIndex, replica] of replicas.entries()) {
              expect(
                isTombstoneQuarantined(readTombstoneEntry(replica.deleted(), record.id)),
                `replica ${replicaIndex}: the repaired edge "${record.id}" is still quarantined — ` +
                  `a quarantine that never lifts is a destroyed record with extra steps`,
              ).toBe(false);
              expect(
                files[replicaIndex].edges.some((edge) => edge.id === record.id),
                `replica ${replicaIndex}: the repaired edge "${record.id}" did not come back`,
              ).toBe(true);
            }
          }
        },
      });
      expect(result.violations, describeResult(result)).toEqual([]);
    }

    expect(liftsChecked, "no repaired record was ever observed — the LIFT half is untested").toBeGreaterThan(
      0,
    );
  }, FUZZ_TEST_TIMEOUT_MS);
});
