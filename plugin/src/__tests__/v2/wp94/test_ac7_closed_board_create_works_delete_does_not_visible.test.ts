// WP94 / C94 AC7 — THE CLOSED BOARD (S84), THE HEADLESS COMPANION TO THE LIVE
// ROW.
//
// THE PREDICTION, DERIVED FROM TWO LINES AND NOT OBSERVED FIRST: rule 4 was gated
// on `surface.viewOpen`, and `viewOpen` is `canvasAdapters.get(path)?.isAvailable()
// === true`, which requires an OPEN CANVAS LEAF. Rules 2 and 3 consult no surface
// state at all. Therefore, on an instance whose board is CLOSED, creations and
// mutations capture normally and DELETIONS NEVER CAPTURE -- of any record, ever,
// at any delta. That is S78's general form and it is far wider than the shape B50
// measured.
//
// THE MEASUREMENT IS THE ASYMMETRY: create works, delete does not, same instance,
// same file, same second. Not "delete is broken" -- that could be a subscription
// failure, a missing doc handle or a declined write. The paired create is what
// makes it a statement about rule 4 specifically.
//
// POST-REPAIR both land, and they land through P2 rather than through P3. That is
// a measured deviation from the charter's attribution and it is reported: P3
// (`noteExternalDiskWrite`) is deliberately NOT an issuer, because it proves what
// WE wrote to the file and not what the NEXT writer had read -- wiring it as one
// reddened `wp91/test_tp05` T2 by destroying a peer's record under a stale
// editor. The closed board still captures its deletions, through the receipt its
// own earlier save earned.

import { describe, expect, it } from "vitest";

import {
  ALL_DECLINE_REASONS,
  PATH,
  canvasJson,
  inDoc,
  isDeleted,
  makePeer,
  node,
  projection,
  save,
} from "./harness";

const A = node("a");
const B = node("b", { x: 300 });
const NEW = node("new", { x: 900, text: "made with the board closed" });

describe("WP94 AC7 — the closed board", () => {
  it("the board really IS closed, and the path really IS subscribed", async () => {
    // Vacuity (a): reporting a lost delete on a path that was never subscribed is
    // a statement about a different mechanism entirely -- `handleLocalModify`
    // returns at `not-subscribed` long before the diff. Both halves are asserted
    // before anything is concluded.
    const peer = await makePeer(canvasJson([A, B]), { viewOpen: false });
    expect(peer.cs.isSubscribed(PATH), "the path is not subscribed").toBe(true);
    expect(peer.cs.surfaceEvidenceFor(PATH).viewOpen, "the board is open").toBe(false);
  });

  it("CREATE works with the board closed — rules 2 and 3 consult no surface state", async () => {
    const peer = await makePeer(canvasJson([A, B]), { viewOpen: false });
    const declinesBefore = peer.cs.captureDeclineCounts();

    await save(peer, canvasJson([A, B, NEW]));

    expect(inDoc(peer.doc, "node", "new"), "a creation was lost on a closed board").toBe(true);
    expect(projection(peer.doc).nodes.sort()).toEqual(["a", "b", "new"]);
    // ...and nothing declined, so the create is not "the pass ran normally by
    // accident".
    const declinesAfter = peer.cs.captureDeclineCounts();
    for (const reason of ALL_DECLINE_REASONS) {
      expect(declinesAfter[reason], `CAPTURE DECLINED: ${reason} moved`).toBe(
        declinesBefore[reason],
      );
    }
  });

  it("DELETE now works too — the same instance, the same file, the same second", async () => {
    const peer = await makePeer(canvasJson([A, B]), { viewOpen: false });

    // (i) a node ADDED
    await save(peer, canvasJson([A, B, NEW]));
    expect(inDoc(peer.doc, "node", "new")).toBe(true);
    // The receipt this earned names the FILE surface, because that is what the
    // board being closed means: with no open canvas leaf the file is the surface.
    expect(peer.cs.surfaceEvidenceFor(PATH).receipts?.node.get("new")).toBe("file");

    // (ii) a node REMOVED
    const declinesBefore = peer.cs.captureDeclineCounts();
    await save(peer, canvasJson([A, B]));

    expect(
      isDeleted(peer.doc, "new"),
      "S84: a closed board still captures no deletion, of any record, at any delta",
    ).toBe(true);
    expect(projection(peer.doc).nodes.sort()).toEqual(["a", "b"]);
    // The asymmetry is gone, and it is gone without a decline appearing.
    const declinesAfter = peer.cs.captureDeclineCounts();
    for (const reason of ALL_DECLINE_REASONS) {
      expect(declinesAfter[reason]).toBe(declinesBefore[reason]);
    }
  });

  it("the closed board still REFUSES an unlicensed deletion — the gate became a criterion, not an absence of one", async () => {
    // The control that keeps the row above from being "a closed board deletes
    // whatever the file omits". A record the host seed put in the doc, that no
    // local save has ever observed, has no receipt and is not deletable.
    const peer = await makePeer(canvasJson([A, B]), { viewOpen: false });
    const before = peer.cs.deleteWithholdCounts();

    await save(peer, canvasJson([A]));

    expect(
      isDeleted(peer.doc, "b"),
      "removing the viewOpen gate turned a closed board into a licence to delete anything",
    ).toBe(false);
    expect(peer.cs.deleteWithholdCounts()["no-receipt"] - before["no-receipt"]).toBe(1);
  });

  it("a receipt earned on the CLOSED board is not spendable once the board opens", async () => {
    // The mirror of AC2's wrong-surface row, driven at the AC7 shape.
    const peer = await makePeer(canvasJson([A, B]), { viewOpen: false });
    await save(peer, canvasJson([A, B, NEW]));
    expect(peer.cs.surfaceEvidenceFor(PATH).receipts?.node.get("new")).toBe("file");

    peer.openPaths.add(PATH); // the user opens the canvas
    const before = peer.cs.deleteWithholdCounts();
    await save(peer, canvasJson([A, B]));

    expect(
      isDeleted(peer.doc, "new"),
      "a receipt earned while the board was closed licensed an absence observed on the open view",
    ).toBe(false);
    expect(peer.cs.deleteWithholdCounts()["no-receipt"] - before["no-receipt"]).toBe(1);
  });
});
