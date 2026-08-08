// ---------------------------------------------------------------------------
// S159 — HASH EQUALITY IS NOT FILE IDENTITY, AND THE DESTRUCTIVE HALF ACTS ON
// THE MATCH.
//
// A pure core with ZERO IMPORTS, in the precedent of `files/protected-paths.ts`:
// no Obsidian, no filesystem, no clock, no Yjs. It lives here rather than in
// `utils.ts` for one structural reason — `files/manifest-removal-decision.ts`
// has to be able to ask it what an identity basis is, and that module's contract
// forbids it from importing anything that reaches Obsidian. `utils.ts` imports
// `obsidian` on its first line. Two copies of the accepted-basis list would have
// been the alternative, and a predicate re-declared per consumer is the exact
// shape of defect WP95 exists to close.
//
// WHAT THE PAIRER IS FOR. A manifest publication can retire keys and add keys in
// ONE `Y.Map` transaction — `publishManifest` writes its `set`s and its purge
// `delete`s inside a single `doc.transact`, so an event carrying both is
// routine. Some of those pairs are renames and the manifest carries no rename
// op, so the consumer has to work out which disappearance goes with which
// appearance. `main.ts`'s rename arm then calls `vault.rename` on the answer:
// THE DESTRUCTIVE HALF ACTS ON THE MATCH.
//
// THE DEFECT. Pairing was by content digest, first-match-wins, in array order.
// `hash("")` is a full 64-character digest like any other, so TWO EMPTY NOTES
// ARE INTERCHANGEABLE TO THE PAIRER — and so are ANY two identical notes, which
// is the more general case and the more ordinary one: duplicated templates,
// stub notes, two copies of the same daily-note skeleton. The old loop resolved
// the tie by iteration order and never noticed there had been a choice, so two
// vaults handed the same event with the keys in a different order would move
// DIFFERENT FILES.
//
// REACHABLE, NOT THEORETICAL. `S119` left EIGHTEEN zero-byte `.md` files in one
// live vault — a standing supply of mutually interchangeable identities sitting
// in exactly the state that triggers this. WP95 names the HOSTILE version of the
// collision (an attacker who supplies the hash); the benign one was named
// nowhere until S159.
//
// THE RULE: CONTENT EQUALITY ALONE CAN NEVER ESTABLISH IDENTITY.
//
//   ├── A digest carried by exactly ONE removed key and exactly ONE added key is
//   │      identity evidence: in this event nothing else could have gone here.
//   ├── When more keys share the digest, content has said nothing about WHICH
//   │      went WHERE, so the pairer looks for evidence that is not content — a
//   │      path relationship. If exactly one added candidate inside that digest
//   │      class keeps this removed key's BASENAME, and no rival removed key
//   │      claims that basename either, the file kept its name and changed
//   │      folder. That is a rename signature, and it rescues the ordinary
//   │      "drag three identical stubs into a subfolder" gesture.
//   └── Otherwise it REFUSES. I11 — A REFUSAL NEVER DESTROYS. Losing a rename's
//          tidiness is recoverable; moving the wrong file is not.
//
// WHAT A REFUSAL COSTS, STATED SO THE TRADE IS VISIBLE RATHER THAN ASSUMED. An
// unpaired removed key falls through to `decideManifestRemoval` → DELEGATED →
// the GATED `cleanupStaleFiles`; an unpaired added key falls through to
// `syncFromManifest` / `backgroundSync.onFileAdded`. The end state is the same
// bytes at the same new path. What is lost is the MOVE — ctime, and the
// difference between "moved" and "trashed then re-fetched". The primary rename
// route (a real rename op over `file-ops.ts`, which carries an explicit
// old→new pair and needs none of this) is untouched, and it is the one users
// actually see; this arm is the manifest-diff fallback behind it.
//
// ORDER-INDEPENDENT BY CONSTRUCTION. Neither rule reads a path's position in its
// array, so shuffling `removed` or `added` cannot change a verdict. The old
// loop's answer was a function of arrival order, which is precisely what made
// "right" and "wrong" indistinguishable at the call site.
// ---------------------------------------------------------------------------

/** Why one removed key ended up paired, or did not. One value per removed key. */
export const RENAME_PAIRING = {
  /** The digest is unique on both sides: nothing else could have gone here. */
  UNIQUE_CONTENT: "paired-unique-content",
  /** The digest was ambiguous; the basename was not, and a basename is a path fact. */
  UNIQUE_BASENAME_IN_CLASS: "paired-unique-basename-within-content-class",
  /** No local bytes could be hashed, so nothing identifies this key at all. */
  REFUSED_NO_LOCAL_HASH: "refused-no-local-hash",
  /** Nothing added carries these bytes. An ordinary removal, not a rename. */
  REFUSED_NO_CONTENT_MATCH: "refused-no-content-match",
  /** THE S159 CASE. More than one candidate, and content cannot say which. */
  REFUSED_AMBIGUOUS_CONTENT: "refused-ambiguous-content-identity",
} as const;

export type RenamePairingOutcome = (typeof RENAME_PAIRING)[keyof typeof RENAME_PAIRING];

/**
 * The ONLY two answers that mean "these two keys are the same file", and
 * therefore the only two `decideManifestRename` admits. Declared here so the
 * pure decision core and the pairer cannot drift apart.
 */
export const IDENTITY_BASES: readonly string[] = [
  RENAME_PAIRING.UNIQUE_CONTENT,
  RENAME_PAIRING.UNIQUE_BASENAME_IN_CLASS,
];

export interface RenamePairingRow {
  oldPath: string;
  /** `null` on every refusal. */
  newPath: string | null;
  outcome: RenamePairingOutcome;
  /** Always populated, in every branch. */
  reason: string;
  /** Every added key carrying these bytes. */
  candidates: string[];
  /** Every OTHER removed key carrying these bytes. */
  rivals: string[];
}

export interface RenamePairing {
  pairs: Map<string, string>;
  /**
   * ONE ROW PER REMOVED KEY, IN EVERY BRANCH — S155's rule. A pairer that
   * recorded only its successes would make "it ran and refused" byte-identical
   * to "it never ran", which is the reading that cost this project a full round
   * and misled three readers.
   */
  ledger: RenamePairingRow[];
}

/** The last path segment. Tolerates both separators; `""` for a trailing one. */
export function basenameOf(path: string): string {
  const normalised = path.replace(/\\/g, "/");
  const cut = normalised.lastIndexOf("/");
  return cut < 0 ? normalised : normalised.slice(cut + 1);
}

/**
 * S159 — pair vanished manifest keys to appeared ones by IDENTITY, refusing
 * whenever content equality is all there is. See the header for the rule, for
 * what a refusal costs, and for why the tie-break is a path fact rather than a
 * cleverer use of the same digest.
 */
export function pairRenamesByIdentity(
  removed: string[],
  added: string[],
  removedHashOf: (path: string) => string | undefined,
  addedHashOf: (path: string) => string | undefined,
): RenamePairing {
  const pairs = new Map<string, string>();
  const ledger: RenamePairingRow[] = [];

  // Index BOTH sides by digest BEFORE deciding anything. The old loop decided
  // per removed key while walking, which is why it could not see that it had a
  // choice at all: the rival was still in the future.
  const removedByHash = new Map<string, string[]>();
  const addedByHash = new Map<string, string[]>();
  for (const oldPath of removed) {
    const hash = removedHashOf(oldPath);
    if (!hash) continue;
    const bucket = removedByHash.get(hash);
    if (bucket) bucket.push(oldPath);
    else removedByHash.set(hash, [oldPath]);
  }
  for (const newPath of added) {
    const hash = addedHashOf(newPath);
    if (!hash) continue;
    const bucket = addedByHash.get(hash);
    if (bucket) bucket.push(newPath);
    else addedByHash.set(hash, [newPath]);
  }

  for (const oldPath of removed) {
    const hash = removedHashOf(oldPath);
    if (!hash) {
      ledger.push({
        oldPath,
        newPath: null,
        outcome: RENAME_PAIRING.REFUSED_NO_LOCAL_HASH,
        reason:
          "no content digest is available for the removed path — the local file is gone, " +
          "unreadable, or the entry is a directory placeholder — so nothing identifies it",
        candidates: [],
        rivals: [],
      });
      continue;
    }

    const candidates = addedByHash.get(hash) ?? [];
    const rivals = (removedByHash.get(hash) ?? []).filter((p) => p !== oldPath);

    if (candidates.length === 0) {
      ledger.push({
        oldPath,
        newPath: null,
        outcome: RENAME_PAIRING.REFUSED_NO_CONTENT_MATCH,
        reason:
          "no added key carries these bytes, so this disappearance is not the source half of " +
          "any rename in this event",
        candidates: [],
        rivals,
      });
      continue;
    }

    // The unambiguous case: one on each side. Content equality is identity
    // evidence HERE AND ONLY HERE, because there is nothing else it could be.
    if (candidates.length === 1 && rivals.length === 0) {
      pairs.set(oldPath, candidates[0]);
      ledger.push({
        oldPath,
        newPath: candidates[0],
        outcome: RENAME_PAIRING.UNIQUE_CONTENT,
        reason:
          "exactly one removed key and exactly one added key carry these bytes, so no other " +
          "pairing of this content is possible in this event",
        candidates,
        rivals,
      });
      continue;
    }

    // Ambiguous by content. Look for evidence that is NOT content: the file kept
    // its name. Required to be unique on BOTH sides of the digest class, or it
    // is the same coin flip one level down.
    const base = basenameOf(oldPath);
    const sameName = candidates.filter((p) => basenameOf(p) === base);
    const rivalsWithSameName = rivals.filter((p) => basenameOf(p) === base);
    if (sameName.length === 1 && rivalsWithSameName.length === 0) {
      pairs.set(oldPath, sameName[0]);
      ledger.push({
        oldPath,
        newPath: sameName[0],
        outcome: RENAME_PAIRING.UNIQUE_BASENAME_IN_CLASS,
        reason:
          `${candidates.length} added key(s) carry these bytes, so content cannot say which; ` +
          `exactly one of them keeps the filename '${base}' and no other removed key claims it, ` +
          "which is a path relationship rather than a content coincidence",
        candidates,
        rivals,
      });
      continue;
    }

    ledger.push({
      oldPath,
      newPath: null,
      outcome: RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT,
      reason:
        `${candidates.length} added key(s) and ${rivals.length + 1} removed key(s) carry the ` +
        "identical bytes and no filename disambiguates them; content equality alone is not file " +
        "identity, and this route would move a user's file on the strength of it. REFUSED (I11) " +
        "— the added key still syncs and the removed key still reaches the gated stale " +
        "reconcile, so nothing is lost but the move itself",
      candidates,
      rivals,
    });
  }

  // A pairing is a bijection or it is not a pairing. Nothing above can assign
  // one added key twice — a digest class is either 1×1, or resolved by a
  // basename that is unique within it — but the invariant is cheap to hold and
  // its violation would be a silent double-move onto one path.
  const claimed = new Set<string>();
  for (const [oldPath, newPath] of [...pairs]) {
    if (claimed.has(newPath)) {
      pairs.delete(oldPath);
      const row = ledger.find((r) => r.oldPath === oldPath);
      if (row) {
        row.newPath = null;
        row.outcome = RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT;
        row.reason =
          `two removed keys resolved to the same target '${newPath}'; a pairing that is not a ` +
          "bijection is not identity, so this half is refused rather than chosen";
      }
      continue;
    }
    claimed.add(newPath);
  }

  return { pairs, ledger };
}
