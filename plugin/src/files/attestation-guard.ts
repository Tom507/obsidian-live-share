/**
 * S141 — THE FLOOR ON THE *PUBLISH* PATH, AND WHY THE WRITE PATH'S FLOOR CANNOT
 * DO THIS JOB.
 *
 * `empty-write-guard.ts` stands in front of the two WRITERS and asks "may this
 * empty content replace those bytes?". This module stands in front of the
 * PUBLISHER and asks a different question: "is the statement about to be made
 * about this file TRUE OF THAT FILE?".
 *
 * The two are not the same question, and S141 is the proof. `setActiveFile`
 * hashed the CRDT DOCUMENT and published the result against the FILE:
 *
 *     const content = docHandle.text.toString();          // the DOCUMENT
 *     void this.writeToDisk(oldActive, content, …);       // floored → REFUSED
 *     void this.manifestManager.updateFile(file, content) // UNFLOORED → published
 *
 * Measured, on a real relay, before this module existed: the empty-write floor
 * correctly refused the host's own truncation (`doc-write: 1`, the host's 50
 * bytes untouched) and the SAME three lines published `e3b0c442…`, size 0, about
 * the file it had just saved. A guest then read that attestation and its own
 * floor — `hashContent(content) === entry.hash` — was **TRUE** for `""` against
 * `hash("")`, so the write was not empty-LOOKING to it and the guest's file was
 * truncated to zero bytes. S119's outcome, reached through the guard built to
 * stop S119, with every floor working exactly as designed.
 *
 * THE PROPERTY THIS MODULE OWNS: **hash agreement is evidence of AGREEMENT, not
 * of CORRECTNESS.** `""` matching `hash("")` proves the transmission was
 * faithful and nothing else. The consumer's evidence test is not wrong — it is
 * being told the truth about the wrong object. So the repair belongs here, at
 * the producer, and hardening the consumer would have been the wrong fix.
 *
 * SCOPED TO EMPTINESS, DELIBERATELY, and the scope is stated rather than
 * implied. A general "the attestation must equal the file's current bytes" rule
 * cannot be enforced at this seam: `setActiveFile` issues its disk write and its
 * publication in the same tick, and the write is queued behind
 * `BackgroundSync.writeQueue`, so a strict equality test would refuse the
 * legitimate publication of content that is about to land. Emptiness is the case
 * where the attestation is DESTRUCTIVE at the consumer, it is the case S119
 * measured in the field, and it is the case a file read can settle without
 * racing anything.
 *
 * Deliberately a pure module with no imports — the same discipline, and for the
 * same reason, as `empty-write-guard.ts`.
 */

export const ATTESTATION_DECISION = {
  /**
   * The attestation is not empty, so it is not this floor's subject. Counted
   * anyway: see {@link AttestationLedger}.
   */
  PUBLISH_NOT_EMPTY: "publish-not-empty",
  /** The attestation is empty and the file is empty too — it is TRUE of it. */
  PUBLISH_VERIFIED_EMPTY: "publish-verified-empty",
  /** An empty attestation about a file that has bytes. THE S141 CASE. */
  REFUSE_CONTRADICTED: "refuse-empty-attestation-contradicted-by-the-file",
  /**
   * An empty attestation about a file whose bytes could not be read. An unknown
   * must refuse, never guess (I11): refusing leaves the manifest's PREVIOUS
   * entry in place, which is stale at worst, while publishing would licence
   * every consumer to empty its copy.
   */
  REFUSE_UNVERIFIABLE: "refuse-empty-attestation-unverifiable",
} as const;

export type AttestationDecision =
  (typeof ATTESTATION_DECISION)[keyof typeof ATTESTATION_DECISION];

export interface AttestationVerdict {
  decision: AttestationDecision;
  /** Always populated, in every branch. */
  reason: string;
  /** `true` for the two REFUSE decisions. The caller's whole test. */
  refused: boolean;
}

export interface AttestationInput {
  /**
   * The length of the content the caller is about to attest — characters for
   * the text arm, bytes for the binary one. A LENGTH rather than the content
   * itself so one decision serves both arms and so no file content can reach
   * this module or its log line.
   */
  attestedLength: number;
  /**
   * The length of what the named file actually holds, or `null` when it could
   * not be read.
   *
   * The caller may pass `null` when it has not consulted the file at all —
   * which is correct ONLY because `attestedLength > 0` is decided first and
   * without reference to this field. That short-circuit is what keeps the
   * common publication free of a disk read; it is asserted by a pure test row
   * so a future reordering cannot quietly turn every publish into a refusal.
   */
  fileLength: number | null;
}

/**
 * The whole decision, as a total function of its argument. No clock, no I/O, no
 * global state — so every branch has a row and the two arms provably ask the
 * same question.
 */
export function decideAttestation(input: AttestationInput): AttestationVerdict {
  if (input.attestedLength > 0) {
    return {
      decision: ATTESTATION_DECISION.PUBLISH_NOT_EMPTY,
      reason: "the attestation is not empty; this floor governs empty attestations only",
      refused: false,
    };
  }
  if (input.fileLength === null) {
    return {
      decision: ATTESTATION_DECISION.REFUSE_UNVERIFIABLE,
      reason:
        "refusing to attest emptiness about a file that could not be read: an unverified " +
        "empty attestation licences every peer to empty its own copy, and a stale entry does not",
      refused: true,
    };
  }
  if (input.fileLength > 0) {
    return {
      decision: ATTESTATION_DECISION.REFUSE_CONTRADICTED,
      reason:
        `refusing to attest emptiness about a file holding ${input.fileLength} unit(s): the ` +
        "attestation was derived from something other than the file it names, and a peer's " +
        "evidence test would find it FAITHFUL and empty its own copy",
      refused: true,
    };
  }
  return {
    decision: ATTESTATION_DECISION.PUBLISH_VERIFIED_EMPTY,
    reason: "the file it names is empty too, so the attestation is true of it",
    refused: false,
  };
}

/**
 * S155 — EVERY BRANCH IS COUNTED, INCLUDING THE ONES THAT DO NOTHING.
 *
 * WP115 lost a round because a guard's do-nothing branch returned before every
 * counter, so "ran and declined" and "was never called" produced byte-identical
 * readings and three readers in a row got it wrong. This ledger has exactly one
 * counter per branch of {@link decideAttestation} plus a `total`, so:
 *
 *   ├── `total === 0`                    → no attestation was published at all
 *   ├── `publishedNotEmpty > 0`          → the publisher ran; this floor was not its subject
 *   ├── `publishedVerifiedEmpty > 0`     → a LEGITIMATE emptying was published
 *   ├── `refusedContradicted > 0`        → **S141, caught** — name the path in the log
 *   └── `refusedUnverifiable > 0`        → the file could not be read
 *
 * No reading of this ledger is ambiguous between "ran" and "did not run".
 */
export interface AttestationLedger {
  /** Every attestation this floor has judged. Never decremented. */
  total: number;
  publishedNotEmpty: number;
  publishedVerifiedEmpty: number;
  refusedContradicted: number;
  refusedUnverifiable: number;
}

/** The debug-log category, the same one every other refusal in this tree uses. */
export const ATTESTATION_LOG_CATEGORY = "file-op";

/**
 * S137's rule, applied to a new refusal: ONE SPELLING, and it NAMES THE PATH.
 * `reason` comes from {@link decideAttestation}, which states LENGTHS and never
 * content, so no file content reaches the log through it.
 */
export function attestationRefusalMessage(path: string, reason: string): string {
  return `ATTESTATION REFUSED: path=${path} reason=${reason}`;
}

/** S137 — the minimal structural logger, declared here so this file stays pure. */
export interface AttestationRefusalLogger {
  warn(category: string, message: string): void;
}

const ledger: AttestationLedger = {
  total: 0,
  publishedNotEmpty: 0,
  publishedVerifiedEmpty: 0,
  refusedContradicted: 0,
  refusedUnverifiable: 0,
};

/**
 * Record ONE attestation decision — count it always, and say it when it refused.
 *
 * The counting happens BEFORE any early exit in this function and for every
 * decision, which is the whole of S155's lesson expressed as code rather than as
 * a comment.
 */
export function noteAttestation(
  verdict: AttestationVerdict,
  path: string,
  logger?: AttestationRefusalLogger | null,
): void {
  ledger.total += 1;
  switch (verdict.decision) {
    case ATTESTATION_DECISION.PUBLISH_NOT_EMPTY:
      ledger.publishedNotEmpty += 1;
      return;
    case ATTESTATION_DECISION.PUBLISH_VERIFIED_EMPTY:
      ledger.publishedVerifiedEmpty += 1;
      return;
    case ATTESTATION_DECISION.REFUSE_CONTRADICTED:
      ledger.refusedContradicted += 1;
      break;
    case ATTESTATION_DECISION.REFUSE_UNVERIFIABLE:
      ledger.refusedUnverifiable += 1;
      break;
  }
  const message = attestationRefusalMessage(path, verdict.reason);
  logger?.warn(ATTESTATION_LOG_CATEGORY, message);
  console.warn(`[live-share] ${message}`);
}

/** READ-ONLY. What the publish floor has decided, so a live validator can read it. */
export function getAttestationDecisions(): AttestationLedger {
  return { ...ledger };
}

/** Tests only. Production never resets a counter that answers "how many". */
export function resetAttestationDecisions(): void {
  ledger.total = 0;
  ledger.publishedNotEmpty = 0;
  ledger.publishedVerifiedEmpty = 0;
  ledger.refusedContradicted = 0;
  ledger.refusedUnverifiable = 0;
}
