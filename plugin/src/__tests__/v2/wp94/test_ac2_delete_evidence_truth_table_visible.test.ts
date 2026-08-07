// WP94 / C94 AC2 — THE EVIDENCE CRITERION, EXHAUSTIVELY, PLUS THE FOUR CORNERS
// DRIVEN END TO END.
//
//     Delete(X) <=> Receipt(X, surface) & Complete(save) & Present(X) & !Seen(X)
//
// ABSENCE NEVER AUTHORISES. A RECEIPT AUTHORISES; ABSENCE ONLY SELECTS WHICH
// AUTHORISED RECORD TO SPEND IT ON.
//
// The expression is deliberately NOT symmetric in its conjuncts, and the whole
// work package turns on that asymmetry:
//
//   ├── drop `!Seen` and NOTHING is deleted -- every record is "still there";
//   └── drop `Receipt` and EVERYTHING is -- which is the naive rule "records
//          absent from the file are deleted from the doc", I11 inverted, and the
//          exact substitution WP80 and WP86 both shipped and had to be repaired
//          for. `parseCanvas` degrades every JSON error to an empty canvas, so
//          under that rule one truncated read destroys a whole shared board.
//
// Vacuity (a): a table asserted against the implementation's own enum is a
// restatement of the code and cannot fail, so the four corners are driven through
// the REAL `handleLocalModify`.
// Vacuity (b): every cell below is reachable -- the domain is the full product of
// the five facts, and there is no combination the type admits and no fixture can
// produce.
// Vacuity (c): the `wrong-surface` rows are present and are the rows that
// distinguish this criterion from "any receipt, ever, licenses any absence".
// Vacuity (d): `Complete` is supplied by the real producer in the corner cells.

import { describe, expect, it } from "vitest";

import {
  type DeleteVerdict,
  type ReceiptSurface,
  type ShadowRecordState,
  judgeDelete,
} from "../../../canvas/canvas-shadow";
import { canvasJson, isDeleted, makePeer, node, save } from "./harness";

const RECEIPT_SETS: ReadonlyArray<readonly ReceiptSurface[]> = [
  [],
  ["view"],
  ["file"],
  ["view", "file"],
];
const SURFACES: readonly ReceiptSurface[] = ["view", "file"];
const STATES: readonly ShadowRecordState[] = ["present", "absent", "unknown"];

/**
 * The criterion, restated INDEPENDENTLY of the implementation.
 *
 * Written as the four conjuncts of the specification rather than as a copy of
 * `judgeDelete`'s branch order, so that agreement between the two is evidence
 * rather than tautology. Only the DELETE half is modelled here; the REASON a
 * refusal is charged is asserted separately below, because a reason is a
 * reporting decision and the delete is the safety property.
 */
function specSaysDelete(
  receipts: readonly ReceiptSurface[],
  observedOn: ReceiptSurface,
  complete: boolean,
  state: ShadowRecordState,
  seen: boolean,
): boolean {
  const hasReceipt = receipts.includes(observedOn); // Receipt(X, surface)
  const present = state === "present"; // Present(X)
  return hasReceipt && complete && present && !seen; // & Complete & !Seen
}

describe("WP94 AC2 — the delete evidence criterion", () => {
  it("every cell of the truth table agrees with the specification", () => {
    let cells = 0;
    let deleting = 0;
    for (const receipts of RECEIPT_SETS) {
      for (const observedOn of SURFACES) {
        for (const complete of [true, false]) {
          for (const state of STATES) {
            for (const seen of [true, false]) {
              cells += 1;
              const verdict = judgeDelete({ receipts, observedOn, complete, state, seen });
              const expected = specSaysDelete(receipts, observedOn, complete, state, seen);
              if (expected) deleting += 1;
              expect(
                verdict.delete,
                `cell {receipts:[${receipts}] observedOn:${observedOn} complete:${complete} ` +
                  `state:${state} seen:${seen}} disagreed with the criterion`,
              ).toBe(expected);
            }
          }
        }
      }
    }
    // The table has to be a real one. A domain that collapsed to a single cell
    // would also "agree with the specification".
    expect(cells).toBe(RECEIPT_SETS.length * 2 * 2 * STATES.length * 2);
    expect(cells).toBe(96);
    // ...and it has to contain both outcomes, in quantity.
    // Four, and the arithmetic is worth stating: the licensing cell requires
    // `complete && present && !seen` (one value each) and a receipt set that
    // CONTAINS the observed surface — which is 2 of the 4 receipt sets for each
    // of the 2 surfaces. 4 x 1 x 1 x 1 = 4 licensed cells out of 96.
    expect(deleting, "no cell in the table deletes — the table proves nothing").toBe(4);
    expect(cells - deleting).toBe(92);
  });

  it("EXACTLY ONE cell deletes for each (receipt-set, surface) pair that matches", () => {
    // The asymmetry, stated as an experiment rather than as prose: hold three
    // conjuncts at their licensing value and flip the fourth.
    const licensing = {
      receipts: ["view"] as readonly ReceiptSurface[],
      observedOn: "view" as ReceiptSurface,
      complete: true,
      state: "present" as ShadowRecordState,
      seen: false,
    };
    expect(judgeDelete(licensing).delete).toBe(true);

    // Drop !Seen -> nothing is deleted.
    expect(judgeDelete({ ...licensing, seen: true }).delete).toBe(false);
    // Drop Receipt -> and under the NAIVE rule this is where everything would be
    // destroyed. Here it is a refusal with a name.
    expect(judgeDelete({ ...licensing, receipts: [] })).toEqual<DeleteVerdict>({
      delete: false,
      reason: "no-receipt",
    });
    // Drop Complete.
    expect(judgeDelete({ ...licensing, complete: false })).toEqual<DeleteVerdict>({
      delete: false,
      reason: "incomplete-observation",
    });
    // Drop Present.
    expect(judgeDelete({ ...licensing, state: "absent" }).delete).toBe(false);
    expect(judgeDelete({ ...licensing, state: "unknown" }).delete).toBe(false);
  });

  it("a NON-CANDIDATE is not a withhold — selection and authorisation are different", () => {
    // If `state`/`seen` charged a reason, the ledger would report the size of the
    // board on every save rather than a refusal, and AC6's counters would be
    // useless as an oracle.
    for (const state of ["absent", "unknown"] as const) {
      expect(judgeDelete({ receipts: [], observedOn: "view", complete: false, state, seen: false }))
        .toEqual<DeleteVerdict>({ delete: false, reason: null });
    }
    expect(
      judgeDelete({ receipts: [], observedOn: "view", complete: false, state: "present", seen: true }),
    ).toEqual<DeleteVerdict>({ delete: false, reason: null });
  });

  it("THE WRONG-SURFACE ROWS — a receipt is spendable only on the surface it names", () => {
    const base = { complete: true, state: "present" as ShadowRecordState, seen: false };
    // A view hand-over survives the closing of the board. It must not license an
    // absence observed on the file, and `no-open-surface` says exactly why.
    expect(judgeDelete({ ...base, receipts: ["view"], observedOn: "file" })).toEqual<DeleteVerdict>({
      delete: false,
      reason: "no-open-surface",
    });
    // The mirror: a receipt earned while the board was CLOSED does not license an
    // absence observed on the open view.
    expect(judgeDelete({ ...base, receipts: ["file"], observedOn: "view" })).toEqual<DeleteVerdict>({
      delete: false,
      reason: "no-receipt",
    });
    // Both surfaces vouched, so either observation is licensed.
    expect(judgeDelete({ ...base, receipts: ["view", "file"], observedOn: "view" }).delete).toBe(true);
    expect(judgeDelete({ ...base, receipts: ["view", "file"], observedOn: "file" }).delete).toBe(true);
    // Without these rows the criterion would be satisfied by the strictly weaker
    // rule "any receipt, ever, licenses any absence" — which is the degeneracy
    // the WP23 fuzzer caught in the first draft of the widening.
  });

  it("the criterion is PURE — same inputs, same verdict, and no shared state", () => {
    const evidence = {
      receipts: ["view"] as readonly ReceiptSurface[],
      observedOn: "view" as ReceiptSurface,
      complete: true,
      state: "present" as ShadowRecordState,
      seen: false,
    };
    const first = judgeDelete(evidence);
    for (let i = 0; i < 50; i += 1) expect(judgeDelete(evidence)).toEqual(first);
    // The argument is not mutated either — a predicate that edited its evidence
    // would make the truth table above order-dependent.
    expect(evidence.receipts).toEqual(["view"]);
  });

  // -------------------------------------------------------------------------
  // The four corners, driven END TO END through the real entry point.
  // -------------------------------------------------------------------------
  describe("the corners, driven through handleLocalModify", () => {
    const KEEP = node("keep");
    const X = node("x", { x: 300 });

    it("corner 1 — receipt + complete + present + not-seen ⇒ DELETED", async () => {
      const peer = await makePeer(canvasJson([KEEP]));
      await save(peer, canvasJson([KEEP, X])); // earns the P2 receipt
      await save(peer, canvasJson([KEEP]));
      expect(isDeleted(peer.doc, "x")).toBe(true);
    });

    it("corner 2 — no receipt ⇒ NOT deleted, charged no-receipt", async () => {
      // The host seed puts `x` in the doc and in the shadow, and WP29 is explicit
      // that a seed has NO OPINION ABOUT DELETION — so it issues no receipt. The
      // first save that omits `x` therefore has nothing to spend.
      const peer = await makePeer(canvasJson([KEEP, X]));
      const before = peer.cs.deleteWithholdCounts();
      await save(peer, canvasJson([KEEP]));
      expect(isDeleted(peer.doc, "x"), "a seed acted as a delete licence (WP29)").toBe(false);
      expect(peer.cs.deleteWithholdCounts()["no-receipt"] - before["no-receipt"]).toBe(1);
    });

    it("corner 3 — receipt but INCOMPLETE ⇒ NOT deleted, charged incomplete-observation", async () => {
      const peer = await makePeer(canvasJson([KEEP]));
      await save(peer, canvasJson([KEEP, X]));
      const before = peer.cs.deleteWithholdCounts();
      await save(peer, ""); // a zero-byte read
      expect(isDeleted(peer.doc, "x")).toBe(false);
      expect(
        peer.cs.deleteWithholdCounts()["incomplete-observation"] - before["incomplete-observation"],
      ).toBeGreaterThan(0);
    });

    it("corner 4 — receipt + complete but SEEN ⇒ not a candidate, nothing charged", async () => {
      const peer = await makePeer(canvasJson([KEEP]));
      await save(peer, canvasJson([KEEP, X]));
      const before = peer.cs.deleteWithholdCounts();
      await save(peer, canvasJson([KEEP, { ...X, x: 555 }])); // still mentioned
      expect(isDeleted(peer.doc, "x")).toBe(false);
      expect(peer.cs.deleteWithholdCounts(), "a mentioned record was charged a withhold").toEqual(
        before,
      );
    });

    it("A RECEIPT IS WHAT THE SURFACE HELD LAST TIME, NEVER WHAT IT HAS EVER HELD", async () => {
      // THE ANTI-DEGENERACY PROPERTY, and it is the one this suite could not
      // originally catch: the WP23 convergence fuzzer found it and nothing here
      // did, so it is pinned deterministically as well.
      //
      // A ledger that ACCUMULATES receipts is exactly the rule the criterion
      // exists to exclude — "any past knowledge licenses any future absence".
      // Every complete observation therefore REPLACES that kind's receipt set.
      //
      // The story: the user works on an open board, closes it, edits the file
      // with the board closed (and `c` leaves the file there, refused for want of
      // a matching receipt), then reopens the board. `c`'s old view receipt is
      // STALE — the board has not carried it since — and must not be spendable.
      const peer = await makePeer(canvasJson([KEEP]));
      const C = node("c", { x: 600 });

      // 1. Open board: a complete observation carrying `c`.
      await save(peer, canvasJson([KEEP, X, C]));
      expect(peer.cs.surfaceEvidenceFor("wiki/board.canvas").receipts?.node.get("c")).toBe("view");

      // 2. Board closed: a complete observation that no longer carries `c`. The
      //    deletion is refused (wrong surface) and the receipt set is REPLACED.
      peer.openPaths.clear();
      await save(peer, canvasJson([KEEP, X]));
      expect(isDeleted(peer.doc, "c")).toBe(false);
      expect(
        peer.cs.surfaceEvidenceFor("wiki/board.canvas").receipts?.node.get("c"),
        "a receipt survived an observation of the same surface that did not carry it",
      ).toBeUndefined();

      // 3. Board reopened. Under an ACCUMULATING ledger `c` would still hold its
      //    step-1 view receipt, the surfaces would match, and the arrow would be
      //    destroyed by a licence earned two observations ago.
      peer.openPaths.add("wiki/board.canvas");
      const before = peer.cs.deleteWithholdCounts();
      await save(peer, canvasJson([KEEP, { ...X, x: 301 }]));

      expect(
        isDeleted(peer.doc, "c"),
        "a stale receipt licensed an absence the surface had already stopped speaking about",
      ).toBe(false);
      expect(peer.cs.deleteWithholdCounts()["no-receipt"] - before["no-receipt"]).toBe(1);
    });

    it("an INCOMPLETE observation neither issues receipts nor revokes them", async () => {
      // The paired half of the replacement rule. An observation that cannot be
      // shown complete teaches nothing in either direction — revoking on it would
      // make one truncated read silently disarm every legitimate deletion that
      // followed, which is a data-loss bug facing the other way.
      const peer = await makePeer(canvasJson([KEEP]));
      await save(peer, canvasJson([KEEP, X]));
      expect(peer.cs.surfaceEvidenceFor("wiki/board.canvas").receipts?.node.get("x")).toBe("view");

      await save(peer, "{ truncated");
      expect(
        peer.cs.surfaceEvidenceFor("wiki/board.canvas").receipts?.node.get("x"),
        "a truncated read revoked a valid receipt",
      ).toBe("view");

      // ...and the deletion the user actually makes next still lands.
      await save(peer, canvasJson([KEEP]));
      expect(isDeleted(peer.doc, "x")).toBe(true);
    });

    it("the WRONG-SURFACE row, driven: a receipt earned on the OPEN view is not spent on the closed file", async () => {
      const peer = await makePeer(canvasJson([KEEP]));
      await save(peer, canvasJson([KEEP, X])); // viewOpen = true ⇒ a "view" receipt
      expect(peer.cs.surfaceEvidenceFor("wiki/board.canvas").receipts?.node.get("x")).toBe("view");

      // The user closes the board, and the next save comes from the FILE surface.
      peer.openPaths.clear();
      const before = peer.cs.deleteWithholdCounts();
      await save(peer, canvasJson([KEEP]));

      expect(
        isDeleted(peer.doc, "x"),
        "a receipt from the open view licensed an absence observed on the closed file",
      ).toBe(false);
      expect(
        peer.cs.deleteWithholdCounts()["no-open-surface"] - before["no-open-surface"],
      ).toBe(1);
    });
  });
});
