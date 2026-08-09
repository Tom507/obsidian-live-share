import { SYNC_RESOLUTION, type SyncResolution } from "../sync/sync";

/**
 * S129 — MAY THIS EDITOR BE BOUND TO THIS DOCUMENT?
 *
 * Opening a note is the most common action in the product, and it could empty
 * that note. A guest activates a file; `waitForSync` resolves INSTANTLY on
 * `NO_PEERS` with an empty `Y.Text`; a one-second wall-clock loop waits for
 * content; when it expires the code CONTINUES and hands the empty text to
 * `yCollab`, which makes the editor buffer match it. The user's open note goes
 * blank, and Obsidian persists the buffer.
 *
 * It lands on the one path both existing empty-write floors miss BY DESIGN:
 * `BackgroundSync`'s observer returns for `path === this.activeFile`, because
 * "the active file is persisted by the editor / yCollab, never by
 * background-sync". So the active file never reaches `doWriteToDisk`, which is
 * where S119's and S126's floor lives.
 *
 * THE LOOP IS NOT THE DEFECT. What the loop does WHEN IT EXPIRES is. This
 * module is that fall-through, turned from a bind into a decision.
 *
 * THE EVIDENCE IS THE SAME EVIDENCE, deliberately — one vocabulary across three
 * signals rather than a fourth private rule:
 *
 *   - S128's `SyncResolution`. `PEER_STATE` means a peer answered and its state
 *     was applied, so an empty document is a FACT about the shared note.
 *     `NO_PEERS` means there was nobody to ask, and `ALREADY_SYNCED` means the
 *     reason is no longer held; neither establishes anything.
 *   - S126's tombstone probe. A `Y.Text` that held characters and had them
 *     removed carries them, on every peer, opened or not. If somebody emptied
 *     this note, binding the empty text is exactly right.
 *
 * Either fact alone licenses the bind. Neither means the emptiness is unproven,
 * and an unproven emptiness must not reach the buffer.
 */

export const COLLAB_BIND = {
  /** Bind `yCollab`. The normal outcome. */
  BIND: "bind",
  /**
   * Refuse: the document is empty, the buffer is not, and nothing establishes
   * that the emptiness is real. The editor keeps its content and does not
   * collaborate on this file until the state arrives.
   */
  REFUSE_UNPROVEN_EMPTY: "refuse-unproven-empty",
} as const;

export type CollabBindDecision = (typeof COLLAB_BIND)[keyof typeof COLLAB_BIND];

export interface CollabBindVerdict {
  decision: CollabBindDecision;
  /** Always populated, in every branch. */
  reason: string;
}

export interface CollabBindObservation {
  /** `docHandle.text.length` at the moment of the decision. */
  docTextLength: number;
  /** `view.state.doc.length` — what the user currently has on screen. */
  editorBufferLength: number;
  /** S128 — why this doc's sync resolved, or `null` if unknown. */
  resolution: SyncResolution | null;
  /** S126 — does this `Y.Text` carry tombstones? */
  docHeldContent: boolean;
}

/**
 * A total function of its argument. No clock, no I/O — so the fall-through that
 * used to be an implicit `continue` is now something a test can enumerate.
 */
export function decideCollabBind(observation: CollabBindObservation): CollabBindVerdict {
  if (observation.docTextLength > 0) {
    return { decision: COLLAB_BIND.BIND, reason: "the shared document holds content" };
  }
  if (observation.editorBufferLength === 0) {
    // Both empty. Binding destroys nothing, and refusing here would stop
    // collaboration on every genuinely-new note.
    return {
      decision: COLLAB_BIND.BIND,
      reason: "both the document and the buffer are empty; the bind destroys nothing",
    };
  }
  if (observation.docHeldContent) {
    return {
      decision: COLLAB_BIND.BIND,
      reason: "the document carries tombstones, so somebody emptied this note deliberately",
    };
  }
  if (observation.resolution === SYNC_RESOLUTION.PEER_STATE) {
    return {
      decision: COLLAB_BIND.BIND,
      reason: "a peer answered with its state and the note really is empty",
    };
  }
  return {
    decision: COLLAB_BIND.REFUSE_UNPROVEN_EMPTY,
    reason:
      `refusing to bind an empty document over ${observation.editorBufferLength} ` +
      `character(s) in the editor: sync resolved as ` +
      `${observation.resolution ?? "unknown"}, which does not establish that anyone ` +
      "holds this note, and the document carries no evidence of a deletion",
  };
}

/**
 * S129 AC3 — MAY THE HOST SEED THIS DOCUMENT FROM ITS EDITOR?
 *
 * The host arm seeds `Y.Text` from the buffer whenever the doc is empty. That is
 * correct for the case it was written for — the host is the source of truth for
 * a note nobody has opened yet — and it is NOT the same hole as the guest arm:
 * it writes content INTO the CRDT rather than emptiness into a buffer, so its
 * failure mode is resurrection, not destruction.
 *
 * But it is a second hole of a milder kind. If a peer emptied the note while the
 * host had a stale buffer, an unconditional re-seed UNDOES that deletion — the
 * exact inverse of S126, and a divergence the user did not ask for. The
 * tombstones distinguish the two cases at no cost, so the seed is gated on them.
 */
export function hostMaySeedFromEditor(observation: {
  docTextLength: number;
  docHeldContent: boolean;
}): boolean {
  if (observation.docTextLength > 0) return false;
  // A document that once held content and no longer does was emptied by
  // somebody. Re-seeding it from a stale buffer would resurrect what they
  // deleted.
  return !observation.docHeldContent;
}

/**
 * S129 AC5 — THE LEDGER. A refusal is invisible by construction: the buffer is
 * unchanged, which from outside is indistinguishable from "nothing happened".
 * S127 is a live example of a correct fail-safe nobody could observe, so this
 * one is readable from the start.
 *
 * Records the PATH, because unlike the empty-write ledger this is a per-file
 * user-visible state ("this note is not syncing") and a validator needs to know
 * which note. No content is ever recorded.
 */
export interface CollabBindRefusals {
  /** Total refusals since load. Never decremented. */
  total: number;
  /** Vault paths currently refused and not yet recovered. */
  paths: string[];
}

const refusedPaths = new Set<string>();
let refusalTotal = 0;

export function noteCollabBindRefusal(path: string): void {
  refusalTotal += 1;
  refusedPaths.add(path);
}

/** Called when a refused path later binds, so `paths` reflects live state. */
export function clearCollabBindRefusal(path: string): void {
  refusedPaths.delete(path);
}

export function getCollabBindRefusals(): CollabBindRefusals {
  return { total: refusalTotal, paths: Array.from(refusedPaths) };
}

/** Tests only. */
export function resetCollabBindRefusals(): void {
  refusalTotal = 0;
  refusedPaths.clear();
}

/**
 * S134 AC3 — A BIND THAT FAILED IS NOT A BIND THAT WAS REFUSED, AND THE TWO GET
 * SEPARATE LEDGERS.
 *
 * A refusal above is a DECISION this peer took on evidence it holds. What this
 * ledger counts is the other thing entirely: `waitForSync` REJECTED, the
 * activation never reached a decision at all, and the `catch` reconfigured the
 * CodeMirror compartment to empty while `collabBoundFile` still named the file.
 * Every internal indicator said "bound" and nothing anywhere moved.
 *
 * Kept apart from {@link getCollabBindRefusals} on S132's ground: a ledger
 * dominated by a benign, expected class cannot report the one class that still
 * loses collaboration. A validator watching `refusals` must be able to read
 * "this peer decided not to bind" and nothing else.
 */
export interface CollabBindFailures {
  /** Total activations that ended in the timeout `catch`. Never decremented. */
  total: number;
  /** Vault paths whose bind failed and has not since succeeded. */
  paths: string[];
}

const failedPaths = new Set<string>();
let failureTotal = 0;

export function noteCollabBindFailure(path: string): void {
  failureTotal += 1;
  failedPaths.add(path);
}

/** Called when a failed path later binds, so `paths` reflects live state. */
export function clearCollabBindFailure(path: string): void {
  failedPaths.delete(path);
}

export function getCollabBindFailures(): CollabBindFailures {
  return { total: failureTotal, paths: Array.from(failedPaths) };
}

/** Tests only. */
export function resetCollabBindFailures(): void {
  failureTotal = 0;
  failedPaths.clear();
}

/** The half of `BackgroundSync` the sink below touches. Structural, so no import. */
export interface CollabBoundFileFlag {
  getCollabBoundFile(): string | null;
  setCollabBoundFile(path: string | null): void;
}

/**
 * S134 AC3 — THE GLUE, OWNED HERE SO IT HAS EXACTLY ONE DEFINITION.
 *
 * `main.ts` sets `collabBoundFile` synchronously, before the activation it
 * describes has even started, and had no path back. This is that path, and it is
 * deliberately a function rather than a closure written inline at the call site:
 * a rule spelled out at its only caller is a rule no test can drive, and this
 * codebase has paid for that more than once.
 *
 * Two properties, both load-bearing:
 *
 *   - IDENTITY-GUARDED. A late-resolving activation must not clear a flag the
 *     user has already moved past — the same stale-write trap that got the
 *     `.then()` removed from `onActiveFileChange`.
 *   - IT NEVER SETS. A successful bind is reported too, and does nothing: the
 *     flag was already set synchronously by the caller, and re-asserting it here
 *     would let a stale activation re-claim a file the user left.
 */
export function makeBindStateSink(flag: CollabBoundFileFlag): (path: string, bound: boolean) => void {
  return (path, bound) => {
    if (bound) return;
    if (flag.getCollabBoundFile() !== path) return;
    flag.setCollabBoundFile(null);
  };
}
