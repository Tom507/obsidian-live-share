import type { EditorView } from "@codemirror/view";
import { MarkdownView, Menu, Notice, Plugin, TFile, requestUrl } from "obsidian";

import { minimatch } from "minimatch";
import { type CanvasAdapter, createCanvasAdapter } from "./canvas/canvas-adapter";
import { CanvasBinding } from "./canvas/canvas-binding";
import {
  type CanvasModelBridgeHandle,
  createCanvasModelBridge,
} from "./canvas/canvas-model-bridge";
import { CanvasOverlay, type OverlayHost } from "./canvas/canvas-overlay";
import { type AwarenessLike, CanvasPresence, resolveHolder } from "./canvas/canvas-presence";
import {
  type ApplyOutcome,
  type SurfaceStateStore,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceStateStore,
  shadowToCanvasRecords,
} from "./canvas/canvas-shadow";
import { canvasIds, planReconcile } from "./canvas/reconcile-plan";
import { DebugLogger } from "./debug-logger";
import { CollabManager } from "./editor/collab";
import { BackgroundSync } from "./files/background-sync";
import {
  type CanvasPersistence,
  attachCanvasPersistence,
  createVaultPersistenceIO,
} from "./files/canvas-persistence";
import {
  type CanvasSidecarWiring,
  createVaultSidecarIO,
  wireCanvasSidecar,
} from "./files/canvas-sidecar-lifecycle";
import { CanvasSync } from "./files/canvas-sync";

import { ExclusionManager } from "./files/exclusion";
import { FileOpsManager } from "./files/file-ops";
import { ManifestManager } from "./files/manifest";
import {
  registerVaultEvents,
  resetCanvasTextFallbackWarnings,
  subscribeCanvasWithHandover,
} from "./files/vault-events";
import { AuthManager } from "./session/auth";
import { registerCommands } from "./session/commands";
import { LOG_VIEW_TYPE, LogView } from "./session/log-view";
import { PresenceManager } from "./session/presence-manager";
import { PRESENCE_VIEW_TYPE, type PresenceUser, PresenceView } from "./session/presence-view";
import { SessionManager } from "./session/session";
import { ConnectionStateManager } from "./sync/connection-state";
import { registerControlHandlers } from "./sync/control-handlers";
import { ControlChannel } from "./sync/control-ws";
import { E2ECrypto } from "./sync/crypto";
import { SyncManager } from "./sync/sync";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "./types";

import { AuditLogModal } from "./ui/audit-modal";

import { ExplorerIndicators } from "./ui/explorer-indicators";
import { ConfirmModal, PromptModal } from "./ui/modals";
import { LiveShareSettingTab } from "./ui/settings";
import {
  VAULT_EVENT_SETTLE_MS,
  ensureFolder,
  hashBuffer,
  hashContent,
  isPathSafe,
  isTextFile,
  matchRenamesByHash,
  normalizeLineEndings,
  normalizePath,
  parseJwtPayload,
  toCanonicalPath,
  toLocalPath,
} from "./utils";

// Build-time flag injected by esbuild `define` (esbuild.config.mjs): `false` in
// the production build, `true` in dev. Guards the E2E control-server import so
// the entire `plugin/src/testing/` module is dead-code-eliminated from the
// production `main.js` (US7 AC1). Declared here so `tsc` typechecks; never
// referenced at runtime except inside the folded branch below.
declare const __LS_E2E__: boolean;

function getCmView(view: MarkdownView): EditorView | undefined {
  return (view.editor as unknown as { cm?: EditorView }).cm;
}

export default class LiveSharePlugin extends Plugin {
  settings!: LiveShareSettings;
  syncManager!: SyncManager;
  collabManager!: CollabManager;
  fileOpsManager!: FileOpsManager;
  sessionManager!: SessionManager;
  manifestManager!: ManifestManager;
  authManager!: AuthManager;
  exclusionManager!: ExclusionManager;
  backgroundSync!: BackgroundSync;
  connectionState!: ConnectionStateManager;
  logger!: DebugLogger;
  // Flag-gated E2E control-server handle (dev/test only). Always null on
  // production paths — the only assignment lives in a dead-code branch that is
  // eliminated from the production bundle. Typed inline to avoid importing from
  // the tree-shaken testing/ module.
  private testControlHandle: { close(): void } | null = null;

  canvasSync: CanvasSync | null = null;
  // WP25: the sidecar store + lifecycle + identity store, built by
  // `wireCanvasSidecar`. Held only so the periodic compaction timer can be
  // stopped at teardown.
  private canvasSidecar: CanvasSidecarWiring | null = null;
  // WP2/WP3: one presence controller per open, subscribed canvas (keyed by
  // canonical path). Owns that canvas' cursor/lock awareness + DOM overlay.
  private canvasPresences = new Map<string, CanvasPresence>();
  // WP-scatter: live Canvas adapters keyed by canonical path, so remote deltas can
  // patch the OPEN canvas view (Obsidian ignores external .canvas writes). Kept in
  // lockstep with canvasPresences (same mount/teardown sites).
  private canvasAdapters = new Map<string, CanvasAdapter>();
  // WP5 (C5 AC1): the hand-over half of the reconcile receipt — which record ids
  // the last CONFIRMED apply actually put on each surface, plus whether that view
  // is open at all. This is the only per-path canvas structure `main.ts` still
  // owns; the field-level basis is the ONE shared Surface-Shadow, obtained from
  // `CanvasSync.getSurfaceShadow()` at every use site and never cached here.
  // `path` is canonical, matching every other registry in this file.
  private surfaceState: SurfaceStateStore = createSurfaceStateStore(
    (path) => this.canvasAdapters.get(path)?.isAvailable() === true,
  );
  // Phase 2 (SPEC_04 §3): one CanvasBinding per open, subscribed canvas — ONLY
  // constructed when `settings.useCanvasBinding` is ON. Its own doc observer
  // drives the follower-apply path (applyRemote over the model bridge), replacing
  // reconcileLiveCanvas. Kept in lockstep with canvasAdapters (same mount/teardown).
  private canvasBindings = new Map<string, CanvasBinding>();
  // Phase 3 (SPEC_04 §4): the model bridge behind each binding. Held so its
  // capture subscriptions (adapter interaction hooks) are detached on teardown,
  // in lockstep with canvasBindings.
  private canvasModelBridges = new Map<string, CanvasModelBridgeHandle>();
  // WP7 (US5 AC13): the SINGLE CRDT→disk writer for each subscribed canvas path,
  // keyed by canonical path. Its lifetime tracks the CanvasSync SUBSCRIPTION, not
  // the open view — a closed canvas must still be persisted when remote deltas
  // arrive, which is the whole reason a writer exists. Torn down in
  // `teardownCanvasPresences()`, i.e. in both destroy paths.
  private canvasWriters = new Map<string, CanvasPersistence>();
  // Paths whose writer attach is in flight (the cold open is awaited), so two
  // subscribe call sites can never race a second writer onto one path.
  private canvasWriterAttaching = new Set<string>();
  explorerIndicators: ExplorerIndicators | null = null;
  controlChannel: ControlChannel | null = null;
  remoteUsers = new Map<string, PresenceUser>();
  remoteReadOnlyPatterns: string[] = [];
  presenceManager: PresenceManager | null = null;
  private connectionStateUnsub: (() => void) | null = null;
  statusBarEl!: HTMLElement;
  private isEndingSession = false;
  private isStartingSession = false;
  private currentScrollListener: (() => void) | null = null;
  muxConnected = false;
  controlConnected = false;
  private manifestHandlerQueue: Promise<void> = Promise.resolve();

  updateOnlineState() {
    const bothUp = this.muxConnected && this.controlConnected;
    this.fileOpsManager.setOnline(bothUp);
  }

  private requestBinaryFile = (path: string) => {
    this.controlChannel?.send({ type: "sync-request", path });
  };

  private mutePathEvents = (path: string) => this.fileOpsManager.mutePathEvents(path);
  private unmutePathEvents = (path: string) => this.fileOpsManager.unmutePathEvents(path);

  private registerManifestChangeHandler() {
    this.manifestManager.setManifestChangeHandler((added, removed, updated) => {
      this.manifestHandlerQueue = this.manifestHandlerQueue
        .then(async () => {
          const renamedOldPaths = new Set<string>();
          const renamedNewPaths = new Set<string>();
          if (added.length > 0 && removed.length > 0) {
            // Bug E: pair removed→added by content hash, not iteration order, so
            // concurrent renames (removed=[A,C], added=[D,B]) map A→B / C→D by
            // identity instead of A→D. The removed file still exists on local
            // disk here, so its hash is the pre-rename content hash; the added
            // entry's hash is already in the manifest.
            const removedHashes = new Map<string, string>();
            for (const oldPath of removed) {
              const oldFileForHash = this.app.vault.getAbstractFileByPath(toLocalPath(oldPath));
              if (!(oldFileForHash instanceof TFile)) continue;
              try {
                if (isTextFile(oldPath)) {
                  const content = normalizeLineEndings(await this.app.vault.read(oldFileForHash));
                  removedHashes.set(oldPath, await hashContent(content));
                } else {
                  const buf = await this.app.vault.readBinary(oldFileForHash);
                  removedHashes.set(oldPath, await hashBuffer(buf));
                }
              } catch {
                // Unreadable file — fall back to positional pairing for it.
              }
            }
            const manifestEntries = this.manifestManager.getEntries();
            const preferredNew = matchRenamesByHash(
              removed,
              added,
              (p) => removedHashes.get(p),
              (p) => manifestEntries.get(p)?.hash,
            );

            for (const oldPath of removed) {
              // Try the hash-matched target first, then fall back to the
              // original manifest order for anything left unmatched.
              const preferred = preferredNew.get(oldPath);
              const orderedAdded = preferred
                ? [preferred, ...added.filter((p) => p !== preferred)]
                : added;
              for (const newPath of orderedAdded) {
                if (renamedNewPaths.has(newPath)) continue;
                // Reject peer-supplied rename targets that would escape the vault.
                if (!isPathSafe(normalizePath(newPath))) continue;
                const localOld = toLocalPath(oldPath);
                const localNew = toLocalPath(newPath);
                const oldFile = this.app.vault.getAbstractFileByPath(localOld);
                const newFile = this.app.vault.getAbstractFileByPath(localNew);
                if (oldFile && !newFile) {
                  renamedOldPaths.add(oldPath);
                  renamedNewPaths.add(newPath);
                  this.fileOpsManager.mutePathEvents(localOld);
                  this.fileOpsManager.mutePathEvents(localNew);
                  try {
                    const parentDir = localNew.substring(0, localNew.lastIndexOf("/"));
                    if (parentDir) await ensureFolder(this.app.vault, parentDir);
                    await this.app.vault.rename(oldFile, localNew);
                  } finally {
                    setTimeout(() => {
                      this.fileOpsManager.unmutePathEvents(localOld);
                      this.fileOpsManager.unmutePathEvents(localNew);
                    }, VAULT_EVENT_SETTLE_MS);
                  }
                  if (isTextFile(oldPath)) {
                    this.backgroundSync.onFileRemoved(oldPath);
                  }
                  if (isTextFile(newPath)) {
                    await this.backgroundSync.onFileAdded(newPath);
                  }
                  break;
                }
                if (!oldFile && newFile) {
                  renamedOldPaths.add(oldPath);
                  renamedNewPaths.add(newPath);
                  if (isTextFile(oldPath)) {
                    this.backgroundSync.onFileRemoved(oldPath);
                  }
                  if (isTextFile(newPath)) {
                    await this.backgroundSync.onFileAdded(newPath);
                  }
                  break;
                }
              }
            }
          }

          const actuallyAdded = added.filter((path) => !renamedNewPaths.has(path));
          const actuallyRemoved = removed.filter((path) => !renamedOldPaths.has(path));

          if (actuallyAdded.length > 0) {
            const syncedCount = await this.manifestManager.syncFromManifest(
              this.mutePathEvents,
              this.unmutePathEvents,
              this.requestBinaryFile,
              { skipText: true },
            );
            if (syncedCount > 0) this.notify(`Live Share: synced ${syncedCount} file(s)`);
            for (const path of actuallyAdded) {
              if (isTextFile(path)) {
                await this.backgroundSync.onFileAdded(path);
              }
            }
          }
          for (const path of actuallyRemoved) {
            this.backgroundSync.onFileRemoved(path);
            const file = this.app.vault.getAbstractFileByPath(toLocalPath(path));
            if (file) await this.app.fileManager.trashFile(file);
          }
          if (actuallyRemoved.length > 0)
            this.notify(`Live Share: removed ${actuallyRemoved.length} file(s)`);

          if (updated.length > 0) {
            for (const path of updated) {
              const entry = this.manifestManager.getEntries().get(path);
              if (entry?.binary) {
                this.requestBinaryFile(path);
              }
            }
          }
        })
        .catch((err) => {
          this.logger.error("manifest", "handler error", err);
        });
    });
  }

  private get userId(): string {
    return this.settings.githubUserId || this.settings.clientId;
  }

  async onload() {
    await this.loadSettings();

    if (!this.settings.clientId) {
      this.settings.clientId = crypto.randomUUID();
      await this.saveData(this.settings);
    }

    if (this.settings.excludePatterns.length === 0) {
      try {
        const configFile = this.app.vault.getAbstractFileByPath(".liveshare.json");
        if (configFile && configFile instanceof TFile) {
          const content = await this.app.vault.read(configFile);
          const config = JSON.parse(content);
          if (Array.isArray(config.exclude) && config.exclude.length > 0) {
            this.settings.excludePatterns = config.exclude;
            await this.saveData(this.settings);
          }
        }
      } catch {
        // Config file may not exist or be invalid JSON
      }
    }

    this.syncManager = new SyncManager(this.settings);
    this.collabManager = new CollabManager();
    this.fileOpsManager = new FileOpsManager(this.app.vault, this.app.fileManager);
    this.sessionManager = new SessionManager(this);
    this.manifestManager = new ManifestManager(this.app.vault, this.settings);
    this.authManager = new AuthManager(this);
    this.exclusionManager = new ExclusionManager();
    this.exclusionManager.setConfigDir(this.app.vault.configDir);
    this.exclusionManager.setPatterns(this.settings.excludePatterns);
    this.manifestManager.setExclusionManager(this.exclusionManager);
    this.backgroundSync = new BackgroundSync(
      this.app.vault,
      this.syncManager,
      this.manifestManager,
      this.fileOpsManager,
    );
    this.connectionState = new ConnectionStateManager();
    this.logger = new DebugLogger(
      this.app.vault,
      this.settings.debugLogPath,
      this.settings.debugLogging,
    );
    // US6: SyncManager measures the awareness keep-alive gap whether or not a logger is
    // attached, but only reports `AWARENESS GAP:` once one is. Attached here, right after
    // the DebugLogger exists, because SyncManager is constructed before it.
    this.syncManager.setLogger(this.logger);
    this.connectionStateUnsub = this.connectionState.onChange(() => this.updateStatusBar());

    this.registerEditorExtension(this.collabManager.getBaseExtension());

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addEventListener("click", () => void this.activatePresenceView());
    this.statusBarEl.addClass("live-share-status-bar");
    this.updateStatusBar();

    registerCommands(this);

    this.registerView(PRESENCE_VIEW_TYPE, (leaf) => {
      const view = new PresenceView(leaf);
      view.setFollowHandler((userId) => this.presenceManager?.followUser(userId));
      view.setKickHandler((userId) => void this.kickUser(userId));
      view.setSummonHandler((userId) => this.summonUser(userId));
      view.setPermissionHandler((userId) => this.setUserPermission(userId));
      return view;
    });

    // Phase A: live status console backed by the DebugLogger ring buffer.
    this.registerView(LOG_VIEW_TYPE, (leaf) => {
      const view = new LogView(leaf);
      view.setLogger(this.logger);
      return view;
    });

    const ribbonEl = this.addRibbonIcon("users", "Collaborators", () => {
      void this.activatePresenceView();
    });
    const ribbonCtxHandler = (event: MouseEvent) => {
      event.preventDefault();
      this.showRibbonMenu(event);
    };
    ribbonEl.addEventListener("contextmenu", ribbonCtxHandler);
    this.register(() => ribbonEl.removeEventListener("contextmenu", ribbonCtxHandler));

    registerVaultEvents(this);
    this.addSettingTab(new LiveShareSettingTab(this.app, this));

    this.registerObsidianProtocolHandler("live-share-auth", async (params) => {
      const token = params.token;
      if (!token) return;
      if (this.authManager.completeAuth(token)) return;
      try {
        const payload = parseJwtPayload(token);
        this.settings.jwt = token;
        this.settings.githubUserId = payload.sub;
        this.settings.displayName =
          (payload.displayName || payload.username || "").trim() || "Anonymous";
        this.settings.avatarUrl = payload.avatar || "";
        await this.saveSettings();
        new Notice(`Live Share: authenticated as ${this.settings.displayName}`);
      } catch {
        new Notice("Live Share: invalid auth token");
      }
    });

    this.registerObsidianProtocolHandler("live-share", (params) => {
      if (params.invite) void this.joinWithInvite(params.invite);
    });

    if (
      this.settings.roomId &&
      this.settings.token &&
      this.settings.role &&
      this.settings.autoReconnect
    ) {
      this.app.workspace.onLayoutReady(() => {
        void this.resumeSession().catch((err) => {
          this.logger.error("session", "auto-reconnect failed", err);
        });
      });
    }

    // Flag-gated E2E control server (US4). `__LS_E2E__` is folded to `false` by
    // the production esbuild build, so this whole branch — and the dynamic
    // import of the testing/ module — is dead-code-eliminated from `main.js`.
    // The `typeof` guard also keeps this safe under vitest, where the define is
    // absent. When present, the module itself only listens if the runtime port
    // flag (LIVESHARE_E2E env / hidden e2eControlPort setting) is set.
    if (typeof __LS_E2E__ !== "undefined" && __LS_E2E__) {
      void import("./testing/e2e-control")
        .then((m) => {
          this.testControlHandle = m.maybeStartE2EControlServer(this);
        })
        .catch((err) => this.logger.error("e2e", "control server failed to start", err));
    }
  }

  onunload() {
    this.testControlHandle?.close();
    this.testControlHandle = null;
    this.logger.destroy();
    this.controlChannel?.destroy();
    this.controlChannel = null;
    this.explorerIndicators?.destroy();
    this.explorerIndicators = null;
    this.teardownCanvasPresences();
    this.canvasSync?.destroy();
    this.canvasSync = null;
    // WP25: stop the periodic compaction timer with the session that armed it.
    void this.canvasSidecar?.lifecycle.destroy();
    this.canvasSidecar = null;
    this.presenceManager?.destroy();
    this.presenceManager = null;
    this.removeScrollListener();
    this.connectionStateUnsub?.();
    this.connectionStateUnsub = null;

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const cmView = getCmView(activeView);
      if (cmView) this.collabManager.deactivateAll(cmView);
    }

    this.fileOpsManager.destroy();
    this.backgroundSync.destroy();
    this.manifestManager.destroy();
    this.syncManager.destroy();
  }

  private async resumeSession() {
    this.logger.log("session", `resuming as ${this.settings.role}`);
    try {
      await this.connectSync();
      await this.manifestManager.connect(this.syncManager);
      if (this.settings.role === "host") {
        await this.manifestManager.publishManifest({ purge: true });
        await this.backgroundSync.startAll("host");
        this.registerManifestChangeHandler();
      } else {
        await this.cleanupStaleFiles();
        await this.manifestManager.syncFromManifest(
          this.mutePathEvents,
          this.unmutePathEvents,
          this.requestBinaryFile,
        );
        await this.backgroundSync.startAll("guest");
        this.registerManifestChangeHandler();
      }
      this.onActiveFileChange();
    } catch {
      this.logger.error("session", "failed to resume session");
      await this.abortSession("Live Share: failed to resume previous session");
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.syncManager.updateSettings(this.settings);
    this.manifestManager.updateSettings(this.settings);
    this.logger.updateSettings(this.settings.debugLogging, this.settings.debugLogPath);
    this.exclusionManager.setPatterns(this.settings.excludePatterns);
    // Live-apply the canvas display toggles to every mounted presence.
    for (const presence of this.canvasPresences.values()) {
      presence.setDisplayOptions(
        this.settings.showCanvasCursors,
        this.settings.showCanvasPresence,
      );
    }
  }

  notify(msg: string): void {
    if (this.settings.notificationsEnabled) {
      new Notice(msg);
    }
  }

  public promptText(placeholder: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new PromptModal(this.app, placeholder, resolve);
      modal.open();
    });
  }

  private async cleanupStaleFiles() {
    const manifest = this.manifestManager.getEntries();
    if (manifest.size === 0) return;
    const manifestPaths = new Set(manifest.keys());
    const localFiles = this.app.vault
      .getFiles()
      .filter((file) => this.manifestManager.isSharedPath(file.path));
    for (const file of localFiles) {
      if (!manifestPaths.has(toCanonicalPath(normalizePath(file.path)))) {
        this.fileOpsManager.mutePathEvents(file.path);
        try {
          await this.app.fileManager.trashFile(file);
        } finally {
          setTimeout(() => this.fileOpsManager.unmutePathEvents(file.path), VAULT_EVENT_SETTLE_MS);
        }
      }
    }
  }

  cleanupSession() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const cmView = getCmView(activeView);
      if (cmView) this.collabManager.deactivateAll(cmView);
    }
    this.explorerIndicators?.destroy();
    this.explorerIndicators = null;
    this.teardownCanvasPresences();
    this.canvasSync?.destroy();
    this.canvasSync = null;
    // WP25: stop the periodic compaction timer with the session that armed it.
    void this.canvasSidecar?.lifecycle.destroy();
    this.canvasSidecar = null;
    // WP6 (US6 AC5): `CANVAS TEXT FALLBACK:` is once per path per SESSION.
    resetCanvasTextFallbackWarnings();
    this.backgroundSync.setCollabBoundFile(null);
    this.backgroundSync.destroy();
    this.syncManager.disconnect();
    this.controlChannel?.destroy();
    this.controlChannel = null;
    this.presenceManager?.destroy();
    this.presenceManager = null;
    this.removeScrollListener();
    this.remoteUsers.clear();
    this.remoteReadOnlyPatterns = [];
    this.refreshPresenceView();
    this.fileOpsManager.clearPendingChunks();
    this.manifestManager.destroy();
    this.muxConnected = false;
    this.controlConnected = false;
    this.connectionState.transition({ type: "disconnect" });
  }

  private async abortSession(message: string) {
    if (this.isEndingSession) return;
    this.isEndingSession = true;
    try {
      new Notice(message);
      this.cleanupSession();
    } finally {
      await this.sessionManager.endSession();
      this.isEndingSession = false;
    }
  }

  public async startSession() {
    if (this.sessionManager.isActive || this.isStartingSession) {
      new Notice("Live Share: session already active");
      return;
    }
    this.isStartingSession = true;
    try {
      const ok = await this.sessionManager.startSession();
      if (ok) {
        try {
          await this.connectSync();
          await this.manifestManager.connect(this.syncManager);
          await this.manifestManager.publishManifest({ purge: true });
          await this.backgroundSync.startAll("host");
          this.registerManifestChangeHandler();
          this.onActiveFileChange();
          this.logger.log("session", `started, room=${this.settings.roomId}`);
          this.notify("Live Share: session started, invite copied to clipboard");
        } catch {
          this.logger.error("session", "failed to start session");
          await this.abortSession("Live Share: failed to start session");
        }
      }
    } finally {
      this.isStartingSession = false;
    }
  }

  public async joinSession() {
    if (this.sessionManager.isActive || this.isStartingSession) {
      new Notice("Live Share: session already active");
      return;
    }
    this.isStartingSession = true;
    try {
      const invite = await this.promptText("Paste invite link");
      if (!invite) return;

      const ok = await this.sessionManager.joinSession(invite);
      if (ok) {
        try {
          await this.connectSync();
          await this.manifestManager.connect(this.syncManager);
          await this.cleanupStaleFiles();
          const syncedCount = await this.manifestManager.syncFromManifest(
            this.mutePathEvents,
            this.unmutePathEvents,
            this.requestBinaryFile,
          );
          await this.backgroundSync.startAll("guest");
          this.registerManifestChangeHandler();
          this.onActiveFileChange();
          this.logger.log("session", `joined, room=${this.settings.roomId}`);
          this.notify(`Live Share: joined session, synced ${syncedCount} file(s)`);
        } catch {
          this.logger.error("session", "failed to join session");
          await this.abortSession("Live Share: failed to join session");
        }
      }
    } finally {
      this.isStartingSession = false;
    }
  }

  private async joinWithInvite(inviteString: string) {
    if (this.sessionManager.isActive || this.isStartingSession) {
      new Notice("Live Share: session already active");
      return;
    }
    this.isStartingSession = true;
    try {
      const ok = await this.sessionManager.joinSession(inviteString);
      if (ok) {
        try {
          await this.connectSync();
          await this.manifestManager.connect(this.syncManager);
          await this.cleanupStaleFiles();
          const syncedCount = await this.manifestManager.syncFromManifest(
            this.mutePathEvents,
            this.unmutePathEvents,
            this.requestBinaryFile,
          );
          await this.backgroundSync.startAll("guest");
          this.registerManifestChangeHandler();
          this.onActiveFileChange();
          this.logger.log("session", `joined via link, room=${this.settings.roomId}`);
          this.notify(`Live Share: joined session, synced ${syncedCount} file(s)`);
        } catch {
          this.logger.error("session", "failed to join via link");
          await this.abortSession("Live Share: failed to join session");
        }
      }
    } finally {
      this.isStartingSession = false;
    }
  }

  public async endSession() {
    if (!this.sessionManager.isActive) {
      new Notice("Live Share: no active session");
      return;
    }

    if (this.isEndingSession) return;
    this.isEndingSession = true;

    try {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) {
        const cmView = getCmView(activeView);
        if (cmView) this.collabManager.deactivateAll(cmView);
      }

      if (this.settings.role === "host" && this.controlChannel) {
        this.controlChannel.send({ type: "session-end" });
      }

      this.cleanupSession();
      this.notify(
        this.settings.role === "host" ? "Live Share: session ended" : "Live Share: left session",
      );
    } finally {
      await this.sessionManager.endSession();
      this.isEndingSession = false;
    }
  }

  private async connectSync() {
    if (this.settings.role === "host") {
      this.settings.permission = "read-write";
    }
    this.connectionState.transition({ type: "connect" });
    this.muxConnected = false;
    this.controlConnected = false;
    this.syncManager.connect();
    this.syncManager.onMaxReconnect(() => {
      this.logger.error("sync", "mux channel exhausted reconnect attempts");
      new Notice("Live Share: sync connection lost, ending session");
      void this.endSession();
    });
    this.syncManager.onConnectionChange((connected) => {
      this.muxConnected = connected;
      this.updateOnlineState();
    });

    if (this.controlChannel) {
      this.controlChannel.destroy();
      this.controlChannel = null;
    }

    let e2e: E2ECrypto | undefined;
    if (this.settings.encryptionPassphrase) {
      e2e = new E2ECrypto(this.settings.encryptionPassphrase, this.settings.encryptionSalt);
      await e2e.init();
    }

    this.syncManager.setE2E(e2e ?? null);
    this.controlChannel = new ControlChannel(this.settings, e2e);
    this.controlChannel.onError((context, err) => {
      this.logger.error("control-ws", `${context} error`, err);
    });
    this.controlChannel.onStateChange((controlState) => {
      this.logger.log("connection", `control channel ${controlState}`);
      if (controlState === "connected") {
        this.connectionState.transition({ type: "connected" });
        // Both host and guest must send join-request so the server knows identities
        this.controlChannel?.send({
          type: "join-request",
          userId: this.userId,
          displayName: this.settings.displayName,
          avatarUrl: this.settings.avatarUrl,
        });
        if (this.settings.role === "host") {
          this.controlConnected = true;
          this.updateOnlineState();
        }
        this.presenceManager?.broadcastPresence();
        if (this.backgroundSync.isRunning()) {
          this.onActiveFileChange();
        }
      } else if (controlState === "reconnecting") {
        this.controlConnected = false;
        this.connectionState.transition({ type: "reconnecting" });
        this.updateOnlineState();
      } else if (controlState === "auth-required") {
        this.controlConnected = false;
        this.updateOnlineState();
        this.connectionState.transition({ type: "auth-expired" });
        new Notice("Live Share: authentication required - sign in via settings");
        void this.endSession();
      } else {
        this.controlConnected = false;
        this.updateOnlineState();
        this.connectionState.transition({ type: "disconnect" });
        if (this.sessionManager.isActive && !this.isEndingSession) {
          new Notice("Live Share: connection lost, session ended");
          void this.endSession();
        }
      }
    });

    registerControlHandlers(this);
    this.controlChannel.connect();

    this.explorerIndicators = new ExplorerIndicators();
    this.canvasSync = new CanvasSync(this.app.vault, this.syncManager, this.fileOpsManager);
    this.canvasSync.setLogger(this.logger);
    // WP25 (§7.0(e)): the sidecar wiring WP27 could not do. Injects BOTH the
    // guid identity store (over the manifest AND `index.json`) and the sidecar
    // lifecycle. Every decision lives in `wireCanvasSidecar` — this file holds
    // wiring only and has no test file of its own.
    this.canvasSidecar = wireCanvasSidecar({
      canvasSync: this.canvasSync,
      manifest: this.manifestManager,
      io: createVaultSidecarIO(this.app.vault.adapter),
    });
    // Defense-in-depth client guard: never push local canvas edits when the effective
    // permission is read-only (global read-only OR a host-designated read-only pattern).
    // Authoritative enforcement is server-side in ws-handler; this stops a read-only
    // guest from diverging locally. `path` is the canonical canvas path.
    this.canvasSync.setCanWrite((path) => this.canWriteCanvasPath(path));
    // WP3: the diff-inferred lock-acquisition hook, backed by the per-canvas
    // CanvasPresence controllers. WP21 removed the per-node lock write/delete
    // gates that used to be injected alongside it — locks are pure UX and no
    // longer carry write authority — so a claim is all that is wired here.
    this.canvasSync.setOnLocalNodeChange((path, nodeId) => {
      this.canvasPresences.get(path)?.onDiffInferredChange(nodeId);
    });
    // WP5 (C5 AC1): the surface-state seam WP4 left at its honest P0 default.
    // The value comes from the same confirmed apply that advances the shared
    // shadow, so the hand-over receipt and the field receipt cannot drift apart.
    this.canvasSync.setSurfaceStateProvider((path) => this.surfaceState.stateFor(path));
    // Scatter fix: patch the OPEN canvas view from every integrated remote delta.
    // Phase 2 (SPEC_04 §3): when `useCanvasBinding` is ON, the follower-apply path
    // is driven by the per-canvas CanvasBinding's OWN doc observer (constructed in
    // mountCanvasPresence), so this legacy reconcile is bypassed. When a binding is
    // not mounted for the path there is likewise no adapter, so reconcileLiveCanvas
    // would be a no-op anyway. Flag OFF ⇒ unchanged legacy behaviour.
    this.canvasSync.setOnRemoteCanvasUpdate((path, data) => {
      if (this.settings.useCanvasBinding) return;
      this.reconcileLiveCanvas(path, data);
    });
    // WP1 reconnect seam (US4 AC3): re-claim only still-free nodes, never blindly.
    this.syncManager.onReconnect(() => {
      for (const presence of this.canvasPresences.values()) presence.onReconnect();
    });
    // Keep the mounted presences in sync with which canvases are open.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncCanvasPresences()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncCanvasPresences()));

    const entries = this.manifestManager.getEntries();
    const role = this.settings.role === "host" ? "host" : "guest";
    for (const [path] of entries) {
      if (isTextFile(path) && path.endsWith(".canvas")) {
        // WP6 (US5 AC8/AC9): hand the path over to CanvasSync with
        // `backgroundSync.unsubscribe` immediately before the subscribe, and
        // install the announced raw-text fallback if the subscribe FAILS.
        // WP7 (US5 AC13/AC17): once the path is genuinely canvas-owned — i.e.
        // after `waitForSync` — attach its single CRDT→disk writer.
        void subscribeCanvasWithHandover({
          path,
          role,
          backgroundSync: this.backgroundSync,
          canvasSync: this.canvasSync,
          logger: this.logger,
        }).then((owned) => {
          if (owned) void this.attachCanvasWriter(path);
        });
      }
    }

    this.presenceManager = new PresenceManager({
      getUserId: () => this.userId,
      getDisplayName: () => this.settings.displayName,
      getAvatarUrl: () => this.settings.avatarUrl,
      getCursorColor: () => this.settings.cursorColor,
      getRole: () => this.settings.role ?? "guest",
      getCurrentFile: () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        return activeView?.file?.path ?? "";
      },
      getScrollTop: () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return 0;
        const cmView = getCmView(activeView);
        return cmView ? cmView.scrollDOM.scrollTop : 0;
      },
      getCursorLine: () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        return activeView ? activeView.editor.getCursor().line : 0;
      },
      getControlChannel: () => this.controlChannel,
      getRemoteUsers: () => this.remoteUsers,
      notify: (msg) => this.notify(msg),
      openFileAndScroll: async (filePath, scrollTop) => {
        const currentView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (currentView?.file?.path !== toLocalPath(filePath)) {
          const file = this.app.vault.getAbstractFileByPath(toLocalPath(filePath));
          if (file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
            this.onActiveFileChange();
          }
        }
        if (scrollTop !== undefined) {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (view) {
            const cmView = getCmView(view);
            if (cmView) cmView.scrollDOM.scrollTop = scrollTop;
          }
        }
      },
      refreshPresenceView: () => this.refreshPresenceView(),
      updateStatusBar: () => this.updateStatusBar(),
      onActiveFileChange: () => this.onActiveFileChange(),
    });
    this.presenceManager.startBroadcasting();
  }

  onActiveFileChange() {
    // WP2: branch to canvas presence. Previously this method hard-returned for
    // any non-MarkdownView (canvas included); now an open canvas mounts a
    // presence overlay instead of being ignored.
    this.syncCanvasPresences();

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const file = view.file;
    const cmView = getCmView(view);
    if (!cmView) return;

    const filePath = file?.path ?? null;
    const sharedPath =
      filePath && this.manifestManager.isSharedPath(filePath) && isTextFile(filePath)
        ? toCanonicalPath(normalizePath(filePath))
        : null;
    this.backgroundSync.setActiveFile(sharedPath);
    // Single-writer invariant: mark the active file as collab-bound SYNCHRONOUSLY,
    // before the async activation. Previously this was nulled here and only
    // restored in the activateForFile().then() up to 10 s later, opening a window
    // where background-sync treated the active file as a background file and both
    // yCollab AND background-sync wrote the same disk-originated frontmatter edit
    // into Y.Text (duplicated/interleaved YAML). sharedPath is null for
    // non-shared files, which correctly clears the guard.
    this.backgroundSync.setCollabBoundFile(sharedPath);
    let effectivePermission = this.settings.permission;
    if (
      sharedPath &&
      this.settings.role === "guest" &&
      this.remoteReadOnlyPatterns.some((p) => minimatch(sharedPath, p))
    ) {
      effectivePermission = "read-only";
    }
    // collabBoundFile is set synchronously above; do NOT restore it in a
    // .then() after activation resolves, or a stale activation could clobber
    // the guard back to a file the user has already switched away from.
    void this.collabManager.activateForFile(
      cmView,
      sharedPath,
      this.syncManager,
      this.settings.role,
      effectivePermission,
      {
        name: this.settings.displayName,
        color: this.settings.cursorColor,
        colorLight: `${this.settings.cursorColor}33`,
      },
    );

    this.removeScrollListener();
    const scrollDOM = cmView.scrollDOM;
    const scrollHandler = () => {
      this.presenceManager?.debouncedBroadcastPresence();
    };
    scrollDOM.addEventListener("scroll", scrollHandler);
    this.currentScrollListener = () => scrollDOM.removeEventListener("scroll", scrollHandler);
  }

  private removeScrollListener() {
    if (this.currentScrollListener) {
      this.currentScrollListener();
      this.currentScrollListener = null;
    }
  }

  // WP2/WP3: reconcile mounted canvas presences with the set of currently-open,
  // subscribed canvas leaves. Mount for newly-opened shared canvases; tear down
  // for closed ones. Defensive throughout — the Obsidian Canvas view is private.
  private syncCanvasPresences() {
    if (!this.canvasSync) return;
    const activePaths = new Set<string>();
    let leaves: Array<{ view?: unknown }> = [];
    try {
      leaves = this.app.workspace.getLeavesOfType("canvas") as Array<{ view?: unknown }>;
    } catch {
      leaves = [];
    }
    this.logger.debug("canvas", `syncCanvasPresences: ${leaves.length} canvas leaf/leaves open`);
    for (const leaf of leaves) {
      const view = leaf.view as { file?: { path?: string }; getViewType?: () => string } | undefined;
      const rawPath = view?.file?.path;
      // Lazily subscribe a shared canvas the user opened AFTER session start. The
      // session-start loop only subscribes canvases present in the manifest at
      // that moment; without this, opening/creating a canvas mid-session leaves it
      // permanently unsubscribed and no presence overlay ever mounts.
      if (
        rawPath &&
        !this.canvasSync.isSubscribed(rawPath) &&
        this.manifestManager.isSharedPath(rawPath)
      ) {
        this.logger.debug("canvas", `lazy-subscribing shared canvas ${rawPath}`);
        const role = this.settings.role === "host" ? "host" : "guest";
        // subscribe() adds to subscribedPaths synchronously (before its first
        // await), so isSubscribed() below already reads true and the mount
        // proceeds this pass; awareness works before full doc sync. No re-call.
        // WP6 (US5 AC8/AC9): same handover as the session-start call site —
        // `backgroundSync.unsubscribe` immediately precedes the subscribe (both
        // still synchronous, so the mount below is unaffected), and a FAILED
        // subscribe installs the announced raw-text fallback.
        // WP7: same writer attach as the session-start site (idempotent per path).
        void subscribeCanvasWithHandover({
          path: rawPath,
          role,
          backgroundSync: this.backgroundSync,
          canvasSync: this.canvasSync,
          logger: this.logger,
        }).then((owned) => {
          if (owned) void this.attachCanvasWriter(rawPath);
        });
      }
      const subscribed = rawPath ? this.canvasSync.isSubscribed(rawPath) : false;
      this.logger.debug("canvas", `  leaf path=${rawPath ?? "(none)"} subscribed=${subscribed}`);
      if (!rawPath || !subscribed) continue;
      const canonical = toCanonicalPath(normalizePath(rawPath));
      activePaths.add(canonical);
      if (this.canvasPresences.has(canonical)) continue;
      let viewType = "?";
      try {
        viewType = view?.getViewType?.() ?? "?";
      } catch {
        /* ignore */
      }
      this.logger.debug("canvas", `detected canvas leaf path=${rawPath} viewType=${viewType}`);
      const presence = this.mountCanvasPresence(rawPath, leaf.view);
      if (presence) this.canvasPresences.set(canonical, presence);
    }
    for (const [path, presence] of this.canvasPresences) {
      if (!activePaths.has(path)) {
        presence.destroy();
        this.canvasPresences.delete(path);
        this.canvasAdapters.delete(path);
        // WP5 (C5 AC1): drop the HAND-OVER receipt with the adapter — nothing is
        // on a surface that no longer exists. The shared Surface-Shadow's path is
        // deliberately NOT cleared: it is also the capture basis, so dropping it
        // here would make the first save after a close read as pure intent and
        // reopen the cascade window. A remount still classifies from scratch,
        // because both remount paths force `initial: true`.
        this.surfaceState.clearPath(path);
        // Phase 2: tear down the binding (unobserve/unsubscribe) on canvas close.
        this.canvasBindings.get(path)?.destroy();
        this.canvasBindings.delete(path);
        // Phase 3: detach the bridge's capture subscriptions from the adapter.
        this.canvasModelBridges.get(path)?.destroy();
        this.canvasModelBridges.delete(path);
      }
    }
  }

  // Scatter fix: patch the OPEN Obsidian canvas view to match a just-integrated
  // remote delta. Obsidian's open canvas is authoritative over its file and
  // ignores our external .canvas writes, so without this the view stays stale
  // (cards "scattered") until a full reload. Geometry-only changes are applied
  // per-node via moveAndResize (smooth, never interrupts an active drag);
  // structural changes (node/edge add/remove) fall back to a full setData reload.
  private reconcileLiveCanvas(
    path: string,
    data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] },
    opts?: { initial?: boolean },
  ): void {
    const canonical = toCanonicalPath(normalizePath(path));
    const adapter = this.canvasAdapters.get(canonical);
    if (!adapter || !adapter.isAvailable()) return; // canvas not open → file sync suffices
    // WP5 (C5 AC1): the ONE shared Surface-Shadow, obtained fresh from CanvasSync
    // at every use site. It is both the classifier basis below and the capture
    // basis inside CanvasSync — never a copy, never cached in this file, so
    // `setSurfaceShadow(...)` re-points both roles in the same call.
    const shadow = this.canvasSync?.getSurfaceShadow();
    if (!shadow) return; // canvas sync torn down → nothing to reconcile against
    if (adapter.isBusy()) {
      // Never reconcile mid-drag; the trailing disk write keeps data safe and the
      // next delta (or a manual reload) will catch the view up once idle.
      this.logger.debug("canvas", `reconcile ${canonical}: deferred (user dragging)`);
      return;
    }
    // WP5 (US3 AC1/AC2): the decision itself lives in the pure `planReconcile`
    // module (unit-tested without Obsidian); this method only supplies its inputs
    // and executes the plan. It classifies against the data we LAST APPLIED to
    // this view, so a remote text/color/type/fromSide/toSide/label change is
    // "structural" instead of falling into the geometry-only branch and never
    // reaching the open canvas. `initial` still forces a full reload (AC8) and a
    // live-view membership difference still does too.
    const desiredNodeIds = canvasIds(data.nodes);
    const desiredEdgeIds = canvasIds(data.edges);
    const liveNodeIds = adapter.getLiveNodeIds();
    const liveEdgeIds = adapter.getLiveEdgeIds();
    const plan = planReconcile({
      desired: data,
      lastApplied: shadowToCanvasRecords(shadow, canonical),
      liveNodeIds,
      liveEdgeIds,
      initial: opts?.initial,
    });
    // US3 AC7: nothing differs — make no mutating adapter call and do not mute
    // the path (muting would swallow an unrelated genuine local save).
    if (plan === "noop") {
      this.logger.debug(
        "canvas",
        `reconcile ${canonical}: noop (view already matches shared data)`,
      );
      return;
    }

    // Nodes that are an endpoint of some edge. Moving one of these per-node only
    // repositions the card; the live edges keep their OLD routing (fromSide/toSide)
    // → arrows look detached and Obsidian re-saves its own recomputed routing,
    // which fights the sync. This is why moving a card with >1 connection breaks
    // sync. When such a node actually moves we escalate to a full setData so edges
    // re-route from authoritative data.
    const edgeEndpoints = new Set<string>();
    for (const e of data.edges) {
      if (typeof e.fromNode === "string") edgeEndpoints.add(e.fromNode);
      if (typeof e.toNode === "string") edgeEndpoints.add(e.toNode);
    }

    const diskPath = toLocalPath(canonical);
    // Live mutations may trigger Obsidian's own requestSave; mute our modify
    // handler for the settle window so the reconcile never loops back into a sync.
    this.fileOpsManager.mutePathEvents(diskPath);
    // WP5 (C5): the two facts the receipt is built from. `main.ts` only collects
    // them — what they MEAN for the shadow is decided in `buildApplyReceipt` /
    // `advanceFromReceipt`, which are pure and tested without Obsidian.
    let reloaded: boolean | undefined;
    let nodeOutcomes: Map<string, ApplyOutcome> | undefined;
    try {
      if (plan === "structural") {
        reloaded = adapter.reloadCanvasData({ nodes: data.nodes, edges: data.edges });
        this.logger.debug(
          "canvas",
          `reconcile ${canonical}: ${opts?.initial ? "initial " : ""}structural reload ` +
            `${reloaded ? "ok" : "unsupported/skipped"} ` +
            `(nodes ${liveNodeIds.size}->${desiredNodeIds.size}, edges ${liveEdgeIds.size}->${desiredEdgeIds.size})`,
        );
      } else {
        let applied = 0;
        let interacting = 0;
        let movedEndpoint = false;
        nodeOutcomes = new Map<string, ApplyOutcome>();
        for (const n of data.nodes) {
          if (
            typeof n.id !== "string" ||
            typeof n.x !== "number" ||
            typeof n.y !== "number" ||
            typeof n.width !== "number" ||
            typeof n.height !== "number"
          ) {
            continue;
          }
          const outcome = adapter.applyNodeGeometry(n.id, {
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
          });
          nodeOutcomes.set(n.id, outcome);
          if (outcome === "applied") {
            applied++;
            if (edgeEndpoints.has(n.id)) movedEndpoint = true;
          } else if (outcome === "interacting") interacting++;
        }
        // A connected node moved → the live edges need re-routing from authoritative
        // data. Per-node geometry cannot do that, so reload once. Bounded: only fires
        // when a card WITH edges actually moved (isolated-node moves stay smooth).
        if (movedEndpoint) {
          reloaded = adapter.reloadCanvasData({ nodes: data.nodes, edges: data.edges });
          this.logger.debug(
            "canvas",
            `reconcile ${canonical}: geometry applied=${applied} deferred(interacting)=${interacting}` +
              ` + edge reflow (setData ${reloaded ? "ok" : "skipped"})`,
          );
        } else if (applied || interacting) {
          this.logger.debug(
            "canvas",
            `reconcile ${canonical}: geometry applied=${applied} deferred(interacting)=${interacting}`,
          );
        }
      }
      // WP5 (C5 AC1/AC2/AC3): one uniform receipt call site for every branch. The
      // shadow advances per FIELD and only for records the surface confirmed, and
      // the very same summary supplies the hand-over half of the seam, so the two
      // can never drift apart.
      const summary = advanceFromReceipt(
        shadow,
        buildApplyReceipt({ path: canonical, desired: data, plan, reloaded, nodeOutcomes }),
      );
      this.surfaceState.noteHandover(canonical, summary.handed);
    } finally {
      setTimeout(() => this.fileOpsManager.unmutePathEvents(diskPath), VAULT_EVENT_SETTLE_MS);
    }
  }

  /**
   * Defense-in-depth client write guard for a CANONICAL canvas path: never push
   * local canvas edits when the effective permission is read-only (global
   * read-only OR a host-designated read-only pattern for a guest). Shared by the
   * legacy `CanvasSync.setCanWrite` seam and the Phase-3 `CanvasBinding` capture
   * gate so both paths enforce identically. Server-side ws-handler stays
   * authoritative; this only stops a read-only client from diverging locally.
   */
  private canWriteCanvasPath(path: string): boolean {
    if (this.settings.permission === "read-only") return false;
    if (
      this.settings.role === "guest" &&
      this.remoteReadOnlyPatterns.some((p) => minimatch(path, p))
    ) {
      return false;
    }
    return true;
  }

  /**
   * WP7 (US5 AC13/AC16/AC17) — attach the SINGLE CRDT→disk writer for one canvas
   * path. Wiring only: the ordering contract (`coldOpen()` after `waitForSync`,
   * before `start()`) lives in the tested `attachCanvasPersistence` helper.
   *
   * Called only once the handover helper reports the path is canvas-owned, which
   * is exactly when `CanvasSync.subscribe` has resolved — i.e. after
   * `waitForSync`. `createVaultPersistenceIO` re-applies the `isPathSafe` +
   * `ensureFolder` guarantees the retired `CanvasSync.writeToDisk` provided, and
   * `onWritten` feeds every landed write back into `CanvasSync` so its diff
   * baseline and its `isRecentDiskWrite` echo guard stay correct.
   */
  private async attachCanvasWriter(rawPath: string): Promise<void> {
    const canonical = toCanonicalPath(normalizePath(rawPath));
    if (this.canvasWriters.has(canonical) || this.canvasWriterAttaching.has(canonical)) return;
    const handle = this.canvasSync?.getCanvasDocHandle(rawPath);
    if (!handle) return;
    this.canvasWriterAttaching.add(canonical);
    const io = createVaultPersistenceIO(this.app.vault.adapter, this.fileOpsManager, {
      isPathSafe: (diskPath) => isPathSafe(diskPath),
      ensureFolder: (parentDir) => ensureFolder(this.app.vault, parentDir),
    });
    try {
      const { persistence, coldOpen } = await attachCanvasPersistence(
        handle.doc,
        io,
        toLocalPath(canonical),
        {
          logger: this.logger,
          onWritten: (content) => this.canvasSync?.noteExternalDiskWrite(canonical, content),
          // WP63 (I11): the HOST seed refuses during `CanvasSync.subscribe`,
          // which has already run by the time we get here — so the writer reads
          // the refused set from the object that filled it.
          seedRefusals: this.canvasSync?.seedRefusalLedger(canonical),
        },
      );
      // A session teardown may have raced the awaited cold open.
      if (!this.canvasSync) {
        persistence.destroy();
        return;
      }
      this.canvasWriters.set(canonical, persistence);
      this.logger.log(
        "canvas",
        `CANVAS WRITER: ${canonical} owner=CanvasPersistence attached (coldOpen=${coldOpen})`,
      );
    } catch (err) {
      this.logger.error("canvas", `failed to attach canvas writer for ${canonical}`, err);
    } finally {
      this.canvasWriterAttaching.delete(canonical);
    }
  }

  private mountCanvasPresence(rawPath: string, view: unknown): CanvasPresence | null {
    const handle = this.canvasSync?.getCanvasDocHandle(rawPath);
    if (!handle) return null;
    try {
      const adapter = createCanvasAdapter(view, {
        // US6: attach the status console so `ADAPTER PATCH:` and `DRAG WATCHDOG:` are
        // recorded instead of silently dropped. `CanvasAdapterLogger` declares `log`
        // while `DebugLogger` (like `CanvasSyncLogger`/`SyncLogger`) exposes `debug`,
        // so the two names are bridged here rather than churning the adapter's tests.
        logger: {
          log: (category, message) => this.logger.debug(category, message),
          warn: (category, message) => this.logger.warn(category, message),
        },
      });
      // Register for live-view reconciliation (kept in lockstep with the presence).
      this.canvasAdapters.set(toCanonicalPath(normalizePath(rawPath)), adapter);
      // Diagnostics: report whether the private Canvas API surface is usable and,
      // if not, exactly which member is missing (the root-cause the user needs).
      const available = adapter.isAvailable();
      // Initial-sync fix: a canvas opened AFTER the CRDT already synced shows the
      // stale on-disk file (Obsidian never reloads a canvas from an external write).
      // Force one authoritative full reconcile now so the freshly-opened view snaps
      // to shared truth — nodes at the right coords AND edges connected — instead of
      // waiting for the next remote delta to nudge it. No-op when the shared doc is
      // still empty (getCanvasSnapshot returns null).
      if (available) {
        if (this.settings.useCanvasBinding) {
          // Phase 3 (SPEC_04 §4): construct the CanvasBinding over the FULL model
          // bridge. Its constructor wires the doc observer AND seeds the model from
          // the doc (one applyRemote) — this seed replaces the legacy forced-initial
          // reconcile below. Capture is now LIVE: the bridge sources local intent
          // from the adapter's interaction signals + snapshot-diff (SPEC_02 §4), so
          // local edits flow model→CRDT via `captureLocal` (NOT the legacy
          // canvasSync.handleLocalModify, which is skipped for bound paths — see
          // vault-events.ts). `isApplying` back-references the binding so capture is
          // suppressed for changes WE apply (I2); the binding is null only during
          // its own constructor seed, when no interaction signal can fire.
          const canonical = toCanonicalPath(normalizePath(rawPath));
          let binding: CanvasBinding | null = null;
          const bridge = createCanvasModelBridge(adapter, {
            logger: this.logger,
            isApplying: () => binding?.applyingRemote ?? false,
          });
          binding = new CanvasBinding(handle.doc, bridge, {
            path: canonical,
            logger: this.logger,
            // WP21: the two lock mirrors that used to sit beside this line are
            // gone. `canWrite` is AUTHORISATION (read-only permission and guest
            // globs) and stays; the per-node lock gates carried no authority
            // once the data model resolved same-register conflicts.
            canWrite: (p) => this.canWriteCanvasPath(p),
          });
          this.canvasBindings.set(canonical, binding);
          this.canvasModelBridges.set(canonical, bridge);
          this.logger.debug(
            "canvas",
            `mount ${rawPath}: CanvasBinding constructed (seeded from shared doc, capture live)`,
          );
        } else {
          const snapshot = this.canvasSync?.getCanvasSnapshot(rawPath);
          if (snapshot) {
            this.logger.debug(
              "canvas",
              `mount ${rawPath}: initial reconcile from shared snapshot ` +
                `(nodes=${snapshot.nodes.length} edges=${snapshot.edges.length})`,
            );
            this.reconcileLiveCanvas(rawPath, snapshot, { initial: true });
          }
        }
      }
      this.logger.log(
        "canvas",
        `mount ${rawPath}: private API available=${available} (${adapter.availabilityReport()})`,
      );
      const hostCandidate =
        (adapter.getOverlayHost() as { createDiv?: unknown } | null) ??
        ((view as { contentEl?: unknown; containerEl?: unknown })?.contentEl as
          | { createDiv?: unknown }
          | undefined) ??
        null;
      let overlay: CanvasOverlay | null = null;
      if (hostCandidate && typeof hostCandidate.createDiv === "function") {
        const overlayRoot = (
          hostCandidate as unknown as { createDiv: (o: { cls: string }) => OverlayHost }
        ).createDiv({ cls: "ls-canvas-overlay" });
        overlay = new CanvasOverlay(overlayRoot);
        this.logger.debug("canvas", `overlay mounted on ${rawPath} (host=wrapperEl)`);
      } else {
        this.logger.warn("canvas", `overlay host NOT found for ${rawPath}; cursors hidden`);
      }
      let peerCount = 0;
      try {
        peerCount = Math.max(0, (handle.awareness.getStates?.().size ?? 1) - 1);
      } catch {
        /* ignore */
      }
      this.logger.debug("canvas", `awareness peers on ${rawPath}: ${peerCount}`);
      const awareness = handle.awareness as unknown as AwarenessLike;
      const presence = new CanvasPresence({
        path: toCanonicalPath(normalizePath(rawPath)),
        awareness,
        identity: {
          clientId: handle.doc.clientID,
          name: this.settings.displayName,
          color: this.settings.cursorColor,
        },
        overlay,
        adapter,
        // WP4 (US2 AC6): supply the GAP-1 loser-revert callback that was declared,
        // stored and invoked in canvas-presence.ts but never wired — dead code
        // until now. Signature matches the call site (it passes the nodeId).
        onRevert: (nodeId: string) => this.revertCanvasNode(rawPath, nodeId, awareness),
        showCursors: this.settings.showCanvasCursors,
        showPresence: this.settings.showCanvasPresence,
        logger: this.logger,
      });
      presence.start();
      return presence;
    } catch (err) {
      this.logger.error("canvas", "failed to mount canvas presence", err);
      return null;
    }
  }

  // WP4 (US2 AC7/AC8) — GAP-1 loser-revert. This client lost the lowest-clientID
  // tiebreak on `nodeId`, so the lock seam denied its optimistic edit and that edit
  // never reached the shared doc (canvas-sync holds its diff baseline back for the
  // same reason). The LIVE view still shows the rejected position, so roll it back
  // to shared truth with one authoritative full reconcile. A null snapshot (shared
  // doc still empty) is a no-op — never wipe the view (BUILD_SPEC § 6).
  private revertCanvasNode(rawPath: string, nodeId: string, awareness: AwarenessLike): void {
    const canonical = toCanonicalPath(normalizePath(rawPath));
    let winner: number | null = null;
    try {
      winner = resolveHolder(canonical, nodeId, awareness.getStates());
    } catch {
      /* awareness may be torn down mid-revert; the view rollback still runs */
    }
    const snapshot = this.canvasSync?.getCanvasSnapshot(rawPath) ?? null;
    const noSnapshot = snapshot ? "" : " (no shared snapshot yet; view left untouched)";
    this.logger.warn(
      "canvas",
      `LOCK REVERT: ${canonical} node=${nodeId} winner=${winner ?? "unknown"}${noSnapshot}`,
    );
    if (!snapshot) return;
    this.reconcileLiveCanvas(rawPath, snapshot, { initial: true });
  }

  private teardownCanvasPresences() {
    for (const presence of this.canvasPresences.values()) {
      try {
        presence.destroy();
      } catch {
        /* ignore */
      }
    }
    // Phase 2: destroy every mounted binding (no leaks on session end / unload).
    for (const binding of this.canvasBindings.values()) {
      try {
        binding.destroy();
      } catch {
        /* ignore */
      }
    }
    this.canvasBindings.clear();
    // Phase 3: detach every mounted bridge's capture subscriptions.
    for (const bridge of this.canvasModelBridges.values()) {
      try {
        bridge.destroy();
      } catch {
        /* ignore */
      }
    }
    this.canvasModelBridges.clear();
    // WP7 (US5 AC13): tear down every canvas disk writer. This runs on BOTH
    // destroy paths (`onunload` and `cleanupSession`) and deliberately NOT when a
    // single canvas view closes: the writer's whole purpose is to keep CLOSED
    // canvases and cold opens correct while remote deltas keep arriving, so its
    // lifetime tracks the CanvasSync subscription, not the open view.
    for (const writer of this.canvasWriters.values()) {
      try {
        writer.destroy();
      } catch {
        /* ignore */
      }
    }
    this.canvasWriters.clear();
    this.canvasWriterAttaching.clear();
    this.canvasPresences.clear();
    this.canvasAdapters.clear();
    // WP5 (C5 AC1): the hand-over receipt lives and dies with the adapters. The
    // shared Surface-Shadow belongs to CanvasSync and is torn down with it.
    this.surfaceState.clearAll();
  }

  updateStatusBar() {
    const state = this.connectionState.getState();
    switch (state) {
      case "disconnected":
        this.statusBarEl.setText("Live Share: off");
        break;
      case "connecting":
        this.statusBarEl.setText("Live Share: connecting...");
        break;
      case "reconnecting":
        this.statusBarEl.setText("Live Share: reconnecting...");
        break;
      case "connected": {
        const count = this.remoteUsers.size;
        const role = this.settings.role === "host" ? "hosting" : "joined";
        const users = count > 0 ? ` (${count + 1})` : "";
        const latency = this.controlChannel?.getLatency();
        const latencyStr = latency ? ` ${latency}ms` : "";
        const presentingLabel = this.presenceManager?.getIsPresenting() ? " [presenting]" : "";
        this.statusBarEl.setText(`Live Share: ${role}${users}${latencyStr}${presentingLabel}`);
        break;
      }
      case "error":
        this.statusBarEl.setText("Live Share: error");
        break;
      case "auth-required":
        this.statusBarEl.setText("Live Share: auth needed");
        break;
    }
  }

  private showRibbonMenu(event: MouseEvent): void {
    const menu = new Menu();
    const active = this.sessionManager.isActive;

    if (!active) {
      menu.addItem((item) =>
        item
          .setTitle("Start session")
          .setIcon("play")
          .onClick(() => void this.startSession()),
      );
      menu.addItem((item) =>
        item
          .setTitle("Join session")
          .setIcon("log-in")
          .onClick(() => void this.joinSession()),
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle("Copy invite link")
          .setIcon("copy")
          .onClick(() => this.sessionManager.copyInvite()),
      );
      menu.addItem((item) =>
        item
          .setTitle("Show collaborators")
          .setIcon("users")
          .onClick(() => void this.activatePresenceView()),
      );
      menu.addSeparator();
      if (this.settings.role === "host") {
        menu.addItem((item) =>
          item
            .setTitle("End session")
            .setIcon("square")
            .setWarning(true)
            .onClick(() => {
              void this.confirm(
                "Are you sure you want to end the session? All participants will be disconnected.",
              ).then((confirmed) => {
                if (confirmed) void this.endSession();
              });
            }),
        );
      } else {
        menu.addItem((item) =>
          item
            .setTitle("Leave session")
            .setIcon("log-out")
            .setWarning(true)
            .onClick(() => {
              void this.confirm("Are you sure you want to leave the session?").then((confirmed) => {
                if (confirmed) void this.endSession();
              });
            }),
        );
      }
    }

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Settings")
        .setIcon("settings")
        .onClick(() => {
          const setting = (
            this.app as unknown as {
              setting: { open(): void; openTabById(id: string): void };
            }
          ).setting;
          setting.open();
          setting.openTabById(this.manifest.id);
        }),
    );

    menu.showAtMouseEvent(event);
  }

  async activatePresenceView() {
    const existing = this.app.workspace.getLeavesOfType(PRESENCE_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: PRESENCE_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async activateLogView() {
    const existing = this.app.workspace.getLeavesOfType(LOG_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: LOG_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  refreshPresenceView() {
    const leaves = this.app.workspace.getLeavesOfType(PRESENCE_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as PresenceView;
      view.updateState(
        this.remoteUsers,
        this.settings.role === "host",
        this.presenceManager?.getFollowTarget() ?? null,
      );
    }
  }

  async kickUser(userId: string) {
    if (this.settings.role !== "host" || !this.controlChannel) return;
    const user = this.remoteUsers.get(userId);
    const name = user?.displayName ?? userId;
    const confirmed = await this.confirm(`Kick ${name} from the session?`);
    if (!confirmed) return;
    this.controlChannel.send({ type: "kick", userId });
    this.remoteUsers.delete(userId);
    this.refreshPresenceView();
    this.updateStatusBar();
    this.notify(`Live Share: kicked ${name}`);
  }

  setUserPermission(userId: string) {
    if (this.settings.role !== "host" || !this.controlChannel) return;
    const user = this.remoteUsers.get(userId);
    if (!user) return;
    const currentPermission = user.permission ?? "read-write";
    const newPermission = currentPermission === "read-write" ? "read-only" : "read-write";
    this.controlChannel.send({
      type: "set-permission",
      userId,
      permission: newPermission,
    });
    user.permission = newPermission;
    this.refreshPresenceView();
    this.notify(`Live Share: set ${user.displayName} to ${newPermission}`);
  }

  async fetchAuditLog() {
    if (!this.settings.serverUrl || !this.settings.roomId || !this.settings.token) return;
    try {
      const url = `${this.settings.serverUrl}/rooms/${this.settings.roomId}/logs?limit=100`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.settings.token}`,
      };
      if (this.settings.serverPassword) headers["X-Server-Password"] = this.settings.serverPassword;
      const res = await requestUrl({ url, headers });
      new AuditLogModal(this.app, res.json).open();
    } catch {
      new Notice("Live Share: failed to fetch audit log");
    }
  }

  async demoteToGuest() {
    this.logger.log("session", "demoted from host - another host exists");
    this.settings.role = "guest";
    if (this.presenceManager?.getIsPresenting()) {
      this.presenceManager.togglePresent();
    }
    await this.saveSettings();
    await this.backgroundSync.startAll("guest");
    await this.cleanupStaleFiles();
    await this.manifestManager.syncFromManifest(
      this.mutePathEvents,
      this.unmutePathEvents,
      this.requestBinaryFile,
    );
    this.notify("Live Share: reconnected as guest - another user is host");
    this.updateStatusBar();
    this.refreshPresenceView();
    this.onActiveFileChange();
  }

  async reloadFromHost() {
    if (!this.controlChannel) return;
    this.notify("Live Share: reloading all files from host...");
    const syncedCount = await this.manifestManager.syncFromManifest(
      this.mutePathEvents,
      this.unmutePathEvents,
      this.requestBinaryFile,
    );
    if (syncedCount > 0) this.notify(`Live Share: reloaded ${syncedCount} file(s) from host`);
  }

  summonUser(userId: string) {
    if (this.settings.role !== "host" || !this.controlChannel) return;
    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      for (const leaf of leaves) {
        if (leaf.view instanceof MarkdownView) {
          view = leaf.view;
          break;
        }
      }
    }
    const cursor = view?.editor?.getCursor();
    const filePath = view?.file?.path;
    if (!filePath) {
      new Notice("Live Share: open a file first to summon");
      return;
    }
    this.controlChannel.send({
      type: "summon",
      fromUserId: this.userId,
      fromDisplayName: this.settings.displayName,
      targetUserId: userId,
      filePath: toCanonicalPath(normalizePath(filePath)),
      line: cursor?.line ?? 0,
      ch: cursor?.ch ?? 0,
    });
    const user = this.remoteUsers.get(userId);
    this.notify(`Live Share: summoned ${user?.displayName ?? userId}`);
  }

  confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmModal(this.app, message, resolve);
      modal.open();
    });
  }
}
