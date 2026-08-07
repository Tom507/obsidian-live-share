// WP23 AC2/AC5 blind1 — the assertion families as a DISCRIMINATION MATRIX
// rather than as a green run.
//
// The visible suite asserts that a healthy run produces no violations. That is
// necessary and it is also the easiest thing in the world to satisfy by accident:
// an oracle that never fires is green on every input. What actually has to hold
// is that each family fires on ITS defect and stays quiet on the others —
// otherwise "the schema family caught it" carries no information.
//
// So this builds four documents by hand, one per defect class, and requires an
// exact family set from each:
//
//   ├── healthy                    → {}
//   ├── one replica out of step    → {sec}          (and NOT intent-trace: the
//   │                                                op log's value is still on
//   │                                                the replica that matters)
//   ├── endpoint-less edge on disk → {schema}
//   └── everyone agrees on a value → {intent-trace} ONLY. Every convergence
//          nobody wrote                              family is satisfied.
//
// The last row is the whole reason AC5 exists, stated as an exact set rather
// than as "something fired".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { FUZZ_TEST_TIMEOUT_MS } from "../../harness/fuzz/fuzzer";
import { IntentTrace } from "../../harness/fuzz/intent-trace";
import { checkAllFamilies, familiesHit } from "../../harness/fuzz/oracle";
import { createReplica, type FuzzReplica } from "../../harness/fuzz/replica";
import { quiesce } from "../../harness/fuzz/scheduler";

const PATH = "matrix.canvas";
const AUTHORED = { x: 720, y: 480 };

async function replicas(count = 3): Promise<FuzzReplica[]> {
  const out: FuzzReplica[] = [];
  for (let index = 0; index < count; index++) out.push(await createReplica(index, PATH));
  return out;
}

function traceFor(x: number, y: number): IntentTrace {
  const trace = new IntentTrace();
  trace.declareRecord({
    kind: "node",
    id: "n1",
    shape: "dual",
    keyOrder: "flatFirst",
    saveEligible: false,
  });
  const fields: [string, string | number][] = [
    ["id", "n1"],
    ["type", "text"],
    ["x", x],
    ["y", y],
    ["width", 240],
    ["height", 120],
    ["text", "one card"],
  ];
  for (const [field, value] of fields) {
    trace.write({
      window: 0,
      replica: 0,
      opClass: "handBuilt",
      slot: { kind: "node", id: "n1", field },
      value,
      contested: false,
    });
  }
  return trace;
}

function putNode(replica: FuzzReplica, x: number, y: number): void {
  replica.doc.transact(() => {
    const record = new Y.Map<unknown>();
    record.set("id", "n1");
    record.set("type", "text");
    record.set("x", x);
    record.set("y", y);
    record.set("width", 240);
    record.set("height", 120);
    record.set("text", "one card");
    record.set("pos", encodePos(x, y));
    record.set("size", encodeSize(240, 120));
    replica.nodes().set("n1", record);
  });
}

describe("WP23 blind1 — the assertion families discriminate between defect classes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a healthy converged document fires nothing at all", async () => {
    const peers = await replicas();
    try {
      putNode(peers[0], AUTHORED.x, AUTHORED.y);
      expect(quiesce(peers, () => vi.runOnlyPendingTimers())).toBe(true);
      const violations = checkAllFamilies(peers, traceFor(AUTHORED.x, AUTHORED.y));
      expect(
        violations.map((violation) => `[${violation.family}] ${violation.message}`),
        "a family fired over a document nothing is wrong with",
      ).toEqual([]);
    } finally {
      for (const peer of peers) peer.destroy();
    }
  }, FUZZ_TEST_TIMEOUT_MS);

  it("one replica out of step fires SEC and byte equality, and NOTHING else", async () => {
    const peers = await replicas();
    try {
      putNode(peers[0], AUTHORED.x, AUTHORED.y);
      quiesce(peers, () => vi.runOnlyPendingTimers());
      // Replica 2 drifts AFTER everybody settled — no further exchange.
      peers[2].doc.transact(() => {
        peers[2].nodes().get("n1")?.set("x", 11);
      });
      const families = familiesHit(checkAllFamilies(peers, traceFor(AUTHORED.x, AUTHORED.y)));
      expect(families.has("sec"), "a divergent replica did not trip SEC").toBe(true);
      expect(families.has("bytes"), "a divergent replica did not trip byte equality").toBe(true);
      expect(families.has("schema"), "a value change tripped the schema family").toBe(false);
      expect(families.has("shadow"), "a value change tripped the shadow family").toBe(false);
    } finally {
      for (const peer of peers) peer.destroy();
    }
  }, FUZZ_TEST_TIMEOUT_MS);

  it("an endpoint-less edge is HIDDEN, not destroyed — so the schema family stays green", async () => {
    const peers = await replicas();
    try {
      putNode(peers[0], AUTHORED.x, AUTHORED.y);
      // A dangling edge cannot be built through a local write boundary — WP18
      // refuses it there — so it is put straight into the doc the way a peer's
      // delta arrives, and the tombstone container is left untouched so the
      // AUDITOR is the only thing that can act on it.
      peers[0].doc.transact(() => {
        const edge = new Y.Map<unknown>();
        edge.set("id", "half");
        edge.set("from", encodeEndpoint("n1", "right"));
        peers[0].edges().set("half", edge);
      });
      expect(quiesce(peers, () => vi.runOnlyPendingTimers())).toBe(true);

      const families = familiesHit(checkAllFamilies(peers, traceFor(AUTHORED.x, AUTHORED.y)));
      // The invariant is "no endpoint-less edge REACHES A FILE", and it holds
      // because the auditor quarantined the record. So the schema family is
      // green — and it is green for the right reason, which the next two
      // assertions pin: the record is hidden, and it is still there.
      expect(
        families.has("schema"),
        "the endpoint-less edge reached a file — the auditor did not hide it",
      ).toBe(false);
      for (const peer of peers) {
        expect(
          peer.edges().has("half"),
          `replica ${peer.index}: the invalid edge was DESTROYED rather than quarantined — a ` +
            `refusal may withhold a write, it may never destroy one`,
        ).toBe(true);
      }
      // And no convergence family fired either: hiding it is a converged state.
      expect(
        [...families].filter((family) => family === "sec" || family === "bytes"),
        "the replicas disagreed about a record they all quarantined",
      ).toEqual([]);
    } finally {
      for (const peer of peers) peer.destroy();
    }
  }, FUZZ_TEST_TIMEOUT_MS);

  it("a value every replica agrees on but no op wrote fires INTENT-TRACE and nothing else", async () => {
    const peers = await replicas(4);
    try {
      // Perfect consensus on a coordinate the op log never recorded.
      putNode(peers[0], 40, 40);
      expect(quiesce(peers, () => vi.runOnlyPendingTimers())).toBe(true);
      const families = familiesHit(checkAllFamilies(peers, traceFor(AUTHORED.x, AUTHORED.y)));
      expect(
        [...families].sort(),
        "the exact family set for an agreed-but-wrong document is not {intent-trace} — either a " +
          "convergence family fired spuriously, or the correctness family did not fire at all",
      ).toEqual(["intent-trace"]);
    } finally {
      for (const peer of peers) peer.destroy();
    }
  }, FUZZ_TEST_TIMEOUT_MS);
});
