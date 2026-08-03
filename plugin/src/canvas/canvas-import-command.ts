// ---------------------------------------------------------------------------
// WP30 / P2 — THE EXPLICIT "IMPORT FROM FILE" COMMAND, pure core (C30).
// ---------------------------------------------------------------------------
//
// CONCEPT_V2 Teil 7: after WP29 removed the destructive re-seed, a file can no
// longer overwrite a living board by accident. This module is half of the ONE
// remaining door — the named, confirmed user action — and it holds the two
// decisions that must never be taken by the wiring:
//
//   ├── IS THE COMMAND AVAILABLE AT ALL (AC4), and
//   └── WHAT DOES THE USER GET TOLD BEFORE THEY AUTHORISE A DESTRUCTION (AC3).
//
// Both are pure functions over data. `main.ts` MEASURES `owned` and `degraded`
// from the live subsystems and hands the pair here; it never decides. The
// confirmation TEXT is likewise built here, not in the modal, so the sentence a
// user reads before their collaborators' work is discarded is unit-testable
// without a DOM.
//
// ─────────────────────────────────────────────────────────────────────────
// PURITY (charter §7.0.a). This module imports NOTHING — not Obsidian, not the
// filesystem, not a clock, not even Yjs. The precedents are
// `canvas/reconcile-plan.ts` and `files/canvas-seed-decision.ts`.
// ─────────────────────────────────────────────────────────────────────────
//
// TWO PROPERTIES CARRY THE WHOLE FILE, and each is a different way to destroy a
// board:
//
// 1. AN UNANSWERED PROBE IS NOT A PERMISSION. Ownership is the permission to
//    replace a living SHARED board from a local file. A probe that answers
//    `undefined` because a wiring step was skipped, or an availability report
//    that never arrived at all, is an unanswered QUESTION — so the tests are
//    `owned !== true` and `degraded !== false`, never `!owned` / `degraded`.
//    This is WP29's `decideSeed` rule applied to the other direction of the same
//    danger, and it is the reason {@link importUnavailableReason} is TOTAL: it
//    answers `UNOWNED` for `null`, `undefined` and any non-object rather than
//    throwing, because a guard that throws inside Obsidian's `checkCallback` is
//    a guard that has stopped guarding.
//
// 2. A CONFIRMATION THAT CARRIES NO DATA IS NOT A CONFIRMATION. "Are you sure?"
//    satisfies every "was a dialog shown?" assertion ever written and tells the
//    user neither what is destroyed nor who loses it. {@link
//    importConfirmationMessage} therefore interpolates the board, the amount of
//    live work and every affected collaborator BY NAME — and refuses, loudly,
//    to render a summary it cannot state truthfully. WP28 recorded this class
//    one function to the left: `undefined.conflict-<date>.canvas` is a perfectly
//    valid filename, and "overwrite undefined" is a perfectly readable sentence.
//    Neither is an answer.
// ---------------------------------------------------------------------------

/** The command id WP30 owns. Registered once, in `session/commands.ts`. */
export const IMPORT_FROM_FILE_COMMAND_ID = "canvas-import-from-file";

/**
 * The palette name. It says what happens rather than what is clicked: the
 * command palette is the last neutral surface before the confirmation, and a
 * name like "Import canvas" reads as additive.
 */
export const IMPORT_FROM_FILE_COMMAND_NAME = "Import canvas from file (overwrite the shared board)";

/**
 * AC4's two conditions, as MEASURED by the wiring layer.
 *
 * Both fields are deliberately positive statements about the world rather than
 * a single "available" boolean: the reason the command is unavailable is part of
 * the answer, and collapsing them upstream would put the decision back in the
 * layer that only knows how to measure.
 */
export interface ImportAvailability {
  readonly owned: boolean;
  readonly degraded: boolean;
}

export const IMPORT_UNAVAILABLE = {
  UNOWNED: "unowned",
  DEGRADED: "degraded",
} as const;
export type ImportUnavailableReason = (typeof IMPORT_UNAVAILABLE)[keyof typeof IMPORT_UNAVAILABLE];

/**
 * `null` when the command is available; the blocking reason otherwise.
 *
 * FAIL-CLOSED AND ORDERED, and the order is a correctness property rather than a
 * style choice:
 *
 * ```text
 * availability is not an object   → UNOWNED
 * owned    !== true               → UNOWNED
 * degraded !== false              → DEGRADED
 * otherwise                       → null
 * ```
 *
 * Ownership is asked FIRST, so a path that is both unowned and degraded reports
 * `UNOWNED`. Telling a user their board is degraded when this client simply does
 * not hold it is a wrong answer, not a harmless one — it sends them looking for
 * a fault in a board they were never subscribed to.
 *
 * TOTAL: it never throws, on any argument. It runs inside Obsidian's
 * `checkCallback`, which is called on every palette keystroke and discards its
 * exceptions; a guard that throws there is a guard that is no longer consulted.
 */
export function importUnavailableReason(
  availability: ImportAvailability | null | undefined,
): ImportUnavailableReason | null {
  if (availability === null || typeof availability !== "object") {
    return IMPORT_UNAVAILABLE.UNOWNED;
  }
  const probe = availability as { owned?: unknown; degraded?: unknown };
  // `!== true` / `!== false`, never truthiness — see property 1 in the header.
  if (probe.owned !== true) return IMPORT_UNAVAILABLE.UNOWNED;
  if (probe.degraded !== false) return IMPORT_UNAVAILABLE.DEGRADED;
  return null;
}

/**
 * Exactly `importUnavailableReason(a) === null`, spelled once so the guard in
 * `commands.ts` and the guard in `runImportFromFile` cannot drift apart.
 */
export function canImportFromFile(availability: ImportAvailability | null | undefined): boolean {
  return importUnavailableReason(availability) === null;
}

/** One collaborator whose work this import replaces. */
export interface ImportAffectedPeer {
  readonly displayName: string;
}

/**
 * Everything the user is entitled to know before authorising the destruction.
 *
 * `liveRecordCount` is the projection of the LIVE board (what is about to be
 * lost), `fileRecordCount` is what the file offers in its place. They are two
 * different numbers on purpose: "12 records become 3" is the sentence that makes
 * an accidental import obvious, and a single number cannot say it.
 */
export interface ImportOverwriteSummary {
  readonly canvasPath: string;
  readonly liveRecordCount: number;
  readonly fileRecordCount: number;
  readonly peers: readonly ImportAffectedPeer[];
}

function typeName(value: unknown): string {
  return value === null ? "null" : typeof value;
}

/** A count that can be STATED. Not merely a number: `NaN` renders fluently. */
function assertRecordCount(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be a number, got ${typeName(value)}`);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      `${label} must be a non-negative safe integer, got ${String(value)} - a dialog cannot state a count it does not have`,
    );
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string, got ${typeName(value)}`);
  }
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

/**
 * `1 record` / `12 records` / `0 records`.
 *
 * The number is rendered as a decimal with a non-digit on either side so it
 * cannot be read as part of a longer number, and the singular exists because a
 * confirmation that says "1 records" reads as machine output and machine output
 * is skimmed.
 */
function records(count: number): string {
  return `${count} ${count === 1 ? "record" : "records"}`;
}

/** `A`, `A and B`, `A, B and C` — an Oxford-free list a human reads as people. */
function nameList(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * AC3's dialog text — a DELIVERABLE, not decoration.
 *
 * The wording is free; four properties are not, and each one is a defect class
 * this project has already paid for:
 *
 *   ├── CONTAINMENT. `canvasPath` verbatim, `liveRecordCount` as a decimal, and
 *   │   EVERY peer's `displayName` verbatim. A user authorising a destruction
 *   │   must be able to see, in the sentence itself, which board and whose work.
 *   ├── SENSITIVITY. Changing any of `canvasPath`, `liveRecordCount` or `peers`
 *   │   changes the message. This is what makes "generic text" a detectable
 *   │   class rather than a taste judgement: a constant sentence cannot survive
 *   │   it, and neither can one that renders the peers into an empty slot.
 *   ├── FAMILY MEMBERSHIP. One destructive verb, from a family rather than an
 *   │   exact word, so later copy-editing stays possible while the meaning does
 *   │   not drift into "update" or "sync".
 *   └── NO COERCION ARTEFACT. `undefined`, `null`, `NaN` and `[object Object]`
 *       are refused at the door rather than rendered. A dialog reading "overwrite
 *       undefined" is WP28's `undefined.conflict-2026-08-02.canvas` one function
 *       to the left: fluent, plausible and false.
 *
 * THROWS `TypeError` rather than degrading. Every other refusal in WP30 returns
 * a status; this one cannot, because the only thing downstream of it is a dialog
 * that asks for permission. A summary this function cannot state truthfully is a
 * dialog that must not open.
 */
export function importConfirmationMessage(summary: ImportOverwriteSummary): string {
  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
    throw new TypeError(
      `importConfirmationMessage: summary must be an object, got ${typeName(summary)}`,
    );
  }
  const { canvasPath, liveRecordCount, fileRecordCount, peers } = summary;
  assertNonEmptyString(canvasPath, "importConfirmationMessage: summary.canvasPath");
  assertRecordCount(liveRecordCount, "importConfirmationMessage: summary.liveRecordCount");
  assertRecordCount(fileRecordCount, "importConfirmationMessage: summary.fileRecordCount");
  if (!Array.isArray(peers)) {
    throw new TypeError(
      `importConfirmationMessage: summary.peers must be an array, got ${typeName(peers)}`,
    );
  }
  const names: string[] = [];
  for (const [index, peer] of peers.entries()) {
    if (peer === null || typeof peer !== "object") {
      throw new TypeError(
        `importConfirmationMessage: summary.peers[${index}] must be an object, got ${typeName(peer)}`,
      );
    }
    assertNonEmptyString(
      (peer as { displayName?: unknown }).displayName,
      `importConfirmationMessage: summary.peers[${index}].displayName`,
    );
    names.push((peer as ImportAffectedPeer).displayName);
  }

  const lines: string[] = [
    `Import ${canvasPath} from the file on disk?`,
    "",
    `The shared board holds ${records(liveRecordCount)} right now. Importing OVERWRITES the shared board wholesale with the ${records(fileRecordCount)} in the file: everything on the board that the file does not contain is discarded, and undo cannot bring it back.`,
    "",
  ];
  if (names.length > 0) {
    lines.push(
      `This discards work by ${nameList(names)} as well as your own. Each of them keeps an archived conflict copy of their version, and their board becomes this file.`,
    );
  } else {
    lines.push(
      "Nobody else is connected to this board right now, so only your own version is replaced. It is archived as a conflict copy first.",
    );
  }
  return lines.join("\n");
}
