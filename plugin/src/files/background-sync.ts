import { Notice, type Vault } from "obsidian";
import type * as Y from "yjs";

import type { SyncManager } from "../sync/sync";
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
import type { FileOpsManager } from "./file-ops";
import type { ManifestManager } from "./manifest";

const DEBOUNCE_MS = 300;
// Cap so a continuous incoming stream still flushes to disk at least this often,
// instead of the trailing debounce resetting on every update and starving it.
const MAX_WAIT_MS = 500;

// WP6 / US5 AC1+AC2 — the `.canvas` skip consulted by all three event-driven
// entry points below (`startAll`, `onFileAdded`, `onFileRenamed`) now lives in
// `utils.ts` beside `isTextFile`, so `manifest.ts`'s `syncFromManifest` consults
// the SAME predicate instead of growing a fourth private copy. Full rationale,
// including why `subscribe()` is deliberately NOT guarded, is on the predicate.

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

  constructor(
    private vault: Vault,
    private syncManager: SyncManager,
    private manifestManager: ManifestManager,
    private fileOpsManager: FileOpsManager,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async startAll(role: SessionRole): Promise<void> {
    this.running = true;
    this.role = role;
    const entries = this.manifestManager.getEntries();
    for (const [path, entry] of entries) {
      if (!isTextFile(path) || entry.binary) continue;
      // US5 AC2 — manifest-replay entry point. See `skipsAutoTextSync`.
      if (skipsAutoTextSync(path)) continue;
      try {
        await this.subscribe(path);
      } catch {
        new Notice(`Live Share: failed to sync ${path}`);
      }
    }
  }

  cancelSubscribe(rawPath: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (this.subscribing.has(path)) {
      this.cancelledSubscribes.add(path);
    }
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

      try {
        await this.syncManager.waitForSync(path);
      } catch {
        return;
      }

      if (this.cancelledSubscribes.has(path)) return;
      if (this.observers.has(path)) return;
      if (docHandle.doc.isDestroyed) return;

      const diskPath = toLocalPath(path);
      if (this.role === "host" && path !== this.activeFile) {
        const file = getFileByPath(this.vault, diskPath);
        if (file) {
          const content = normalizeLineEndings(await this.vault.read(file));
          if (this.cancelledSubscribes.has(path)) return;
          const remoteContent = docHandle.text.toString();
          if (remoteContent.length === 0) {
            // No remote content yet - host seeds the Y.Text
            applyMinimalYTextUpdate(docHandle.doc, docHandle.text, content);
            this.lastWrittenContent.set(path, content);
          } else if (remoteContent !== content) {
            // Remote has content (from guests or prior sync) - write remote to disk instead
            await this.writeToDisk(path, remoteContent);
          } else {
            this.lastWrittenContent.set(path, content);
          }
        }
      } else if (this.role === "guest") {
        // Wait for host to seed Y.Text if it's empty
        if (docHandle.text.length === 0) {
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (this.cancelledSubscribes.has(path)) return;
            if (docHandle.doc.isDestroyed) return;
            if (docHandle.text.length > 0) break;
          }
        }
        const file = getFileByPath(this.vault, diskPath);
        const remoteContent = docHandle.text.toString();
        const localContent = file ? normalizeLineEndings(await this.vault.read(file)) : "";
        if (remoteContent !== localContent) {
          await this.writeToDisk(path, remoteContent);
        } else {
          this.lastWrittenContent.set(path, localContent);
        }
      }

      if (this.cancelledSubscribes.has(path)) return;

      this.attachObserver(path, docHandle.text);
    } finally {
      this.subscribing.delete(path);
      this.cancelledSubscribes.delete(path);
    }
  }

  unsubscribe(rawPath: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    this.flushWrite(path);
    const unobserve = this.observers.get(path);
    if (unobserve) {
      unobserve();
      this.observers.delete(path);
    }
  }

  setActiveFile(rawPath: string | null): void {
    const path = rawPath ? toCanonicalPath(normalizePath(rawPath)) : null;
    const oldActive = this.activeFile;
    this.activeFile = path;

    if (oldActive && oldActive !== path) {
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
    const unobserve = this.observers.get(path);
    if (unobserve) {
      unobserve();
      this.observers.delete(path);
    }
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
    const unobserve = this.observers.get(normOld);
    if (unobserve) {
      unobserve();
      this.observers.delete(normOld);
    }
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
  }

  private currentSeq(path: string): number {
    return this.remoteSeq.get(path) ?? 0;
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
