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

const refusalsByArm = new Map<string, number>();
let refusalTotal = 0;

/** Record one refused empty write. Takes the ARM; never the content. */
export function noteEmptyWriteRefusal(arm: string): void {
  refusalTotal += 1;
  refusalsByArm.set(arm, (refusalsByArm.get(arm) ?? 0) + 1);
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
