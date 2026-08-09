/**
 * WP121 — WINNING IS NOT A LICENCE TO DISCARD.
 *
 * `CanvasPersistence.coldOpen()` on a non-empty doc takes the `doc-wins` branch
 * and flushes the document's projection over the local `.canvas`. That decision
 * is correct and this module does not change it (`conflict-copy.ts`'s own header
 * rule: THIS MODULE DOES NOT CHANGE WHO WINS). What was missing is the half the
 * text arm has had since `S125`: a copy of the local version, placed beside the
 * share, when the projection about to land is missing records the file holds.
 *
 * ── 🔴 THE PREDICATE, AND WHY IT IS NOT THE ONE NEXT DOOR ────────────────────
 *
 * `decideConflictPreservation` (`conflict-copy.ts:313`) compares `mtime` against
 * `settings.lastSessionEndedAt`. That answers a SESSION-BOUNDARY question — "did
 * this peer change the file while it was away?" — for a guest rejoining a share.
 * The `doc-wins` question is a MID-SESSION, RECORD-LEVEL one, and the first
 * cannot answer the second. The placement (`conflictsRootFor`,
 * `conflictCopyPath`, `isConflictsPath`) and the ledger are reused; the
 * predicate is not.
 *
 * THE PREDICATE, IN ONE SENTENCE: the set of record ids (nodes and edges) the
 * file holds that the document has NO KNOWLEDGE OF AT ALL — neither as a key in
 * `nodes`/`edges` nor as an entry in the `deleted` tombstone container.
 *
 * ── 🔴 THREE THINGS IT IS DELIBERATELY NOT ───────────────────────────────────
 *
 *   ├── NOT A BYTE, HASH OR SIZE COMPARISON. `S174` / Investigation §2.2: a
 *   │   `.canvas` has THREE stable byte forms on this build for identical
 *   │   records — the author's, the plugin's canonical tab-indented
 *   │   `serializeCanvas`, and Obsidian's own one-record-per-line form (measured
 *   │   live at 235 / 296 / 218 B, zero field differences). A byte oracle is red
 *   │   for boards that are perfectly in sync and green for boards that are not.
 *   ├── NOT THE PROJECTION. The charter says "records the post-migration doc
 *   │   PROJECTION does not hold", and that phrasing is wrong in a way that
 *   │   would have made this feature unusable: `buildCanvasData` suppresses
 *   │   tombstoned records, so a projection-difference predicate fires on every
 *   │   ORDINARY DELETE — a conflict copy beside the board every time a user
 *   │   removes a card. Deletion in V2 is a VALUE, not an absence (WP19), so a
 *   │   tombstone is knowledge, and knowledge is what the predicate asks for.
 *   └── NOT A FIELD-LEVEL DIFF. A record the doc holds under the same id with
 *       different field values is a convergence question, not a discard; it is
 *       out of scope here and stated as a residual rather than half-implemented.
 *
 * An UNPARSEABLE file is an UNKNOWN, and every unknown preserves — the same
 * asymmetry `decideConflictPreservation`'s AC6b is built on. A copy nobody
 * needed costs a file in a folder; a missing copy costs the user's board.
 */

import { parseCanvasReport } from "./canvas-sync";

/** One record the file holds, named. Ids and kinds only — never content. */
export interface CanvasRecordRef {
  readonly kind: "node" | "edge";
  readonly id: string;
}

export const CANVAS_DISCARD = {
  /** The projection is missing records the file holds — preserve the file. */
  PRESERVE: "preserve",
  /** Every record the file holds is known to the document — do nothing. */
  NOTHING_TO_PRESERVE: "nothing-to-preserve",
} as const;

export type CanvasDiscardDecision = (typeof CANVAS_DISCARD)[keyof typeof CANVAS_DISCARD];

export interface CanvasDiscardVerdict {
  decision: CanvasDiscardDecision;
  reason: string;
  /** The named ids that would be discarded. Empty on NOTHING_TO_PRESERVE. */
  discarded: readonly CanvasRecordRef[];
  /** How many records the file held at all, for the narration's counts. */
  fileRecordCount: number;
}

/** The `arm` this package contributes to the shared conflict-copy ledger. */
export const CANVAS_CONFLICT_ARM = "canvas";

/**
 * Decide whether the about-to-land projection discards anything.
 *
 * Pure: the document is consulted through two membership questions the caller
 * answers from the live maps, so this function holds no Yjs types and can be
 * driven directly in both directions.
 *
 * @param fileContent the `.canvas` bytes currently on disk, or `null` if absent.
 * @param docKnows    does the document know this id — as a live record OR as a
 *                    tombstone? Knowledge, never visibility.
 */
export function decideCanvasDiscard(input: {
  fileContent: string | null;
  docKnows: (ref: CanvasRecordRef) => boolean;
}): CanvasDiscardVerdict {
  const { fileContent } = input;
  if (fileContent === null) {
    return {
      decision: CANVAS_DISCARD.NOTHING_TO_PRESERVE,
      reason: "no local file exists, so the projection replaces nothing",
      discarded: [],
      fileRecordCount: 0,
    };
  }
  if (fileContent.trim().length === 0) {
    return {
      decision: CANVAS_DISCARD.NOTHING_TO_PRESERVE,
      reason: "the local file is empty, so the projection replaces nothing",
      discarded: [],
      fileRecordCount: 0,
    };
  }

  const report = parseCanvasReport(fileContent);
  if (report.degraded) {
    // AC6b's asymmetry, carried across: a file we cannot read is a file we
    // cannot reason about, and the flush is about to overwrite it. `degraded`
    // is `parseCanvasReport`'s own answer (WP94 AC3) — it exists precisely so a
    // caller concluding something from an ABSENCE of records cannot mistake
    // "unreadable" for "empty".
    return {
      decision: CANVAS_DISCARD.PRESERVE,
      reason: "the local file could not be parsed, so what it holds is unknown",
      discarded: [],
      fileRecordCount: 0,
    };
  }

  const nodeIds = Object.keys(report.data.nodes);
  const edgeIds = Object.keys(report.data.edges);
  const discarded: CanvasRecordRef[] = [];
  for (const id of nodeIds) {
    const ref = { kind: "node", id } as const;
    if (!input.docKnows(ref)) discarded.push(ref);
  }
  for (const id of edgeIds) {
    const ref = { kind: "edge", id } as const;
    if (!input.docKnows(ref)) discarded.push(ref);
  }

  const fileRecordCount = nodeIds.length + edgeIds.length;
  if (discarded.length === 0) {
    return {
      decision: CANVAS_DISCARD.NOTHING_TO_PRESERVE,
      reason: "the document knows every record the local file holds",
      discarded: [],
      fileRecordCount,
    };
  }
  return {
    decision: CANVAS_DISCARD.PRESERVE,
    reason: "the document has no knowledge of records the local file holds",
    discarded,
    fileRecordCount,
  };
}

/** `node n-local, edge e-local` — the named ids, for a signature. Never content. */
export function describeDiscarded(discarded: readonly CanvasRecordRef[]): string {
  return discarded.map((r) => `${r.kind} ${r.id}`).join(", ");
}
