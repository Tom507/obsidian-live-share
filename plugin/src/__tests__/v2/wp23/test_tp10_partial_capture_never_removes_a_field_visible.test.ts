// WP23 — the WP22 coverage link: "a PARTIAL CAPTURE — a capture observing only a
// subset of a record's fields must NEVER remove any other field on any replica
// (the I7 assertion)."
//
// The mechanism WP22 fixed is a one-line one and its blast radius was not: the
// old absent-key sweep read "this key is not in the incoming record" as "remove
// it", so an interaction signal reporting `{id}` alone disconnected a live edge
// — on every replica, because the removal is a CRDT write like any other.
//
// A capture is a PARTIAL OBSERVATION. Absence carries no intent at all.
//
// The oracle here is the record's own key SET AND VALUES, before against after,
// taken on the CAPTURING replica at capture time (that is `partialCapture`'s job,
// recorded as `fieldRemovals`) and re-checked on EVERY replica after the run has
// quiesced — because a removal that only shows up after integration is still a
// removal, and a check that only looked at the author would miss it.
//
// Nothing is named: the whole key set is compared, so a key nobody thought to
// list is protected too.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { FUZZ_TEST_TIMEOUT_MS, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import { bootstrapStandardWorld, createStandardRegistry } from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0010;
const OPS = ["partialCapture", "dualSpellingWrite", "moveRegisterOnly", "moveViaSave"];

/** The doc keys the bootstrap gives each doc-only record, per kind. */
const BOOTSTRAP_KEYS: Record<string, readonly string[]> = {
  d0: ["id", "type", "x", "y", "width", "height", "text", "pos", "size"],
  d1: ["id", "type", "x", "y", "width", "height", "text", "pos", "size"],
  r0: ["id", "type", "pos", "size", "text"],
  r1: ["id", "type", "pos", "size", "text"],
  de0: ["id", "fromNode", "fromSide", "toNode", "toSide", "from", "to"],
};

describe("WP23 — WP22 reached: a partial capture never removes an unmentioned field", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("no field is ever removed, on the capturing replica or on any integrating one", async () => {
    let captures = 0;
    let recordsChecked = 0;

    for (let index = 0; index < 32; index++) {
      const result = await runFuzzScenario({
        seed: SEED + index,
        windows: 8,
        registry: createStandardRegistry().subset(OPS),
        bootstrap: bootstrapStandardWorld,
        flushTimers: () => vi.runOnlyPendingTimers(),
        inspect: (replicas, trace) => {
          // Which records a partial capture actually touched in this run.
          const captured = new Set(
            trace.log
              .filter((entry) => entry.opClass === "partialCapture")
              .map((entry) => `${entry.slot.kind}|${entry.slot.id}`),
          );
          for (const key of captured) {
            const [kind, id] = key.split("|");
            const expected = BOOTSTRAP_KEYS[id];
            if (expected === undefined) continue; // a record this run created
            recordsChecked += 1;
            for (const replica of replicas) {
              const map = kind === "node" ? replica.nodes() : replica.edges();
              const record = map.get(id);
              expect(
                record,
                `replica ${replica.index}: the captured ${kind} "${id}" is gone entirely`,
              ).toBeDefined();
              // WP64 — post-WP19 a removal has a second spelling that leaves
              // the container and every key below intact. Neither `deleteViaSave`
              // nor `undoDelete` is in this run's op subset, so ANY suppression
              // here was written by the partial capture itself.
              expect(
                isTombstoneSuppressed(readTombstoneEntry(replica.deleted(), id)),
                `replica ${replica.index}: the partial capture on ${kind} "${id}" TOMBSTONED ` +
                  `the record — I7 says observation never deletes, in either spelling`,
              ).toBe(false);
              const keys = new Set(record ? [...record.keys()] : []);
              const missing = expected.filter((field) => !keys.has(field));
              expect(
                missing,
                `replica ${replica.index}: the partial capture on ${kind} "${id}" removed ` +
                  `${missing.join(", ")} — I7 says observation never deletes, and a removal ` +
                  `propagates to every replica exactly like any other write`,
              ).toEqual([]);
            }
          }
        },
      });
      expect(result.violations, describeResult(result)).toEqual([]);
      captures += result.trace.log.filter((entry) => entry.opClass === "partialCapture").length;
    }

    expect(captures, "the partial-capture op never fired — WP22 is not actually reached").toBeGreaterThan(
      0,
    );
    expect(recordsChecked, "no captured record was ever re-checked after integration").toBeGreaterThan(
      0,
    );
  }, FUZZ_TEST_TIMEOUT_MS);

  it("the capture DOES carry its own value through to every replica", async () => {
    // "Never removes" must not be satisfied by "never writes". The captured
    // field itself has a single author and no concurrent writer (the slot is
    // claimed for the window), so its value is causally determined and asserting
    // it is legitimate.
    const result = await runFuzzScenario({
      seed: SEED + 777,
      windows: 8,
      registry: createStandardRegistry().subset(["partialCapture"]),
      bootstrap: bootstrapStandardWorld,
      flushTimers: () => vi.runOnlyPendingTimers(),
    });
    expect(result.violations, describeResult(result)).toEqual([]);
    const captures = result.trace.log.filter((entry) => entry.opClass === "partialCapture");
    expect(captures.length, "the focused run captured nothing").toBeGreaterThan(0);
    // Every captured `label` is asserted by the intent-trace family above; this
    // just proves the run was not vacuous.
    expect(
      captures.every((entry) => entry.slot.field === "label"),
      "the partial capture wrote something other than the field it declared",
    ).toBe(true);
  }, FUZZ_TEST_TIMEOUT_MS);
});
