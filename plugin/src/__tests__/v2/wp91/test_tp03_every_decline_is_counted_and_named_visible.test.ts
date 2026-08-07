// WP91 / C91 AC3 — no silent discard. Every declined local canvas modify is
// COUNTED, ATTRIBUTED and NAMED.
//
// WHY THIS IS A CRITERION AND NOT A NICETY. The defect survived an entire run of
// adversarial review because the drop produced nothing at all: no signature, no
// counter, no receipt. An unlogged silent discard on a data path is the mechanism
// by which a data-loss bug becomes undetectable. The counters below are worth more
// than the fix, because they are what would catch the fix's own regression.
//
// THE VACUITY RISKS THE CHARTER ATTACHED, AND HOW EACH IS DISCHARGED:
//
//   (a) THE TRAP THIS AC SETS FOR ITSELF — after the fix `muted` is not a
//       reachable reason for a canvas-owned path at all, so an assertion of the
//       form "zero muted declines" is TRUE FOR FREE. That is the exact shape of
//       B44's `[06] B: node gone`. So: no zero is the primary observable
//       anywhere in this file. T1 asserts POSITIVELY that `echo` reaches
//       non-zero, driven through the registered handler, and every other row
//       asserts a counter ADVANCING by exactly one.
//   (b) "A counter incremented on a branch no test reaches." Each of the six
//       reasons has its own driving fixture below, and the reason set contains
//       nothing that is not driven.
//   (c) "The signature asserted by ABSENCE from the debug log." Under S65 — a
//       stamp-to-flush lag measured at ~58 s against 2-2.5 s reader margins — an
//       absence claim about a log is not evidence. No assertion in this file is
//       an absence claim about a log line. The `toHaveLength(0)` assertions are
//       over the in-memory sink this harness owns synchronously, and every one of
//       them is paired with a non-zero counter in the same assertion block.
//
// A NOTE ON THE DIRECT CALLS, STATED RATHER THAN HIDDEN. T1 (`echo`) goes through
// the registered `vault.on("modify")` handler, because `echo` is the reason the
// live path actually produces and the one a fixture is most likely to arrange
// trivially. The other five reasons are UNREACHABLE from that handler by
// construction — `canvasOwned` is `isSubscribed`, so a not-subscribed path never
// routes here at all — and are driven by calling the method directly. That is a
// deliberate, named exception for AC3 only; AC1's rows never do it, because there
// it would bypass the gate that is the defect.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { META_MAP_NAME, SCHEMA_VERSION_KEY } from "../../../canvas/canvas-schema";
import { CAPTURE_DECLINE_REASONS, type CaptureDeclineReason } from "../../../files/canvas-sync";
import {
  PATH,
  type Rig,
  advance,
  applyRemoteDelta,
  canvasJson,
  createRig,
  declineLines,
  node,
  remoteNode,
  settle,
} from "./harness";

const SEED = canvasJson([node("seed", "seed card")]);

/**
 * Drive `body`, then assert that EXACTLY ONE reason advanced, by EXACTLY ONE, and
 * that every other reason is unchanged — in the same assertion, which is what the
 * charter asks for and what stops a counter from being incremented twice or a
 * neighbour from being incremented instead.
 */
async function expectExactlyOneDecline(
  rig: Rig,
  reason: CaptureDeclineReason,
  body: () => Promise<void>,
): Promise<void> {
  const before = rig.canvasSync.captureDeclineCounts();
  await body();
  const after = rig.canvasSync.captureDeclineCounts();
  const expected = { ...before, [reason]: before[reason] + 1 };
  expect(after).toEqual(expected);
}

describe("WP91 AC3 — a closed reason set, a counter per reason, one signature", () => {
  let rig: Rig;

  beforeEach(async () => {
    vi.useFakeTimers();
    rig = await createRig({ initial: { [PATH]: SEED } });
  });

  afterEach(() => {
    rig.destroy();
    vi.useRealTimers();
  });

  it("T1 — POSITIVE: through the registered handler, the `echo` counter reaches non-zero", async () => {
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote", remoteNode("remote", "peer text")));
    await advance(200);
    expect(rig.written.length).toBeGreaterThan(0);
    // Zero to start with, so the non-zero below is an ADVANCE and not a reading.
    expect(rig.canvasSync.captureDeclineCounts().echo).toBe(0);

    await expectExactlyOneDecline(rig, "echo", async () => {
      rig.emitModify(PATH); // the file already holds exactly what we wrote
      await settle();
    });

    expect(rig.canvasSync.captureDeclineCounts().echo).toBe(1);
    expect(rig.canvasSync.captureDeclineCounts().echo).toBeGreaterThan(0);
    const lines = declineLines(rig.logs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`CAPTURE DECLINED: ${PATH} reason=echo (declines=1)`);
  });

  it("T2 — `not-subscribed`", async () => {
    rig.canvasSync.unsubscribe(PATH);
    await expectExactlyOneDecline(rig, "not-subscribed", async () => {
      await rig.canvasSync.handleLocalModify(PATH);
    });
    expect(declineLines(rig.logs).at(-1)).toContain("reason=not-subscribed");
  });

  it("T3 — `read-only`", async () => {
    rig.canvasSync.setCanWrite(() => false);
    await expectExactlyOneDecline(rig, "read-only", async () => {
      await rig.canvasSync.handleLocalModify(PATH);
    });
    expect(declineLines(rig.logs).at(-1)).toContain("reason=read-only");
  });

  it("T4 — `no-doc`", async () => {
    rig.docHandleEnabled.value = false;
    await expectExactlyOneDecline(rig, "no-doc", async () => {
      await rig.canvasSync.handleLocalModify(PATH);
    });
    expect(declineLines(rig.logs).at(-1)).toContain("reason=no-doc");
  });

  it("T5 — `schema-major`", async () => {
    rig.doc.getMap<unknown>(META_MAP_NAME).set(SCHEMA_VERSION_KEY, 99);
    await expectExactlyOneDecline(rig, "schema-major", async () => {
      await rig.canvasSync.handleLocalModify(PATH);
    });
    expect(declineLines(rig.logs).at(-1)).toContain("reason=schema-major");
  });

  it("T6 — `no-file`", async () => {
    // The vault no longer resolves a `TFile` for the path. Not in the set
    // BUILD_SPEC §10 registers; it is here because the branch is real and the
    // rule is that every decline is counted. See the report.
    rig.files.delete(PATH);
    await expectExactlyOneDecline(rig, "no-file", async () => {
      await rig.canvasSync.handleLocalModify(PATH);
    });
    expect(declineLines(rig.logs).at(-1)).toContain("reason=no-file");
  });

  it("T7 — the reason set is CLOSED: every declared reason has a fixture above and none is decoration", async () => {
    // Drive all six on ONE instance and require every counter to be non-zero.
    // A reason with no reachable branch would leave a zero here, which is the
    // charter's rule ("remove it from the enum rather than leave it as
    // decoration") evaluated instead of promised.
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote", remoteNode("remote", "peer text")));
    await advance(200);
    rig.emitModify(PATH); // echo
    await settle();

    rig.doc.getMap<unknown>(META_MAP_NAME).set(SCHEMA_VERSION_KEY, 99);
    await rig.canvasSync.handleLocalModify(PATH); // schema-major
    rig.doc.getMap<unknown>(META_MAP_NAME).delete(SCHEMA_VERSION_KEY);

    rig.files.delete(PATH);
    await rig.canvasSync.handleLocalModify(PATH); // no-file
    rig.files.set(PATH, SEED);

    rig.docHandleEnabled.value = false;
    await rig.canvasSync.handleLocalModify(PATH); // no-doc
    rig.docHandleEnabled.value = true;

    rig.canvasSync.setCanWrite(() => false);
    await rig.canvasSync.handleLocalModify(PATH); // read-only
    rig.canvasSync.setCanWrite(() => true);

    rig.canvasSync.unsubscribe(PATH);
    await rig.canvasSync.handleLocalModify(PATH); // not-subscribed

    const counts = rig.canvasSync.captureDeclineCounts();
    for (const reason of CAPTURE_DECLINE_REASONS) {
      expect(counts[reason], `no fixture ever reached reason=${reason}`).toBeGreaterThan(0);
    }
    expect(Object.keys(counts).sort()).toEqual([...CAPTURE_DECLINE_REASONS].sort());
  });

  it("T8 — the signature carries the path and the reason and NOTHING ELSE", async () => {
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("secret", remoteNode("secret", "SENSITIVE")));
    await advance(200);
    const bytes = rig.written.at(-1) as string;
    expect(bytes).toContain("SENSITIVE"); // the node text really is in the file

    rig.emitModify(PATH);
    await settle();

    const line = declineLines(rig.logs).at(-1) as string;
    expect(line).toBe(`CAPTURE DECLINED: ${PATH} reason=echo (declines=1)`);
    // Never the file's contents, never a node's text.
    expect(line).not.toContain("SENSITIVE");
    expect(line).not.toContain("nodes");
    // And the counters themselves carry no path and no content: they are six
    // numbers, keyed by reason only.
    const counts = rig.canvasSync.captureDeclineCounts();
    expect(Object.values(counts).every((v) => typeof v === "number")).toBe(true);
    expect(JSON.stringify(counts)).not.toContain(PATH);
  });

  it("T9 — the accessor is a SNAPSHOT: a reading cannot be mutated, and it does not move under its holder", async () => {
    const first = rig.canvasSync.captureDeclineCounts();
    first.echo = 4242;
    applyRemoteDelta(rig.doc, (nodes) => nodes.set("remote", remoteNode("remote", "peer")));
    await advance(200);
    rig.emitModify(PATH);
    await settle();

    expect(first.echo).toBe(4242); // the caller's copy is the caller's
    expect(rig.canvasSync.captureDeclineCounts().echo).toBe(1); // the ledger is untouched by it
  });
});
