// S148 — THE GUEST'S OFFLINE WORK WAS SILENTLY OVERWRITTEN ON BOTH BRANCHES.
//
// THE CHARTER'S PREMISE IS CORRECTED, AND THE CORRECTION IS THE FINDING.
// ---------------------------------------------------------------------------
// The live reading was `conflictCopies = {total: 0, byArm: {}, failed: 0}`, and
// both the validation report and the charter drew the same conclusion from it:
// *"`preserveLocalVersion` did not run and fail — it did not run at all."*
//
// THAT DOES NOT FOLLOW. `preserveLocalVersion`'s DISCARD branch returned before
// every counter in `conflict-copy.ts`, so a guard that RAN and decided "merely
// stale" produced a reading that is byte-for-byte identical to a guard that was
// never called. The zeros could not distinguish the two, and three readers in a
// row read them as the second. `discarded` (below) is the counter that had to
// exist for that question to be answerable at all — live or here.
//
// REGRESSION OR SETUP-DEPENDENT: SETUP-DEPENDENT, and regression is refuted by
// construction rather than by argument. `conflict-copy.ts` has exactly ONE
// commit in its entire history (`1f22557`, WP99) and is byte-identical between
// the build that validated `S125` and the build that refuted it. The two
// intervening commits' only `manifest.ts` hunks are a logger field, a setter and
// three log lines; `39255ee` does not touch this file or `manifest.ts` at all.
// The code that decides preservation did not change. The SETUP did.
//
// THE PRECONDITION NOBODY HAD WRITTEN DOWN
// ---------------------------------------------------------------------------
// `syncFromManifest` establishes that the file diverged with `vault.read()` — a
// fresh read of the DISK. Five lines later `preserveLocalVersion` decides what to
// do about that divergence from `localFile.stat.mtime` — Obsidian's IN-MEMORY
// INDEX. Two freshness regimes, same file, same function.
//
//   ├── Obsidian CLOSED, file edited, Obsidian REOPENED — the index is rebuilt
//   │     from disk at load, the two agree, the guard is correct. This is the
//   │     setup in which `S125` was VALIDATED LIVE, and that green was real.
//   └── Obsidian LEFT RUNNING while the bytes changed underneath it — the index
//         can still hold the mtime from BEFORE the edit, a moment INSIDE the
//         last session, i.e. `< lastSessionEndedAt`. The guard classifies a file
//         the user genuinely edited as "merely stale" and it is destroyed with
//         no copy, no ledger entry and no log. This is the setup that REFUTED it.
//
// The live data decides this on its own, without any theory about Obsidian's
// cache: the validator varied ONLY the file's ON-DISK mtime between arms 5a and
// 5b — and the mtime is the guard's SOLE discriminator between preserve and
// discard — yet both arms produced the identical outcome. Either the guard never
// ran, or it ran on a value that is not the on-disk mtime. It reads
// `TFile.stat.mtime`, which is not the on-disk mtime.
//
// THE SECOND DOOR, which nobody had looked for
// ---------------------------------------------------------------------------
// `S125` locked `syncFromManifest`'s overwrite and nobody asked whether it was
// the only way a guest's divergent file gets replaced on a join. It is not.
// `BackgroundSync.subscribe()`'s guest arm writes the host's content over the
// guest's file with NO preservation whatsoever, and it is reached by an ordinary
// ordering: whenever `syncFromManifest`'s text branch declines — `getDoc` null, a
// rejected `waitForSync` swallowed by a bare `catch`, or the `S119` floor
// refusing an empty document — the guest's bytes survive that pass and this arm
// destroys them a moment later. Row A3 measures it end to end.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONFLICT_PRESERVATION,
  decideConflictPreservation,
  getConflictCopies,
  observedModificationTime,
  resetConflictCopies,
} from "../../../files/conflict-copy";
import {
  getEmptyWriteRefusals,
  resetEmptyWriteRefusals,
} from "../../../files/empty-write-guard";
import { CONFLICTS, type Rig, SHARE, sleep, startRig } from "./harness";

const NOTE = `${SHARE}/offline-edit.md`;
const HOST_TEXT = "the host's version of the shared note\n";
const GUEST_MARK = "GUEST-OFFLINE-WORK";
const GUEST_TEXT = `${GUEST_MARK} the guest typed this while out of session\n`;

/** The moment this peer's last session ended. Both clocks are compared to it. */
const LAST_SESSION_ENDED_AT = 1_000;
/** A modification INSIDE the last session — stale, by S125's rule. */
const STALE = 500;
/** A modification AFTER the last session ended — the guest's offline edit. */
const EDITED = 5_000;

describe("S148 — a guest's offline edit is never silently lost", () => {
  let rig: Rig;

  beforeEach(async () => {
    resetConflictCopies();
    resetEmptyWriteRefusals();
    rig = await startRig("wp115-s148");
  });

  afterEach(async () => {
    await rig.close();
  });

  /**
   * The production guest join, in `main.ts`'s order:
   *   `syncFromManifest(...)` → `backgroundSync.startAll("guest")`.
   *
   * `seedHostBefore: false` seeds the host's document only AFTER the guest's
   * `syncFromManifest` has run, which is what makes that pass decline. Nothing
   * else differs.
   */
  async function joinAsGuest(opts: {
    cachedMtime: number;
    diskMtime: number;
    seedHostBefore?: boolean;
    hostFiles?: Record<string, string>;
    guestFiles?: Record<string, string>;
    statThrows?: boolean;
    noStat?: boolean;
  }) {
    const host = await rig.peer({
      clientId: "host",
      role: "host",
      files: opts.hostFiles ?? { [NOTE]: HOST_TEXT },
    });
    await host.manifest.publishManifest();
    if (opts.seedHostBefore !== false) await host.bg.startAll("host");

    const guest = await rig.peer({
      clientId: "guest",
      role: "guest",
      files: opts.guestFiles ?? { [NOTE]: GUEST_TEXT },
      cachedMtime: opts.cachedMtime,
      diskMtime: opts.diskMtime,
      statThrows: opts.statThrows,
      noStat: opts.noStat,
      lastSessionEndedAt: LAST_SESSION_ENDED_AT,
    });

    const synced = await guest.manifest.syncFromManifest(
      () => {},
      () => {},
      () => {},
    );
    const diskAfterManifest = guest.vault.bytes.get(NOTE);

    const started = guest.bg.startAll("guest");
    if (opts.seedHostBefore === false) {
      await sleep(50);
      await host.bg.startAll("host");
    }
    await started;
    await sleep(800);

    return { host, guest, synced, diskAfterManifest };
  }

  // -------------------------------------------------------------------------
  // PART A — the two doors, over the real relay.
  // -------------------------------------------------------------------------

  it("A1 (control) — Obsidian RESTARTED: the two clocks agree and S125 fires, exactly as it did live", async () => {
    const { guest } = await joinAsGuest({ cachedMtime: EDITED, diskMtime: EDITED });

    // HOST AUTHORITY — unchanged. This half must never regress.
    expect(guest.vault.bytes.get(NOTE)).toBe(HOST_TEXT);
    // PRESERVATION — the guest's bytes still exist, beside the share.
    expect(guest.vault.conflictCopies()).toHaveLength(1);
    expect(guest.vault.survives(GUEST_MARK)).toBe(true);
    expect(getConflictCopies()).toMatchObject({ total: 1, byArm: { text: 1 }, failed: 0 });
    // Written by the MANIFEST arm — `Vault.modify`, not the doc writer.
    expect(guest.vault.writes).toContain(`modify:${NOTE}`);
  }, 30_000);

  it("🚨 A2 — Obsidian LEFT RUNNING: the index still holds the pre-edit mtime, and the guest's work is destroyed", async () => {
    // The ONLY difference from A1. The bytes on disk are the guest's edit; the
    // filesystem says so; Obsidian's index has not caught up.
    const { guest } = await joinAsGuest({ cachedMtime: STALE, diskMtime: EDITED });

    expect(guest.vault.bytes.get(NOTE)).toBe(HOST_TEXT); // the host still wins
    // 🚨 Before the repair this was `[]`, `false`, and `{total: 0, byArm: {},
    // failed: 0, discarded: 1}` — the live reading, reproduced, with the guest's
    // bytes gone from the vault entirely.
    expect(guest.vault.conflictCopies()).toHaveLength(1);
    expect(guest.vault.survives(GUEST_MARK)).toBe(true);
    expect(getConflictCopies()).toMatchObject({ total: 1, discarded: 0 });
  }, 30_000);

  it("🚨 A3 — THE SECOND DOOR: syncFromManifest declines, and BackgroundSync's guest arm overwrites", async () => {
    const { guest, synced, diskAfterManifest } = await joinAsGuest({
      cachedMtime: EDITED,
      diskMtime: EDITED,
      seedHostBefore: false,
    });

    // The manifest arm declined — its S119 floor refused an empty document —
    // so the guest's bytes were still on disk when it finished. That is the
    // precondition, asserted rather than assumed.
    expect(synced).toBe(0);
    expect(diskAfterManifest).toBe(GUEST_TEXT);
    expect(getEmptyWriteRefusals().byArm["manifest-sync"]).toBe(1);

    // ...and then the OTHER writer replaced them.
    expect(guest.vault.bytes.get(NOTE)).toBe(HOST_TEXT);
    expect(guest.vault.writes).toContain(`adapter.write:${NOTE}`);
    expect(guest.vault.writes).not.toContain(`modify:${NOTE}`);

    // 🚨 Before the repair: no copy at all, from a door that had never been
    // asked to preserve anything.
    expect(guest.vault.conflictCopies()).toHaveLength(1);
    expect(guest.vault.survives(GUEST_MARK)).toBe(true);
    expect(getConflictCopies()).toMatchObject({ total: 1, byArm: { text: 1 }, failed: 0 });
  }, 30_000);

  it("A4 — S125's DISCARD branch is not weakened: both clocks say stale, so no copy is written", async () => {
    // The file predates the last session end on BOTH clocks. It is staleness,
    // not the guest's work, and copying it would build the graveyard S125's
    // AC6a exists to prevent. The overwrite is silent and correct.
    const { guest } = await joinAsGuest({ cachedMtime: STALE, diskMtime: STALE });

    expect(guest.vault.bytes.get(NOTE)).toBe(HOST_TEXT);
    expect(guest.vault.conflictCopies()).toHaveLength(0);
    expect(getConflictCopies().total).toBe(0);
    // ...but it is no longer invisible. This is the row that decides S148's own
    // question, and it is the one the live rig could not have asked.
    expect(getConflictCopies().discarded).toBe(1);
  }, 30_000);

  it("A5 — the ledger tells 'never called' from 'called, and discarded'", async () => {
    // NEVER CALLED: the guest's copy already matches the host, so `needsSync` is
    // false and the loop body is never entered. Every counter stays at zero.
    const { guest } = await joinAsGuest({
      cachedMtime: STALE,
      diskMtime: STALE,
      guestFiles: { [NOTE]: HOST_TEXT },
    });
    expect(guest.vault.writes).toHaveLength(0);
    expect(getConflictCopies()).toMatchObject({ total: 0, failed: 0, discarded: 0 });

    // A4 above is the other half: same `total`, same `failed`, `discarded: 1`.
    // Before this package the two cases were indistinguishable, which is why a
    // live round could measure the defect and be unable to attribute it.
  }, 30_000);

  it("A6 — the two doors do not both fire: one copy per lost version, never two", async () => {
    const { guest } = await joinAsGuest({ cachedMtime: EDITED, diskMtime: EDITED });
    // `subscribe()`'s guest arm runs after `syncFromManifest` has converged the
    // file, sees local === remote, and writes nothing. A preservation seam that
    // fired on every join would fill the conflicts folder by itself.
    expect(guest.vault.conflictCopies()).toHaveLength(1);
    expect(getConflictCopies().total).toBe(1);
  }, 30_000);

  it("A7 — a vault whose adapter cannot stat still preserves (AC6b: every unknown preserves)", async () => {
    const noStat = await joinAsGuest({
      cachedMtime: EDITED,
      diskMtime: EDITED,
      noStat: true,
    });
    expect(noStat.guest.vault.conflictCopies()).toHaveLength(1);
    resetConflictCopies();
    await rig.close();
    rig = await startRig("wp115-s148-throws");
    const throws = await joinAsGuest({
      cachedMtime: EDITED,
      diskMtime: EDITED,
      statThrows: true,
    });
    expect(throws.guest.vault.conflictCopies()).toHaveLength(1);
  }, 60_000);

  it("A9 — a preservation that cannot run must never suppress the SYNC (S125's own contract)", async () => {
    // The first cut of the second door awaited `preserveLocalVersion` bare,
    // inside `doWriteToDisk`'s single `catch`. A collaborator that could not
    // answer therefore did not merely skip the COPY — it skipped the WRITE, and
    // "a best-effort safety net turned into a new outage" is the exact failure
    // `preserveLocalVersion`'s own doc comment forbids. A pre-existing row in
    // `background-sync.test.ts` caught it, and this is that lesson pinned where
    // this package owns it.
    const { guest } = await joinAsGuest({
      cachedMtime: EDITED,
      diskMtime: EDITED,
      seedHostBefore: false,
    });
    const seam = guest.manifest as unknown as { preserveLocalVersion?: unknown };
    const real = seam.preserveLocalVersion;
    seam.preserveLocalVersion = undefined;
    try {
      // Re-run the second door with the seam missing: same arm, same file.
      guest.vault.bytes.set(NOTE, GUEST_TEXT);
      guest.vault.writes.length = 0;
      (guest.bg as unknown as { observers: Map<string, unknown> }).observers.clear();
      (guest.bg as unknown as { lastWrittenContent: Map<string, string> }).lastWrittenContent.clear();
      await guest.bg.subscribe(NOTE);
      await sleep(300);
      // THE SYNC STILL LANDS. That is the half that must never regress.
      expect(guest.vault.bytes.get(NOTE)).toBe(HOST_TEXT);
      // ...and the unreachable seam is counted rather than swallowed.
      expect(getConflictCopies().failed).toBeGreaterThanOrEqual(1);
    } finally {
      seam.preserveLocalVersion = real;
    }
  }, 30_000);

  it("A8 — the preserved copy is the guest's bytes, under the conflicts root, stamped", async () => {
    const { guest } = await joinAsGuest({ cachedMtime: STALE, diskMtime: EDITED });
    const [copy] = guest.vault.conflictCopies();
    expect(copy).toBeDefined();
    expect(copy?.startsWith(`${CONFLICTS}/`)).toBe(true);
    expect(copy).toMatch(/offline-edit \(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\)\.md$/);
    expect(guest.vault.bytes.get(copy as string)).toBe(GUEST_TEXT);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// PART B — the decision itself. Pure, so every branch has a row.
// ---------------------------------------------------------------------------

describe("S148 — observedModificationTime: which clock the guard may believe", () => {
  it("takes the DISK value when the cached index is behind it", () => {
    expect(observedModificationTime({ cached: STALE, onDisk: EDITED })).toBe(EDITED);
  });

  it("takes the CACHED value when it is ahead of the disk", () => {
    // A filesystem that rounded a just-written mtime down must not turn an edit
    // into staleness either. `Math.max` is the preserving direction on both sides.
    expect(observedModificationTime({ cached: EDITED, onDisk: STALE })).toBe(EDITED);
  });

  it("falls back to the cached value when the disk cannot answer", () => {
    for (const onDisk of [undefined, null, 0, Number.NaN, "nope", -1]) {
      expect(observedModificationTime({ cached: STALE, onDisk })).toBe(STALE);
    }
  });

  it("passes an unusable cached value through unchanged, so the verdict is PRESERVE", () => {
    // AC6b. `decideConflictPreservation` owns the "I cannot tell" reasoning and
    // must keep owning it; this function never invents a timestamp.
    expect(observedModificationTime({ cached: undefined, onDisk: undefined })).toBeUndefined();
    expect(
      decideConflictPreservation({
        mtime: observedModificationTime({ cached: undefined, onDisk: undefined }),
        lastSessionEndedAt: LAST_SESSION_ENDED_AT,
      }).decision,
    ).toBe(CONFLICT_PRESERVATION.PRESERVE);
  });

  it("the repaired input flips exactly the verdict S148 is about, and nothing else", () => {
    const lastSessionEndedAt = LAST_SESSION_ENDED_AT;
    // What the guard used to see when Obsidian was left running:
    expect(decideConflictPreservation({ mtime: STALE, lastSessionEndedAt }).decision).toBe(
      CONFLICT_PRESERVATION.DISCARD,
    );
    // What it sees now, for the same file:
    expect(
      decideConflictPreservation({
        mtime: observedModificationTime({ cached: STALE, onDisk: EDITED }),
        lastSessionEndedAt,
      }).decision,
    ).toBe(CONFLICT_PRESERVATION.PRESERVE);
    // ...and a genuinely stale file is still discarded, on both clocks.
    expect(
      decideConflictPreservation({
        mtime: observedModificationTime({ cached: STALE, onDisk: STALE }),
        lastSessionEndedAt,
      }).decision,
    ).toBe(CONFLICT_PRESERVATION.DISCARD);
  });
});
