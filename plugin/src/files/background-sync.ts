import { Notice, type Vault } from "obsidian";
import type * as Y from "yjs";

import { SYNC_RESOLUTION, type SyncManager, type SyncResolution } from "../sync/sync";
import type { SessionRole } from "../types";
import {
  VAULT_EVENT_SETTLE_MS,
  applyMinimalYTextUpdate,
  ensureFolder,
  getFileByPath,
  isPathSafe,
  isTextFile,
  normalizeLineEndings,
  normalizePath,
  skipsAutoTextSync,
  toCanonicalPath,
  toLocalPath,
} from "../utils";
import { isSidecarPath } from "./canvas-sidecar";
import { yTextHeldContent } from "./ytext-history";
import {
  EMPTY_WRITE_DECISION,
  type EmptyWriteRefusalLogger,
  decideEmptyWrite,
  noteEmptyWriteRefusal,
} from "./empty-write-guard";
import type { FileOpsManager } from "./file-ops";
import {
  isProtectedPath,
  noteProtectedRefusal,
  protectedRefusalMessage,
} from "./protected-paths";
import type { ManifestManager } from "./manifest";

const DEBOUNCE_MS = 300;
// Cap so a continuous incoming stream still flushes to disk at least this often,
// instead of the trailing debounce resetting on every update and starving it.
const MAX_WAIT_MS = 500;

/**
 * S147 — HOW LONG A GUEST WILL WAIT FOR THE HOST'S SEED, AS A DEADLINE.
 *
 * This was `for (let i = 0; i < 20; i++) await setTimeout(…, 100)` — a fixed
 * COUNT of timer hops, nominally 2 s. Chromium clamps timers in a backgrounded
 * renderer, and Obsidian is Electron: measured on this project's own rig, a hop
 * costs 12 ms in the foreground, **907 ms** after a minute hidden and
 * **9 004 ms** after ten, and it keeps growing. Twenty hops is therefore not
 * 2 s, it is 18 s, then 180 s, then unbounded — and in the ordinary
 * three-window setup ALL THREE renderers are hidden.
 *
 * The budget below is the same 2 s. What changed is that it is an ABSOLUTE
 * DEADLINE evaluated against the wall clock and raced against the EVENT the
 * wait is actually about — the host's seed arriving, which is a mux message,
 * and messages are never throttled. One timer, not twenty, and the ordinary
 * case does not consult a timer at all.
 */
const SEED_WAIT_BUDGET_MS = 2_000;

// WP6 / US5 AC1+AC2 — the `.canvas` skip consulted by all three event-driven
// entry points below (`startAll`, `onFileAdded`, `onFileRenamed`) now lives in
// `utils.ts` beside `isTextFile`, so `manifest.ts`'s `syncFromManifest` consults
// the SAME predicate instead of growing a fourth private copy. Full rationale,
// including why `subscribe()` is deliberately NOT guarded, is on the predicate.
//
// WP26 AC1+AC2 — that same predicate now also excludes the sidecar state
// directory, so those three entry points need no second guard. The fourth door,
// `handleLocalTextModify`, is guarded with WP24's `isSidecarPath` ALONE and not
// with `skipsAutoTextSync`: it is the local-edit half of the R10 text fallback
// and must keep accepting a `.canvas` that CanvasSync does not own.
//
// WP27 AC4 — `setActiveFile` is now GUARDED too, with the same predicate. It
// was previously left open on a reachability argument ("main.ts only ever sets
// the active file from a path that already passed `isSharedPath` AND
// `isTextFile`"), and AC4 rejects reachability arguments explicitly: the guard
// has to be a line a test can point at. See the guard's own comment.
//
// The remaining two `getDoc` sites in this class are deliberately UNGUARDED,
// each for a different and checked reason — a guard on either would be
// unfalsifiable by construction, which is worse than none:
//
//   subscribe()     the announced R10 text-fallback door. Out of WP26's and
//                   WP27's scope (WP33 owns it) and pinned open by a test in
//                   both. It is made unreachable for a sidecar path by guarding
//                   its callers.
//   flushWrite()    keyed off `this.writeTimers`, populated only by the observer
//                   installed in `attachObserver`, which only runs for a path
//                   that already came through one of the four guarded doors.

export class BackgroundSync {
  private observers = new Map<string, () => void>();
  private subscribing = new Set<string>();
  private cancelledSubscribes = new Set<string>();
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private writeFirstScheduled = new Map<string, number>();
  private activeFile: string | null = null;
  private collabBoundFile: string | null = null;
  private recentDiskWrites = new Set<string>();
  private lastWrittenContent = new Map<string, string>();
  /**
   * S119 — paths whose shared document this peer has observed holding CONTENT
   * during this session. The positive evidence that lets an empty write
   * through.
   *
   * A document that went from text to nothing was emptied by somebody, and that
   * edit must reach disk (a user who selects-all-and-deletes means it). A
   * document that has never held anything is not "empty" in the same sense — it
   * is a document nothing has arrived in yet, and the two were indistinguishable
   * to the writer until this set existed. Membership is monotonic within a
   * session and never removed on emptiness, because "it once had content" is
   * exactly the fact being remembered.
   */
  private observedNonEmpty = new Set<string>();
  /**
   * S147 — waiters parked in {@link awaitSeed}, so a cancellation, a teardown
   * or a released document can END a wait instead of leaving it to expire on a
   * clamped timer. A wait that can only be ended by a timer is a wait whose
   * length the platform decides.
   */
  private seedWaiters = new Map<string, Set<() => void>>();
  // Per-file monotonic counter of remote (non-local) Y.Text deltas applied to
  // the doc. A whole-file disk flush snapshots this value when it captures its
  // content; if the counter has advanced by the time the flush actually reaches
  // disk, an in-flight remote delta arrived after the snapshot and the snapshot
  // is stale — the flush must yield rather than clobber that remote change.
  // This is a version/sequence gate, NOT a wall-clock debounce race.
  private remoteSeq = new Map<string, number>();
  private writeQueue: Promise<void> = Promise.resolve();
  private role: SessionRole = "host";
  private running = false;
  /**
   * S137 — the debug-log sink for this writer's REFUSALS.
   *
   * Null until `main.ts` wires it, and every use is `?.`-guarded, so a harness
   * that constructs this class directly is unaffected. Wired AFTER the
   * `DebugLogger` is assigned, never beside the constructor call — that is
   * S104's lesson and it cost this project two signatures that were unreachable
   * for its entire history.
   */
  private logger: EmptyWriteRefusalLogger | null = null;

  constructor(
    private vault: Vault,
    private syncManager: SyncManager,
    private manifestManager: ManifestManager,
    private fileOpsManager: FileOpsManager,
  ) {}

  /**
   * S137 — wiring only. See {@link logger}: this must be called after the
   * plugin's `DebugLogger` exists, not beside `new BackgroundSync(...)`.
   */
  setLogger(logger: EmptyWriteRefusalLogger | null): void {
    this.logger = logger;
  }

  isRunning(): boolean {
    return this.running;
  }

  async startAll(role: SessionRole): Promise<void> {
    this.running = true;
    this.role = role;
    const entries = this.manifestManager.getEntries();
    const paths: string[] = [];
    for (const [path, entry] of entries) {
      if (!isTextFile(path) || entry.binary) continue;
      // US5 AC2 — manifest-replay entry point. See `skipsAutoTextSync`.
      if (skipsAutoTextSync(path)) continue;
      paths.push(path);
    }
    // S147 — PHASE 1. Every announced path gets its document BEFORE any single
    // path is settled. The loop below settles them one at a time and always
    // did; what it must never again do is decide whether a LATER path is
    // subscribed at all. See `registerAnnounced`.
    this.registerAnnounced(paths);
    for (const path of paths) {
      try {
        await this.subscribe(path);
      } catch {
        new Notice(`Live Share: failed to sync ${path}`);
      }
    }
  }

  /**
   * S147 — PHASE 1 OF AN ANNOUNCED BATCH, AND IT IS THE HALF THAT WAS MISSING.
   *
   * The live orphans read `docExists: false`: no `Y.Doc` had been created for
   * those paths at all, so `subscribe()` had never reached `getDoc` for them.
   * That is not a defect inside `subscribe()` — it is a defect in every caller
   * that iterates announced paths SERIALLY and awaits each one
   * (`startAll` above, `main.ts::processManifestChange`'s `actuallyAdded`
   * loop). One path whose settle is slow — and under a clamp a two-second wait
   * is a three-minute wait — decided whether every path behind it existed.
   *
   * This is synchronous and consults no timer. It creates the document and
   * sends the relay's `MUX_SUBSCRIBE`, which is exactly what `subscribe()`'s
   * first statement does, so nothing new happens to a path — it happens
   * SOONER, and it can no longer be prevented by a neighbour. It also means
   * `SyncManager.onopen`'s reconnect loop, which re-subscribes
   * `this.docs.keys()`, has something to re-subscribe after an outage; a
   * document that was never created is why a throttled guest never recovered.
   *
   * The filters are the same three the two callers already apply, restated here
   * rather than trusted: an unsafe path, a non-text path and a `.canvas` or
   * sidecar path must not acquire a raw `Y.Text` document (WP6/US5, WP26).
   */
  registerAnnounced(rawPaths: Iterable<string>): void {
    for (const raw of rawPaths) {
      const path = toCanonicalPath(normalizePath(raw));
      if (!isPathSafe(path)) continue;
      if (!isTextFile(path)) continue;
      if (skipsAutoTextSync(path)) continue;
      if (this.observers.has(path)) continue;
      this.syncManager.getDoc(path);
    }
  }

  cancelSubscribe(rawPath: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (this.subscribing.has(path)) {
      this.cancelledSubscribes.add(path);
      // S147 — a cancellation is an EVENT. Waking the waiter here is what keeps
      // a deliberate cancel from being held hostage by a clamped deadline; the
      // caller re-checks `cancelledSubscribes` immediately afterwards, so this
      // ends the wait and never turns it into a completion.
      this.wakeSeedWaiters(path);
    }
  }

  /** S147 — release anything parked in {@link awaitSeed} for this path. */
  private wakeSeedWaiters(path: string): void {
    const waiters = this.seedWaiters.get(path);
    if (!waiters) return;
    for (const wake of [...waiters]) wake();
  }

  async subscribe(rawPath: string): Promise<void> {
    const path = toCanonicalPath(normalizePath(rawPath));
    // A peer/host controls manifest keys; reject any that would escape the vault.
    if (!isPathSafe(path)) return;
    if (this.observers.has(path) || this.subscribing.has(path)) return;
    this.cancelledSubscribes.delete(path);
    this.subscribing.add(path);

    try {
      const docHandle = this.syncManager.getDoc(path);
      if (!docHandle) return;

      // S147 — SUBSCRIPTION IS OBSERVATION. SETTLEMENT IS SOMETHING ELSE.
      //
      // `attachObserver` used to be the LAST statement of this function, behind
      // `waitForSync`, a disk read, a seed and (on the guest) a wait for the
      // host's seed. Every one of those is slow or fallible: `S143` counted
      // five early returns that leave `observers: false` with no retry, no
      // counter and no log, and a clamped renderer makes two of them
      // unbounded — the `waitForSync` timeout is a 10 s duration that a hidden
      // window stretches to minutes, and the seed wait was twenty timer hops.
      // So "is this file participating in the session at all" was decided by
      // how long a settlement happened to take. That is the `observers: false`
      // reading taken on sixteen of sixteen live guest/file pairs.
      //
      // Attaching here is not merely earlier, it is the right order. Hearing
      // this document's remote deltas does not depend on the initial sync
      // having completed, and WP42's replay gate already guarantees the doc is
      // never observed half-replayed. The arms below are a one-off
      // reconciliation of what was on disk when we arrived; with the observer
      // on, anything that arrives afterwards — including everything that
      // arrives after a link is restored — still reaches disk through
      // `scheduleDiskWrite`. The file converges by the CRDT rather than by this
      // function having been quick enough.
      //
      // It cannot echo this peer's own work: the observer returns immediately
      // for `transaction.local`, which is what the host's seed below is. A
      // cancellation arriving after this point is undone in the `finally`.
      this.attachObserver(path, docHandle.text);

      // S147 — the RESOLUTION is read, not discarded. See `awaitSeed`'s caller
      // in the guest arm: `PEER_STATE` means a peer answered and its state has
      // already been applied, so there is no arrival left to wait for.
      let resolution: SyncResolution | null = null;
      try {
        resolution = await this.syncManager.waitForSync(path);
      } catch {
        return;
      }

      if (this.cancelledSubscribes.has(path)) return;
      if (docHandle.doc.isDestroyed) return;

      const diskPath = toLocalPath(path);
      if (this.role === "host") {
        const file = getFileByPath(this.vault, diskPath);
        if (file) {
          const content = normalizeLineEndings(await this.vault.read(file));
          if (this.cancelledSubscribes.has(path)) return;
          const remoteContent = docHandle.text.toString();
          this.noteIfNonEmpty(path, remoteContent);
          // S134 — SEEDING IS NOT WRITING, AND THE ACTIVE-FILE EXEMPTION STOPPED
          // BOTH.
          //
          // This whole block used to be guarded by `path !== this.activeFile`.
          // The guard exists for the SINGLE-WRITER invariant, which is about the
          // DISK: the active file's copy on disk belongs to the editor/yCollab
          // and background-sync must never write it. Seeding runs in the other
          // direction — disk → CRDT — and `activateForFile`'s host arm already
          // does exactly that from the editor buffer, so it was never what the
          // guard was protecting.
          //
          // A note created DURING a session is, in Obsidian, the ACTIVE FILE the
          // instant it exists, so this is the branch that decides every
          // mid-session file. Session-start files never met it: `startAll` runs
          // before `onActiveFileChange`, so `activeFile` is null there and every
          // one of them IS seeded. That asymmetry — not the file's birth time —
          // is why a Leave/Start/Join cycle "fixes" the same file.
          //
          // The consequence of not seeding is not a slow sync, it is NO sync:
          // the document stays empty on every peer while the file has bytes on
          // every peer's disk, the guest arm's write of "" is (correctly)
          // refused by the S119 floor, and each peer then edits its own copy.
          const isActive = path === this.activeFile;
          if (remoteContent.length === 0) {
            // S129 AC3's evidence, applied to the newly-reachable case. A doc
            // that HELD content and no longer does was emptied by somebody; for
            // the active file the user has that note open, so re-seeding it from
            // disk would resurrect their deletion under their cursor. The
            // non-active case is byte-unchanged, deliberately: widening a
            // pre-existing branch is not this package's to do silently.
            if (!isActive || !yTextHeldContent(docHandle.text)) {
              // No remote content yet - host seeds the Y.Text
              applyMinimalYTextUpdate(docHandle.doc, docHandle.text, content);
              this.lastWrittenContent.set(path, content);
            }
          } else if (isActive) {
            // THE SINGLE-WRITER INVARIANT, unchanged and now explicit: the two
            // branches below both settle the file's DISK copy, and neither may
            // run for the file the editor owns.
          } else if (remoteContent !== content) {
            // Remote has content (from guests or prior sync) - write remote to disk instead
            await this.writeToDisk(path, remoteContent);
          } else {
            this.lastWrittenContent.set(path, content);
          }
        }
      } else if (this.role === "guest") {
        // Wait for the host to seed the Y.Text if it is empty. S147 — this was
        // twenty 100 ms hops; it is now the SAME 2 s budget expressed as a
        // deadline and raced against the arrival itself. See `awaitSeed`.
        //
        // ...and it is not entered at all when the question has already been
        // ANSWERED. `S128` named the two reasons a sync resolves, and this is
        // the first consumer that needs the distinction for a WAIT rather than
        // for a write:
        //   ├── PEER_STATE — a peer replied and its state was applied above. An
        //   │     empty text after that is the peer's actual content, not an
        //   │     absence in flight. Waiting 2 s changes nothing, and it is
        //   │     exactly the wait a vault full of empty notes pays once per
        //   │     note, per pass, multiplied by the clamp.
        //   └── NO_PEERS / ALREADY_SYNCED — nobody answered, so this really is
        //         a document that may still be seeded a moment from now
        //         (`S131`'s race). Wait, on the event, bounded by the deadline.
        // Unknown resolves to the waiting branch: a wait never destroys.
        if (docHandle.text.length === 0 && resolution !== SYNC_RESOLUTION.PEER_STATE) {
          await this.awaitSeed(path, docHandle, SEED_WAIT_BUDGET_MS);
          if (this.cancelledSubscribes.has(path)) return;
          if (docHandle.doc.isDestroyed) return;
        }
        const file = getFileByPath(this.vault, diskPath);
        const remoteContent = docHandle.text.toString();
        this.noteIfNonEmpty(path, remoteContent);
        const localContent = file ? normalizeLineEndings(await this.vault.read(file)) : "";
        if (remoteContent !== localContent) {
          await this.writeToDisk(path, remoteContent);
        } else {
          this.lastWrittenContent.set(path, localContent);
        }
      }

    } finally {
      this.subscribing.delete(path);
      // S147 — the observer now goes on BEFORE the arms above, so every exit
      // from this function — including the four early `return`s inside them —
      // has to answer for it. A DELIBERATE cancellation must leave nothing
      // behind: this is the single place that undoes the attach, so no exit can
      // forget. It detaches only; it does not flush, because a cancelled
      // subscribe has no business writing anything to disk.
      if (this.cancelledSubscribes.has(path)) this.detachObserver(path);
      this.cancelledSubscribes.delete(path);
      this.seedWaiters.delete(path);
    }
  }

  unsubscribe(rawPath: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    this.flushWrite(path);
    this.detachObserver(path);
  }

  /** Detach this path's `Y.Text` observer, if one is installed. Writes nothing. */
  private detachObserver(path: string): void {
    const unobserve = this.observers.get(path);
    if (unobserve) {
      unobserve();
      this.observers.delete(path);
    }
  }

  /**
   * S147 — WAIT FOR THE HOST'S SEED ON THE EVENT, BOUNDED BY AN ABSOLUTE
   * DEADLINE. The three rules the charter sets, in one function:
   *
   *   ├── EVENT-DRIVEN where an event exists. The seed arrives as a mux frame
   *   │     and lands as a `Y.Text` change. Chromium does not throttle socket
   *   │     delivery, so this path is unaffected by the clamp — in the ordinary
   *   │     case no timer is consulted at all.
   *   ├── DEADLINE-BASED, not duration-based, where a wait is unavoidable. The
   *   │     budget is an absolute instant compared against the wall clock, and
   *   │     the timer merely re-asks. A clamped fire cannot make the wait
   *   │     longer than one hop past the deadline; an early fire re-arms for
   *   │     the remainder rather than falling through.
   *   └── ONE timer, never a hop count. A count multiplies by the clamp, and
   *         the clamp grows without bound the longer the window stays hidden —
   *         which is why lengthening the old loop would not have been a fix.
   *
   * Resolving is not a claim that content arrived. The caller re-reads the text
   * and every existing floor (`decideEmptyWrite`, `yTextHeldContent`) still has
   * its say, exactly as it did when this was a loop.
   */
  private awaitSeed(
    path: string,
    handle: { doc: Y.Doc; text: Y.Text },
    budgetMs: number,
  ): Promise<void> {
    if (handle.text.length > 0) return Promise.resolve();
    const deadline = Date.now() + budgetMs;
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const observer = () => {
        if (handle.text.length > 0) finish();
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        handle.text.unobserve(observer);
        const waiters = this.seedWaiters.get(path);
        if (waiters) {
          waiters.delete(finish);
          if (waiters.size === 0) this.seedWaiters.delete(path);
        }
        resolve();
      };

      let waiters = this.seedWaiters.get(path);
      if (!waiters) {
        waiters = new Set<() => void>();
        this.seedWaiters.set(path, waiters);
      }
      waiters.add(finish);
      handle.text.observe(observer);

      // Re-read AFTER registering: a seed that landed between the length check
      // above and the `observe` here would otherwise be waited for forever.
      if (handle.text.length > 0 || handle.doc.isDestroyed) {
        finish();
        return;
      }

      // ONE timer, armed ONCE, for the WHOLE wait — that is the whole of the
      // repair's timing half. A re-arming loop was written here first and then
      // removed: under a clamp a timer can only fire LATE, never early, so the
      // re-arm branch was unreachable by any test this facility can build, and
      // `S101` is this project's own rule that a defence no test can redden is
      // worse than none. The budget is expressed against `deadline` rather than
      // as a bare duration because it must stay the cost of the WAIT, not the
      // cost of each hop of it.
      timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
    });
  }

  setActiveFile(rawPath: string | null): void {
    const path = rawPath ? toCanonicalPath(normalizePath(rawPath)) : null;
    const oldActive = this.activeFile;
    this.activeFile = path;

    if (oldActive && oldActive !== path) {
      // WP27 AC4 — one of the two unguarded bare-path `getDoc` sites (R5).
      //
      // `oldActive` is a VAULT PATH. Handing it to `getDoc` creates a raw
      // `Y.Text` document under that path for anything CanvasSync owns, and the
      // block below then flushes that (empty) text straight over the user's
      // `.canvas` file and republishes the result to the manifest.
      //
      // WP27 also defuses this STRUCTURALLY — a canvas doc is now
      // `__canvas__:<guid>`, which collides with no path — but a structural
      // defence plus an explicit guard is the ask, not either one alone
      // (charter AC4: "verified by an explicit test rather than by a
      // reachability argument"). The guard is what a test can point at.
      //
      // Placed BEFORE the `getDoc`, never after: the damage is the CALL, which
      // creates the document. `skipsAutoTextSync` is the shared predicate
      // (`utils.ts`) and covers `.canvas` plus the sidecar directory; this
      // module has twice grown a private `endsWith(".canvas")` copy and must
      // not grow a third.
      if (skipsAutoTextSync(oldActive)) return;
      const docHandle = this.syncManager.getDoc(oldActive);
      if (docHandle) {
        const content = docHandle.text.toString();
        void this.writeToDisk(oldActive, content, this.currentSeq(oldActive));
        if (this.role === "host") {
          const file = getFileByPath(this.vault, toLocalPath(oldActive));
          if (file) void this.manifestManager.updateFile(file, content);
        }
      }
    }
  }

  setCollabBoundFile(path: string | null): void {
    this.collabBoundFile = path;
  }

  /**
   * S134 AC3 — readable so a failed bind can clear the flag it set, and only if
   * it is still the one it set. Read-only; nothing here decides anything.
   */
  getCollabBoundFile(): string | null {
    return this.collabBoundFile;
  }

  async onFileAdded(rawPath: string): Promise<void> {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (!isTextFile(path)) return;
    // US5 AC1 — CREATE entry point. A canvas created mid-session must not get a
    // raw `Y.Text` doc alongside CanvasSync's structured one. See
    // `skipsAutoTextSync`. Guarded here, not in the three callers.
    if (skipsAutoTextSync(path)) return;
    await this.subscribe(path);
  }

  onFileRemoved(rawPath: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    const timer = this.writeTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      this.writeTimers.delete(path);
    }
    this.writeFirstScheduled.delete(path);
    this.remoteSeq.delete(path);
    this.detachObserver(path);
    // S147 — the document is about to be destroyed, so anything waiting for it
    // to be seeded is waiting for an event that can no longer happen. Ending
    // the wait here rather than letting a clamped deadline expire is the same
    // rule as `cancelSubscribe`: a wait ends on the fact, not on the clock.
    this.wakeSeedWaiters(path);
    this.syncManager.releaseDoc(path);
  }

  async onFileRenamed(oldPath: string, newPath: string): Promise<void> {
    const normOld = toCanonicalPath(normalizePath(oldPath));
    const normNew = toCanonicalPath(normalizePath(newPath));

    const timer = this.writeTimers.get(normOld);
    if (timer) {
      clearTimeout(timer);
      this.writeTimers.delete(normOld);
    }
    this.writeFirstScheduled.delete(normOld);
    this.remoteSeq.delete(normOld);
    this.detachObserver(normOld);
    // S147 — same reason as `onFileRemoved`: the old path's document is going
    // away, so nothing may still be parked waiting for it to be seeded.
    this.wakeSeedWaiters(normOld);
    this.syncManager.releaseDoc(normOld);

    if (this.activeFile === normOld) {
      this.activeFile = normNew;
    }

    if (!isPathSafe(normNew)) return;
    if (!isTextFile(normNew)) return;
    // US5 AC1 — RENAME entry point, and the one that is NOT role-gated by its
    // caller, so every peer observing an unmuted rename would otherwise create
    // the doc. Deliberately placed AFTER the old path's teardown above (timers,
    // remoteSeq, observer, releaseDoc) so a rename AWAY from a synced text file
    // still tears down cleanly, and BEFORE `getDoc(normNew)` so no `Y.Text`
    // document is ever created for the canvas. Note that this method does not
    // route through `subscribe()` — it acquires its own doc below — so it needs
    // its own guard. See `skipsAutoTextSync`.
    if (skipsAutoTextSync(normNew)) return;

    const docHandle = this.syncManager.getDoc(normNew);
    if (!docHandle) return;

    this.subscribing.add(normNew);
    try {
      try {
        await this.syncManager.waitForSync(normNew);
      } catch {
        return;
      }

      if (this.observers.has(normNew)) return;
      if (docHandle.doc.isDestroyed) return;

      const diskNew = toLocalPath(normNew);
      if (this.role === "host") {
        const file = getFileByPath(this.vault, diskNew);
        if (file) {
          const content = normalizeLineEndings(await this.vault.read(file));
          applyMinimalYTextUpdate(docHandle.doc, docHandle.text, content);
        }
      } else if (docHandle.text.length > 0) {
        const file = getFileByPath(this.vault, diskNew);
        const remoteContent = docHandle.text.toString();
        const localContent = file ? normalizeLineEndings(await this.vault.read(file)) : "";
        if (remoteContent !== localContent) {
          await this.writeToDisk(normNew, remoteContent);
        }
      }

      this.attachObserver(normNew, docHandle.text);
    } finally {
      this.subscribing.delete(normNew);
    }
  }

  async handleLocalTextModify(rawPath: string): Promise<void> {
    const path = toCanonicalPath(normalizePath(rawPath));
    // WP26 AC2 — the MODIFY verb, and the WIDEST of the doors: this method has
    // no `isTextFile` pre-filter, so a `.yhistory` or `.ycheckpoint` write would
    // otherwise reach `getDoc` and seed a shared `Y.Text` from local replica
    // state. Guarded with `isSidecarPath` and NOT with `skipsAutoTextSync`:
    // `vault-events.ts` deliberately routes a `.canvas` that CanvasSync does not
    // own into here (the local-edit half of the announced R10 text fallback), so
    // the canvas predicate would silently make that fallback read-only.
    if (isSidecarPath(path)) return;
    if (this.recentDiskWrites.has(path)) return;
    // Single-writer invariant: the active file is owned exclusively by yCollab
    // (in the CM6 editor). Gate on the active-file identity in addition to the
    // racy collabBoundFile so background-sync never diffs/echoes a disk-only
    // edit (e.g. a Properties-UI frontmatter write) that yCollab is also
    // applying, regardless of activation timing.
    if (path === this.activeFile) return;
    if (path === this.collabBoundFile) return;

    const docHandle = this.syncManager.getDoc(path);
    if (!docHandle) return;

    const file = getFileByPath(this.vault, toLocalPath(path));
    if (!file) return;

    // Read disk then apply against a FRESH Y.Text snapshot. applyMinimalYTextUpdate
    // recomputes its diff base from text.toString() with no interleaving await, so
    // the base cannot go stale between the read and the transaction.
    const localContent = normalizeLineEndings(await this.vault.read(file));
    if (localContent === docHandle.text.toString()) return;

    applyMinimalYTextUpdate(docHandle.doc, docHandle.text, localContent);

    if (this.role === "host") {
      await this.manifestManager.updateFile(file, localContent);
    }
  }

  isRecentDiskWrite(rawPath: string): boolean {
    return this.recentDiskWrites.has(toCanonicalPath(normalizePath(rawPath)));
  }

  destroy(): void {
    this.running = false;
    // Flush all pending debounced writes before clearing
    for (const path of [...this.writeTimers.keys()]) {
      this.flushWrite(path);
    }
    this.writeFirstScheduled.clear();
    // S147 — release every parked seed wait BEFORE tearing the observers down,
    // so a teardown never leaves a `subscribe()` suspended on a clamped timer
    // holding the caller's loop open. The waiters re-check their own state.
    for (const path of [...this.seedWaiters.keys()]) this.wakeSeedWaiters(path);
    this.seedWaiters.clear();
    for (const [, unobserve] of this.observers) {
      unobserve();
    }
    this.observers.clear();
    this.cancelledSubscribes.clear();
    this.activeFile = null;
    this.collabBoundFile = null;
    this.recentDiskWrites.clear();
    this.lastWrittenContent.clear();
    this.remoteSeq.clear();
    // S119 — the evidence describes ONE session. Carrying it forward would let
    // a document that held content in a previous session vouch for an empty
    // write in the next one, before anything has arrived.
    this.observedNonEmpty.clear();
  }

  private currentSeq(path: string): number {
    return this.remoteSeq.get(path) ?? 0;
  }

  /**
   * S119 — remember that this document has held content. See
   * {@link observedNonEmpty}. Called wherever the doc's text is read, so the
   * evidence is gathered on the same reads the writer already performs and
   * costs nothing extra.
   */
  private noteIfNonEmpty(path: string, content: string): void {
    if (content.length > 0) this.observedNonEmpty.add(path);
  }

  private attachObserver(path: string, text: Y.Text): void {
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.local) return;
      // A remote delta was just integrated into this doc's Y.Text. Advance the
      // per-file sequence so any flush snapshotted before this point yields
      // instead of overwriting the delta on disk. Bump BEFORE the active/collab
      // gate returns: even the active file's version must advance so a queued
      // background flush for it cannot clobber the remote change.
      this.remoteSeq.set(path, this.currentSeq(path) + 1);
      // S119 — the evidence is recorded on EVERY remote delta, including the
      // ones for the active file that return below. A user emptying a note they
      // have open must still be able to empty it on every peer.
      this.noteIfNonEmpty(path, text.toString());
      // The active file is persisted by the editor / yCollab, never by
      // background-sync. Gate on active-file identity as well as collabBoundFile
      // so the currently-active file is never disk-echoed during the activation
      // race window.
      if (path === this.activeFile) return;
      if (path === this.collabBoundFile) return;
      this.scheduleDiskWrite(path, text);
    };
    text.observe(observer);
    this.observers.set(path, () => text.unobserve(observer));
  }

  private flushWrite(path: string): void {
    const timer = this.writeTimers.get(path);
    if (!timer) return;
    clearTimeout(timer);
    this.writeTimers.delete(path);
    this.writeFirstScheduled.delete(path);
    const docHandle = this.syncManager.getDoc(path);
    if (docHandle) {
      void this.writeToDisk(path, docHandle.text.toString(), this.currentSeq(path));
    }
  }

  private scheduleDiskWrite(path: string, text: Y.Text): void {
    const now = Date.now();
    let firstAt = this.writeFirstScheduled.get(path);
    if (firstAt === undefined) {
      firstAt = now;
      this.writeFirstScheduled.set(path, now);
    }
    const existing = this.writeTimers.get(path);
    if (existing) clearTimeout(existing);
    // Trailing debounce, but capped by MAX_WAIT_MS since the first pending
    // update so a continuous stream still flushes at least every ~500 ms.
    const remainingCap = MAX_WAIT_MS - (now - firstAt);
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, remainingCap));
    this.writeTimers.set(
      path,
      setTimeout(() => {
        this.writeTimers.delete(path);
        this.writeFirstScheduled.delete(path);
        // Snapshot content and sequence together (no interleaving await) so the
        // gate in doWriteToDisk can detect a remote delta arriving afterwards.
        void this.writeToDisk(path, text.toString(), this.currentSeq(path));
      }, delay),
    );
  }

  private writeToDisk(path: string, content: string, expectedSeq?: number): Promise<void> {
    // Final defense-in-depth gate: every disk write funnels through here.
    if (!isPathSafe(path)) return Promise.resolve();
    // WP95 — the DOC-DRIVEN arm. `path` here is a Y.Doc key, and doc keys are
    // acquired from peer-published manifest keys (`syncFromManifest`) and from
    // inbound file-op paths (`onFileAdded` / `onFileRenamed`, called from the
    // `afterApply` callback in `sync/control-handlers.ts`). So a peer chooses
    // this path, and `isPathSafe` — a vault-ESCAPE test — is the only thing that
    // was asked about it. The write below is `vault.adapter.write`, which goes
    // straight past the `Vault` API's own notions entirely.
    //
    // No legitimate write is lost: `skipsAutoTextSync` already keeps sidecar and
    // canvas paths out of this writer, and nothing under a protected root is a
    // shared text document.
    if (isProtectedPath(path)) {
      // S137 (B2) — the SIBLING refusal, and it had the same defect: counted,
      // never said. Four of the seven protected-path arms already emit the
      // shared line; the three that did not were exactly the three modules that
      // held no logger. Same emitter, same wording, no private idiom.
      noteProtectedRefusal("doc-write", path);
      this.logger?.warn("file-op", protectedRefusalMessage("doc-write", path));
      return Promise.resolve();
    }
    if (this.lastWrittenContent.get(path) === content) return Promise.resolve();
    this.writeQueue = this.writeQueue.then(() => this.doWriteToDisk(path, content, expectedSeq));
    return this.writeQueue;
  }

  private async doWriteToDisk(
    path: string,
    content: string,
    expectedSeq?: number,
  ): Promise<void> {
    if (this.lastWrittenContent.get(path) === content) return;
    // Version/sequence gate (US5 AC1): if a remote delta was applied to this
    // doc's Y.Text after this flush snapshotted its content, the snapshot is
    // stale. Writing it would overwrite the in-flight remote change on disk.
    // Yield — the observer that integrated the remote delta scheduled its own
    // flush of the newer content. Checked here (before the async read) and again
    // just before the write so a delta arriving during the read still wins.
    // Use strict "advanced" (>) not "!=": the sequence is monotonic per file, so
    // only a genuine newer remote delta raises it above the snapshot. A reset
    // (e.g. destroy() clearing the map) drops it to 0 and must NOT be read as
    // staleness — the flushed content is still the latest Y.Text at that point.
    if (expectedSeq !== undefined && this.currentSeq(path) > expectedSeq) return;
    const diskPath = toLocalPath(path);
    this.recentDiskWrites.add(path);
    this.fileOpsManager.mutePathEvents(diskPath);
    try {
      const file = getFileByPath(this.vault, diskPath);
      if (file) {
        const existing = normalizeLineEndings(await this.vault.read(file));
        if (existing === content) {
          this.lastWrittenContent.set(path, content);
          return;
        }
        // S119 — THE FLOOR, on the amplifying arm.
        //
        // Four gates already stood here — `lastWrittenContent`, the `remoteSeq`
        // staleness check, `isPathSafe` and `isProtectedPath` — and not one of
        // them looked at whether `content` was empty while the target was not.
        // So a single empty document propagated as a CRDT delete-all and every
        // peer flushed `""` over its own copy within half a second.
        //
        // S126 — THE EVIDENCE, CORRECTED. This shipped as
        // `this.observedNonEmpty.has(path)`: "has THIS PEER seen this document
        // hold content in this session". That is a fact about local
        // observation, and it refused a LEGITIMATE select-all-and-delete on
        // every peer that happened to have the note closed — the deletion never
        // arrived, and the peer kept its stale bytes indefinitely.
        //
        // "Did somebody delete this content" is a property of the DOCUMENT, and
        // CRDTs replicate it. A `Y.Text` that held characters and had them
        // removed carries TOMBSTONES; one that never held anything does not.
        // Every peer has them, opened or not, and they survive gc, v2 encoding
        // and repeated compaction (measured — see `ytext-history.ts`).
        //
        // The session-local set is KEPT as a second, weaker witness rather than
        // deleted: it is true in strictly fewer cases than the tombstone probe,
        // so OR-ing it cannot admit a write the probe would refuse, and it
        // still answers if a future Yjs makes the probe unavailable.
        const docText = this.syncManager.getDoc(path)?.text ?? null;
        const verdict = decideEmptyWrite({
          incoming: content,
          existing,
          intentional: yTextHeldContent(docText) || this.observedNonEmpty.has(path),
          evidenceLabel: "whether this document ever held content (CRDT tombstones)",
        });
        if (verdict.decision !== EMPTY_WRITE_DECISION.ALLOW) {
          // S137 — counted, LOGGED with the path and the arm, and still said on
          // the console. One shared emitter; this arm has no private wording.
          noteEmptyWriteRefusal("doc-write", path, verdict.reason, this.logger);
          return;
        }
      }
      // Re-check the sequence: a remote delta may have been integrated while we
      // awaited the disk read above. Yield rather than clobber it.
      if (expectedSeq !== undefined && this.currentSeq(path) > expectedSeq) return;
      const parentDir = diskPath.substring(0, diskPath.lastIndexOf("/"));
      if (parentDir) await ensureFolder(this.vault, parentDir);
      await this.vault.adapter.write(diskPath, content);
      this.lastWrittenContent.set(path, content);
    } catch {
      new Notice(`Live Share: failed to write ${diskPath}`);
    } finally {
      setTimeout(() => {
        this.recentDiskWrites.delete(path);
        this.fileOpsManager.unmutePathEvents(diskPath);
      }, VAULT_EVENT_SETTLE_MS);
    }
  }
}
