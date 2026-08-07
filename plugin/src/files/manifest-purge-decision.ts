// ---------------------------------------------------------------------------
// WP80 — THE PUBLICATION DECISION. A pure core, in the precedent of
// `files/canvas-seed-decision.ts` and `files/canvas-mirror-decision.ts`: ZERO
// imports. No Obsidian, no filesystem, no clock, no Yjs. Everything it needs
// arrives as an argument.
//
// THE DEFECT IT CLOSES. `publishManifest({ purge: true })` computes the entry
// set from THIS PEER'S OWN DISK and then deletes every manifest key that set
// does not account for. A peer whose initial sync has not completed has a disk
// that is a strict SUBSET of the room's shared set, so the purge removes
// entries for files that exist on other peers and simply have not arrived here
// yet. The entry set is a statement about one peer's disk; the purge turns it
// into a statement about the room, and before this module nothing checked that
// the two were the same thing.
//
// WHY THE D2 CONSUMING-SIDE GATE DOES NOT BOUND THIS. `cleanupStaleFiles` asks
// "did a live host say this?" — and for a newly-promoted host a live host DID
// say it: `promoteToHost` publishes immediately, which advances `seq` past the
// guest's `seqAtConnect` under a `hostId` that is not the guest's, and the
// promoted peer is present and claims host. The manifest is short, not empty,
// so D3's floor never fires either. The gate is not wrong; it answers a
// different question than this shape poses.
//
//     EVIDENCE OF AUTHORITY IS NOT EVIDENCE OF COMPLETENESS.
//
// This module supplies the missing half on the PRODUCING side: a peer must not
// ASSERT a complete file set it cannot know it has.
//
// THE ASYMMETRY THAT FIXES THE SAFE DIRECTION. Publishing additively when a
// purge was warranted leaves a STALE ENTRY: visible, self-correcting on the
// next complete publication, and it costs a guest one file it could have
// deleted later. Purging when completeness was not established TRASHES A USER'S
// FILE. The two costs are not comparable, so every unknown — a manifest that
// has not finished replaying, an empty `getEntries()` because `connect()` has
// not run, a per-file read failure inside the entry loop (which currently omits
// the file from the entry set, i.e. turns a transient read error into a
// deletion) — resolves to ADDITIVE, never to PURGE.
//
// FAIL-CLOSED, AND `!== true` RATHER THAN `!x`. A knowledge probe that cannot
// answer is not evidence of completeness, exactly as `decideSeed` states in its
// own header. Anything that is not the literal `true` counts as "not
// established".
//
// I11 — A REFUSAL NEVER DESTROYS, AND IT ALSO NEVER STRANDS. A peer that cannot
// establish completeness still PUBLISHES, additively, so new and changed files
// still reach the room. The refusal is of the DELETION, never of the
// publication. Refusing to publish at all would be a different bug with the
// same shape.
// ---------------------------------------------------------------------------

/**
 * The three things a publication can be. A closed set: `publishManifest` has no
 * fourth outcome and, in particular, no silent one.
 */
export const PUBLICATION_DECISION = {
  /** Completeness established — manifest keys this peer cannot account for may be deleted. */
  PURGE: "purge",
  /** Publish the entries, delete nothing. The fail-closed answer. */
  ADDITIVE: "additive",
  /** No manifest document is connected. Nothing was published and nothing was deleted. */
  NOTHING_TO_PUBLISH: "nothing-to-publish",
} as const;

export type PublicationDecision =
  (typeof PUBLICATION_DECISION)[keyof typeof PUBLICATION_DECISION];

/**
 * What a peer knows about its own standing at the moment it publishes.
 *
 * Every field is computable from data the peer already holds — the room
 * manifest as replayed and synced, the attestation, its own local shared set,
 * its own role and id. NO NEW FRAME, no server help: the relay is content-blind
 * and has no opinion about manifest entries, so no byte of this decision lives
 * on the server.
 */
export interface PublicationKnowledge {
  /** A manifest document is connected — i.e. there is anything to publish INTO. */
  readonly manifestConnected: boolean;
  /**
   * The manifest's replay has landed (`waitForSync` returned in `connect()`).
   *
   * Load-bearing on its own: an `getEntries()` that is empty because the replay
   * has not arrived looks EXACTLY like an empty room, and "every entry is
   * accounted for" is trivially true of a set nobody has told us about yet.
   */
  readonly manifestSynced: boolean;
  /** This peer's role RIGHT NOW. Only a host may purge. */
  readonly isHost: boolean;
  /**
   * This peer's role when it CONNECTED the manifest — the whole discriminator
   * between the safe call sites and the dangerous one.
   *
   * A peer that entered the session as host never populated its disk from
   * anybody else's manifest during this session, so its local set is its own
   * word about its own vault. A peer that entered as GUEST pulled its disk out
   * of the room manifest, and until that pull has accounted for every entry its
   * local set is a statement about how far it got, not about the room.
   * `promoteToHost` is exactly the transition that turns the second kind of peer
   * into a publisher.
   */
  readonly enteredSessionAsHost: boolean;
  /**
   * STICKY, for this session: some OTHER peer has published this manifest
   * SINCE WE CONNECTED — D2's `hasFreshPublication(ownId)`, latched.
   *
   * Two spellings are deliberately excluded.
   *
   *   ├── NOT "the attestation currently in the doc is not mine". That is right
   *   │   exactly once: a peer whose first publication is additive stamps its
   *   │   OWN id into the attestation, so the very next publication would see a
   *   │   familiar `hostId` and purge — re-opening the hole one republish later
   *   │   and re-arming the host-identity churn (S25) as a destructive event.
   *   └── NOT "the attestation I found on arrival was somebody else's". A
   *       replayed attestation is the room's PERSISTED state, not a live peer
   *       talking over us, and D2 already draws exactly that line with
   *       `seqAtConnect`. Latching on the replay would permanently disable the
   *       host's own deletion propagation in every session after a single role
   *       flip — a lobotomy, and one AC4 exists to catch.
   *
   * So: a publication by another peer, after our baseline. Once true it stays
   * true; something happened while we were not looking, and that does not stop
   * being the case because we talk afterwards.
   */
  readonly foreignPublicationSinceConnect: boolean;
  /** The caller asked for a purge. A publication that never asked cannot be granted one. */
  readonly purgeRequested: boolean;
  /** Keys the manifest carries right now. */
  readonly manifestPaths: readonly string[];
  /** Canonical paths this publication is about to assert from local disk. */
  readonly localPaths: readonly string[];
  /**
   * Local files that could not be READ while the entry set was built.
   *
   * Each one is silently missing from `localPaths`, so under a purge each one
   * is a DELETION caused by a transient IO error. A publication with any read
   * failure cannot establish completeness by construction.
   */
  readonly readFailures: number;
}

/** One publication's verdict, with the reason it was reached. */
export interface PublicationVerdict {
  readonly decision: PublicationDecision;
  /** Always populated. No branch of this module returns an empty reason. */
  readonly reason: string;
  /** Manifest keys the local set does not account for — i.e. what a purge would delete. */
  readonly unaccounted: string[];
}

function verdict(
  decision: PublicationDecision,
  reason: string,
  unaccounted: string[] = [],
): PublicationVerdict {
  return { decision, reason, unaccounted };
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

/**
 * Pure. No state between calls, does not mutate its argument, never throws.
 *
 * Returns {@link PUBLICATION_DECISION.PURGE} only when completeness is
 * POSITIVELY established; every other input — including a missing field, a
 * missing object and a non-boolean probe — yields
 * {@link PUBLICATION_DECISION.ADDITIVE}, except the one state that is not a
 * publication at all ({@link PUBLICATION_DECISION.NOTHING_TO_PUBLISH}).
 *
 * Completeness has exactly TWO independent witnesses, and either one is enough:
 *
 *   ├── OWN MANIFEST — this peer entered the session as host and the manifest
 *   │   it holds carries no publication by any OTHER peer. Its disk was never
 *   │   populated from someone else's manifest, and nobody else has spoken
 *   │   since, so the local set is the room's truth by construction. This is
 *   │   the `startSession` and `resumeSession`-host-arm case, and it is what
 *   │   keeps a host's real deletion propagating.
 *   └── ACCOUNTED — every key the manifest already carries is present in the
 *       local set. A purge then cannot be wrong about anything, because there
 *       is nothing it does not already hold.
 *
 * Note what the first witness deliberately does NOT accept: "the last
 * publication was mine". A peer promoted mid-sync publishes once (additively),
 * and from the next publication on the attestation WOULD be its own — so a
 * self-attestation test would re-open the hole one republish later. The
 * question is whether this peer's disk was ever fed from the room, and that is
 * answered by the role it CONNECTED with, not by who spoke last.
 */
export function decidePublication(knowledge: PublicationKnowledge): PublicationVerdict {
  // A missing or non-object probe is an unanswered question, not a "complete".
  if (knowledge === null || typeof knowledge !== "object") {
    return verdict(
      PUBLICATION_DECISION.ADDITIVE,
      "no publication knowledge was supplied; completeness cannot be established",
    );
  }
  const probe = knowledge as Partial<PublicationKnowledge>;

  if (probe.manifestConnected !== true) {
    return verdict(
      PUBLICATION_DECISION.NOTHING_TO_PUBLISH,
      "no manifest document is connected; nothing was published and nothing was deleted",
    );
  }

  const manifestPaths = asStringArray(probe.manifestPaths);
  const localPaths = asStringArray(probe.localPaths);
  if (manifestPaths === null || localPaths === null) {
    return verdict(
      PUBLICATION_DECISION.ADDITIVE,
      "the manifest or local path set was not readable as a list of paths; completeness cannot be established",
    );
  }
  const local = new Set(localPaths);
  const unaccounted = manifestPaths.filter((path) => !local.has(path));

  if (probe.purgeRequested !== true) {
    return verdict(
      PUBLICATION_DECISION.ADDITIVE,
      "this publication did not request a purge",
      unaccounted,
    );
  }

  if (probe.isHost !== true) {
    return verdict(
      PUBLICATION_DECISION.ADDITIVE,
      "this peer is not the host; only a host may delete manifest entries",
      unaccounted,
    );
  }

  if (probe.manifestSynced !== true) {
    return verdict(
      PUBLICATION_DECISION.ADDITIVE,
      "the room manifest has not finished replaying; an entry set that has not arrived is not an empty one",
      unaccounted,
    );
  }

  // S28 — a per-file read failure omits that file from the entry set, and under
  // a purge that omission IS a deletion. A read error must never present as a
  // deletion, so any failure at all disqualifies the purge for this publication.
  const readFailures = probe.readFailures;
  if (typeof readFailures !== "number" || !Number.isFinite(readFailures) || readFailures !== 0) {
    const count = typeof readFailures === "number" && Number.isFinite(readFailures)
      ? String(readFailures)
      : "an unknown number of";
    return verdict(
      PUBLICATION_DECISION.ADDITIVE,
      `${count} local file(s) could not be read, so their absence from the entry set is not evidence of deletion`,
      unaccounted,
    );
  }

  // WITNESS 1 — own manifest. `!== false` on the sticky flag: an unwired or
  // missing probe reads as "a foreign peer may have published", which closes the
  // witness. The safe direction.
  const foreign = probe.foreignPublicationSinceConnect !== false;
  if (probe.enteredSessionAsHost === true && !foreign) {
    return verdict(
      PUBLICATION_DECISION.PURGE,
      "this peer entered the session as host and no other peer has published this manifest since it connected, so its local set is the room's truth",
      unaccounted,
    );
  }

  // WITNESS 2 — accounted.
  if (unaccounted.length === 0) {
    return verdict(
      PUBLICATION_DECISION.PURGE,
      "every entry the manifest carries is accounted for locally, so this publication cannot be missing anything",
      unaccounted,
    );
  }

  return verdict(
    PUBLICATION_DECISION.ADDITIVE,
    `${unaccounted.length} manifest entr${unaccounted.length === 1 ? "y is" : "ies are"} not accounted for locally, and this peer ${
      probe.enteredSessionAsHost === true
        ? "has seen another peer publish this manifest since it connected"
        : "did not enter the session as host"
    }, so it cannot know whether they were deleted or have simply not arrived yet`,
    unaccounted,
  );
}
