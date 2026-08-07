import * as Y from "yjs";

import { type EpochConflictOutcome, bumpEpoch, readEpoch } from "../canvas/canvas-epoch";
import {
  type ImportAffectedPeer,
  type ImportAvailability,
  type ImportOverwriteSummary,
  type ImportUnavailableReason,
  importConfirmationMessage,
  importUnavailableReason,
} from "../canvas/canvas-import-command";
import { EPOCH_KEY, META_MAP_NAME } from "../canvas/canvas-schema";
import { SEED_DECISION, type SeedDecision } from "./canvas-seed-decision";
import {
  DELETED_MAP_NAME,
  buildCanvasData,
  decodeCanvasDataToFlat,
  parseCanvas,
  seedRecordsIntoYMaps,
} from "./canvas-sync";

// ---------------------------------------------------------------------------
// WP30 / P2 — `runImportFromFile`: the ONE door through which a file overwrites
// an already-living board (C30, AC1).
// ---------------------------------------------------------------------------
//
// WP29 removed the destructive re-seed, so nothing automatic can subtract a
// record from a living doc any more; the seed writer that survives is
// upsert-only (I7) and can only ever add. This module is what replaces it: a
// NAMED user action, gated by a confirmation that says what is destroyed and
// whose it is, publishing a WHOLESALE replacement through WP28's epoch seam.
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS IS NOT `seedRecordsIntoYMaps(liveDoc, ...)` — the wrong
// implementation that satisfies almost everything
// ─────────────────────────────────────────────────────────────────────────
//
// Seeding the LIVE doc from the file produces, on this client, a board that
// contains the file. It looks right. It is wrong twice over:
//
//   ├── the seed is upsert-only, so every record the file does NOT mention
//   │   survives — the import adds and never overwrites; and
//   └── the records reach the peers as ORDINARY EDITS. They merge them. Nothing
//       is archived anywhere, no peer's board is replaced, and the user is told
//       their import landed.
//
// So the file is staged into a SEPARATE `winner` document, the epoch is raised
// on that winner, and the pair is offered to `CanvasSync.adoptEpochWinner`,
// which replaces the record containers wholesale under one transaction and makes
// every peer archive-then-adopt through the epoch rule. That is also why the
// complete replacement is executed HERE and nowhere else: a replica that has
// already merged the winner holds `winner ∪ loser` and cannot subtract its way
// back to the winner's record set — no implementation can, and none must try
// (WP28's implementation report, "the one honest gap").
//
// ─────────────────────────────────────────────────────────────────────────
// TWO ORDERING PROPERTIES, BOTH OF THEM ACCEPTANCE CRITERIA
// ─────────────────────────────────────────────────────────────────────────
//
// 1. ASK FIRST, WRITE AFTER (AC3). "Cancelling performs no write of any kind" is
//    not implementable as stage-publish-rollback: a rollback is two writes and a
//    window in which peers saw the first one. Nothing in this function touches
//    any write channel before `await env.confirm(...)` has returned exactly
//    `true`. The reads that precede it — the file, the live projection, the peer
//    list — are reads, and they have to happen first, because a confirmation
//    that cannot quote the board is the generic dialog AC3 forbids.
//
// 2. BUMP AND SEED BOTH COMPLETE BEFORE THE PUBLISH (AC2). At the instant the
//    winner is offered, it already carries the file's records AND an epoch
//    strictly greater than the live board's, and the live board is still
//    untouched. An import that raised the epoch afterwards would publish records
//    that peers merge as ordinary edits; an import that bumped the STAGED doc
//    instead of the live board's successor would publish epoch 1 (a doc parsed
//    from a `.canvas` has no `meta` at all) and lose every conflict against a
//    board that has ever been imported before.
//
// ─────────────────────────────────────────────────────────────────────────
// FAIL-CLOSED, AND LEGIBLE (I11)
// ─────────────────────────────────────────────────────────────────────────
//
// Four of the five outcomes are refusals, and none of them may throw out of the
// call: the production caller is a `checkCallback`, which is not async and whose
// result Obsidian discards, so an escaping rejection is an unhandled rejection
// in the user's console and nothing else. The refusal that is easiest to get
// wrong is `ADOPTION_REFUSED`: `conflictCopyPath` is day-granular and
// `CanvasSync.writeConflictCopy` never clobbers, so an ordinary SECOND import of
// the same board on the same day is refused by the archive channel — and because
// the mechanism is fail-closed, that refusal cancels the adoption. The board is
// then unchanged, which is the correct outcome and an incomprehensible one
// unless the user is told. `IMPORTED` is reported only when a real outcome came
// back from the seam.
// ---------------------------------------------------------------------------

/**
 * The provenance of the staged seed, in the style of `CANVAS_SEED_ORIGIN` and
 * `CANVAS_EPOCH_ADOPT_ORIGIN`.
 *
 * A `unique symbol`, so no peer, test or other module can forge it. It is only
 * ever seen on the WINNER document — the live doc receives exactly one
 * transaction and it carries WP28's adopt origin, never this one.
 */
export const CANVAS_IMPORT_SEED_ORIGIN: unique symbol = Symbol("canvas-import-seed-origin");

export const IMPORT_STATUS = {
  IMPORTED: "imported",
  CANCELLED: "cancelled",
  UNAVAILABLE: "unavailable",
  NO_SOURCE: "no-source",
  ADOPTION_REFUSED: "adoption-refused",
} as const;
export type ImportStatus = (typeof IMPORT_STATUS)[keyof typeof IMPORT_STATUS];

/** The logger category every import line carries. */
const IMPORT_LOG_CATEGORY = "canvas-import";

/**
 * The injected world. Everything impure the import needs, and nothing else.
 *
 * The injection is not only a purity concern: `adoptEpochWinner` being the ONLY
 * write channel is what makes "cancelling performs no write of any kind"
 * observable at an I/O boundary rather than inferred from an unchanged board.
 */
export interface ImportFromFileEnv {
  availability(canvasPath: string): ImportAvailability;
  liveDoc(canvasPath: string): Y.Doc | null;
  peers(canvasPath: string): readonly ImportAffectedPeer[];
  readCanvasFile(canvasPath: string): Promise<string | null>;
  confirm(summary: ImportOverwriteSummary, message: string): Promise<boolean>;
  /** THE ONLY WRITE CHANNEL. WP28's complete-adoption seam. */
  adoptEpochWinner(canvasPath: string, winner: Y.Doc): Promise<EpochConflictOutcome | null>;
  notify(message: string): void;
  logger?: { debug(c: string, m: string): void; warn(c: string, m: string): void };
}

export interface ImportFromFileResult {
  readonly status: ImportStatus;
  /** `SEED_DECISION.SEED_FROM_FILE` when the import ran; `null` otherwise. */
  readonly decision: SeedDecision | null;
  readonly epoch: number | null;
  readonly archivedTo: string | null;
  readonly message: string | null;
  readonly unavailableReason: ImportUnavailableReason | null;
  readonly detail: string | null;
}

/** Every field that is not the status defaults to `null` — never to a plausible value. */
function refusal(
  status: ImportStatus,
  fields: Partial<Omit<ImportFromFileResult, "status">> = {},
): ImportFromFileResult {
  return {
    status,
    decision: null,
    epoch: null,
    archivedTo: null,
    message: null,
    unavailableReason: null,
    detail: null,
    ...fields,
  };
}

function errorText(err: unknown): string {
  if (err instanceof Error && typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  return String(err);
}

/**
 * The parsed file, or `null` when the text is not a canvas document.
 *
 * THIS GUARD IS THE POINT, not a formality. `parseCanvas` SWALLOWS a JSON error
 * and returns empty records (a deliberate, load-bearing property everywhere
 * else: a corrupt file must never throw a subscribe). Handing its output
 * straight to a wholesale replacement would read a truncated, half-written or
 * empty file as "the user wants an empty board" and delete everything — with a
 * confirmation dialog that truthfully said so, which is worse.
 *
 * So the text is parsed HERE, independently, and admitted only if it is a JSON
 * OBJECT carrying an ARRAY `nodes`. `{"nodes":[],"edges":[]}` is admitted:
 * emptying a board is a thing a user may legitimately ask for, and refusing it
 * would make "empty" and "corrupt" indistinguishable. An `edges` present but not
 * an array is refused for the same reason `nodes` is — half a document is not a
 * document — even though no visible test supplies one.
 */
function parseImportSource(text: string): ReturnType<typeof parseCanvas> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const shape = parsed as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(shape.nodes)) return null;
  if (shape.edges !== undefined && !Array.isArray(shape.edges)) return null;
  return parseCanvas(text);
}

/**
 * What a peer, the `.canvas` file and the open view actually see — never raw key
 * presence. Post-WP19 a removal is a TOMBSTONE rather than a missing key, and
 * `buildCanvasData` also applies the node→edge cascade, so a count taken off the
 * containers would overstate the board by every suppressed record and every
 * dangling edge. The number in the dialog has to be the number the user sees.
 */
function liveRecordCount(doc: Y.Doc | null): number {
  if (doc === null) return 0;
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
  return data.nodes.length + data.edges.length;
}

/**
 * AC1–AC4 in one function. THE ORDER BELOW IS THE ACCEPTANCE CRITERION, not a
 * preference:
 *
 * ```text
 *  1. availability      → refuse UNAVAILABLE. No read, no dialog, no write.
 *  2. read + parse      → refuse NO_SOURCE.   No dialog, no write.
 *  3. live doc          ← a read
 *  4. summary           ← the LIVE board's projection, and `env.peers(path)`
 *  5. message           ← `importConfirmationMessage(summary)`
 *  6. confirm           → anything but `true` is CANCELLED. NOT ONE WRITE.
 *  7. stage the winner  ← live epoch stamped, then the file's records seeded
 *  8. bumpEpoch(winner) ← WP28 owns the increment; WP30 never writes `n + 1`
 *  9. adoptEpochWinner  ← THE ONLY WRITE
 * 10. winner.destroy()  ← in a `finally`
 * ```
 *
 * Steps 1–6 are all reads and a question. Step 9 is the only write, and steps 7
 * and 8 both complete before it — at the moment the winner is offered it already
 * carries the file's records and the new epoch, and the live doc is untouched.
 *
 * Never throws. Every failure is a status.
 */
export async function runImportFromFile(
  canvasPath: string,
  env: ImportFromFileEnv,
): Promise<ImportFromFileResult> {
  // 1. AC4. Asked before anything at all is read: a client that does not own
  //    this board, or cannot see it properly, must not even open the file — the
  //    dialog it would build would quote a board it cannot see.
  const unavailable = importUnavailableReason(env.availability(canvasPath));
  if (unavailable !== null) {
    env.logger?.debug(
      IMPORT_LOG_CATEGORY,
      `IMPORT REFUSED: ${canvasPath} is ${unavailable} - the command is unavailable here`,
    );
    return refusal(IMPORT_STATUS.UNAVAILABLE, { unavailableReason: unavailable });
  }

  // 2. The source. A missing file and an unparseable one are the same refusal:
  //    there is nothing to import. Crucially they are NOT an empty board.
  const text = await env.readCanvasFile(canvasPath);
  if (text === null) {
    env.logger?.warn(IMPORT_LOG_CATEGORY, `IMPORT REFUSED: ${canvasPath} could not be read`);
    return refusal(IMPORT_STATUS.NO_SOURCE, {
      detail: `${canvasPath} could not be read from disk`,
    });
  }
  const source = parseImportSource(text);
  if (source === null) {
    env.logger?.warn(
      IMPORT_LOG_CATEGORY,
      `IMPORT REFUSED: ${canvasPath} is not a readable canvas document - refusing to read it as an empty board`,
    );
    return refusal(IMPORT_STATUS.NO_SOURCE, {
      detail: `${canvasPath} is not a readable canvas document`,
    });
  }

  // 3-5. What the user is about to authorise, stated over the LIVE board.
  const live = env.liveDoc(canvasPath);
  const summary: ImportOverwriteSummary = {
    canvasPath,
    liveRecordCount: liveRecordCount(live),
    fileRecordCount: Object.keys(source.nodes).length + Object.keys(source.edges).length,
    peers: env.peers(canvasPath),
  };
  const message = importConfirmationMessage(summary);

  // 6. AC3. Anything that is not exactly `true` is a cancel — a dismissed modal,
  //    a torn-down dialog, a promise that settles `undefined`. Consent is
  //    affirmative or it is not consent, and this returns BEFORE the winner is
  //    even constructed, so there is nothing to roll back.
  const ok = await env.confirm(summary, message);
  if (ok !== true) {
    env.logger?.debug(IMPORT_LOG_CATEGORY, `IMPORT CANCELLED: ${canvasPath} - nothing was written`);
    return refusal(IMPORT_STATUS.CANCELLED, { message });
  }

  const winner = new Y.Doc();
  try {
    // 7. The predecessor is the LIVE board's epoch, NOT the staged doc's. A doc
    //    parsed from a `.canvas` carries no `meta` at all, so a bump taken on the
    //    staged doc alone yields 1 — which loses every conflict against a board
    //    that has ever been imported before, silently and permanently.
    const predecessor = live === null ? 0 : readEpoch(live);
    winner.transact(() => {
      winner.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, predecessor);
    });
    seedRecordsIntoYMaps(winner, decodeCanvasDataToFlat(source), CANVAS_IMPORT_SEED_ORIGIN);

    // 8. WP28 owns the increment. `bumpEpoch` normalises first, so a corrupt or
    //    absent live cell still yields a strictly greater epoch instead of
    //    freezing the board.
    const epoch = bumpEpoch(winner);

    // 9. THE ONLY WRITE. Everything above this line is a read or a question.
    let outcome: EpochConflictOutcome | null;
    try {
      outcome = await env.adoptEpochWinner(canvasPath, winner);
    } catch (err) {
      // Fail-closed and LEGIBLE (I11). The archive channel never clobbers, so a
      // second import of this board on the same day lands here with the board
      // completely unchanged — a correct outcome that is indistinguishable from
      // a bug unless the user is told which board did not change and why.
      const detail = errorText(err);
      env.notify(`Live Share: ${canvasPath} was NOT imported - the board is unchanged. ${detail}`);
      env.logger?.warn(
        IMPORT_LOG_CATEGORY,
        `IMPORT REFUSED: ${canvasPath} was not published - ${detail}`,
      );
      return refusal(IMPORT_STATUS.ADOPTION_REFUSED, { epoch, message, detail });
    }
    if (outcome === null) {
      // The seam answers `null` when this client holds no document for the path.
      // Reporting a success here would tell the user their file landed on a
      // board that never received it.
      const detail = `no live document is held for ${canvasPath}, so the import could not be published`;
      env.notify(`Live Share: ${canvasPath} was NOT imported - the board is unchanged. ${detail}`);
      env.logger?.warn(IMPORT_LOG_CATEGORY, `IMPORT REFUSED: ${detail}`);
      return refusal(IMPORT_STATUS.ADOPTION_REFUSED, { epoch, message, detail });
    }

    env.logger?.debug(
      IMPORT_LOG_CATEGORY,
      `IMPORTED: ${canvasPath} at epoch ${epoch} (archived to ${outcome.archivedTo ?? "nothing"})`,
    );
    return {
      status: IMPORT_STATUS.IMPORTED,
      // WP29's vocabulary, imported and never re-spelt (Contract §1).
      decision: SEED_DECISION.SEED_FROM_FILE,
      epoch,
      archivedTo: outcome.archivedTo,
      message,
      unavailableReason: null,
      detail: null,
    };
  } finally {
    // 10. The winner is a scratch document. Leaking one per import leaks every
    //     observer WP28's adoption attached to it.
    winner.destroy();
  }
}
