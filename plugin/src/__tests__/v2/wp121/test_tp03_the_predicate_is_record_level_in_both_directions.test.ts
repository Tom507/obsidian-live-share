// WP121 A2 — the predicate is RECORD-LEVEL, and it is proved in BOTH directions.
//
// 🔴 NO ROW IN THIS FILE SCORES A CANVAS ON `sha256`, BYTE-IDENTITY OR FILE SIZE.
// `S174` / Investigation §2.2: a `.canvas` has three stable byte forms on this
// build for identical records, measured live at 235 / 296 / 218 B with zero
// field differences. The "stays silent" rows below are built out of two of those
// three REAL spellings, not out of a whitespace tweak invented for the test —
// and each asserts that the bytes genuinely differ, which is what makes the row
// a discriminator rather than a tautology. That byte assertion is a CONTROL on
// the fixture ("a byte predicate would have fired here"), never the oracle.
//
// The "stays silent" direction is the one that decides whether this package is
// usable: a guard that fires on spelling puts a conflict copy beside every board
// on this build, which trains the user to ignore the folder — functionally the
// same as having no net at all, with extra clutter.

import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { attachCanvasPersistence, serializeCanvas } from "../../../files/canvas-persistence";
import { getConflictCopies, resetConflictCopies } from "../../../files/conflict-copy";
import {
  EDGE,
  NODE,
  authorSpelling,
  conflictCopiesIn,
  createIO,
  obsidianSpelling,
  preservationOver,
  recordIdsIn,
  seedDoc,
  tombstone,
} from "./harness";

const SHARE = "share";
const CONFLICTS = "share (conflicts)";
const PATH = "share/board.canvas";

beforeEach(() => {
  resetConflictCopies();
});

describe("WP121 A2 — FIRES: the file holds a record the document does not know", () => {
  it("preserves the file, names the ids, and the flush still lands", async () => {
    const io = createIO({ [PATH]: authorSpelling([NODE("n-shared"), NODE("n-local")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence, coldOpen } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    expect(coldOpen).toBe("doc-wins");

    // The projection landed — who wins did not change.
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-shared"]);

    // And the card is recoverable, by NAME, from the conflicts root.
    const copies = conflictCopiesIn(io, CONFLICTS);
    expect(copies).toHaveLength(1);
    expect(recordIdsIn(io.files.get(copies[0])).nodes).toEqual(["n-local", "n-shared"]);

    expect(getConflictCopies()).toMatchObject({ total: 1, byArm: { canvas: 1 }, failed: 0 });
    persistence.destroy();
  });

  it("fires for a file-only EDGE just as it does for a node", async () => {
    const io = createIO({
      [PATH]: authorSpelling([NODE("n1"), NODE("n2")], [EDGE("e-local", "n1", "n2")]),
    });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n1"), NODE("n2")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    const copies = conflictCopiesIn(io, CONFLICTS);
    expect(copies).toHaveLength(1);
    expect(recordIdsIn(io.files.get(copies[0])).edges).toEqual(["e-local"]);
    persistence.destroy();
  });

  it("an UNPARSEABLE file preserves — every unknown preserves (AC6b's asymmetry)", async () => {
    const io = createIO({ [PATH]: "{ this is not JSON" });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-shared")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    const copies = conflictCopiesIn(io, CONFLICTS);
    expect(copies).toHaveLength(1);
    // The bytes are preserved verbatim, unparsed — that is the whole point.
    expect(io.files.get(copies[0])).toBe("{ this is not JSON");
    expect(getConflictCopies().byArm.canvas).toBe(1);
    persistence.destroy();
  });
});

describe("WP121 A2 — STAYS SILENT: identical records in a different spelling", () => {
  /** The document both spellings below describe, record for record. */
  function sharedBoard(): Y.Doc {
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n1"), NODE("n2")], [EDGE("e1", "n1", "n2")]);
    return doc;
  }

  it("the file is in OBSIDIAN's one-record-per-line spelling → no copy, nothing in the ledger", async () => {
    const doc = sharedBoard();
    const canonical = serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    );
    const parsed = JSON.parse(canonical) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    const obsidian = obsidianSpelling(parsed.nodes, parsed.edges);

    // FIXTURE CONTROL, not the oracle: the two byte forms genuinely differ, so a
    // byte / size / sha256 predicate WOULD have fired on this row.
    expect(obsidian).not.toBe(canonical);
    expect(obsidian.length).not.toBe(canonical.length);
    // ...and they carry exactly the same records.
    expect(recordIdsIn(obsidian)).toEqual(recordIdsIn(canonical));

    const io = createIO({ [PATH]: obsidian });
    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    expect(conflictCopiesIn(io, CONFLICTS)).toEqual([]);
    expect(getConflictCopies()).toMatchObject({ total: 0, failed: 0 });
    persistence.destroy();
  });

  it("the file is in the AUTHOR's compact spelling → no copy, nothing in the ledger", async () => {
    const doc = sharedBoard();
    const canonical = serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    );
    const parsed = JSON.parse(canonical) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    const author = authorSpelling(parsed.nodes, parsed.edges);

    expect(author).not.toBe(canonical);
    expect(author.length).not.toBe(canonical.length);
    expect(recordIdsIn(author)).toEqual(recordIdsIn(canonical));

    const io = createIO({ [PATH]: author });
    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    expect(conflictCopiesIn(io, CONFLICTS)).toEqual([]);
    expect(getConflictCopies()).toMatchObject({ total: 0, failed: 0 });
    persistence.destroy();
  });

  it("POSITIVE CONTROL: the same spelling with ONE extra record does fire", async () => {
    // Without this row the two above would be scoring "the guard never fires",
    // which a deleted guard also achieves. Same spelling, same doc, one card
    // added to the file.
    const doc = sharedBoard();
    const canonical = serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    );
    const parsed = JSON.parse(canonical) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    const io = createIO({
      [PATH]: obsidianSpelling([...parsed.nodes, NODE("n-local")], parsed.edges),
    });

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    expect(conflictCopiesIn(io, CONFLICTS)).toHaveLength(1);
    expect(getConflictCopies().byArm.canvas).toBe(1);
    persistence.destroy();
  });
});

describe("WP121 A2 — STAYS SILENT: a record the user DELETED", () => {
  it("an ordinary delete produces no copy — carried by the RECORD-MAP conjunct", async () => {
    // 🔴 THIS ROW'S SUBJECT IS NARROWER THAN ITS FIRST NAME SUGGESTED, and the
    // break table is what found that out. Planting `BK3` — deleting the
    // tombstone conjunct from `docKnowsRecord` — reddened NOTHING, because WP19
    // made deletion a VALUE, not an absence: a tombstoned record's key STAYS in
    // `nodes`/`edges`, so `nodesMap.has(id)` already answers `true` here and the
    // tombstone conjunct is SUBSUMED on every delete path the product has today.
    //
    // The row is kept, because "an ordinary delete produces no conflict copy" is
    // the property that decides whether this feature is usable and it is worth
    // pinning whichever conjunct carries it. What it does NOT pin is the
    // tombstone conjunct — that is the next row's job.
    // 🔴 THE CHARTER IS WRONG HERE AND THIS ROW IS THE CORRECTION. §2 states the
    // predicate as "records the post-migration doc PROJECTION does not hold".
    // `buildCanvasData` SUPPRESSES tombstoned records, so a projection-difference
    // predicate fires on every ordinary delete — a conflict copy beside the board
    // every time a user removes a card, which is precisely the "guard that fires
    // on spelling" failure mode A2's second row exists to prevent, wearing a
    // different coat. Deletion in V2 is a VALUE, not an absence (WP19), so the
    // predicate asks about KNOWLEDGE.
    const io = createIO({ [PATH]: authorSpelling([NODE("n-keep"), NODE("n-deleted")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-keep"), NODE("n-deleted")]);
    tombstone(doc, "n-deleted");

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    // The delete landed on disk...
    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-keep"]);
    // ...and it produced NO conflict copy.
    expect(conflictCopiesIn(io, CONFLICTS)).toEqual([]);
    expect(getConflictCopies()).toMatchObject({ total: 0, failed: 0 });
    persistence.destroy();
  });

  it("a TOMBSTONE ALONE is knowledge — the conjunct the previous row cannot reach", async () => {
    // The state: the `deleted` container holds the id and the record map does
    // NOT. `docKnowsRecord`'s tombstone conjunct is the only thing that can
    // answer here, so this row is what makes it falsifiable — `BK3` reddens it
    // and reddens nothing else.
    //
    // 🔴 HOW REACHABLE IS IT? Stated rather than implied. No delete path in the
    // product produces this today: `canvas-sync.ts` has no `nodesMap.delete(id)`
    // / `edgesMap.delete(id)` on the record path at all (WP19 removed them, and
    // its own comment says a key removal is what made undo lossy and the delete
    // unmergeable). So the conjunct is DEFENCE AGAINST A CHANGE ELSEWHERE, not
    // against a live path — and the cost of that change landing without this
    // conjunct is a conflict copy beside the board on EVERY ordinary delete,
    // which is the usability failure this whole direction exists to prevent.
    // Kept, and pinned, with its reachability written down.
    const io = createIO({ [PATH]: authorSpelling([NODE("n-keep"), NODE("n-gone")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-keep"), NODE("n-gone")]);
    tombstone(doc, "n-gone");
    // Remove the record key, leaving the tombstone as the only knowledge.
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>("nodes").delete("n-gone");
    });
    expect(doc.getMap<Y.Map<unknown>>("nodes").has("n-gone")).toBe(false);
    expect(doc.getMap<unknown>("deleted").has("n-gone")).toBe(true);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    expect(conflictCopiesIn(io, CONFLICTS)).toEqual([]);
    persistence.destroy();
  });

  it("POSITIVE CONTROL: the same board with the id NEITHER held NOR tombstoned does fire", async () => {
    // Identical fixture minus the tombstone and minus the doc record — the one
    // difference that separates "the user deleted it" from "the document never
    // heard of it".
    const io = createIO({ [PATH]: authorSpelling([NODE("n-keep"), NODE("n-deleted")]) });
    const doc = new Y.Doc();
    seedDoc(doc, [NODE("n-keep")]);

    const { persistence } = await attachCanvasPersistence(doc, io, PATH, {
      preserveDiscarded: preservationOver(io, { sharedFolder: SHARE }),
    });

    expect(recordIdsIn(io.files.get(PATH)).nodes).toEqual(["n-keep"]);
    expect(conflictCopiesIn(io, CONFLICTS)).toHaveLength(1);
    persistence.destroy();
  });
});
