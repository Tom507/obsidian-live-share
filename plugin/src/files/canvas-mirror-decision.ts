// ---------------------------------------------------------------------------
// WP79 (C79 AC1) — THE MIRROR VERDICT. A pure core, in the precedent of
// `files/canvas-seed-decision.ts`: ZERO imports. No Obsidian, no filesystem, no
// clock, no Yjs. Everything it needs arrives as an argument.
//
// THE PROBLEM THIS ANSWERS. A guest never receives a `.canvas` it does not
// already have. The two manifest-driven consumers skip `.canvas` deliberately
// (`files/background-sync.ts:97`, `files/manifest.ts:203`) and BOTH SKIPS ARE
// CORRECT: without them a shared canvas also gets a bare-path raw `Y.Text` of
// the same bytes — a second CRDT over a path `CanvasSync` already owns, "whose
// character-level merge destroys edge endpoints" (`utils.ts`,
// `skipsAutoTextSync`). They name `CanvasPersistence.coldOpen` as the
// materialiser, and `coldOpen` runs only when a canvas is OPENED, and opening
// requires the file to exist. The cycle closes and the file never arrives.
//
// WP79 does not open either skip. It answers a different question — WHICH PATHS
// REACH THE EXISTING MECHANISM — and leaves what that mechanism does when
// reached exactly as it is.
//
// FAIL-CLOSED, AND `!== false` / `=== true` RATHER THAN TRUTHINESS. The verdict
// that writes a file is the dangerous one, so every input that is missing,
// `undefined`, `null` or not a boolean must land on a SKIP and never on
// `materialise`. This is the same discipline `decideSeed` states in its own
// header — "a knowledge probe that cannot answer … is not evidence" — applied
// to the doc→file direction. In particular `localFileExists` is read as
// `!== false`: a probe that could not answer whether the user already has a file
// at that path is treated as "they do", because the cost of being wrong in that
// direction is a skipped mirror and the cost of being wrong in the other is a
// destroyed board.
// ---------------------------------------------------------------------------

/**
 * The closed set of answers. Owned by WP79; every consumer imports these
 * strings rather than re-spelling them, so a receipt and a test can name the
 * same verdict.
 */
export const MIRROR_VERDICT = {
  /**
   * HOST. This client holds the file, so it is the one that can give the path a
   * published identity — and until it does, no peer can resolve the doc at all.
   * The act is a subscribe, never a write: the host already has the file.
   */
  PUBLISH: "publish",
  /**
   * WP122 (`S146`) — HOST, and the file is bound to the ONE existing writer as
   * well as published.
   *
   * THE DEFECT THIS ANSWERS. {@link MIRROR_VERDICT.PUBLISH} binds a guid and
   * nothing else, so a canvas the HOST created has no CRDT→disk writer for the
   * life of the session: a guest's edit reaches the host's shared DOCUMENT in
   * seconds and its FILE never — measured unchanged after 240 s and after four
   * unrelated manifest changes, then converged the instant a human opened the
   * board. A GUEST-created board takes 0.25 s, because its create handshake
   * attaches the writer (`canvas-create.ts`, `attachWriter`). The deciding
   * variable was who created the canvas, which is not a property any correctness
   * argument should turn on.
   *
   * IT LICENSES NO WRITE OF ITS OWN, exactly like
   * {@link MIRROR_VERDICT.MATERIALISE} and {@link MIRROR_VERDICT.ADOPT_LOCAL_FILE}:
   * it hands the path to the ONE existing writer, whose cold open then decides.
   * A doc holding records wins and the file is rewritten from it — under WP121's
   * conflict copy, which is why WP122 depends on WP121 as a hard precondition
   * and not as a safety net.
   *
   * FENCED BY A SECOND `=== true`, on the WP117 precedent. An observation that
   * does not carry {@link CanvasMirrorObservation.bindsHostWriter} — every
   * pre-WP122 caller, and any deps object with no writer seam to bind through —
   * degrades to exactly {@link MIRROR_VERDICT.PUBLISH} rather than throwing, so
   * the pre-WP122 verdict table is byte-unchanged for every input that does not
   * ask for this.
   */
  PUBLISH_AND_BIND_WRITER: "publish-and-bind-writer",
  /**
   * GUEST. There is no local file, an identity resolves, and the doc holds
   * records. This is the only verdict that ends in a file being created, and it
   * is created by the ONE existing writer through the ONE existing projection.
   */
  MATERIALISE: "materialise",
  /**
   * A `.canvas` already exists at that path. NO write of any kind is licensed —
   * not a byte-identical one. The path needs nothing from this pass, and the
   * only paths this pass touches are therefore paths where there is no user
   * file to destroy (I11).
   */
  SKIP_LOCAL_FILE: "skip-local-file",
  /**
   * WP117 (S122) — GUEST, and the ONE case in which an existing local file is
   * not a reason to leave the path alone: this peer asked the host to create
   * this canvas, the host accepted, and the file on disk is the very file the
   * host was seeded from. Skipping here would leave the originating guest
   * holding a PRIVATE copy of a board every other peer shares — the file would
   * be right today and drift from the first remote edit onwards.
   *
   * It licenses no write of its own. Like {@link MIRROR_VERDICT.MATERIALISE} it
   * hands the path to the ONE existing writer, whose cold open then decides:
   * a doc holding records wins and the file is rewritten from it, an empty doc
   * writes nothing at all.
   *
   * FENCED BY TWO `=== true` CLAUSES. Nothing but an accepted creation request
   * on THIS peer sets `originatedHere`, and an unresolvable identity still skips
   * — so every other existing local file keeps {@link
   * MIRROR_VERDICT.SKIP_LOCAL_FILE}, byte for byte.
   */
  ADOPT_LOCAL_FILE: "adopt-local-file",
  /**
   * Nothing to mirror FROM: no resolvable identity (the guest must never mint
   * one), or a doc holding no records. An empty doc materialises no file —
   * never an empty or skeleton `.canvas` — because an empty file that then wins
   * a reconcile is how the E2 cascade destroyed user data.
   */
  SKIP_NO_SOURCE: "skip-no-source",
} as const;

export type MirrorVerdict = (typeof MIRROR_VERDICT)[keyof typeof MIRROR_VERDICT];

/** What a client observed about one shared canvas path before deciding. */
export interface CanvasMirrorObservation {
  /** This client's session role. Anything other than the two literals skips. */
  readonly role: "host" | "guest";
  /** A `.canvas` already exists at this path in THIS vault. */
  readonly localFileExists: boolean;
  /** A published guid resolves for this path — the guest never mints one. */
  readonly identityResolves: boolean;
  /** The shared doc for this path holds at least one node or edge record. */
  readonly docHasRecords: boolean;
  /**
   * WP117 — THIS peer asked the host to create this canvas and the host
   * accepted. Optional, and read `=== true`: a deps object that does not supply
   * it degrades to exactly the pre-WP117 verdict table rather than throwing.
   */
  readonly originatedHere?: boolean;
  /**
   * WP122 — does the caller have a writer seam to bind the HOST's own file
   * through? Optional, and read `=== true`: a deps object that does not supply
   * it degrades to exactly the pre-WP122 verdict table rather than throwing.
   *
   * It is a capability, not a preference. `canvas-mirror.ts` derives it from the
   * presence of {@link CanvasMirrorDeps.bindHostWriter}, i.e. from the object
   * that owns the answer, so a pass with nothing to bind through can never be
   * told to bind.
   */
  readonly bindsHostWriter?: boolean;
}

/** The observation minus the one field that costs a doc subscription to measure. */
export type CanvasMirrorPreObservation = Omit<CanvasMirrorObservation, "docHasRecords">;

/**
 * Pure. No state between calls, does not mutate its argument, never throws.
 *
 * Row order is part of the contract:
 *   1. a non-object probe is an unanswered question
 *   2. a role that is not exactly `"host"` or `"guest"` is likewise
 *   3. HOST — publishes only what it actually holds
 *   4. GUEST — the local file wins over everything, THEN identity, THEN records
 *
 * WP117 adds ONE row inside clause 4 and moves none of the others: a local file
 * this peer itself asked the host to create, whose identity resolves, is
 * `adopt-local-file` instead of `skip-local-file`. Every other combination of
 * inputs answers exactly what it answered before.
 *
 * Clause 4's order is why `skip-local-file` and `skip-no-source` are two
 * verdicts and not one: a path skipped because the user already has the file is
 * a complete outcome, and a path skipped for want of a source is a mirror that
 * did not happen. Collapsing them would make "the folder mirrored completely"
 * unfalsifiable.
 */
export function decideCanvasMirror(observation: CanvasMirrorObservation): MirrorVerdict {
  if (observation === null || typeof observation !== "object") {
    return MIRROR_VERDICT.SKIP_NO_SOURCE;
  }
  const probe = observation as {
    role?: unknown;
    localFileExists?: unknown;
    identityResolves?: unknown;
    docHasRecords?: unknown;
    originatedHere?: unknown;
    bindsHostWriter?: unknown;
  };

  if (probe.role === "host") {
    // Nothing to publish for a path this client does not hold. `=== true`, so a
    // probe that could not answer does not make the host subscribe (and
    // therefore seed) a path it may not have.
    if (probe.localFileExists === true) {
      // WP122 — and the SECOND `=== true`, on the WP117 precedent: an
      // observation that does not carry the capability answers exactly what it
      // answered before this package existed.
      return probe.bindsHostWriter === true
        ? MIRROR_VERDICT.PUBLISH_AND_BIND_WRITER
        : MIRROR_VERDICT.PUBLISH;
    }
    return MIRROR_VERDICT.SKIP_NO_SOURCE;
  }
  if (probe.role !== "guest") return MIRROR_VERDICT.SKIP_NO_SOURCE;

  // `!== false`: present, or unknown, both mean "do not write here".
  if (probe.localFileExists !== false) {
    // WP117 — the single exception, and it is fenced by two `=== true` clauses
    // so an unanswered probe of either one keeps the old verdict. See
    // MIRROR_VERDICT.ADOPT_LOCAL_FILE.
    if (probe.originatedHere === true && probe.identityResolves === true) {
      return MIRROR_VERDICT.ADOPT_LOCAL_FILE;
    }
    return MIRROR_VERDICT.SKIP_LOCAL_FILE;
  }
  // The guest never mints. An unresolvable identity is a SKIP, never a fallback:
  // reaching for the R10 raw-text path here would install the second CRDT this
  // WP exists to keep out.
  if (probe.identityResolves !== true) return MIRROR_VERDICT.SKIP_NO_SOURCE;
  if (probe.docHasRecords !== true) return MIRROR_VERDICT.SKIP_NO_SOURCE;
  return MIRROR_VERDICT.MATERIALISE;
}

/**
 * Would this path be worth opening its doc for at all?
 *
 * Derived from {@link decideCanvasMirror} rather than re-stating its rules, so
 * the admission gate and the verdict cannot drift apart: it asks the very same
 * function what the answer WOULD be if the doc turned out to hold records. A
 * path this returns `false` for is skipped without a `getDoc`, a `waitForSync`
 * or a sidecar attach — which is both the cost argument (a guest pays nothing
 * for the canvases it already has) and the safety argument (the pass only ever
 * touches paths with no user file to destroy).
 */
export function admitsCanvasMirror(pre: CanvasMirrorPreObservation): boolean {
  const verdict = decideCanvasMirror({
    ...(pre as CanvasMirrorObservation),
    docHasRecords: true,
  });
  return (
    verdict === MIRROR_VERDICT.PUBLISH ||
    // WP122 — a host bind must be ADMITTED, or the pass would skip the path
    // before ever asking `decideCanvasMirror` for the bind verdict. WP117 hit
    // exactly this wall and left the comment below saying so; this is the same
    // wall, one verdict later. Derived from the same function, not re-stated.
    verdict === MIRROR_VERDICT.PUBLISH_AND_BIND_WRITER ||
    verdict === MIRROR_VERDICT.MATERIALISE ||
    // WP117 — an adoption must be ADMITTED, or the pass would skip the path
    // before ever asking `decideCanvasMirror` for the adopt verdict. Derived
    // from the same function rather than re-stated, exactly as the other two
    // are, so the gate and the verdict cannot drift apart.
    verdict === MIRROR_VERDICT.ADOPT_LOCAL_FILE
  );
}
