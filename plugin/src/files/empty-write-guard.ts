/**
 * S119 — I11 ON THE TEXT PATH.
 *
 * `cleanupStaleFiles` was made to demand POSITIVE EVIDENCE before deleting a
 * file, because "the manifest does not mention it" turned out to mean both "the
 * host says it is gone" and "I have not been told anything yet", and only one of
 * those licenses destruction. This module is the same argument applied to a
 * WRITE instead of a delete.
 *
 * An empty `Y.Text` means both:
 *
 *     "the document is empty because somebody emptied it"        (a fact)
 *     "the document is empty because nothing has arrived yet"    (an absence)
 *
 * and the text writer could not tell them apart, so it wrote `""` over the
 * user's notes. In the live incident that emptied 100 % of the `.md` files in a
 * shared folder on three clients inside 21 seconds. `.canvas` survived only
 * because it is skipped by an extension test one line earlier — the canvas
 * writer has an empty-doc floor (`canvas-persistence.ts`), and the text writer
 * had none.
 *
 * THE RULE: replacing non-empty file content with empty content, from a remote
 * source, requires positive evidence that the emptiness is intended. No
 * evidence is a REFUSAL, and a refusal leaves every byte where it was.
 *
 * Deliberately a pure module with no imports: both the manifest writer and the
 * background-sync writer consult it, and a shared predicate is the only way the
 * two arms cannot drift apart — the lesson S115 paid for with `matchesSharedRoot`.
 */

export const EMPTY_WRITE_DECISION = {
  /** The write may proceed. */
  ALLOW: "allow",
  /**
   * Refused: the incoming content is empty, the target is not, and nothing
   * vouches for the emptiness.
   */
  REFUSE_NO_EVIDENCE: "refuse-empty-without-evidence",
} as const;

export type EmptyWriteDecision =
  (typeof EMPTY_WRITE_DECISION)[keyof typeof EMPTY_WRITE_DECISION];

export interface EmptyWriteVerdict {
  decision: EmptyWriteDecision;
  /** Always populated, in every branch. */
  reason: string;
}

export interface EmptyWriteInput {
  /** The content about to be written. */
  incoming: string;
  /**
   * The bytes currently on disk at the target, or `null` when the target does
   * not exist. Creating a new empty file destroys nothing and is always
   * allowed.
   */
  existing: string | null;
  /**
   * POSITIVE EVIDENCE that this emptiness is intended, and the whole of the
   * decision. Each caller supplies the strongest fact it actually holds:
   *
   *  - `syncFromManifest` passes whether the incoming content matches the
   *    HOST'S OWN published hash for this path. The manifest entry is the
   *    host's attestation of what the file should contain, so a hash match is
   *    the host stating "empty is correct" — and a mismatch is this peer
   *    holding something the host never described.
   *  - `BackgroundSync` passes whether this document has been observed
   *    NON-EMPTY in this session. A document that went from content to nothing
   *    was emptied by somebody; one that has never held anything is simply a
   *    document nothing has arrived in yet.
   *
   * Both are facts already held at the call site. Neither is a timer.
   */
  intentional: boolean;
  /** What the evidence was, for the log line. Never a value, only a claim. */
  evidenceLabel: string;
}

/**
 * The whole decision, as a total function of its argument. No clock, no I/O, no
 * global state — so it can be exhaustively tested without a rig, and so the two
 * writers provably ask the same question.
 */
export function decideEmptyWrite(input: EmptyWriteInput): EmptyWriteVerdict {
  if (input.incoming.length > 0) {
    return { decision: EMPTY_WRITE_DECISION.ALLOW, reason: "the incoming content is not empty" };
  }
  if (input.existing === null) {
    return {
      decision: EMPTY_WRITE_DECISION.ALLOW,
      reason: "the target does not exist; creating an empty file destroys nothing",
    };
  }
  if (input.existing.length === 0) {
    return {
      decision: EMPTY_WRITE_DECISION.ALLOW,
      reason: "the target is already empty; the write changes nothing",
    };
  }
  if (input.intentional) {
    return {
      decision: EMPTY_WRITE_DECISION.ALLOW,
      reason: `emptying ${input.existing.length} byte(s) is vouched for: ${input.evidenceLabel}`,
    };
  }
  return {
    decision: EMPTY_WRITE_DECISION.REFUSE_NO_EVIDENCE,
    reason:
      `refusing to replace ${input.existing.length} byte(s) with empty content: ` +
      `${input.evidenceLabel}. An empty document is equally consistent with ` +
      "'somebody emptied it' and 'nothing has arrived yet', and only the first may overwrite a file",
  };
}

/**
 * AC5 — the counter, so a live validator can see refusals that by construction
 * leave no other trace. Modelled on `protected-paths.ts`'s refusal counters,
 * which the e2e surface already exposes: same shape, same reason, and the same
 * rule that it records the ARM and never the path's contents.
 */
export interface EmptyWriteRefusals {
  /** Total refusals since load. Never decremented. */
  total: number;
  /** Refusals by writer arm. Arm, never content. */
  byArm: Record<string, number>;
}

/**
 * S137 — the writer arms that can refuse an empty write. Named, so a typo
 * cannot invent an arm and so the census over them is closed.
 */
export const EMPTY_WRITE_ARMS = [
  /** `files/manifest.ts` — `syncFromManifest`, the manifest-driven writer. */
  "manifest-sync",
  /** `files/background-sync.ts` — `doWriteToDisk`, the doc-driven writer. */
  "doc-write",
] as const;

export type EmptyWriteArm = (typeof EMPTY_WRITE_ARMS)[number];

/**
 * S137 — the minimal structural logger this module needs. The concrete
 * `DebugLogger` satisfies it; declaring it structurally keeps this file the pure
 * dependency-free module its header promises.
 */
export interface EmptyWriteRefusalLogger {
  warn(category: string, message: string): void;
}

/** The debug-log category every arm files its refusal under. */
export const EMPTY_WRITE_LOG_CATEGORY = "file-op";

const refusalsByArm = new Map<string, number>();
let refusalTotal = 0;

/**
 * S137 — THE ONE SPELLING OF THE REFUSAL LINE.
 *
 * Every arm emits this exact string, so a live grep is a census over arms rather
 * than over phrasings and a new arm cannot invent its own wording. The
 * precedent, deliberately copied rather than re-invented, is
 * `protected-paths.ts`'s `protectedRefusalMessage`.
 *
 * IT NAMES THE PATH, and that is the difference from its precedent. A protected
 * refusal reports a protected ROOT because the class is what matters there. Here
 * the whole finding was that the floor fired twice on an ordinary rejoin and
 * NOBODY COULD SAY WHICH FILES WERE NEARLY DESTROYED — the path is the answer to
 * the only question the line exists to answer. `reason` comes from
 * {@link decideEmptyWrite}, which states byte COUNTS and never bytes, so no file
 * content reaches the log through it.
 */
export function emptyWriteRefusalMessage(
  arm: EmptyWriteArm,
  path: string,
  reason: string,
): string {
  return `EMPTY WRITE REFUSED: arm=${arm} path=${path} reason=${reason}`;
}

/**
 * S137 — record one refused empty write: COUNT it, LOG it, and say it on the
 * console.
 *
 * ONE FUNCTION RATHER THAN THREE LINES PER CALL SITE, deliberately. This shipped
 * as a bare counter with a `console.warn` written out separately at each of the
 * two arms, and the console is not the debug log: the two live firings on an
 * ordinary rejoin left a total in `byArm` and NO ATTRIBUTION AT ALL, because no
 * console capture was attached and the debug log — the one sink a validator does
 * read after the fact — never heard about it. A floor whose firings cannot be
 * attributed cannot be diagnosed.
 *
 * The logger is a PARAMETER rather than a module-level sink. A module-level sink
 * would have to be installed at plugin load, and this project has already paid
 * for exactly that shape once: `S104`, where a consumer was handed `this.logger`
 * fifteen lines before it existed and two language features (`logger!` and
 * `?.`) hid the fact that two signatures were unreachable for the plugin's whole
 * life. Passing it per call makes the wiring visible at every call site and lets
 * the pure-core tests drive the real function with a recording double.
 *
 * The `console.warn` STAYS (B1 explicitly permits it): it is what a developer
 * with devtools open already looks at, and removing it would trade one sink for
 * another rather than adding the missing one.
 */
export function noteEmptyWriteRefusal(
  arm: EmptyWriteArm,
  path: string,
  reason: string,
  logger?: EmptyWriteRefusalLogger | null,
): string {
  refusalTotal += 1;
  refusalsByArm.set(arm, (refusalsByArm.get(arm) ?? 0) + 1);
  const message = emptyWriteRefusalMessage(arm, path, reason);
  logger?.warn(EMPTY_WRITE_LOG_CATEGORY, message);
  console.warn(`[live-share] ${message}`);
  return message;
}

/** READ-ONLY. What every arm has refused, so a live validator can read it. */
export function getEmptyWriteRefusals(): EmptyWriteRefusals {
  return { total: refusalTotal, byArm: Object.fromEntries(refusalsByArm) };
}

/** Tests only. Production never resets a counter that answers "how many". */
export function resetEmptyWriteRefusals(): void {
  refusalTotal = 0;
  refusalsByArm.clear();
}
