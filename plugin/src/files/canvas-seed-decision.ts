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

/** What a client learned about a doc before it decided whether to seed it. */
export interface SeedKnowledge {
  /** A sidecar replica for this doc was replayed into it. */
  readonly sidecarKnowsDoc: boolean;
  /** Some peer knows this doc — it is not this client's alone. */
  readonly peerKnowsDoc: boolean;
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
  // A missing or non-object probe is an unanswered question, not a "no".
  if (knowledge === null || typeof knowledge !== "object") return SEED_DECISION.LOAD_OR_MERGE;
  const probe = knowledge as { sidecarKnowsDoc?: unknown; peerKnowsDoc?: unknown };
  // Both conjuncts, both spelled `!== false`. Dropping either one satisfies
  // three of the truth table's four rows, which is why the table is asserted
  // row by row rather than by example.
  if (probe.sidecarKnowsDoc !== false) return SEED_DECISION.LOAD_OR_MERGE;
  if (probe.peerKnowsDoc !== false) return SEED_DECISION.LOAD_OR_MERGE;
  return SEED_DECISION.SEED_FROM_FILE;
}
