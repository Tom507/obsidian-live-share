// WP94 / C94 AC3 — A TRUNCATED, PARTIAL OR UNPARSEABLE OBSERVATION YIELDS ZERO
// DELETE CANDIDATES, AND A GENUINELY EMPTIED CANVAS STILL DELETES.
//
// This is the most important file in the work package, and its ordering rule is
// not negotiable: it lands BEFORE the licence set is widened.
//
// `parseCanvas` catches EVERY JSON error and returns `{nodes:{},edges:{}}`, and
// `handleLocalModify` never asked whether it had degraded. So a mid-write read, a
// half-flushed file, a zero-byte file and a canvas the user genuinely emptied all
// arrived at the delete rule as `save.nodes = []`. The hand-over gate — the very
// defect S78 names — was the ONLY thing standing between a partial read and the
// tombstoning of every record on a shared board. Widen the gate before this
// exists and you have shipped that path.
//
// THE DISCRIMINATION IS THE MEASUREMENT. "0 deletes" on a truncated read is also
// the UNFIXED behaviour, so it proves nothing on its own; the paired positive —
// a genuinely cleared canvas deleting N — is what makes this a measurement rather
// than a restatement. If (iii) and (v) cannot be told apart, the product either
// loses every wipe or destroys on every truncation, and there is no third option.
//
// MEASURED, AND REPORTED BECAUSE IT IS NOT WHAT THE CHARTER ASSUMED: conjunct 1
// (`degraded`) IS NOT INDEPENDENTLY FALSIFIABLE THROUGH `handleLocalModify`. It
// is SUBSUMED by conjunct 4 (`hasNodesKey` / `hasEdgesKey`), because a parse that
// threw reports both keys as absent — which is the honest report, since a
// degraded parse genuinely establishes nothing about what the source contained.
// Forcing `parseOk = true` in `measureCompleteness` reddens NOTHING here. The
// conjunct is kept anyway: it NAMES the reason, and it is the fact a future
// caller that only asks `degraded` would rely on. It is pinned at the unit level
// instead, where it does fail — making the catch branch report `degraded: false`
// reddens the first test below.
//
// No wall-clock sleep, no `setTimeout` wait, no timing constant.

import { describe, expect, it } from "vitest";

import { parseCanvasReport } from "../../../files/canvas-sync";
import {
  PATH,
  type Peer,
  canvasJson,
  confirmReload,
  edge,
  isDeleted,
  makePeer,
  node,
  projection,
  save,
} from "./harness";

const N1 = node("n1", { text: "one" });
const N2 = node("n2", { text: "two", x: 300 });
const N3 = node("n3", { text: "three", x: 600 });
const E1 = edge("e1", "n1", "n2");
const FULL = canvasJson([N1, N2, N3], [E1]);

/**
 * A board whose four records are all `present` in the shadow AND all carry a
 * valid P1 receipt.
 *
 * Vacuity (c): a fixture with no receipts has nothing deletable, so every "0
 * deletes" assertion would be true for free. The receipts are asserted non-empty
 * here, in the same run, before anything else is read.
 */
async function boardWithReceipts(): Promise<Peer> {
  const peer = await makePeer(FULL);
  confirmReload(peer);
  const handed = peer.cs.surfaceEvidenceFor(PATH).handedToView;
  expect(
    [...handed.node].sort(),
    "the fixture never established a receipt, so nothing was deletable anyway",
  ).toEqual(["n1", "n2", "n3"]);
  expect([...handed.edge]).toEqual(["e1"]);
  return peer;
}

describe("WP94 AC3 — an incomplete observation deletes nothing", () => {
  // -------------------------------------------------------------------------
  // The parse report is load-bearing, not decorative (unit level).
  // -------------------------------------------------------------------------
  describe("parseCanvas reports HOW it degraded", () => {
    it("(i)-(iii) unparseable input is reported as degraded", () => {
      const bytes = FULL;
      for (const fraction of [0.25, 0.5, 0.75]) {
        const truncated = bytes.slice(0, Math.floor(bytes.length * fraction));
        const report = parseCanvasReport(truncated);
        expect(report.degraded, `truncation at ${fraction * 100}% was not reported`).toBe(true);
        expect(report.data.nodes).toEqual({});
      }
      expect(parseCanvasReport('{"nodes":[').degraded).toBe(true);
      expect(parseCanvasReport("").degraded).toBe(true);
    });

    it("(iv) a MISSING edges key is well-formed JSON — excluded by conjunct 4, not conjunct 1", () => {
      const report = parseCanvasReport('{"nodes":[]}');
      // This is the half that would be missed by a suite in which every case is
      // invalid JSON and `JSON.parse` does the work for free.
      expect(report.degraded, "well-formed JSON was reported as a parse degradation").toBe(false);
      expect(report.hasNodesKey).toBe(true);
      expect(report.hasEdgesKey, "a missing `edges` key was read as an empty edge set").toBe(false);
    });

    it("(v) a genuinely cleared canvas degrades in no way at all", () => {
      const report = parseCanvasReport('{"nodes":[],"edges":[]}');
      expect(report.degraded).toBe(false);
      expect(report.hasNodesKey).toBe(true);
      expect(report.hasEdgesKey).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // The inversion guard, driven end to end through the real entry point.
  // -------------------------------------------------------------------------
  describe("the inversion guard", () => {
    const cases: Array<[string, string]> = [
      ["(i) truncated at 25%", FULL.slice(0, Math.floor(FULL.length * 0.25))],
      ["(i) truncated at 50%", FULL.slice(0, Math.floor(FULL.length * 0.5))],
      ["(i) truncated at 75%", FULL.slice(0, Math.floor(FULL.length * 0.75))],
      ["(ii) the prefix {\"nodes\":[", '{"nodes":['],
      ["(iii) the empty string", ""],
    ];

    for (const [label, content] of cases) {
      it(`${label} deletes NOTHING and charges every candidate to incomplete-observation`, async () => {
        const peer = await boardWithReceipts();
        const before = peer.cs.deleteWithholdCounts();

        await save(peer, content);

        for (const id of ["n1", "n2", "n3", "e1"]) {
          expect(isDeleted(peer.doc, id), `${label} tombstoned ${id}`).toBe(false);
        }
        expect(projection(peer.doc).nodes.sort()).toEqual(["n1", "n2", "n3"]);

        // AC6 vacuity (a): the primary evidence is a POSITIVE non-zero, never a
        // zero. Four candidates were suppressed, so the counter advances by four.
        const after = peer.cs.deleteWithholdCounts();
        expect(after["incomplete-observation"] - before["incomplete-observation"]).toBe(4);
        expect(after["no-receipt"]).toBe(before["no-receipt"]);
        expect(after["no-open-surface"]).toBe(before["no-open-surface"]);
        expect(after["refused-at-ingest"]).toBe(before["refused-at-ingest"]);
      });
    }

    it("(iv) `{\"nodes\":[]}` with NO edges key deletes no EDGE — the nodes are still readable", async () => {
      const peer = await boardWithReceipts();
      const before = peer.cs.deleteWithholdCounts();

      await save(peer, '{"nodes":[]}');

      // The node half IS a complete observation: `nodes` is present and empty, so
      // the user really did clear the cards.
      for (const id of ["n1", "n2", "n3"]) {
        expect(isDeleted(peer.doc, id), `a complete node observation failed to delete ${id}`).toBe(true);
      }
      // The edge half is not evidence of anything: a document with no `edges` key
      // is indistinguishable from one whose every edge was deleted.
      expect(
        isDeleted(peer.doc, "e1"),
        "a MISSING `edges` key was read as `every edge was deleted`",
      ).toBe(false);

      const after = peer.cs.deleteWithholdCounts();
      expect(after["incomplete-observation"] - before["incomplete-observation"]).toBe(1);
    });

    it("(v) THE DISCRIMINATION — a genuinely cleared canvas deletes all N", async () => {
      const peer = await boardWithReceipts();
      const before = peer.cs.deleteWithholdCounts();

      await save(peer, '{"nodes":[],"edges":[]}');

      for (const id of ["n1", "n2", "n3"]) {
        expect(isDeleted(peer.doc, id), `the user's wipe did not delete ${id}`).toBe(true);
      }
      // ...and the board really is empty for the user and for every peer.
      expect(projection(peer.doc)).toEqual({ nodes: [], edges: [] });

      // THE EDGE IS **NOT** INDEPENDENTLY TOMBSTONED, AND THAT IS WP19 AC3, NOT A
      // MISSED DELETE. `e1` runs between `n1` and `n2`, both of which this pass
      // deletes, so `buildCanvasData`'s `visibleNodeIds` guard already refuses to
      // emit it — the cascade is a CONSEQUENCE of the suppression rule rather than
      // a second mechanism. Tombstoning the arrow as well would break undo:
      // restoring the card could no longer bring its arrow back, because the arrow
      // would carry a tombstone of its own that the card's undo never mentions.
      // The edge's own absence from the file is therefore not an observation about
      // the edge at all, and it is charged as such.
      expect(
        isDeleted(peer.doc, "e1"),
        "the arrow was tombstoned independently of its cards — undo can no longer restore it",
      ).toBe(false);
      const after = peer.cs.deleteWithholdCounts();
      expect(after["incomplete-observation"] - before["incomplete-observation"]).toBe(1);
      expect(after["no-receipt"]).toBe(before["no-receipt"]);
      expect(after["no-open-surface"]).toBe(before["no-open-surface"]);
    });

    it("(iii) and (v) are told APART over the same fixture in the same run", async () => {
      // The pair, side by side, because neither half may be reported without the
      // other: "0 deletes on a truncated read" is also the unfixed behaviour, and
      // "N deletes on a wipe" alone would be satisfied by destroying on both.
      const truncated = await boardWithReceipts();
      await save(truncated, "");
      const wiped = await boardWithReceipts();
      await save(wiped, '{"nodes":[],"edges":[]}');

      expect(projection(truncated.doc).nodes.length, "a truncated read destroyed the board").toBe(3);
      expect(projection(wiped.doc).nodes.length, "the user's wipe was lost").toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Conjunct 2 — the stability re-read, driven through the I/O seam.
  // -------------------------------------------------------------------------
  describe("conjunct 2 — an UNSTABLE read is not an observation", () => {
    it("two reads of one pass that disagree withhold every candidate", async () => {
      const peer = await boardWithReceipts();
      const before = peer.cs.deleteWithholdCounts();

      // A mid-write observation: the first read sees a cleared canvas, the
      // confirming re-read sees the writer's next state. Nothing about the clock
      // is involved — the seam returns different bytes, which is the fact.
      peer.vault.files.set(PATH, '{"nodes":[],"edges":[]}');
      peer.vault.nextReads.push('{"nodes":[],"edges":[]}', canvasJson([N1], []));

      await peer.cs.handleLocalModify(PATH);

      for (const id of ["n1", "n2", "n3", "e1"]) {
        expect(isDeleted(peer.doc, id), `an unstable read tombstoned ${id}`).toBe(false);
      }
      const after = peer.cs.deleteWithholdCounts();
      expect(after["incomplete-observation"] - before["incomplete-observation"]).toBe(4);
    });

    it("...and the SAME fixture with EQUAL bytes on both reads goes green", async () => {
      // The paired positive. Without it, "unstable ⇒ withhold" would also be
      // satisfied by a build that withheld unconditionally.
      const peer = await boardWithReceipts();
      peer.vault.files.set(PATH, '{"nodes":[],"edges":[]}');
      peer.vault.nextReads.push('{"nodes":[],"edges":[]}', '{"nodes":[],"edges":[]}');

      await peer.cs.handleLocalModify(PATH);

      expect(projection(peer.doc)).toEqual({ nodes: [], edges: [] });
    });
  });

  // -------------------------------------------------------------------------
  // Conjunct 4 — a pass that REFUSED a record is not a full picture.
  // -------------------------------------------------------------------------
  it("conjunct 4 — a capture-boundary refusal withholds the whole pass's deletes", async () => {
    const peer = await boardWithReceipts();
    const before = peer.cs.deleteWithholdCounts();

    // The save drops n2 and n3 (a real deletion) while introducing a node the
    // capture boundary must refuse: `type: "text"` with no `text` key.
    await save(
      peer,
      canvasJson([N1, { id: "bad", type: "text", x: 0, y: 0, width: 10, height: 10 }], [E1]),
    );

    expect(
      isDeleted(peer.doc, "n2"),
      "a save the boundary partly refused was still read as a complete picture",
    ).toBe(false);
    expect(isDeleted(peer.doc, "n3")).toBe(false);
    const after = peer.cs.deleteWithholdCounts();
    expect(after["incomplete-observation"] - before["incomplete-observation"]).toBe(2);
  });

  // -------------------------------------------------------------------------
  // AC3 vacuity (e) — `noteExternalDiskWrite` must not start reading from disk.
  // -------------------------------------------------------------------------
  it("noteExternalDiskWrite still receives the WRITER'S IN-MEMORY STRING, not a re-read", async () => {
    // Its `markMissingAbsent = true` arm marks every omitted record absent. That
    // is safe ONLY because the content is the string `writeSnapshot` just
    // serialised and passed to `onWritten`, which cannot be truncated. Any change
    // that makes this arm read from disk turns it into a shadow-wide erase on a
    // partial read.
    const peer = await makePeer(FULL, { viewOpen: false });
    const readsBefore = peer.vault.read.mock.calls.length;

    peer.cs.noteExternalDiskWrite(PATH, canvasJson([N1], []));

    expect(
      peer.vault.read.mock.calls.length,
      "noteExternalDiskWrite read the file — its content is no longer the writer's own bytes",
    ).toBe(readsBefore);
    expect(peer.vault.adapter.read.mock.calls.length).toBe(0);
  });
});
