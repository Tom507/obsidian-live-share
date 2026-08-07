/**
 * S125 — PRESERVE THE GUEST'S VERSION BEFORE THE HOST'S OVERWRITES IT.
 *
 * `syncFromManifest` hashes the guest's local file against the host's manifest
 * entry and, on any difference, writes the host's content over it. There is no
 * merge available at that moment and there never was: the guest's local content
 * never enters the CRDT, because `backgroundSync.startAll("guest")` only
 * subscribes — it never seeds a doc from disk — and it runs AFTER
 * `syncFromManifest` has already written. By the time Yjs is involved there is
 * one version left.
 *
 * Reachable by the most ordinary sequence the product supports: close Obsidian,
 * edit a shared note, reopen with `autoReconnect`. The notice said "synced N
 * file(s)", which reads as success.
 *
 * THIS MODULE DOES NOT CHANGE WHO WINS. The host remains authoritative and the
 * overwrite still happens; a copy of the guest's version is placed beside the
 * share first. Not a merge, not a prompt, not a blocking dialog.
 */

/** Appended to the shared folder's name to form its sibling. */
export const CONFLICTS_SUFFIX = " (conflicts)";

/**
 * Used when `sharedFolder` is empty — i.e. the whole vault is shared, so there
 * is no "beside" and every path is inside the share.
 *
 * AC8: the folder then lives at the VAULT ROOT and is kept out of the share by
 * the same OWNED rule as the sibling case ({@link isConflictsPath}), never by
 * position. Position could not work here even in principle: a whole-vault share
 * contains the vault root by definition, so a positional exclusion would have
 * to be "outside the vault", which is not a place a file can go.
 */
export const WHOLE_VAULT_CONFLICTS_ROOT = "Live Share (conflicts)";

/**
 * The conflicts root for a given shared folder. A SIBLING of the share —
 * `_liveshare-test` yields `_liveshare-test (conflicts)`, and a nested share
 * `a/b` yields `a/b (conflicts)`, still a sibling of `b`.
 */
export function conflictsRootFor(sharedFolder: string): string {
  const trimmed = sharedFolder.trim();
  return trimmed ? `${trimmed}${CONFLICTS_SUFFIX}` : WHOLE_VAULT_CONFLICTS_ROOT;
}

/**
 * AC7 — THE OWNED EXCLUSION. Is `path` inside the conflicts root?
 *
 * This project's most repeated lesson (WP26, WP95, S94) is a guard that
 * excluded something only because it happened to sit under a path some OTHER
 * rule covered. A conflicts folder that ever counts as shared would be
 * published, re-conflicted on the next join, and multiply without bound — the
 * copies are by construction different from the host's content, so every one of
 * them is a permanent `needsSync`.
 *
 * So the answer is owned here and consulted directly by `isSharedPath`, rather
 * than left to `ExclusionManager` (which the user can reconfigure) or to the
 * sibling position (which does not exist in the whole-vault case).
 */
export function isConflictsPath(path: string, sharedFolder: string): boolean {
  const root = conflictsRootFor(sharedFolder);
  return path === root || path.startsWith(`${root}/`);
}

/** `2026-08-07 17-42-03` — filename-safe, sorts chronologically. */
export function conflictStamp(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`
  );
}

/**
 * AC9 — where the guest's version is preserved.
 *
 * Mirrors the file's path RELATIVE TO THE SHARED ROOT, so a share with
 * subfolders does not collapse into a flat heap, and stamps the filename so a
 * second conflict on the same path cannot overwrite the first. A
 * conflict-preservation feature that overwrites its own previous copy is the
 * defect it exists to fix.
 */
export function conflictCopyPath(path: string, sharedFolder: string, when: Date): string {
  const root = conflictsRootFor(sharedFolder);
  const trimmed = sharedFolder.trim();
  // Relative to the share, so structure survives. With a whole-vault share the
  // path is already vault-relative and is used as-is.
  let relative = path;
  if (trimmed) {
    const prefix = `${trimmed}/`;
    if (path.startsWith(prefix)) relative = path.slice(prefix.length);
  }
  const slash = relative.lastIndexOf("/");
  const dir = slash === -1 ? "" : relative.slice(0, slash);
  const name = slash === -1 ? relative : relative.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  // A leading dot is an extensionless dotfile, not an extension.
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const stamped = `${stem} (${conflictStamp(when)})${ext}`;
  return dir ? `${root}/${dir}/${stamped}` : `${root}/${stamped}`;
}

/**
 * AC10 — the ledger. A preservation that nothing can observe is indistinguishable
 * from no preservation at all, and this one happens during a join where the only
 * user-visible message used to be "synced N file(s)".
 */
export interface ConflictCopyLedger {
  /** Total copies written since load. Never decremented. */
  total: number;
  /** Copies by arm (`text` / `binary`), so the two writers stay distinguishable. */
  byArm: Record<string, number>;
  /** Copies refused because the copy itself failed. A silent failure here is a loss. */
  failed: number;
}

const copiesByArm = new Map<string, number>();
let copyTotal = 0;
let copyFailures = 0;

/** Record one preserved version. Takes the ARM; never the path, never content. */
export function noteConflictCopy(arm: string): void {
  copyTotal += 1;
  copiesByArm.set(arm, (copiesByArm.get(arm) ?? 0) + 1);
}

/** Record a preservation that could not be written. */
export function noteConflictCopyFailure(): void {
  copyFailures += 1;
}

/** READ-ONLY. What has been preserved, so a live validator can read it. */
export function getConflictCopies(): ConflictCopyLedger {
  return { total: copyTotal, byArm: Object.fromEntries(copiesByArm), failed: copyFailures };
}

/** Tests only. */
export function resetConflictCopies(): void {
  copyTotal = 0;
  copyFailures = 0;
  copiesByArm.clear();
}

/**
 * S125 AC6a — DID THE GUEST CHANGE THIS FILE WHILE OFFLINE, or is it merely stale?
 *
 * Copying every divergent file would fill the folder with versions the guest
 * never touched: the host edits a note while the guest is away, the guest
 * rejoins, the hashes differ, and a "conflict" copy is written for an edit the
 * guest had nothing to do with. A few reconnects and the folder is a graveyard
 * nobody reads, which defeats the point of having it.
 *
 * The exact answer is the local file's mtime against the moment THIS PEER's
 * session last ended.
 *
 * WHY THIS IS NOT THE UNSAFE KIND OF MTIME CHECK, and the next reader will
 * assume it is: both sides of this comparison come from the SAME MACHINE'S
 * CLOCK. `lastSessionEndedAt` is written by this peer when its own session
 * ends, and `mtime` is set by this peer's filesystem. No remote timestamp
 * enters the comparison, so the cross-peer clock skew that makes mtime
 * untrustworthy in distributed code cannot arise here.
 *
 * EVERY UNCERTAIN INPUT PRESERVES (AC6b). First run, a crash before the stamp
 * was written, a reinstall, a corrupted value, `undefined`, `0`, `NaN`, a
 * timestamp in the future — all of them mean "I cannot tell", and the cost of
 * being wrong is asymmetric: preserving something stale leaves a file nobody
 * needed, while discarding something the user wrote is the loss this entire
 * package exists to prevent.
 *
 * KNOWN LIMITS, written down rather than left to be discovered (AC6d):
 *   1. Anything else that writes the file offline — Obsidian Sync, git, another
 *      plugin touching frontmatter — counts as "the guest changed it". That is
 *      arguably correct: it is a local change the host does not have.
 *   2. A hard kill leaves no stamp, so the next join preserves everything.
 *   Both err toward keeping too much, which is the direction to err in.
 */
export const CONFLICT_PRESERVATION = {
  /** The guest changed it while offline — keep a copy. */
  PRESERVE: "preserve",
  /** Merely stale — the host's version supersedes it silently, as before. */
  DISCARD: "discard",
} as const;

export type ConflictPreservation =
  (typeof CONFLICT_PRESERVATION)[keyof typeof CONFLICT_PRESERVATION];

export interface PreservationVerdict {
  decision: ConflictPreservation;
  reason: string;
}

function usableTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function decideConflictPreservation(input: {
  /** The local file's mtime, from `file.stat.mtime`. */
  mtime: unknown;
  /** `settings.lastSessionEndedAt`, or anything at all if it got corrupted. */
  lastSessionEndedAt: unknown;
  /** Injected so the "future timestamp" branch is testable without waiting. */
  now?: number;
}): PreservationVerdict {
  const now = input.now ?? Date.now();
  if (!usableTimestamp(input.lastSessionEndedAt)) {
    return {
      decision: CONFLICT_PRESERVATION.PRESERVE,
      reason: "no usable record of when this peer's last session ended",
    };
  }
  if (input.lastSessionEndedAt > now) {
    return {
      decision: CONFLICT_PRESERVATION.PRESERVE,
      reason: "the recorded session end is in the future; the clock cannot be reasoned about",
    };
  }
  if (!usableTimestamp(input.mtime)) {
    return {
      decision: CONFLICT_PRESERVATION.PRESERVE,
      reason: "the local file has no usable modification time",
    };
  }
  if (input.mtime > input.lastSessionEndedAt) {
    return {
      decision: CONFLICT_PRESERVATION.PRESERVE,
      reason: "the local file was modified after this peer's last session ended",
    };
  }
  return {
    decision: CONFLICT_PRESERVATION.DISCARD,
    reason: "the local file predates this peer's last session end, so it is stale, not edited",
  };
}
