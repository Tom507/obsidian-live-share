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

import {
  type ApplyOutcome,
  advanceFromReceipt,
  buildApplyReceipt,
} from "../../../canvas/canvas-shadow";
import {
  PATH,
  canvasJson,
  confirmGeometry,
  confirmReload,
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
      // ⭐ CONVERTED 2026-08-07 (B60) — S82 IS REPAIRED AT THE LICENCE AND THIS
      // ASSERTION IS INVERTED, DELIBERATELY. It read:
      //
      //     expect(evidence.handedToView.edge.has("ab"),
      //       "the geometry branch stopped handing edges over — S82 is gone and
      //        this arm is vacuous").toBe(true);
      //
      // and it said in as many words what would make it wrong. That is what
      // happened: `buildApplyReceipt` now carries `delivered` beside `outcome`,
      // and a geometry EDGE is `delivered: false` because a geometry pass
      // touches nodes only — no edge reaches the surface unless the endpoint
      // reflow reload lands. The edge's `"unchanged"` remains true about the
      // VALUES and no longer mints a `"view"` receipt about the SURFACE.
      //
      // The arm below is NOT vacuous as a result, and that is the point worth
      // keeping: it now measures the same user-visible outcome — the card and
      // its arrow survive together — with BOTH halves unlicensed for their own
      // honest reasons instead of the arrow being rescued by WP94's gesture
      // rule. The gesture rule stays; it is simply no longer the only thing
      // standing between a held card and an orphaned arrow.
      expect(
        evidence.handedToView.edge.has("ab"),
        "a geometry pass minted a view receipt for an edge it never handed to the view (S82)",
      ).toBe(false);
      expect(
        evidence.handedToView.node.has("b"),
        "the card the user is holding was handed over",
      ).toBe(false);
      // The PER-KIND split the original assertion pair existed to pin is kept:
      // a node the pass really did apply is still licensed, so "no divergence"
      // is not true for free by everything failing for one reason.
      expect(evidence.handedToView.node.has("a")).toBe(true);
      expect(evidence.handedToView.node.has("c")).toBe(true);

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

  // ⭐ CONVERTED 2026-08-07 (B60) — S83 IS REPAIRED, AND THE TEST THAT SAID SO
  // COULD NOT HAVE SEEN IT EITHER WAY.
  //
  // The previous test was titled "ADJACENT AND NOT REPAIRED HERE" and asserted
  // that a failed pass leaves P1 empty. It did that by reading
  // `handedToView.node.size === 0` after a pass that confirmed nothing — but
  // P1 WAS ALREADY EMPTY when the test started. `makePeer` subscribes and seeds;
  // it never runs a reconcile, and `save()` issues P2 receipts, not P1. So the
  // assertion had no BEFORE: it read zero, zero was the initial value, and it
  // would have read zero on a tree where `noteHandover` merged perfectly. It
  // also drove `confirmGeometry`, i.e. a GEOMETRY pass, while its prose
  // described a structural one — so the mechanism it named was not the
  // mechanism it exercised.
  //
  // What replaces it establishes the licence set first, from the one production
  // producer, and then asserts it SURVIVES. That is the regression S83 needs:
  // it is red on the pre-repair tree and green on this one, and the arm that
  // makes it red is the user-visible one — a card the user handed over and then
  // deleted comes back, because an unrelated reload did not land.
  describe("S83 — a pass that confirms nothing revokes nothing", () => {
    it("a failed structural reload leaves every licence on the board standing", async () => {
      const peer = await makePeer(BOARD);
      // THE BEFORE, and it comes from the only production producer of P1:
      // `advanceFromReceipt` -> `noteHandover`, on a reload that LANDED.
      const granted = confirmReload(peer);
      expect([...granted.handed.node].sort()).toEqual(["a", "b", "c"]);
      const before = peer.cs.surfaceEvidenceFor(PATH);
      expect([...before.handedToView.node].sort()).toEqual(["a", "b", "c"]);
      expect([...before.handedToView.edge].sort()).toEqual(["ab", "bc"]);

      // A STRUCTURAL pass whose reload did not land. Every line is `"failed"`,
      // which is a fact about the PASS — our `setData` did not run — and not a
      // fact about any record on the board.
      const failed = confirmReload(peer, false);
      expect(failed.handed.node.size, "a failed reload handed something over").toBe(0);
      expect(failed.handed.edge.size).toBe(0);
      expect(
        failed.revoked.node.size + failed.revoked.edge.size,
        "a pass that proved nothing revoked something",
      ).toBe(0);
      expect(failed.markedAbsent, "an unlanded reload is not exhaustive").toEqual([]);

      // ...and the licence set is exactly what it was.
      const after = peer.cs.surfaceEvidenceFor(PATH);
      expect(
        [...after.handedToView.node].sort(),
        "a reload nobody classified as an error voided the board's node licences",
      ).toEqual(["a", "b", "c"]);
      expect(
        [...after.handedToView.edge].sort(),
        "a reload nobody classified as an error voided the board's edge licences",
      ).toEqual(["ab", "bc"]);
    });

    it("THE USER-VISIBLE HALF: the deletion the user makes after that pass still lands", async () => {
      // `b` holds a P1 licence and NOTHING ELSE — no `save()` has run, so
      // `CanvasSync`'s own P2 ledger is empty for this path and cannot stand in
      // for the revoked licence the way it does in the arm above. Whether the
      // user's delete is honoured therefore depends on P1 alone, which is what
      // makes this the discriminating arm.
      const peer = await makePeer(BOARD);
      confirmReload(peer);
      expect(peer.cs.surfaceEvidenceFor(PATH).receipts?.node.get("b")).toBeUndefined();

      confirmReload(peer, false); // the reload that did not land

      const withheldBefore = peer.cs.deleteWithholdCounts();
      await save(peer, canvasJson([A, C], [BC]));

      expect(
        isDeleted(peer.doc, "b"),
        "a reload that did not land revoked the user's own licence and their deletion was lost",
      ).toBe(true);
      expect(projection(peer.doc).nodes.sort()).toEqual(["a", "c"]);
      expect(
        peer.cs.deleteWithholdCounts()["no-receipt"] - withheldBefore["no-receipt"],
        "the delete was charged as unlicensed",
      ).toBe(0);
    });

    it("PROOF still revokes: a landed reload that no longer carries a record voids ITS licence only", async () => {
      // The other half of the repair, and the half that keeps "merge" from
      // meaning "licences are immortal". A LANDED structural reload replaced
      // the surface's membership, so a record it did not carry is provably not
      // on that surface and its `"view"` receipt is now false.
      const peer = await makePeer(BOARD);
      confirmReload(peer);
      expect([...peer.cs.surfaceEvidenceFor(PATH).handedToView.node].sort()).toEqual([
        "a",
        "b",
        "c",
      ]);

      // A peer removed `b`, so the next landed reload carries `a` and `c` only.
      // Driven through the receipt seam with an explicit `desired` rather than
      // by deleting locally first: a locally honoured delete already marks the
      // shadow record `absent`, and `sweepAbsent` skips anything not `present`
      // — the sweep would then be a no-op and this arm would measure nothing.
      const swept = advanceFromReceipt(
        peer.cs.getSurfaceShadow(),
        buildApplyReceipt({
          path: PATH,
          desired: { nodes: [A, C], edges: [BC] },
          plan: "structural",
          reloaded: true,
        }),
      );
      peer.store.noteHandover(PATH, swept.handed, swept.revoked);

      expect([...swept.revoked.node], "the sweep proved `b` absent and did not say so").toEqual([
        "b",
      ]);
      expect(swept.markedAbsent).toContainEqual({ kind: "node", id: "b" });
      const evidence = peer.cs.surfaceEvidenceFor(PATH);
      expect(
        evidence.handedToView.node.has("b"),
        "a record the surface provably no longer holds kept its view licence",
      ).toBe(false);
      // ...and ONLY its own. The merge is not an excuse to keep everything, and
      // proof is not an excuse to drop everything.
      expect([...evidence.handedToView.node].sort()).toEqual(["a", "c"]);
    });

    it("what WP94 already bought is kept: P2 was never reachable by the revocation", async () => {
      // The original test's one sound half, preserved. P2 lives in
      // `CanvasSync`'s own ledger rather than behind `noteHandover`, so it was
      // out of the blast radius before this repair and still is.
      const peer = await makePeer(BOARD);
      await save(peer, TOUCHED);
      expect(peer.cs.surfaceEvidenceFor(PATH).receipts?.node.get("b")).toBe("view");

      confirmReload(peer, false);

      expect(peer.cs.surfaceEvidenceFor(PATH).receipts?.node.get("b")).toBe("view");
      await save(peer, canvasJson([A, C], []));
      expect(isDeleted(peer.doc, "b")).toBe(true);
    });
  });
});
