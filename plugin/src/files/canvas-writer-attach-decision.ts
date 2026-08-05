// ---------------------------------------------------------------------------
// WP85 (C7 / US5 AC13, AC16, AC17) — THE WRITER-ATTACH VERDICT. A pure core, in
// the precedent of `files/canvas-seed-decision.ts` and
// `files/canvas-mirror-decision.ts`: ZERO imports. No Obsidian, no filesystem,
// no clock, no Yjs. Everything it needs arrives as an argument.
//
// SITING. Beside the other two doc↔disk decisions rather than in `canvas/`,
// because its subject is the SINGLE doc→disk writer (`files/canvas-persistence.ts`)
// and its two attach sites, not the canvas surface. `canvas/` holds the view,
// the adapter, the shadow and the reconcile plan; `files/` holds every decision
// about whether a byte reaches the vault. This verdict is one of the latter.
//
// THE PROBLEM THIS ANSWERS. `CanvasPersistence` is the only live doc→disk writer
// for a canvas, it observes with NO origin filter (so a remote delta persists
// exactly like a local capture), and before WP85 it was attached from a call
// NESTED INSIDE the lazy-subscribe branch of `syncCanvasPresences`:
//
//     if (rawPath && !canvasSync.isSubscribed(rawPath) && isSharedPath(rawPath)) {
//       … subscribeCanvasWithHandover(…).then((owned) => {
//            if (owned) void this.attachCanvasWriter(rawPath);   ← the ONLY
//          });                                                     leaf-driven
//     }                                                            attach
//
// So the attach was a SIDE EFFECT OF SUBSCRIBING, and the subscribe was gated on
// `!isSubscribed`. Every path that was subscribed by somebody else BEFORE its
// leaf opened therefore consumed the one and only opportunity and stayed
// writerless for the rest of the session. That is not a hypothetical ordering:
// WP79's mirror pass subscribes EVERY shared canvas on the host and returns
// `PUBLISH` without materialising (`files/canvas-mirror.ts:251-268`), because
// C79 AC4 forbids it to write the host's file. Its own landed live receipt says
// so — `role=host considered=6 published=6 materialised=0`. A host's shared
// canvas is therefore subscribed and writerless whether or not it is open, in
// production, with no test rig involved at any point.
//
// WP85 does not teach the mirror to write and does not add a second writer. It
// separates the two questions the old `if` had fused:
//
//   ├── "does this path need SUBSCRIBING?"  → still the lazy-subscribe branch,
//   │                                         still gated on `!isSubscribed`,
//   │                                         byte-unchanged.
//   └── "does this OPEN leaf need a WRITER?" → this function, consulted for
//                                              every open canvas leaf on every
//                                              pass, whoever subscribed it.
//
// WHY A CLOSED VERDICT SET RATHER THAN A BOOLEAN. `attachCanvasWriter` is
// already idempotent per path (`main.ts` — `canvasWriters` / `canvasWriterAttaching`),
// so "call it for every leaf and let the helper sort it out" would work by
// accident. It is refused on purpose: it would attach for unshared and
// unsubscribed paths where `getCanvasDocHandle` returns `null` and the failure
// is SILENT, and it would make "already attached" unobservable — a state that
// cannot be named cannot be asserted, and this whole work package exists because
// an attach that never happened was invisible.
//
// FAIL-CLOSED, AND `=== true` RATHER THAN TRUTHINESS. Attaching is the acting
// direction: it ends in bytes on disk. Every input that is missing, `undefined`,
// `null` or not a boolean must land on a NON-ATTACH verdict — the discipline
// `decideSeed` and `decideCanvasMirror` both state in their own headers, applied
// to the attach question. There is no `!== false` field here: unlike
// `localFileExists`, none of these probes is safer unknown-as-true.
// ---------------------------------------------------------------------------

/**
 * The closed set of answers. Owned by WP85; every consumer imports these strings
 * rather than re-spelling them, so a receipt and a test can name the same
 * verdict.
 */
export const WRITER_ATTACH_VERDICT = {
  /**
   * A shared, subscribed, canvas-owned path showing in an open leaf, with no
   * writer attached and none being attached. The ONLY verdict that licenses a
   * call to `attachCanvasWriter`.
   */
  ATTACH: "attach",
  /**
   * A writer is already attached for this path, or one is mid-attach. A
   * COMPLETE outcome, not a silent no-op: the pass did consult, and the answer
   * was that the seam is already satisfied. Distinguishing this from the three
   * refusals below is what makes "the open canvas has a writer" falsifiable.
   */
  ALREADY_ATTACHED: "already-attached",
  /**
   * The path is not inside the shared folder. Nothing about it is this
   * session's business, and no writer is licensed.
   */
  NOT_SHARED: "not-shared",
  /**
   * Shared, but `CanvasSync` does not own it. Either the lazy-subscribe branch
   * is about to take it (this pass, synchronously) or the handover installed
   * the raw-text fallback and the canvas doc is not the authority for this
   * path. Attaching here would ask `getCanvasDocHandle` for a handle that does
   * not exist and fail silently. The subscribe branch's business, unchanged.
   */
  NOT_SUBSCRIBED: "not-subscribed",
  /**
   * The leaf reports no path at all — an unsaved or half-torn-down canvas view.
   * Obsidian's canvas view is private and untyped (I5: degrade, never break),
   * so this is a real row and not a defensive flourish.
   */
  NO_PATH: "no-path",
} as const;

export type WriterAttachVerdict =
  (typeof WRITER_ATTACH_VERDICT)[keyof typeof WRITER_ATTACH_VERDICT];

/** What the seam observed about ONE open canvas leaf before deciding. */
export interface CanvasWriterAttachObservation {
  /** The leaf reports a usable, non-empty path. */
  readonly hasPath: boolean;
  /** `ManifestManager.isSharedPath` for that path. */
  readonly isShared: boolean;
  /**
   * `CanvasSync.isSubscribed` for that path, read BEFORE the lazy-subscribe
   * branch of this pass. Reading it before is deliberate: `subscribe()` adds to
   * `subscribedPaths` synchronously, so reading it after would make a path the
   * branch has just claimed look like WP85's business and drive the attach
   * twice for one open.
   */
  readonly isSubscribed: boolean;
  /**
   * A writer is attached for this path, or an attach is in flight. Both, not
   * just the first: an attach awaits `attachCanvasPersistence`, and
   * `syncCanvasPresences` fires on `layout-change` and `active-leaf-change`
   * often enough to re-enter during that await.
   */
  readonly hasWriter: boolean;
}

/**
 * Pure. No state between calls, does not mutate its argument, never throws.
 *
 * Row order is part of the contract, and it is the order of increasing
 * specificity — each row is only meaningful once the row above it has passed:
 *
 *   1. no path            — nothing to decide about
 *   2. not shared         — not this session's file
 *   3. not subscribed     — the canvas doc is not the authority here
 *   4. already attached   — the seam is satisfied
 *   5. attach             — everything else
 *
 * Rows 2 and 3 are two verdicts rather than one because they belong to
 * different owners: `NOT_SHARED` is a permanent property of the path, while
 * `NOT_SUBSCRIBED` is the lazy-subscribe branch's job and resolves on its own.
 * Collapsing them would make "the leaf was refused a writer" unattributable.
 */
export function decideCanvasWriterAttach(
  observation: CanvasWriterAttachObservation,
): WriterAttachVerdict {
  // A missing or non-object probe is an unanswered question, not a licence.
  if (observation === null || typeof observation !== "object") {
    return WRITER_ATTACH_VERDICT.NO_PATH;
  }
  const probe = observation as {
    hasPath?: unknown;
    isShared?: unknown;
    isSubscribed?: unknown;
    hasWriter?: unknown;
  };

  if (probe.hasPath !== true) return WRITER_ATTACH_VERDICT.NO_PATH;
  if (probe.isShared !== true) return WRITER_ATTACH_VERDICT.NOT_SHARED;
  if (probe.isSubscribed !== true) return WRITER_ATTACH_VERDICT.NOT_SUBSCRIBED;
  // `=== true` here too, and it is the one row where the fail-closed direction
  // is "do nothing" rather than "act": an unanswerable "is a writer attached?"
  // is treated as ATTACH, because `attachCanvasWriter`'s own per-path guard is
  // the backstop for a duplicate and there is no backstop for an absence.
  if (probe.hasWriter === true) return WRITER_ATTACH_VERDICT.ALREADY_ATTACHED;
  return WRITER_ATTACH_VERDICT.ATTACH;
}
