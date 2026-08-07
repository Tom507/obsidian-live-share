// WP94 / C94 AC1 — THE LOSS, REPRODUCED HEADLESS THROUGH THE REAL PRODUCER.
//
// The user's own instance shows the card gone -- they deleted it -- and the peer
// still shows it. The peer then projects its doc, which still holds the record,
// back onto the shared file, and the card RETURNS TO THE DELETING USER'S DISK.
// It is not a failure to propagate; it is a silent revert of a destructive user
// intent by a peer that was never told, and no signature fires on either side.
//
// Why this file is first: every claim in this work package about severity and
// about the shape of the repair rests on "the licence set has exactly one
// producer, and it is on the REMOTE path". A RED that a fixture manufactures is
// worth nothing. The store below is the real `createSurfaceStateStore`, wired as
// `main.ts` wires it, so the only way a P1 hand-over can appear is
// `advanceFromReceipt` -> `noteHandover`, which is driven only by a remote delta.
//
// PRE-REPAIR (measured at c4ba2f1, before the widening commit):
//     × the record this client created and then deleted is gone everywhere
//       AssertionError: the user's own deletion was silently discarded:
//       expected false to be true
// POST-REPAIR the identical fixture, unchanged in any other respect, tombstones
// the record -- through P2, the client's own capture, and NOT through P1.
//
// No wall-clock sleep, no `setTimeout` wait, no timing constant.

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

const KEEP = node("keep", { text: "kept" });
const X = node("x", { text: "the card the user makes and then deletes", x: 300 });

describe("WP94 AC1 — a record this client created and no peer re-delivered", () => {
  it("the record this client created and then deleted is gone everywhere", async () => {
    // Start from a board holding only `keep`, so `x` is created by THIS client
    // through the real capture path — which is the record class B50's DELETE_A
    // rung exercises and the class that can never hold a P1 licence.
    const peer = await makePeer(canvasJson([KEEP]));

    // ---- the CREATE half must be asserted to have landed, in the same run ----
    // Vacuity (b): "no tombstone" alone is true for free if the path was never
    // subscribed, the doc handle is missing or `canWrite` declined.
    // Vacuity (d): a RED that is red because the FILE write failed proves
    // nothing, so the fixture vault's bytes are asserted before the doc is.
    await save(peer, canvasJson([KEEP, X]));
    expect(peer.vault.files.get(PATH), "the fixture never wrote the file").toContain('"x"');
    expect(inDoc(peer.doc, "node", "x"), "the create half never landed").toBe(true);
    expect(projection(peer.doc).nodes.sort()).toEqual(["keep", "x"]);

    // ---- THE PRECONDITION THAT MAKES THIS THE S78 SHAPE ----
    // The killer vacuity, and the class that hid this defect for a whole run:
    // every WP19/WP2/WP15 delete test injects `handedToView` as a literal at
    // `setSurfaceStateProvider`, manufacturing a precondition production cannot
    // reach for this record. Here the hand-over set is asserted EMPTY at the
    // instant of the deleting save — no reconcile pass ever ran.
    const evidence = peer.cs.surfaceEvidenceFor(PATH);
    expect(evidence.viewOpen, "the board must be open — this is not the AC7 shape").toBe(true);
    expect(
      evidence.handedToView.node.size,
      "a P1 hand-over appeared without a reconcile pass — the fixture is manufacturing it",
    ).toBe(0);
    expect(evidence.handedToView.edge.size).toBe(0);

    const declinesBefore = peer.cs.captureDeclineCounts();

    // ---- the DELETE half: the user removes the card they just made ----
    await save(peer, canvasJson([KEEP]));

    expect(
      isDeleted(peer.doc, "x"),
      "the user's own deletion was silently discarded",
    ).toBe(true);
    expect(
      projection(peer.doc).nodes,
      "the deleted card is still in the projection the peer would receive",
    ).toEqual(["keep"]);

    // ---- and it is NOT a decline: a licensed delete is not a refusal ----
    // Vacuity (b): all six counters are asserted unmoved, so the delete cannot be
    // "explained" by the pass having bailed out before the diff.
    const declinesAfter = peer.cs.captureDeclineCounts();
    for (const reason of ALL_DECLINE_REASONS) {
      expect(declinesAfter[reason], `CAPTURE DECLINED: ${reason} moved`).toBe(
        declinesBefore[reason],
      );
    }
  });

  it("it goes green through P2 specifically — the withhold counters stay at zero", async () => {
    // AC2's "the widening is real, not cosmetic" row. The evidence that P2 did
    // the work is a POSITIVE fact about the receipt ledger plus an untouched
    // withhold ledger — never the absence of a log line (S65/S71).
    const peer = await makePeer(canvasJson([KEEP]));
    await save(peer, canvasJson([KEEP, X]));

    const evidence = peer.cs.surfaceEvidenceFor(PATH);
    expect(evidence.handedToView.node.has("x"), "P1 issued a licence it cannot issue").toBe(false);
    expect(
      evidence.receipts?.node.get("x"),
      "this client's own capture of x from this path issued no receipt",
    ).toBe("view");

    const before = peer.cs.deleteWithholdCounts();
    await save(peer, canvasJson([KEEP]));

    expect(isDeleted(peer.doc, "x")).toBe(true);
    expect(
      peer.cs.deleteWithholdCounts(),
      "a licensed delete charged a withhold",
    ).toEqual(before);
  });

  it("the telemetry line stops reading `-0 node(s)` for a deletion that happened", async () => {
    // The line that made S78 invisible: `local modify ... -0 node(s)` is
    // byte-identical to "the user deleted nothing". The log is NOT the oracle
    // here — the tombstone above is — but the human-facing line must stop lying.
    const peer = await makePeer(canvasJson([KEEP]));
    await save(peer, canvasJson([KEEP, X]));
    peer.logs.length = 0;
    await save(peer, canvasJson([KEEP]));

    const line = peer.logs.find((l) => l.startsWith(`local modify ${PATH}`));
    expect(line).toBeDefined();
    expect(line, "the deletion was reported as -0 node(s)").toContain("-1 node(s)");
    expect(line).toContain("deleted=[x]");
  });
});
