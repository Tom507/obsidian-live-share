// WP94 / C94 AC5 — A RECORD REFUSED AT INGEST IS NEVER A DELETE CANDIDATE, AND
// THE SEED'S OWN SHADOW ADVANCE DOES NOT MANUFACTURE ONE.
//
// THE POLARITY, AND IT STOPPED BEING THEORETICAL ON 2026-08-07:
//
//   ├── a DELETED record is PRESENT IN THE DOC and ABSENT FROM THE FILE;
//   └── a REFUSED record is ABSENT FROM THE DOC and PRESENT IN THE FILE.
//
// They are mirror images, and a repair keyed on "the doc and the file disagree"
// collapses them into one action. `SEED REFUSED:` fired live for the first time
// in this project during B50, so both rows are now occupied by real events.
//
// THE MECHANISM THAT CONNECTS THEM, which no document in this run recorded:
// `seedFlatSpace` refuses records and returns them, and the host-seed branch then
// called `advanceShadowFromContent` over the WHOLE FILE, refusals included --
// `advanceShadowFromContent` performs no ingest check of any kind. So the shadow
// held `present` for a record the doc NEVER RECEIVED.
//
// THE DECISION THIS WORK PACKAGE TOOK, WRITTEN DOWN AS THE CHARTER REQUIRES.
// The charter offered two repairs -- subtract the refused set from the delete
// candidates, or make the shadow advance consistent with what the doc actually
// received -- and said they are not equivalent. BOTH are implemented, and the
// SHADOW is the fix while the veto is defence in depth:
//
//   ├── the shadow advance is the ROOT CAUSE, and it is the only one of the two
//   │      that also restores CREATABILITY. `applyIntentPlan` refuses to create
//   │      an id the shadow already holds as `present` (GAP-2 delete-wins), so a
//   │      seed-refused record could never be created afterwards -- not even once
//   │      the user repaired the file, because every field of the repaired record
//   │      then read as staleness against a shadow that already claimed it. A
//   │      veto alone would have left that defect standing.
//   └── the veto in `applyIntentPlan` covers the OTHER routes that advance the
//          shadow from file content with no ingest check -- `noteExternalDiskWrite`
//          and the cold-open seed -- which the seed fix does not reach. Those are
//          real and reachable, which is why the reason is not decoration.
//
// HEADLESS ONLY, and that is a decision rather than an omission: B50 section 2.5
// showed Obsidian's own canvas view NORMALISES a `toNode`-less edge away when the
// board is open (S80), so a live arm could not distinguish the product from the
// host application.

import { describe, expect, it } from "vitest";

import { getRecordState } from "../../../canvas/canvas-shadow";
import {
  PATH,
  canvasJson,
  edge,
  inDoc,
  isDeleted,
  makePeer,
  node,
  projection,
  save,
} from "./harness";

const A = node("a");
const B = node("b", { x: 300 });
/** B50's shape exactly: `fromNode` and NO `toNode` -> MISSING_TO, reject: true. */
const BAD = { id: "bad", fromNode: "a", fromSide: "right" };
const WITH_BAD = JSON.stringify({ nodes: [A, B], edges: [BAD] });
const GOOD = edge("good", "a", "b");

describe("WP94 AC5 — a refusal is not a deletion", () => {
  it("the host seed REFUSES the malformed edge — asserted as STATE, not from the log", async () => {
    // Vacuity (a): a fixture that never produced a refusal makes every assertion
    // below true for free. Under S65/S71 an `INGEST REJECTED` grep is not
    // admissible for this, so the ledger is the oracle.
    const peer = await makePeer(WITH_BAD);

    const refusals = peer.cs.seedRefusalLedger(PATH).list();
    expect(refusals.length, "the fixture produced no refusal at all").toBeGreaterThan(0);
    expect(refusals.map((r) => r.id)).toContain("bad");
    expect(refusals.find((r) => r.id === "bad")?.reason).toBe("MISSING_TO");

    // The doc never received it...
    expect(inDoc(peer.doc, "edge", "bad"), "a refused record reached the doc").toBe(false);
    // ...and the SHADOW does not claim it either. This is the root-cause repair:
    // before it, the seed advanced the shadow over the whole file and the shadow
    // said `present` for a record with no `Y.Map`.
    expect(
      getRecordState(peer.cs.getSurfaceShadow(), PATH, "edge", "bad"),
      "the shadow claims a record the doc never received",
    ).toBe("unknown");
  });

  it("saving the file WITHOUT the bad edge writes no tombstone — beside a licensed control", async () => {
    const peer = await makePeer(WITH_BAD);
    // Earn receipts for the whole board with a real edit, and add a normal edge
    // so the run carries a LICENSED control (vacuity (b)): "no tombstone" on a
    // path where nothing was licensed anyway demonstrates nothing.
    await save(peer, JSON.stringify({ nodes: [A, { ...B, x: 301 }], edges: [BAD, GOOD] }));
    expect(inDoc(peer.doc, "edge", "good"), "the licensed control never landed").toBe(true);

    const before = peer.cs.deleteWithholdCounts();
    // The user repairs the file by removing the malformed edge, and in the same
    // save deletes the good one.
    await save(peer, JSON.stringify({ nodes: [A, { ...B, x: 301 }], edges: [] }));

    expect(
      isDeleted(peer.doc, "bad"),
      "a REFUSAL standing in the file was tombstoned as though it were a DELETION in the doc",
    ).toBe(false);
    // The control went green in the same run, so the arm above is not "nothing
    // was deletable here".
    expect(isDeleted(peer.doc, "good"), "the licensed control was not deleted").toBe(true);
    expect(peer.cs.deleteWithholdCounts()).toEqual(before);
  });

  it("THE ROW THAT PROVES THE RESURRECT BLOCK DID NOT SWALLOW IT — the id stays creatable", async () => {
    // If a tombstone had been written for `bad`, `planIntentDiff`'s rule 1 would
    // block it forever; and if the shadow still claimed it `present`, the create
    // branch would refuse it forever. Repairing the file must simply work.
    const peer = await makePeer(WITH_BAD);
    await save(peer, JSON.stringify({ nodes: [A, { ...B, x: 301 }], edges: [BAD] }));

    // The user gives the edge its missing endpoint.
    await save(peer, JSON.stringify({ nodes: [A, { ...B, x: 301 }], edges: [edge("bad", "a", "b")] }));

    expect(
      inDoc(peer.doc, "edge", "bad"),
      "a record refused at the seed could never be created again once the file was repaired",
    ).toBe(true);
    expect(isDeleted(peer.doc, "bad")).toBe(false);
    expect(projection(peer.doc).edges).toContain("bad");
  });

  it("the VETO fires for a record the doc never received by another route, and is charged", async () => {
    // The route the seed fix does not reach: `noteExternalDiskWrite` advances the
    // shadow from file content with NO ingest check at all, so the shadow can
    // still come to hold `present` for a record with no `Y.Map`. This is the
    // fixture that makes `refused-at-ingest` a reachable reason rather than
    // decoration (AC6 vacuity (b)).
    const peer = await makePeer(canvasJson([A, B]), { viewOpen: false });

    // 1. The shadow learns the bad edge from a disk write, with no ingest check.
    peer.cs.noteExternalDiskWrite(PATH, WITH_BAD);
    expect(getRecordState(peer.cs.getSurfaceShadow(), PATH, "edge", "bad")).toBe("present");
    expect(inDoc(peer.doc, "edge", "bad")).toBe(false);

    // 2. A local save mentions it, so it earns a receipt from the file surface —
    //    while the capture boundary still refuses to write it. The bytes must
    //    DIFFER from what `noteExternalDiskWrite` just recorded as the baseline,
    //    or WP4 AC2's byte echo breaker declines the save before the diff.
    await save(peer, JSON.stringify({ nodes: [A, { ...B, x: 301 }], edges: [BAD] }));
    expect(peer.cs.surfaceEvidenceFor(PATH).receipts?.edge.get("bad")).toBe("file");
    expect(inDoc(peer.doc, "edge", "bad"), "the capture boundary admitted a MISSING_TO edge").toBe(
      false,
    );

    // 3. ...and now the save omits it. Licensed by the criterion, and refused by
    //    the veto, because a tombstone here would stamp an id with no `Y.Map` and
    //    the resurrect block would make it permanently uncreatable.
    const before = peer.cs.deleteWithholdCounts();
    await save(peer, canvasJson([A, { ...B, x: 302 }]));

    expect(isDeleted(peer.doc, "bad")).toBe(false);
    expect(
      peer.cs.deleteWithholdCounts()["refused-at-ingest"] - before["refused-at-ingest"],
      "the veto fired without charging its reason",
    ).toBe(1);
  });

  it("SEED REFUSED / SEED RESTORED behaviour is byte-unchanged — the ledger is still the writer's input", async () => {
    const peer = await makePeer(WITH_BAD);
    const ledger = peer.cs.seedRefusalLedger(PATH);
    expect(ledger.list().map((r) => r.id)).toEqual(["bad"]);
    // WP63/WP90 own this gate and WP94 is on the CAPTURE side, not the projection
    // side. The ledger's contents are read here and never written.
    expect(ledger.list().every((r) => r.boundary === "host-seed")).toBe(true);
  });
});
