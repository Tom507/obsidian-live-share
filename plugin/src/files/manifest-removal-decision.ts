// ---------------------------------------------------------------------------
// WP86 — A MANIFEST ENTRY DISAPPEARING IS NOT A LICENCE TO DESTROY A LOCAL
// FILE. A pure core, in the precedent of `files/manifest-purge-decision.ts` and
// `files/canvas-seed-decision.ts`: ZERO imports. No Obsidian, no filesystem, no
// clock, no Yjs. Everything it needs arrives as an argument.
//
// THE DEFECT IT CLOSES. `registerManifestChangeHandler` reacted to every
// `delete` key in a `Y.Map` event by trashing the corresponding local file —
// for EVERY peer, host or guest, on ANY peer's authority, with no role guard,
// no evidence gate, no completeness check and not even an `instanceof TFile`:
//
//     for (const path of actuallyRemoved) {
//       this.backgroundSync.onFileRemoved(path);
//       const file = this.app.vault.getAbstractFileByPath(toLocalPath(path));
//       if (file) await this.app.fileManager.trashFile(file);   // <- the sink
//     }
//
// WHY THAT IS WORSE THAN IT LOOKS. A vanished manifest key has at least FIVE
// producers and only ONE of them means a file was deleted:
//
//   1. a genuine remote delete            — the only one that means "deleted"
//   2. a purge by a peer that could not know its set was complete   (WP80)
//   3. a per-file read failure published as an absence              (S28)
//   4. a peer that never held the entry at all
//   5. a parent DIRECTORY entry retired because the folder stopped being empty
//      (`manifest.ts`'s `updateFile`) — not about deletion in any sense, and
//      the sink above would hand the resulting `TFolder` to `trashFile`, taking
//      the folder AND EVERYTHING IN IT.
//
// All five arrive as one `Y.Map` `delete` key with no provenance whatsoever. A
// route that cannot tell "the host deleted this file" from "a folder stopped
// being empty" has no business performing an irreversible operation on either.
//
// THE RULING THIS MODULE IMPLEMENTS: THIS LOOP DOES NOT NEED TO DELETE ON ITS
// OWN AUTHORITY. Legitimate live deletions already have a complete,
// manifest-independent route — `vault.on("delete")` fires `onFileDelete` for
// every role BEFORE the manifest is touched, and the receiving peer trashes in
// `applyRemoteOpInner`. "Deletions nobody was watching" is `cleanupStaleFiles`'
// stated job, and it is armed on every session entry and on every publication.
// So the destruction is DELEGATED to that one landed, gated sink rather than
// performed here on no evidence at all.
//
// NO THIRD PREDICATE IS AUTHORED. This module does not ask "was that host
// complete?" (unanswerable on the consuming side — the publisher's knowledge is
// not on the wire, which is why WP80 had to be producer-side) and it does not
// re-derive D2's evidence gate (`role`, `hasFreshPublication`, a live host
// claim, the `manifest.size === 0` floor). It decides only whether this route
// may act AT ALL, and hands every case that survives that question to
// `cleanupStaleFiles`, which owns the evidence question and always did.
//
// I11 — A REFUSAL NEVER DESTROYS, AND IT NEVER CANCELS THE PASS. The
// non-destructive work of the handler — `backgroundSync.onFileRemoved`, the
// `actuallyAdded` sync, the binary re-requests, `armCanvasMirrorPass` — runs in
// every branch. The refusal is of the destruction, never of the pass.
//
// FAIL-CLOSED, AND `=== true` RATHER THAN `!x`. A probe that cannot answer is
// not evidence. Anything that is not the literal expected value counts as "not
// established", exactly as `decideSeed` and `decidePublication` state in their
// own headers.
// ---------------------------------------------------------------------------

/**
 * What this route may do about ONE vanished manifest key. A closed set: there
 * is no fourth outcome and, in particular, no silent one.
 */
export const REMOVAL_DECISION = {
  /** Nothing exists at that path on this disk. Nothing to decide, nothing to do. */
  NOTHING_TO_DESTROY: "nothing-to-destroy",
  /** This route will not act. The reason names what it could not account for. */
  REFUSED: "refused",
  /**
   * The question is handed to the landed, gated stale reconcile
   * (`cleanupStaleFiles`), which owns the evidence gate. This route destroys
   * nothing itself in any branch.
   */
  DELEGATED: "delegated",
} as const;

export type RemovalVerdict = (typeof REMOVAL_DECISION)[keyof typeof REMOVAL_DECISION];

/**
 * What this route may do about ONE (removed, added) pairing in the rename arm.
 */
export const RENAME_DECISION = {
  /** A content-identity pair exists and the local file may be moved. */
  RENAME: "rename",
  /** No content identity, or the local thing is not a file. Nothing is moved. */
  REFUSED: "refused",
} as const;

export type RenameVerdict = (typeof RENAME_DECISION)[keyof typeof RENAME_DECISION];

/** What the vault holds at the vanished key's path, classified before deciding. */
export type LocalKind = "absent" | "file" | "folder" | "other";

export interface RemovalKnowledge {
  /** The canonical manifest key that disappeared. */
  path?: unknown;
  /** What `getAbstractFileByPath` returned, classified. */
  localKind?: unknown;
  /**
   * Whether the key is present in the manifest AGAIN by the time this pass
   * runs. The handler is queued behind a promise chain, so a delete followed by
   * a re-add can both be in flight; acting on the stale half would destroy a
   * file the manifest currently lists.
   */
  stillInManifest?: unknown;
}

export interface RemovalDecision {
  path: string;
  verdict: RemovalVerdict;
  /** Why. Always populated, in every branch. */
  reason: string;
}

export interface RenameKnowledge {
  oldPath?: unknown;
  newPath?: unknown;
  /**
   * `true` only when `matchRenamesByHash` paired these two keys on EQUAL
   * CONTENT. Without it the old branch fell back to positional pairing and
   * renamed the user's file onto an arbitrary added key.
   */
  hasContentPair?: unknown;
  /** What the vault holds at the OLD path. Only a `file` may be moved. */
  oldKind?: unknown;
  /** Whether something already exists at the new path. */
  newExists?: unknown;
}

export interface RenameDecision {
  oldPath: string;
  newPath: string;
  verdict: RenameVerdict;
  reason: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asLocalKind(value: unknown): LocalKind {
  return value === "absent" || value === "file" || value === "folder" || value === "other"
    ? value
    : "other";
}

/**
 * WP86 — the verdict for ONE vanished manifest key.
 *
 * Ordered so that the cheapest and most certain answers come first, and so that
 * every branch that could reach a destructive sink has already been eliminated
 * before `delegated` is returned.
 */
export function decideManifestRemoval(knowledge: RemovalKnowledge | null | undefined): RemovalDecision {
  const probe = knowledge && typeof knowledge === "object" ? knowledge : {};
  const path = asString(probe.path);
  const localKind = asLocalKind(probe.localKind);

  if (localKind === "absent") {
    return {
      path,
      verdict: REMOVAL_DECISION.NOTHING_TO_DESTROY,
      reason:
        "the vault holds nothing at this path, so the disappearance costs nothing here " +
        "(a legitimate delete has usually already arrived over the file-op route)",
    };
  }

  // The queued handler can run after a re-add. Destroying a path the manifest
  // currently LISTS would be destroying a file the room says exists.
  if (probe.stillInManifest === true) {
    return {
      path,
      verdict: REMOVAL_DECISION.REFUSED,
      reason:
        "the manifest lists this path again by the time the change was processed, " +
        "so the removal no longer describes the room's current state",
    };
  }

  if (localKind !== "file") {
    return {
      path,
      verdict: REMOVAL_DECISION.REFUSED,
      reason:
        `the vault holds a ${localKind === "folder" ? "folder" : "non-file"} at this path, not a file; ` +
        "a manifest key can be retired for bookkeeping (a shared folder stops being empty and its " +
        "directory entry is replaced by the file's), and trashing what is there would take the " +
        "folder and everything inside it",
    };
  }

  return {
    path,
    verdict: REMOVAL_DECISION.DELEGATED,
    reason:
      "a local file exists at a path the manifest stopped listing; this route holds no evidence " +
      "about WHY the key vanished, so the question is handed to the stale reconcile, which " +
      "requires a live host's fresh publication before anything is trashed",
  };
}

/**
 * WP86 — the verdict for ONE candidate rename pairing.
 *
 * The old code paired an arbitrary vanished key with an arbitrary added key
 * whenever `matchRenamesByHash` produced nothing, because the fallback was
 * `orderedAdded = added` and the loop took the first target for which
 * `oldFile && !newFile`. That is reachable in the NORMAL shape of a purging
 * publication — `publishManifest` writes its `set`s and its purge `delete`s in
 * one `doc.transact`, so a single event carrying both is routine — and it is
 * also exactly what a retired parent-directory entry produces, which is how a
 * folder came to be renamed into a path inside itself.
 */
export function decideManifestRename(knowledge: RenameKnowledge | null | undefined): RenameDecision {
  const probe = knowledge && typeof knowledge === "object" ? knowledge : {};
  const oldPath = asString(probe.oldPath);
  const newPath = asString(probe.newPath);
  const oldKind = asLocalKind(probe.oldKind);

  if (probe.hasContentPair !== true) {
    return {
      oldPath,
      newPath,
      verdict: RENAME_DECISION.REFUSED,
      reason:
        "no content-identity pair: the removed key's local bytes do not hash to the added key's " +
        "manifest hash, so there is no evidence these two keys are the same file under a new name",
    };
  }

  if (oldKind !== "file") {
    return {
      oldPath,
      newPath,
      verdict: RENAME_DECISION.REFUSED,
      reason:
        `the vault holds a ${oldKind === "folder" ? "folder" : oldKind === "absent" ? "nothing" : "non-file"} ` +
        "at the removed path; only a file is moved by a rename",
    };
  }

  if (probe.newExists === true) {
    return {
      oldPath,
      newPath,
      verdict: RENAME_DECISION.REFUSED,
      reason: "something already exists at the new path; moving onto it would destroy it",
    };
  }

  return {
    oldPath,
    newPath,
    verdict: RENAME_DECISION.RENAME,
    reason:
      "the removed key's local content hashes to the added key's manifest hash, so this is the " +
      "same file re-keyed by a rename",
  };
}
