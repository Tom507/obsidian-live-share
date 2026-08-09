/**
 * S142 — THE SINGLE-WRITER INVARIANT, AS A COUNTED DECISION RATHER THAN AS AN
 * ABSENCE.
 *
 * THE INVARIANT: the file the editor currently has open is written by Obsidian
 * and yCollab, and by nothing else. A second writer touching that file's disk
 * copy races the editor's own save and can resurrect, truncate or duplicate the
 * user's text under their cursor.
 *
 * `background-sync.ts` honours it in four places. Three of them are gates on a
 * hot path (`handleLocalTextModify`, the `Y.Text` observer, and `subscribe()`'s
 * HOST arm) and one of them — `subscribe()`'s GUEST arm — did not exist at all
 * until S142, in the role where the editor also owns the disk copy.
 *
 * WHY A LEDGER AND NOT JUST A BRANCH — this is S155's lesson, and this module is
 * the shape of the repair. WP109 expressed the host arm's invariant as an EMPTY
 * `else if` branch:
 *
 *     } else if (isActive) {
 *       // THE SINGLE-WRITER INVARIANT, unchanged and now explicit
 *     } else if (remoteContent !== content) {
 *
 * That is a branch a test can point at, which is what its charter asked for, but
 * it produces NO READING WHATSOEVER. "The guard ran and declined to write" and
 * "the arm was never reached at all" are byte-identical to every observer,
 * live and in a suite alike, and WP115 lost a round to exactly that ambiguity.
 * Every decline now increments here and says which arm took it.
 *
 * WHERE THE GUARD MAY STAND, which is S134's lesson and cost a package: the
 * invariant is about the DISK, so the guard belongs immediately in front of the
 * WRITE and nowhere earlier. The host arm's guard used to sit in front of the
 * whole arm, where it also disabled SEEDING — a disk → CRDT flow that the
 * invariant has nothing to say about — and every mid-session note silently
 * stopped syncing. A guard placed one line too early is a different defect, not
 * a wider version of the same one.
 *
 * Pure, no imports, for `empty-write-guard.ts`'s reason: both arms consult it
 * and a shared spelling is the only thing that keeps them from drifting.
 */

/**
 * The arms that can decline a write for this reason. Named, so a typo cannot
 * invent an arm and the census over them stays closed.
 */
export const SINGLE_WRITER_ARMS = [
  /** `subscribe()`'s HOST arm — the join reconciliation, WP109/S134. */
  "subscribe-host",
  /** `subscribe()`'s GUEST arm — the same reconciliation in the other role, S142. */
  "subscribe-guest",
] as const;

export type SingleWriterArm = (typeof SINGLE_WRITER_ARMS)[number];

export interface SingleWriterDeclines {
  /** Total declines since load. Never decremented. */
  total: number;
  /** Declines by arm. Arm and path only — never content. */
  byArm: Record<string, number>;
}

/** The debug-log category every refusal in this tree files under. */
export const SINGLE_WRITER_LOG_CATEGORY = "file-op";

/**
 * S137's rule: ONE SPELLING, and it NAMES THE PATH — a decline that cannot be
 * attributed to a file cannot be diagnosed. No content, ever.
 */
export function singleWriterDeclineMessage(arm: SingleWriterArm, path: string): string {
  return (
    `SINGLE-WRITER DECLINE: arm=${arm} path=${path} reason=the editor owns this file's ` +
    "disk copy while it is the active file; background-sync must not be its second writer"
  );
}

/** S137 — the minimal structural logger, declared here so this file stays pure. */
export interface SingleWriterLogger {
  warn(category: string, message: string): void;
}

const declinesByArm = new Map<string, number>();
let declineTotal = 0;

/**
 * Record ONE declined write. Counted FIRST, before anything that could return
 * or throw — see the module header for what a counter behind an early exit
 * costs.
 *
 * The log line is `debug`, not `warn`: unlike an empty-write refusal this is the
 * invariant working as designed on an ordinary join, so it must be greppable
 * without being alarming. It is still one fixed spelling.
 */
export function noteSingleWriterDecline(
  arm: SingleWriterArm,
  path: string,
  logger?: SingleWriterLogger | null,
): string {
  declineTotal += 1;
  declinesByArm.set(arm, (declinesByArm.get(arm) ?? 0) + 1);
  const message = singleWriterDeclineMessage(arm, path);
  logger?.warn(SINGLE_WRITER_LOG_CATEGORY, message);
  return message;
}

/** READ-ONLY. What each arm has declined, so a live validator can read it. */
export function getSingleWriterDeclines(): SingleWriterDeclines {
  return { total: declineTotal, byArm: Object.fromEntries(declinesByArm) };
}

/** Tests only. Production never resets a counter that answers "how many". */
export function resetSingleWriterDeclines(): void {
  declineTotal = 0;
  declinesByArm.clear();
}
