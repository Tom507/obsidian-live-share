// WP23 / AC5 (the load-bearing sentence) — "AGREEMENT BETWEEN REPLICAS IS
// NECESSARY BUT NOT SUFFICIENT: a run in which all replicas agree on a value
// that NO OP EVER WROTE is a FAILURE, not a pass."
//
// Every other test in this suite asserts that the fuzzer stays green over honest
// behaviour. This one asserts the opposite property, which is the one that
// actually makes AC5 mean something: that the oracle CAN go red while the four
// convergence families are perfectly satisfied.
//
// The state is constructed directly rather than fuzzed, because the point is a
// property of the ORACLE, not of the system: three replicas hold the byte-
// identical, schema-valid, fully converged document — and the value in it is one
// the op log never recorded. SEC is green. The schema is green. Byte equality is
// green. Shadow consistency is green. The run is still a FAILURE.
//
// This is also the self-test for the circularity rule: the expected value comes
// from `IntentTrace`, which is populated by hand here and reads nothing from any
// replica. If the oracle were reading its expectation back from the
// implementation, this test could not fail — and could not pass.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { FUZZ_TEST_TIMEOUT_MS } from "../../harness/fuzz/fuzzer";
import { IntentTrace } from "../../harness/fuzz/intent-trace";
import { checkAllFamilies, familiesHit } from "../../harness/fuzz/oracle";
import { createReplica, type FuzzReplica } from "../../harness/fuzz/replica";
import { quiesce } from "../../harness/fuzz/scheduler";

const PATH = "oracle-self-test.canvas";

/** What the op log says the last writer meant. */
const AUTHORED_X = 900;
/** What every replica actually holds — a value nobody ever submitted. */
const AGREED_X = 100;

async function threeReplicas(): Promise<FuzzReplica[]> {
  return [await createReplica(0, PATH), await createReplica(1, PATH), await createReplica(2, PATH)];
}

/** An op log that records the move to `x`, and a trace record to hang it on. */
function traceSayingTheCardMovedTo(x: number): IntentTrace {
  const trace = new IntentTrace();
  trace.declareRecord({
    kind: "node",
    id: "card",
    shape: "dual",
    keyOrder: "flatFirst",
    saveEligible: false,
  });
  const write = (field: string, value: string | number): void =>
    trace.write({
      window: 0,
      replica: 0,
      opClass: "moveCard",
      slot: { kind: "node", id: "card", field },
      value,
      contested: false,
    });
  write("id", "card");
  write("type", "text");
  write("x", x);
  write("y", 640);
  write("width", 240);
  write("height", 120);
  write("text", "a card");
  return trace;
}

function seedCard(replica: FuzzReplica, x: number): void {
  replica.doc.transact(() => {
    const record = new Y.Map<unknown>();
    record.set("id", "card");
    record.set("type", "text");
    record.set("x", x);
    record.set("y", 640);
    record.set("width", 240);
    record.set("height", 120);
    record.set("text", "a card");
    record.set("pos", encodePos(x, 640));
    record.set("size", encodeSize(240, 120));
    replica.nodes().set("card", record);
  });
}

describe("WP23 AC5 — agreement is necessary but not sufficient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports a FAILURE when every replica agrees on a value no op ever wrote", async () => {
    const replicas = await threeReplicas();
    try {
      // Every replica converges on AGREED_X. Perfect consensus, wrong document.
      seedCard(replicas[0], AGREED_X);
      expect(quiesce(replicas, () => vi.runOnlyPendingTimers())).toBe(true);

      const violations = checkAllFamilies(replicas, traceSayingTheCardMovedTo(AUTHORED_X));
      const families = familiesHit(violations);

      // THE FOUR CONVERGENCE FAMILIES ARE GREEN. That is the whole point: they
      // are satisfied by agreement, and the replicas agree.
      expect(
        [...families].filter((family) => family !== "intent-trace"),
        `a convergence family fired over a perfectly converged document: ` +
          `${violations.map((violation) => `[${violation.family}] ${violation.message}`).join(" | ")}`,
      ).toEqual([]);

      // AND THE RUN IS A FAILURE ANYWAY.
      expect(
        families.has("intent-trace"),
        "the oracle accepted a value no op ever wrote, because every replica agreed on it — " +
          "that is precisely the WP18-class corruption AC5 exists to catch",
      ).toBe(true);
      expect(
        violations.some((violation) => violation.message.includes(String(AUTHORED_X))),
        "the violation does not name the value the op log actually recorded",
      ).toBe(true);
    } finally {
      for (const replica of replicas) replica.destroy();
    }
  }, FUZZ_TEST_TIMEOUT_MS);

  it("is green for the same document when the op log agrees with it", async () => {
    const replicas = await threeReplicas();
    try {
      seedCard(replicas[0], AUTHORED_X);
      quiesce(replicas, () => vi.runOnlyPendingTimers());
      const violations = checkAllFamilies(replicas, traceSayingTheCardMovedTo(AUTHORED_X));
      expect(
        violations.map((violation) => `[${violation.family}] ${violation.message}`),
        "the oracle rejects a document that matches its own op log — it is over-strict, not independent",
      ).toEqual([]);
    } finally {
      for (const replica of replicas) replica.destroy();
    }
  }, FUZZ_TEST_TIMEOUT_MS);

  it("the oracle's expectation survives being computed with no replica in existence", () => {
    // The circularity rule, made mechanical. `IntentTrace` answers "what did the
    // last op write?" from its own log alone — no doc, no decoder, no serialiser.
    const trace = traceSayingTheCardMovedTo(AUTHORED_X);
    const expectation = trace.expect({ kind: "node", id: "card", field: "x" });
    expect(expectation?.kind).toBe("determinate");
    expect(
      expectation?.kind === "determinate" ? expectation.value : undefined,
      "the expected value is not derivable from the op log alone",
    ).toBe(AUTHORED_X);
  }, FUZZ_TEST_TIMEOUT_MS);
});
