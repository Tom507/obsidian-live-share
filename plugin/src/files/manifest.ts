import { Notice, type TFile, TFolder, type Vault } from "obsidian";
import type * as Y from "yjs";

import type { DocHandle, SyncManager } from "../sync/sync";
import type { LiveShareSettings } from "../types";
import {
  VAULT_EVENT_SETTLE_MS,
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
import type { ExclusionManager } from "./exclusion";

export interface FileEntry {
  hash: string;
  size: number;
  mtime: number;
  binary?: boolean;
  directory?: boolean;
  /**
   * WP27 — the `path -> guid` half of AC1.
   *
   * An ATTRIBUTE of the path's entry, never a second keyspace: the manifest
   * stays keyed by canonical path, and `renameFile` (which re-keys the whole
   * entry object) therefore carries the guid with it for free.
   */
  guid?: string;
}

async function hashBuffer(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hashContent(content: string): Promise<string> {
  return hashBuffer(new TextEncoder().encode(content).buffer);
}

/** WP27 — carry an existing entry's guid onto a freshly rebuilt one. */
function carryGuid(next: FileEntry, previous: FileEntry | undefined): FileEntry {
  return previous?.guid ? { ...next, guid: previous.guid } : next;
}

export class ManifestManager {
  private syncManager: SyncManager | null = null;
  private docHandle: DocHandle | null = null;
  private manifest: Y.Map<FileEntry> | null = null;
  private observer: ((events: Y.YMapEvent<FileEntry>) => void) | null = null;

  private exclusionManager: ExclusionManager | null = null;

  constructor(
    private vault: Vault,
    private settings: LiveShareSettings,
  ) {}

  setExclusionManager(manager: ExclusionManager) {
    this.exclusionManager = manager;
  }

  updateSettings(settings: LiveShareSettings) {
    this.settings = settings;
  }

  async connect(syncManager: SyncManager): Promise<void> {
    this.syncManager = syncManager;
    this.docHandle = syncManager.getDoc("__manifest__");
    if (!this.docHandle) return;
    this.manifest = this.docHandle.doc.getMap("files");
    await syncManager.waitForSync("__manifest__");
  }

  async publishManifest(options?: { purge?: boolean }): Promise<void> {
    if (!this.manifest || !this.docHandle) return;

    const files = this.getSharedFiles();

    const entries = new Map<string, FileEntry>();
    for (const file of files) {
      try {
        const binary = !isTextFile(file.path);
        const canonicalPath = toCanonicalPath(normalizePath(file.path));
        if (binary) {
          const binaryContent = await this.vault.readBinary(file);
          entries.set(canonicalPath, {
            hash: await hashBuffer(binaryContent),
            size: file.stat.size,
            mtime: file.stat.mtime,
            binary: true,
          });
        } else {
          const content = normalizeLineEndings(await this.vault.read(file));
          entries.set(canonicalPath, {
            hash: await hashContent(content),
            size: content.length,
            mtime: file.stat.mtime,
          });
        }
      } catch {
        new Notice(`Live Share: failed to read ${file.path}, skipping`);
      }
    }

    for (const item of this.vault.getAllLoadedFiles()) {
      if (!(item instanceof TFolder)) continue;
      if (!item.path || item.path === "/") continue;
      if (!this.isSharedPath(item.path)) continue;
      if (item.children.length > 0) continue;
      entries.set(toCanonicalPath(normalizePath(item.path)), {
        hash: "",
        size: 0,
        mtime: 0,
        directory: true,
      });
    }

    this.docHandle.doc.transact(() => {
      if (options?.purge) {
        for (const filePath of this.manifest?.keys() ?? []) {
          if (!entries.has(filePath)) {
            this.manifest?.delete(filePath);
          }
        }
      }
      for (const [filePath, fileEntry] of entries) {
        const existing = this.manifest?.get(filePath);
        if (existing && existing.hash === fileEntry.hash) continue;
        // WP27: the guid is IDENTITY, not content. Every writer here rebuilds
        // the entry from what it just read off disk, so the mapping has to be
        // carried across explicitly or a single content republish would strand
        // every peer that resolves this path through the manifest.
        this.manifest?.set(filePath, carryGuid(fileEntry, existing));
      }
    });
  }

  async syncFromManifest(
    mute?: (path: string) => void,
    unmute?: (path: string) => void,
    requestBinary?: (path: string) => void,
    options?: { skipText?: boolean },
  ): Promise<number> {
    if (!this.manifest || !this.syncManager) return 0;

    let synced = 0;
    const entries = Array.from(this.manifest.entries());

    for (const [path, entry] of entries) {
      if (!isPathSafe(path)) continue;
      // WP26 AC1+AC2 — a sidecar entry can only get here because some OTHER
      // client published it (a legacy peer, or a hostile one); nothing local
      // ever adds one, because `isSharedPath` below refuses it. Placed at the
      // TOP of the loop, ahead of everything, because the `.canvas` skip further
      // down covers exactly one of the three branches: the directory branch runs
      // BEFORE it, and its `!entry.binary &&` prefix lets a binary entry past —
      // and `.yhistory` / `.ycheckpoint` are not text extensions, so a published
      // sidecar file is marked binary by `publishManifest`, which makes that the
      // likely leak rather than a corner case. Unconditional, in particular NOT
      // gated on `skipText`: only one of the six call sites passes that option.
      if (isSidecarPath(path)) continue;

      const diskPath = toLocalPath(path);
      if (entry.directory) {
        // Only create directories during initial sync, not during live changes
        // (live folder creation is handled by ensureFolder when files are synced)
        if (!options?.skipText) {
          const existing = this.vault.getAbstractFileByPath(diskPath);
          if (!existing) {
            await ensureFolder(this.vault, diskPath);
            synced++;
          }
        }
        continue;
      }

      if (options?.skipText && !entry.binary && isTextFile(path)) continue;

      // WP6 / US5 AC1 — the FOURTH entry point (F5/F6). The text branch below
      // materialises a file from its bare-path `Y.Text`, but nothing populates
      // that doc for a `.canvas` any more: `startAll`, `onFileAdded` and
      // `onFileRenamed` all skip it, so `tempHandle.text.toString()` is `""` and
      // the write below would create or overwrite the user's canvas EMPTY.
      //
      // Unconditional, NOT gated on `skipText`: only one of the six
      // `syncFromManifest` call sites in `main.ts` passes it, and the other five
      // are join / resume / reconnect / reload-from-host. Gating per-caller would
      // also stop markdown syncing on join, which IS load-bearing — the skip
      // belongs to the canvas extension, not the caller.
      //
      // A canvas's initial file materialisation is `CanvasPersistence.coldOpen`'s
      // job. The R10 text-fallback case self-materialises inside
      // `BackgroundSync.subscribe` (its guest branch waits for the host seed and
      // writes to disk itself), so nothing depends on this branch for a canvas.
      if (!entry.binary && skipsAutoTextSync(path)) continue;

      const localFile = getFileByPath(this.vault, diskPath);

      let needsSync = false;
      if (!localFile) {
        needsSync = true;
      } else if (entry.binary) {
        const binaryContent = await this.vault.readBinary(localFile);
        if ((await hashBuffer(binaryContent)) !== entry.hash) {
          needsSync = true;
        }
      } else {
        const content = normalizeLineEndings(await this.vault.read(localFile));
        if ((await hashContent(content)) !== entry.hash) {
          needsSync = true;
        }
      }

      if (!needsSync) continue;

      if (entry.binary) {
        requestBinary?.(path);
        synced++;
        continue;
      }

      const tempHandle = this.syncManager.getDoc(path);
      if (!tempHandle) continue;

      try {
        await this.syncManager.waitForSync(path);

        const content = tempHandle.text.toString();

        const parentDir = diskPath.substring(0, diskPath.lastIndexOf("/"));
        if (parentDir) await ensureFolder(this.vault, parentDir);

        mute?.(diskPath);
        try {
          if (localFile) {
            await this.vault.modify(localFile, content);
          } else {
            await this.vault.create(diskPath, content);
          }
        } finally {
          if (unmute) {
            setTimeout(() => unmute(diskPath), VAULT_EVENT_SETTLE_MS);
          }
        }
        synced++;
      } catch {
        // Failed to sync individual file, continue with rest
      }
    }

    return synced;
  }

  setManifestChangeHandler(
    callback: (added: string[], removed: string[], updated: string[]) => void,
  ): void {
    if (!this.manifest) return;

    if (this.observer && this.manifest) {
      this.manifest.unobserve(this.observer);
    }

    this.observer = (event: Y.YMapEvent<FileEntry>) => {
      const added: string[] = [];
      const removed: string[] = [];
      const updated: string[] = [];
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add") added.push(key);
        else if (change.action === "delete") removed.push(key);
        else if (change.action === "update") updated.push(key);
      });
      if (added.length > 0 || removed.length > 0 || updated.length > 0) {
        callback(added, removed, updated);
      }
    };
    this.manifest.observe(this.observer);
  }

  async updateFile(file: TFile, content: string | ArrayBuffer): Promise<void> {
    if (!this.manifest || !this.isSharedPath(file.path)) return;
    const canonical = toCanonicalPath(normalizePath(file.path));
    // Remove parent folder entry if it exists - folder is no longer empty
    const parentDir = canonical.substring(0, canonical.lastIndexOf("/"));
    if (parentDir && this.manifest.has(parentDir)) {
      const parentEntry = this.manifest.get(parentDir);
      if (parentEntry?.directory) {
        this.manifest.delete(parentDir);
      }
    }
    const previous = this.manifest.get(canonical);
    if (content instanceof ArrayBuffer) {
      this.manifest.set(
        canonical,
        carryGuid(
          {
            hash: await hashBuffer(content),
            size: content.byteLength,
            mtime: file.stat.mtime,
            binary: true,
          },
          previous,
        ),
      );
    } else {
      const normalized = normalizeLineEndings(content);
      this.manifest.set(
        canonical,
        carryGuid(
          {
            hash: await hashContent(normalized),
            size: normalized.length,
            mtime: file.stat.mtime,
          },
          previous,
        ),
      );
    }
  }

  /**
   * WP27 AC1 — publish the `path -> guid` mapping for a canvas.
   *
   * Creates a MINIMAL entry when the path has none yet: the mapping has to be
   * publishable before the file's content ever reaches `publishManifest`, and a
   * zero-hash placeholder is replaced by the first real content write (which
   * carries the guid across through {@link carryGuid}).
   *
   * A BLANK guid CLEARS the mapping instead of storing one. That is the one
   * spelling `CanvasIdentityStore.unbind` has available — its dependency is
   * `Pick<ManifestManager, "getCanvasGuid" | "setCanvasGuid">` (WP27 §7.0) — and
   * an empty guid is not an identity in any case: `canvasDocId` refuses it.
   * Clearing leaves the entry itself alone; a rename must not delete the old
   * path's content entry, only its claim on the identity.
   */
  setCanvasGuid(rawPath: string, guid: string): void {
    if (!this.manifest || !this.docHandle) return;
    const canonical = toCanonicalPath(normalizePath(rawPath));
    const usable = typeof guid === "string" && guid.trim().length > 0;
    const existing = this.manifest.get(canonical);
    if (!usable) {
      if (!existing?.guid) return;
      const { guid: _dropped, ...rest } = existing;
      this.manifest.set(canonical, rest);
      return;
    }
    if (existing?.guid === guid) return;
    this.manifest.set(
      canonical,
      existing
        ? { ...existing, guid }
        : { hash: "", size: 0, mtime: 0, guid },
    );
  }

  /** WP27 AC1 — the `path -> guid` lookup. `null` when the path has no mapping. */
  getCanvasGuid(rawPath: string): string | null {
    if (!this.manifest) return null;
    const entry = this.manifest.get(toCanonicalPath(normalizePath(rawPath)));
    const guid = entry?.guid;
    return typeof guid === "string" && guid.trim().length > 0 ? guid : null;
  }

  removeFile(path: string): void {
    if (!this.manifest) return;
    this.manifest.delete(toCanonicalPath(normalizePath(path)));
  }

  addFolder(rawPath: string): void {
    if (!this.manifest || !this.isSharedPath(rawPath)) return;
    const path = toCanonicalPath(normalizePath(rawPath));
    if (this.manifest.has(path)) return;
    this.manifest.set(path, { hash: "", size: 0, mtime: 0, directory: true });
  }

  renameFile(oldPath: string, newPath: string, syncManager?: SyncManager): void {
    if (!this.manifest || !this.docHandle) return;
    const normOld = toCanonicalPath(normalizePath(oldPath));
    const normNew = toCanonicalPath(normalizePath(newPath));
    const fileEntry = this.manifest.get(normOld);
    if (fileEntry) {
      // WP26 AC1 — the one manifest WRITER that does not consult `isSharedPath`.
      // Guarding the membership predicate constrains every writer that ASKS it
      // (`publishManifest` via `getSharedFiles`, `updateFile`, `addFolder`); this
      // method asks nothing and re-keys an existing entry directly, so it needs
      // its own guard. It is reachable: `vault-events.ts`'s rename handler admits
      // the event when EITHER side is shared, so moving an ordinary shared note
      // into the sidecar directory arrives here with a shared `normOld` and a
      // sidecar `normNew`, and would publish the entry under the sidecar key.
      //
      // Destination only, exactly like `BackgroundSync.onFileRenamed` guards
      // `normNew` alone: the delete and the `releaseDoc` below must still happen,
      // because a file moved INTO the sidecar directory has left the shared tree
      // and its old key must go with it. Guarding `normOld` as well would instead
      // strand the stale entry forever, and would block the legitimate reverse
      // direction (a file recovered OUT of the sidecar directory is an ordinary
      // note again — there is no entry under a sidecar key to move, so that case
      // falls out of `manifest.get(normOld)` returning undefined on its own).
      const admitsDestination = !isSidecarPath(normNew);
      this.docHandle.doc.transact(() => {
        this.manifest?.delete(normOld);
        if (admitsDestination) this.manifest?.set(normNew, fileEntry);
      });
    }
    if (syncManager) {
      syncManager.releaseDoc(normOld);
    }
  }

  getEntries(): Map<string, FileEntry> {
    if (!this.manifest) return new Map();
    return new Map(this.manifest.entries());
  }

  isSharedPath(rawPath: string): boolean {
    const path = toCanonicalPath(normalizePath(rawPath));
    // WP26 AC1 — the SECOND, independent gate: manifest MEMBERSHIP. This is the
    // only thing standing between a local sidecar file and `publishManifest` /
    // `updateFile` / `addFolder`, and it is a different question from the
    // text-sync skip (which is why the guard is `isSidecarPath` and not
    // `skipsAutoTextSync` — an ordinary `.canvas` must stay shared).
    //
    // Deliberately NOT expressed as an `ExclusionManager` pattern. That gate
    // excludes the sidecar today only by COINCIDENCE: `setPatterns` prepends
    // `${configDir}/**` and the sidecar happens to live under the DEFAULT
    // config dir. Three configurations break the coincidence — no
    // `ExclusionManager` installed at all, a non-default `app.vault.configDir`
    // (the sidecar directory is a fixed literal and does not follow it), and a
    // `sharedFolder` pointing into the config directory. A pattern injected into
    // `ExclusionManager` would also be rebuilt away by the next `setPatterns`
    // call on any settings save. Owned here instead: `isExcluded` has exactly
    // one consumer (the line below), so this placement is strictly wider and
    // cannot drift.
    if (isSidecarPath(path)) return false;
    if (this.exclusionManager?.isExcluded(path)) return false;
    if (!this.settings.sharedFolder) return true;
    const folder = normalizePath(
      this.settings.sharedFolder.endsWith("/")
        ? this.settings.sharedFolder
        : `${this.settings.sharedFolder}/`,
    );
    return path.startsWith(folder) || path === normalizePath(this.settings.sharedFolder);
  }

  destroy(): void {
    if (this.observer && this.manifest) {
      this.manifest.unobserve(this.observer);
      this.observer = null;
    }
    if (this.syncManager) {
      this.syncManager.releaseDoc("__manifest__");
    }
    this.docHandle = null;
    this.manifest = null;
    this.syncManager = null;
  }

  private getSharedFiles(): TFile[] {
    return this.vault.getFiles().filter((file) => this.isSharedPath(file.path));
  }
}
