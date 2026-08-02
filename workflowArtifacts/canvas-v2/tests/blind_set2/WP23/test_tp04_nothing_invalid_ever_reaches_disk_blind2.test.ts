// WP23 blind2, WP20 link — the schema invariant as a UNIVERSAL over every file
// every replica ever produced, rather than as a check on the record the fault
// injector happened to write.
//
// The visible test follows the injected record: is THIS edge quarantined, is
// THIS edge off disk. That is exactly as good as the injector's imagination. The
// invariant is not about the injected record at all:
//
//   NO FILE ANY REPLICA PRODUCES, IN ANY SETTLED WINDOW OF ANY RUN, MAY CONTAIN
//   AN EDGE WITHOUT BOTH ENDPOINTS, A NODE WITHOUT A POSITION, OR A NODE WITHOUT
//   A SIZE.
//
// Stated that way it also covers the CASCADE — an edge whose endpoint node was
// deleted or quarantined — which the fault injector never writes and which is
// the class that actually broke a live vault. And it is checked at every window
// boundary, because a file that is briefly wrong and later right has already
// been written to the user's disk by then.
//
// `fromSide` is deliberately NOT a conjunct. `fromSide`/`toSide` are optional in
// the JSON Canvas format, so a side-less endpoint is a COMPLETE endpoint and its
// edge is valid — reading it as dangling is how a live path came to delete the
// user's edges.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0xb2_2304;

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

describe("WP23 blind2 — nothing schema-invalid ever reaches a file", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("every file, on every replica, in every settled window, satisfies the invariants", async () => {
    let filesChecked = 0;
    let edgesChecked = 0;
    let injections = 0;

    for (let index = 0; index < 32; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry(),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        onWindowSettled: (replicas, window) => {
          for (const replica of replicas) {
            const file = projectFile(replica);
            filesChecked += 1;
            const nodeIds = new Set(file.nodes.map((node) => String(node.id)));

            for (const node of file.nodes) {
              expect(
                isFiniteNumber(node.x) && isFiniteNumber(node.y),
                `window ${window}, replica ${replica.index}: node "${String(node.id)}" reached the ` +
                  `file with no position: ${JSON.stringify(node)}`,
              ).toBe(true);
              expect(
                isFiniteNumber(node.width) && isFiniteNumber(node.height),
                `window ${window}, replica ${replica.index}: node "${String(node.id)}" reached the ` +
                  `file with no size: ${JSON.stringify(node)}`,
              ).toBe(true);
              expect(
                nonEmptyString(node.id) && nonEmptyString(node.type),
                `window ${window}, replica ${replica.index}: node without id or type`,
              ).toBe(true);
            }

            for (const edge of file.edges) {
              edgesChecked += 1;
              expect(
                nonEmptyString(edge.fromNode) && nonEmptyString(edge.toNode),
                `window ${window}, replica ${replica.index}: endpoint-less edge ` +
                  `"${String(edge.id)}" reached the file: ${JSON.stringify(edge)}`,
              ).toBe(true);
              // THE CASCADE: an edge may never point at a card that is not there.
              expect(
                nodeIds.has(String(edge.fromNode)) && nodeIds.has(String(edge.toNode)),
                `window ${window}, replica ${replica.index}: edge "${String(edge.id)}" points at a ` +
                  `node that is not in the file (${String(edge.fromNode)} -> ${String(edge.toNode)})`,
              ).toBe(true);
            }
          }
        },
      });
      expect(
        result.violations.map((violation) => `[${violation.family}] ${violation.message}`),
        `seed ${SEED + index}`,
      ).toEqual([]);
      injections += result.trace.log.filter(
        (entry) => entry.opClass === "injectInvalidEdge",
      ).length;
    }

    expect(filesChecked, "no file was ever inspected").toBeGreaterThan(32 * 8);
    expect(edgesChecked, "no edge was ever inspected — the invariant is vacuous").toBeGreaterThan(0);
    expect(
      injections,
      "the fault-injection op never fired, so the auditor was never put under pressure",
    ).toBeGreaterThan(0);
  }, FUZZ_TEST_TIMEOUT_MS);
});
