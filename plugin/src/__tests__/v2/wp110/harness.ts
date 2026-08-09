// WP110 / S135 — shared fixtures for "a local rename that never reaches the wire".
//
// TWO RIGS, and the split is the whole point of the package:
//
//   ├── LOCAL GESTURE ({@link createGestureRig}) — the REAL `registerVaultEvents`
//   │   rename/delete/create handlers, driven by calling the callbacks they
//   │   registered, over a REAL `FileOpsManager` with an injected sender. The
//   │   oracle is `sent`: what actually reached the wire.
//   └── INBOUND ({@link createReceiverRig}) — the REAL `registerControlHandlers`
//       `file-op` gate over a REAL `FileOpsManager.applyRemoteOp` and a recording
//       vault. The oracle is the vault's `bytes` map and its mutation `journal`.
//
// WHAT IS REAL AND WHAT IS NOT, stated because Method Rule 1 requires it and
// because partial doubles have cost this run four packages:
//
//   REAL — `registerVaultEvents`, `registerControlHandlers`, `FileOpsManager`
//   (construction, mutes, `onFileRename`, `onFileDelete`, `onFileCreate`,
//   `emitOp`, `applyRemoteOp`, `applyRemoteOpInner`), `ManifestManager.isSharedPath`
//   with the real `sharedFolder` setting, `toCanonicalPath`/`toLocalPath`.
//
//   DOUBLED — `BackgroundSync` and `CanvasSync`. That is deliberate and it is
//   the SUBJECT rather than a shortcut: S135's repair is about what happens when
//   one of those collaborators REJECTS, and driving the real ones would make the
//   rejection an accident of their internals rather than a controlled input.
//   The paths those doubles therefore do NOT exercise, in full: the doc
//   teardown/re-subscribe in `BackgroundSync.onFileRenamed`, `waitForSync`, the
//   host/guest seeding arms, and `CanvasSync.handleRename`'s guid re-key and
//   identity-store bind/unbind. Nothing in this suite asserts anything about
//   those; every assertion is about the file-op channel in front of them.
//
//   DOUBLED — `ManifestManager.renameFile` / `addFolder` / `removeFile`, which
//   write to a `Y.Doc` this rig does not build. No row reads them.

import { TFile, TFolder } from "obsidian";
import { vi } from "vitest";

import { FileOpsManager } from "../../../files/file-ops";
import { ManifestManager } from "../../../files/manifest";
import { registerVaultEvents } from "../../../files/vault-events";
import { DEFAULT_SETTINGS, type FileOp, type LiveShareSettings } from "../../../types";
import { createRecordingVault, createRecordingFileManager } from "../wp68/harness";

/** The share the live S135 measurement was taken in. */
export const SHARE = "_liveshare-test";
/** The subfolder the live move targeted. Named exactly as the signal records it. */
export const SUBFOLDER = `${SHARE}/w4b-sub`;

export function tfile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

export function tfolder(path: string): TFolder {
  const folder = new TFolder();
  (folder as unknown as { path: string }).path = path;
  (folder as unknown as { children: unknown[] }).children = [];
  return folder;
}

/** A real `ManifestManager` whose only job here is the real `isSharedPath`. */
export function manifestFor(sharedFolder: string): ManifestManager {
  const settings: LiveShareSettings = { ...DEFAULT_SETTINGS, sharedFolder };
  const vault = {
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => {}),
    adapter: { exists: vi.fn(async () => false) },
  };
  return new ManifestManager(vault as never, settings as never);
}

export interface GestureRigOptions {
  role?: "host" | "guest";
  /** Initial disk contents, `path -> text`. */
  initial?: Record<string, string>;
  /**
   * The `BackgroundSync.onFileRenamed` double. Reject from it to drive the S135
   * defect; the default resolves.
   */
  onFileRenamed?: (oldPath: string, newPath: string) => Promise<void>;
  /** The `CanvasSync.handleRename` double, or `null` for no `CanvasSync`. */
  handleRename?: ((oldPath: string, newPath: string) => Promise<void>) | null;
}

export interface GestureRig {
  /** Everything the injected sender was handed, in order. THE ORACLE. */
  sent: FileOp[];
  manager: FileOpsManager;
  /** `logger.warn` messages, so a contained failure is observable. */
  warnings: string[];
  /** Fire a vault `rename`, then drain the microtask queue. */
  rename(oldPath: string, newPath: string): Promise<void>;
  /** Fire a vault `delete`, then drain. */
  remove(path: string): Promise<void>;
  /** Fire a vault `create` for a FOLDER, then drain. */
  createFolder(path: string): Promise<void>;
  /** How many times the `onFileRenamed` double was entered. */
  followUpCalls(): number;
}

/**
 * The LOCAL GESTURE rig: a real `registerVaultEvents` over a real
 * `FileOpsManager`.
 *
 * `drain()` is 60 microtask turns rather than a timer. The rename handler's
 * chain is all promise-based, so this is deterministic — no wall clock is
 * consulted anywhere in this rig, which is the S85/S56 discipline.
 */
export function createGestureRig(options: GestureRigOptions = {}): GestureRig {
  const role = options.role ?? "host";
  const vault = createRecordingVault(options.initial ?? {});
  const fileManager = createRecordingFileManager(vault);
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const settings: LiveShareSettings = { ...DEFAULT_SETTINGS, sharedFolder: SHARE, role };
  const manifest = manifestFor(SHARE);
  const manager = new FileOpsManager(vault as never, fileManager as never);
  const sent: FileOp[] = [];
  manager.setSender((op) => sent.push(op));
  const warnings: string[] = [];
  let followUps = 0;

  const on = (name: string, callback: (...args: unknown[]) => void) => {
    const list = listeners.get(name) ?? [];
    list.push(callback);
    listeners.set(name, list);
    return {};
  };

  const plugin = {
    settings,
    registerEvent: () => {},
    app: {
      vault: { ...vault, on },
      workspace: { on, getActiveViewOfType: () => null },
    },
    manifestManager: {
      isSharedPath: (path: string) => manifest.isSharedPath(path),
      renameFile: vi.fn(),
      removeFile: vi.fn(),
      updateFile: vi.fn(async () => {}),
      addFolder: vi.fn(),
    },
    fileOpsManager: manager,
    backgroundSync: {
      onFileAdded: vi.fn(async () => {}),
      onFileRemoved: vi.fn(),
      onFileRenamed: vi.fn(async (oldPath: string, newPath: string) => {
        followUps += 1;
        if (options.onFileRenamed) await options.onFileRenamed(oldPath, newPath);
      }),
      cancelSubscribe: vi.fn(),
      isRecentDiskWrite: vi.fn(() => false),
    },
    canvasSync:
      options.handleRename === undefined || options.handleRename === null
        ? null
        : { handleRename: vi.fn(options.handleRename), isSubscribed: () => false },
    syncManager: {},
    logger: {
      log: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn((_category: string, message: string) => warnings.push(message)),
      error: vi.fn(),
    },
    onActiveFileChange: vi.fn(),
    presenceManager: { debouncedBroadcastPresence: vi.fn() },
  };

  registerVaultEvents(plugin as never);

  const drain = async () => {
    for (let i = 0; i < 60; i++) await Promise.resolve();
  };

  return {
    sent,
    manager,
    warnings,
    followUpCalls: () => followUps,
    async rename(oldPath: string, newPath: string) {
      for (const callback of listeners.get("rename") ?? []) callback(tfile(newPath), oldPath);
      await drain();
    },
    async remove(path: string) {
      for (const callback of listeners.get("delete") ?? []) callback(tfile(path));
      await drain();
    },
    async createFolder(path: string) {
      for (const callback of listeners.get("create") ?? []) callback(tfolder(path));
      await drain();
    },
  };
}
