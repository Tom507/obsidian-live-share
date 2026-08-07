// WP94 / C94 AC4 — EDGE, NODE AND NODE+EDGE, AND A SINGLE GESTURE CANNOT
// HALF-APPLY.
//
// S82, measured rather than asserted: `buildApplyReceipt`'s geometry branch gives
// an EDGE `reloaded ? "applied" : "unchanged"` — always confirmed, always handed
// — while a NODE goes through `geometryNodeOutcome`, whose `"interacting"` and
// `"missing"` are not confirmed. `advanceFromReceipt` then derives BOTH the field
// advance AND the hand-over from one `isConfirmed` test: one value answering two
// different questions. After a geometry pass every edge on the board holds a
// delete licence and a card the user is holding does not.
//
// The user-visible consequence, and it is why this AC exists: delete a card AND
// its arrow in one gesture while holding the card, and the edge is tombstoned
// while the node is not — the card comes back from the peer WITHOUT ITS ARROW.
// Neither peer asked for that state.
//
// THE ORACLE FOR EVERY EDGE ROW IS `readTombstoneEntry`, NEVER THE PROJECTION.
// WP19 AC3's `visibleNodeIds` cascade suppresses an edge whose node was deleted,
// so an UNCAPTURED edge deletion looks identical to a captured one whenever its
// node went too — the single most likely false green in this work package. One
// arm below therefore deletes an edge whose endpoints BOTH SURVIVE.

import { describe, expect, it } from "vitest";

import { type ApplyOutcome } from "../../../canvas/canvas-shadow";
import {
  PATH,
  canvasJson,
  confirmGeometry,
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
const C = node("c", { x: 600 });
const AB = edge("ab", "a", "b");
const BC = edge("bc", "b", "c");
const BOARD = canvasJson([A, B, C], [AB, BC]);
/**
 * THE OBSERVATION THAT EARNS THE RECEIPTS, and it has to be a REAL EDIT.
 *
 * Re-saving the seeded bytes is a byte ECHO (WP4 AC2) and is declined before the
 * diff, so it observes nothing and issues nothing. The user nudging a card is the
 * cheapest honest observation of the whole board: every record is mentioned, so
 * every record earns a receipt, and the bytes differ from what the seed wrote.
 */
const TOUCHED = canvasJson([A, B, { ...C, x: 601 }], [AB, BC]);

describe("WP94 AC4 — edge, node and combined deletion", () => {
  describe("the licensed arms", () => {
    it("EDGE-ONLY, endpoints BOTH SURVIVE — the tombstone is the oracle, not the projection", async () => {
      // This is the arm the `visibleNodeIds` cascade cannot fake: `a` and `b` are
      // both still there, so if `ab` vanishes from the projection it is because it
      // was captured, and the tombstone says so directly.
      const peer = await makePeer(BOARD);
      await save(peer, TOUCHED); // the local observation that earns the receipts
      await save(peer, canvasJson([A, B, { ...C, x: 601 }], [BC]));

      expect(isDeleted(peer.doc, "ab"), "the edge deletion was not captured").toBe(true);
      expect(isDeleted(peer.doc, "a"), "an endpoint was destroyed with the arrow").toBe(false);
      expect(isDeleted(peer.doc, "b")).toBe(false);
      const seen = projection(peer.doc);
      expect(seen.nodes.sort()).toEqual(["a", "b", "c"]);
      expect(seen.edges).toEqual(["bc"]);
      // WP19 AC1: the container survives, so the delete is undoable.
      expect(inDoc(peer.doc, "edge", "ab")).toBe(true);
    });

    it("NODE-ONLY — the card goes and its arrows are suppressed, never tombstoned", async () => {
      const peer = await makePeer(BOARD);
      await save(peer, TOUCHED);
      // Obsidian removes the card AND, because the projection can no longer draw
      // them, its arrows.
      await save(peer, canvasJson([A, C], []));

      expect(isDeleted(peer.doc, "b")).toBe(true);
      expect(projection(peer.doc).nodes.sort()).toEqual(["a", "c"]);
      // Both arrows touched `b`. Neither may carry a tombstone of its own, or
      // undoing the card could never bring them back.
      expect(
        isDeleted(peer.doc, "ab"),
        "an arrow was tombstoned independently of the card it hung from",
      ).toBe(false);
      expect(isDeleted(peer.doc, "bc")).toBe(false);
      expect(projection(peer.doc).edges, "the dangling arrows still reach the file").toEqual([]);
    });

    it("NODE+EDGE together — ALL OR NOTHING, and the arrow never lands alone", async () => {
      const peer = await makePeer(BOARD);
      await save(peer, TOUCHED);
      await save(peer, canvasJson([A, C], [])); // one gesture: the card and its arrows

      // The user-visible outcome is all-or-nothing: nothing of `b` survives the
      // projection, and nothing of `b`'s arrows is independently destroyed.
      expect(isDeleted(peer.doc, "b")).toBe(true);
      expect(projection(peer.doc)).toEqual({ nodes: ["a", "c"], edges: [] });
      expect(inDoc(peer.doc, "edge", "ab")).toBe(true);
      expect(inDoc(peer.doc, "edge", "bc")).toBe(true);
    });
  });

  describe("the unlicensed arms", () => {
    it("EDGE-ONLY, no receipt — nothing is tombstoned and it is charged", async () => {
      // The host seed puts the board in the doc but issues no receipt (WP29).
      const peer = await makePeer(BOARD);
      const before = peer.cs.deleteWithholdCounts();
      await save(peer, canvasJson([A, B, C], [BC]));

      expect(isDeleted(peer.doc, "ab")).toBe(false);
      expect(projection(peer.doc).edges.sort()).toEqual(["ab", "bc"]);
      expect(peer.cs.deleteWithholdCounts()["no-receipt"] - before["no-receipt"]).toBe(1);
    });

    it("NODE-ONLY, no receipt — the card survives and it is charged", async () => {
      const peer = await makePeer(BOARD);
      const before = peer.cs.deleteWithholdCounts();
      await save(peer, canvasJson([A, C], [AB, BC]));

      expect(isDeleted(peer.doc, "b")).toBe(false);
      expect(projection(peer.doc).nodes.sort()).toEqual(["a", "b", "c"]);
      expect(peer.cs.deleteWithholdCounts()["no-receipt"] - before["no-receipt"]).toBe(1);
    });

    it("NODE+EDGE where only the NODE is unlicensed — the arrow is held back WITH it", async () => {
      // THE S82 DIVERGENCE, and the arm that would half-apply without the gesture
      // rule. The licence split is PER KIND and asserted, so "no divergence" is
      // not true for free by both halves failing for the same reason.
      const peer = await makePeer(BOARD);

      // A GEOMETRY pass in which the user is holding card `b`. This is the branch
      // the asymmetry lives in, and the branch is asserted taken.
      const outcomes = new Map<string, ApplyOutcome>([
        ["a", "applied"],
        ["b", "interacting"],
        ["c", "applied"],
      ]);
      confirmGeometry(peer, outcomes);

      const evidence = peer.cs.surfaceEvidenceFor(PATH);
      // S82 ITSELF, as a measured fact: the edge is handed and the held card is
      // not. If this ever stops being true the arm below is testing nothing.
      expect(
        evidence.handedToView.edge.has("ab"),
        "the geometry branch stopped handing edges over — S82 is gone and this arm is vacuous",
      ).toBe(true);
      expect(
        evidence.handedToView.node.has("b"),
        "the card the user is holding was handed over",
      ).toBe(false);
      expect(evidence.handedToView.node.has("a")).toBe(true);

      const before = peer.cs.deleteWithholdCounts();
      // One gesture: the held card and its arrow.
      await save(peer, canvasJson([A, C], [BC]));

      expect(
        isDeleted(peer.doc, "b"),
        "the card the user was holding was deleted by a save it never saw",
      ).toBe(false);
      expect(
        isDeleted(peer.doc, "ab"),
        "THE HALF-APPLY: the arrow was tombstoned while its card survived — " +
          "the card returns from the peer without it",
      ).toBe(false);
      // Both halves are visible to the user, together.
      expect(projection(peer.doc).nodes.sort()).toEqual(["a", "b", "c"]);
      expect(projection(peer.doc).edges.sort()).toEqual(["ab", "bc"]);

      const after = peer.cs.deleteWithholdCounts();
      expect(
        after["no-receipt"] - before["no-receipt"],
        "the withheld node and the arrow held back with it were not both charged",
      ).toBe(2);
    });
  });

  it("S83, ADJACENT AND NOT REPAIRED HERE: a failed structural reload voids P1 wholesale", async () => {
    // Reported as an interaction, not fixed: `noteHandover` REPLACES rather than
    // merges, so a structural pass whose reload did not land gives every line
    // `"failed"`, `summary.handed` is empty, and that empty set is written over
    // the licence set for the WHOLE PATH — on a pass nobody classifies as an
    // error. Whatever WP94 widens, this can revoke.
    //
    // What this test pins is the BLAST RADIUS, which WP94 does change: P2 lives in
    // `CanvasSync`'s own ledger, so `noteHandover`'s wholesale replacement cannot
    // reach it. That is a consequence of where the ledger was put, NOT a repair of
    // S83, and it is asserted here so a later reader does not mistake it for one.
    const peer = await makePeer(BOARD);
    await save(peer, TOUCHED); // P2 receipts, surface "view"
    expect(peer.cs.surfaceEvidenceFor(PATH).receipts?.node.get("b")).toBe("view");

    // A structural pass whose reload did NOT land.
    const summary = confirmGeometry(peer, new Map(), false);
    expect(summary.handed.node.size, "the failed pass handed something over").toBe(0);

    // P1 is now empty for the whole path...
    expect(peer.cs.surfaceEvidenceFor(PATH).handedToView.node.size).toBe(0);
    // ...and P2 is untouched, so the user's own deletion still lands.
    expect(peer.cs.surfaceEvidenceFor(PATH).receipts?.node.get("b")).toBe("view");
    await save(peer, canvasJson([A, C], []));
    expect(
      isDeleted(peer.doc, "b"),
      "a failed reload nobody classified as an error revoked the user's own licence too",
    ).toBe(true);
  });
});
