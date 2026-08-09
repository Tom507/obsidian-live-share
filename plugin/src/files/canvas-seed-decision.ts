// ---------------------------------------------------------------------------
// WP29 (C29) — THE SEED DECISION. A pure core, in the precedent of
// `canvas/reconcile-plan.ts`: ZERO imports. No Obsidian, no filesystem, no
// clock, no Yjs. Everything it needs arrives as an argument.
//
// I9 — "a doc is seeded from a file exactly once in its life" — is not a rule
// about counting seeds; it is a rule about EVIDENCE. Seeding is the destructive
// direction: it lets one client's local `.canvas` speak for a board other
// replicas already hold, and before WP29 that is exactly what a rejoining host
// did (R4). The file may therefore only speak when it is the ONLY replica there
// is, and "the only replica there is" has two independent witnesses:
//
//   ├── sidecarKnowsDoc — THIS client already holds a durable replica of the
//   │                     doc (WP24/WP25's sidecar replayed one into it), so a
//   │                     rejoin is a resume, never a fresh start.
//   └── peerKnowsDoc    — SOMEBODY ELSE holds it, so a rejoin is an ordinary
//                         related-replica merge.
//
// Both must be exactly `false` before the file is allowed to seed. A guard that
// checks only one of them is right on three of the four rows of the truth table
// and silently re-arms R4 on the fourth.
//
// ── WP117 (S122) — A THIRD CONDITION, AND IT IS AUTHORITY RATHER THAN EVIDENCE.
//
// The two witnesses above answer "is this replica alone?". They cannot answer
// "is this client entitled to speak for the board at all?", and that gap is a
// live data-loss route this project measured rather than argued:
//
//   `peerKnowsDoc` is computed as "did bytes arrive across the sync step", which
//   under `NO_PEERS` (`S131`) is FALSE — the relay said nobody holds this doc, so
//   there was nobody to send bytes. A GUEST whose local `.canvas` is a week stale
//   and which wins the subscribe race therefore sees both witnesses false, seeds
//   its stale content into the shared document, and the host's later subscribe
//   finds a NON-EMPTY doc, takes `doc-wins`, and overwrites the host's canvas
//   with the guest's stale one.
//
// Host-mediated canvas creation (WP117) is what makes this closable rather than
// worse: the host is the sole seeder for a new board as well as an old one, so a
// guest never needs to seed and is never permitted to. `role` is therefore asked
// FIRST, ahead of both witnesses — an unentitled client's evidence is not
// interesting, whatever it says.
//
// THE DEFAULT IS THE PRE-WP117 ANSWER, DELIBERATELY. An OMITTED role is a caller
// that predates this field, and it keeps the old table exactly. What refuses is
// a role that was STATED and is not `"host"`. Production states it on every call
// (`CanvasSync.subscribe` records the role it was invoked with, and the writer
// attach stamps the live session role over the top), so the undefined branch is
// unreachable from the product — which is the property the wiring test pins,
// because a fail-open default that nothing exercises is a default that rots.
//
// FAIL-CLOSED, AND `!== false` RATHER THAN `!x`. A knowledge probe that cannot
// answer — a field that is `undefined` because a wiring step was skipped, a
// whole object that never arrived — is not evidence that the board is new. Under
// a truthiness test every one of those unknowns reads as "nobody knows this
// board" and seeds over live shared state, which turns a wiring bug into data
// loss. So anything that is not the literal `false` counts as "knows the doc".
// ---------------------------------------------------------------------------

/**
 * The two things `coldOpen` can decide. Owned by WP29 (Shared Ownership
 * Contract §1); WP30 imports these strings rather than re-spelling them.
 */
export const SEED_DECISION = {
  SEED_FROM_FILE: "seed-from-file",
  LOAD_OR_MERGE: "load-or-merge",
} as const;

export type SeedDecision = (typeof SEED_DECISION)[keyof typeof SEED_DECISION];

/**
 * WP117 (S155) — WHICH CLAUSE PRODUCED THE ANSWER, as a stable token.
 *
 * `decideSeed` returns one of two values, so before this a decision that ran and
 * declined and a decision that was never reached produced the same reading. Four
 * of these five are declines and they are different facts: "a guest may not
 * seed" is a design rule, "a peer knows the doc" is a measurement, and a live
 * reader has to be able to tell them apart.
 */
export const SEED_RULE = {
  /** Both witnesses false, and this client is entitled to seed. */
  SEED_NOTHING_KNOWS_DOC: "seed-nothing-knows-the-doc",
  /** The probe was absent or not an object — an unanswered question. */
  LOAD_PROBE_UNANSWERABLE: "load-probe-unanswerable",
  /** WP117: a role was stated and it is not the host's. */
  LOAD_NOT_THE_SEEDER: "load-role-may-not-seed",
  /** This client already holds a durable replica. */
  LOAD_SIDECAR_KNOWS: "load-sidecar-knows-doc",
  /** Somebody else holds it. */
  LOAD_PEER_KNOWS: "load-peer-knows-doc",
} as const;

export type SeedRule = (typeof SEED_RULE)[keyof typeof SEED_RULE];

/** The decision and the clause that produced it. */
export interface SeedVerdict {
  readonly decision: SeedDecision;
  readonly rule: SeedRule;
}

/** What a client learned about a doc before it decided whether to seed it. */
export interface SeedKnowledge {
  /** A sidecar replica for this doc was replayed into it. */
  readonly sidecarKnowsDoc: boolean;
  /** Some peer knows this doc — it is not this client's alone. */
  readonly peerKnowsDoc: boolean;
  /**
   * WP117 — the session role of the client asking. OPTIONAL, and an omitted
   * value keeps the pre-WP117 table; a STATED role other than `"host"` refuses.
   * See the header for why the default points that way.
   */
  readonly role?: "host" | "guest";
}

/**
 * The both-false shape, and the default everywhere `SeedKnowledge` is optional.
 *
 * FROZEN because it is shared by every caller in the session: a consumer that
 * wrote through it would poison every later cold open in the process, and the
 * write would be invisible at the site that suffers from it.
 */
export const NOTHING_KNOWS_DOC: SeedKnowledge = Object.freeze({
  sidecarKnowsDoc: false,
  peerKnowsDoc: false,
});

/**
 * Pure. No state between calls, does not mutate its argument, never throws.
 *
 * Returns {@link SEED_DECISION.SEED_FROM_FILE} only when BOTH fields are
 * exactly `false`; every other input — including a missing field and a missing
 * object — yields {@link SEED_DECISION.LOAD_OR_MERGE}.
 */
export function decideSeed(knowledge: SeedKnowledge): SeedDecision {
  return explainSeed(knowledge).decision;
}

/**
 * The same decision, plus the clause that produced it. `decideSeed` is exactly
 * `explainSeed(...).decision`, spelled once, so the two can never disagree
 * about the same input.
 *
 * Pure, total, and it never throws — including on `null`, `undefined` and a
 * non-object.
 */
export function explainSeed(knowledge: SeedKnowledge): SeedVerdict {
  const load = (rule: SeedRule): SeedVerdict => ({
    decision: SEED_DECISION.LOAD_OR_MERGE,
    rule,
  });
  // A missing or non-object probe is an unanswered question, not a "no".
  if (knowledge === null || typeof knowledge !== "object") {
    return load(SEED_RULE.LOAD_PROBE_UNANSWERABLE);
  }
  const probe = knowledge as {
    sidecarKnowsDoc?: unknown;
    peerKnowsDoc?: unknown;
    role?: unknown;
  };
  // WP117 — AUTHORITY FIRST. An omitted role keeps the pre-WP117 table; a role
  // that was stated and is not the host's refuses regardless of the evidence.
  if (probe.role !== undefined && probe.role !== "host") {
    return load(SEED_RULE.LOAD_NOT_THE_SEEDER);
  }
  // Both conjuncts, both spelled `!== false`. Dropping either one satisfies
  // three of the truth table's four rows, which is why the table is asserted
  // row by row rather than by example.
  if (probe.sidecarKnowsDoc !== false) return load(SEED_RULE.LOAD_SIDECAR_KNOWS);
  if (probe.peerKnowsDoc !== false) return load(SEED_RULE.LOAD_PEER_KNOWS);
  return {
    decision: SEED_DECISION.SEED_FROM_FILE,
    rule: SEED_RULE.SEED_NOTHING_KNOWS_DOC,
  };
}
