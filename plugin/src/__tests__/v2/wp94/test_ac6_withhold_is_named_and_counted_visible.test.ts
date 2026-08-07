// WP94 / C94 AC6 — A WITHHELD DELETION IS NAMED AND COUNTED. SILENCE STOPS BEING
// AN OUTCOME OF THIS PATH.
//
// This outranks the fix itself. S78 survived a whole run of adversarial review
// because the withhold produced NOTHING AT ALL -- no signature, no counter, no
// receipt, and a telemetry line reading `-0 node(s)` that is byte-identical to
// "the user deleted nothing". An unlogged silent discard on a data path is the
// mechanism by which a data-loss bug becomes undetectable.
//
// THE TRAP THIS AC SETS FOR ITSELF, and the charter names it: after the repair
// `no-receipt` becomes RARE, so any assertion of the form "zero withholds" is
// TRUE FOR FREE. Every primary observable below is a POSITIVE NON-ZERO on a
// driven reason. No zero is used as primary evidence anywhere in this file.
//
// THE COUNTERS ARE THE ORACLE AND THE LINE IS FOR THE HUMAN. Under S65/S71 the
// debug log's stamp-to-flush lag is bimodal -- ~0.5 s normally and 60.00 s +/-
// 0.02 under a host wake-up clamp -- so a test that greps for the signature has
// measured nothing until it proves its watermark advanced past the action window.
// The counters exist precisely so no absence claim is needed.

import { describe, expect, it } from "vitest";

import { DELETE_WITHHOLD_REASONS } from "../../../canvas/canvas-shadow";
import {
  PATH,
  canvasJson,
  edge,
  isDeleted,
  makePeer,
  node,
  save,
} from "./harness";

const A = node("a");
const B = node("b", { x: 300 });
const C = node("c", { x: 600 });
const D = node("d", { x: 900 });
const BAD = { id: "bad", fromNode: "a", fromSide: "right" };

/** Assert exactly one reason moved, by exactly `by`, and every other did not. */
function expectOnly(
  before: Record<string, number>,
  after: Record<string, number>,
  reason: string,
  by: number,
): void {
  expect(after[reason] - before[reason], `${reason} did not advance by ${by}`).toBe(by);
  for (const other of DELETE_WITHHOLD_REASONS) {
    if (other === reason) continue;
    expect(after[other], `${other} moved while driving ${reason}`).toBe(before[other]);
  }
}

describe("WP94 AC6 — the withhold is named and counted", () => {
  it("the reason set is CLOSED and every member has a fixture", () => {
    // Vacuity (b): a reason incremented on a branch no fixture reaches is
    // decoration and must be removed from the enum. Each of the four is driven
    // below, in this file.
    expect([...DELETE_WITHHOLD_REASONS].sort()).toEqual([
      "incomplete-observation",
      "no-open-surface",
      "no-receipt",
      "refused-at-ingest",
    ]);
  });

  it("no-receipt — +1, and every other reason unchanged", async () => {
    const peer = await makePeer(canvasJson([A, B]));
    const before = peer.cs.deleteWithholdCounts();
    await save(peer, canvasJson([A]));
    expectOnly(before, peer.cs.deleteWithholdCounts(), "no-receipt", 1);
    expect(isDeleted(peer.doc, "b")).toBe(false);
  });

  it("incomplete-observation — +1, and every other reason unchanged", async () => {
    const peer = await makePeer(canvasJson([A, B]));
    await save(peer, canvasJson([A, { ...B, x: 301 }])); // earn the receipts
    const before = peer.cs.deleteWithholdCounts();
    await save(peer, "{ this is not json");
    expectOnly(before, peer.cs.deleteWithholdCounts(), "incomplete-observation", 2);
  });

  it("no-open-surface — +1, and every other reason unchanged", async () => {
    const peer = await makePeer(canvasJson([A, B]));
    await save(peer, canvasJson([A, { ...B, x: 301 }])); // a "view" receipt
    peer.openPaths.clear(); // the user closes the board
    const before = peer.cs.deleteWithholdCounts();
    await save(peer, canvasJson([A]));
    expectOnly(before, peer.cs.deleteWithholdCounts(), "no-open-surface", 1);
    expect(isDeleted(peer.doc, "b")).toBe(false);
  });

  it("refused-at-ingest — +1, and every other reason unchanged", async () => {
    const peer = await makePeer(canvasJson([A, B]), { viewOpen: false });
    peer.cs.noteExternalDiskWrite(PATH, JSON.stringify({ nodes: [A, B], edges: [BAD] }));
    await save(peer, JSON.stringify({ nodes: [A, { ...B, x: 301 }], edges: [BAD] }));
    const before = peer.cs.deleteWithholdCounts();
    await save(peer, canvasJson([A, { ...B, x: 302 }]));
    expectOnly(before, peer.cs.deleteWithholdCounts(), "refused-at-ingest", 1);
  });

  it("THE COUNT IS PER RECORD, NEVER PER PASS — thirty withholds do not report one", async () => {
    // Vacuity (d): a counter that counts PASSES would report `1` for a save that
    // withheld every record on the board, which is exactly the reading that made
    // S78 invisible. Driven with a multi-record fixture.
    const peer = await makePeer(canvasJson([A, B, C, D]));
    const before = peer.cs.deleteWithholdCounts();
    await save(peer, canvasJson([A]));
    expectOnly(before, peer.cs.deleteWithholdCounts(), "no-receipt", 3);
  });

  it("the SIGNATURE names the records, carries no user data, and is ONE line per pass", async () => {
    const peer = await makePeer(canvasJson([A, B, C], [edge("ab", "a", "b")]));
    peer.logs.length = 0;
    await save(peer, canvasJson([A], []));

    const lines = peer.logs.filter((line) => line.startsWith("DELETE WITHHELD:"));
    expect(lines.length, "the withhold produced no signature, or more than one per pass").toBe(1);
    const line = lines[0];
    expect(line).toContain(PATH);
    expect(line).toContain("node/b reason=no-receipt");
    expect(line).toContain("node/c reason=no-receipt");
    expect(line).toContain("edge/ab reason=no-receipt");
    expect(line).toContain("(withheld=no-receipt=3)");

    // US6 — kinds, ids, reasons and counts ONLY. The fixture's node text and the
    // geometry values must not be anywhere in the line.
    for (const secret of ["300", "600", '"text"', "width"]) {
      expect(line, `the signature leaked a field value: ${secret}`).not.toContain(secret);
    }
  });

  it("a LICENSED delete charges nothing — a delete that works is not a refusal", async () => {
    // The paired positive for every zero above. Without it, "the counters did not
    // move" would also be satisfied by a build whose counters never move at all.
    const peer = await makePeer(canvasJson([A, B]));
    await save(peer, canvasJson([A, { ...B, x: 301 }]));
    const before = peer.cs.deleteWithholdCounts();
    await save(peer, canvasJson([A]));
    expect(isDeleted(peer.doc, "b"), "the licensed control did not delete").toBe(true);
    expect(peer.cs.deleteWithholdCounts()).toEqual(before);
  });

  it("the counts are a SNAPSHOT — a caller cannot mutate the ledger it is reading", async () => {
    const peer = await makePeer(canvasJson([A, B]));
    const snapshot = peer.cs.deleteWithholdCounts();
    snapshot["no-receipt"] = 9999;
    expect(peer.cs.deleteWithholdCounts()["no-receipt"]).toBe(0);
  });
});
