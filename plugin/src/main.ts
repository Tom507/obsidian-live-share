import type { EditorView } from "@codemirror/view";
import { MarkdownView, Menu, Notice, Plugin, TFile, TFolder, requestUrl } from "obsidian";

import { minimatch } from "minimatch";
import {
  type CanvasAdapter,
  REPAINT_SWEEP_PERIOD_MS,
  createCanvasAdapter,
} from "./canvas/canvas-adapter";
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
import { isCanvasPath } from "./canvas/canvas-epoch";
// WP38 (C38) — TYPE-only. The decision, the origins and the manager all live in
// that module; this file holds calls into it.
import type { CanvasUndoOutcome, CanvasUndoReport } from "./canvas/canvas-undo";
import type { ImportAvailability } from "./canvas/canvas-import-command";
import { RECONCILE_GEOMETRY_KEYS, canvasIds, planReconcile } from "./canvas/reconcile-plan";
import {
  CANVAS_EDIT_DRAIN_DELAY_MS,
  type CanvasWriteHoldQueue,
  type EditingDeferralQueue,
  classifyBusyGate,
  createCanvasWriteHoldQueue,
  createEditingDeferralQueue,
  planCanvasDiskWrite,
  planCanvasDrain,
  planEditingDeferral,
} from "./canvas/canvas-editing-deferral";
import { DebugLogger } from "./debug-logger";
import { CollabManager } from "./editor/collab";
import {
  type AttestationLedger,
  getAttestationDecisions,
} from "./files/attestation-guard";
import { BackgroundSync } from "./files/background-sync";
import {
  type ConflictCopyLedger,
  conflictsRootFor,
  getConflictCopies,
} from "./files/conflict-copy";
import {
  type SingleWriterDeclines,
  getSingleWriterDeclines,
} from "./files/single-writer";
import {
  getCollabBindFailures,
  getCollabBindRefusals,
  makeBindStateSink,
} from "./editor/collab-bind-decision";
import { getEmptyWriteRefusals } from "./files/empty-write-guard";
import { isProtectedPath } from "./files/protected-paths";
import { type PathOutcomeLedger, getPathOutcomes } from "./files/path-outcome";
import {
  type CanvasPersistence,
  type PersistenceIO,
  attachCanvasPersistence,
  createVaultPersistenceIO,
} from "./files/canvas-persistence";
import {
  type ImportFromFileResult,
  runImportFromFile,
} from "./files/canvas-import";
import {
  CANVAS_RECORD_MAPS,
  type CanvasMirrorReport,
  mirrorSharedCanvases,
} from "./files/canvas-mirror";
import {
  CanvasCreateCoordinator,
  type CanvasCreateStats,
} from "./files/canvas-create";
import {
  type CanvasSidecarWiring,
  createVaultSidecarIO,
  wireCanvasSidecar,
} from "./files/canvas-sidecar-lifecycle";
import { CanvasSync, parseCanvasReport } from "./files/canvas-sync";
import {
  WRITER_ATTACH_VERDICT,
  decideCanvasWriterAttach,
} from "./files/canvas-writer-attach-decision";
import { SeedRefusalStore, flushSeedRefusalStore } from "./files/seed-refusal-store";

import { ExclusionManager } from "./files/exclusion";
import { FileOpsManager } from "./files/file-ops";
import { ManifestManager } from "./files/manifest";
import {
  type LocalKind,
  REMOVAL_DECISION,
  RENAME_DECISION,
  decideManifestRemoval,
  decideManifestRename,
} from "./files/manifest-removal-decision";
import { pairRenamesByIdentity } from "./files/rename-identity";
import {
  canvasOwned,
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
import {
  type AnnouncementState,
  FILE_OP_CARRIER_LINK,
  LINK_READY_STATE,
  type LinkLifecycleEvent,
  type LinkName,
  NO_ANNOUNCEMENT,
  type PeerLinkFacts,
  type SeveranceCause,
  type SharingVerdict,
  WP88_BUILD_MARKER,
  acceptsIntoOfflineQueue,
  announcementKey,
  decideSharing,
  describeLifecycle,
  isLinkUp,
  nextAnnouncement,
  offlineQueueSealKey,
  offlineQueueSealNoticeText,
  readyStateName,
  severanceAnnouncementKey,
  severanceLogLine,
  severanceNoticeText,
  sharingNoticeText,
  sharingStatusText,
} from "./sync/link-state";
import { SyncManager } from "./sync/sync";
import {
  DEFAULT_SETTINGS,
  type LiveShareSettings,
  type ManifestChangeDisposition,
  type ManifestPublishDecision,
  STALE_RECONCILE_RULE,
  type StaleReconcileDecision,
  type StaleReconcileRule,
} from "./types";

import { AuditLogModal } from "./ui/audit-modal";

import { ExplorerIndicators } from "./ui/explorer-indicators";
import { confirmImportFromFile } from "./ui/import-canvas-modal";
import { ConfirmModal, PromptModal } from "./ui/modals";
import { LiveShareSettingTab, sharesEntireVault } from "./ui/settings";
import {
  ensureFolder,
  hashBuffer,
  hashContent,
  isPathSafe,
  isTextFile,
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
  // WP117 (S122): host-mediated guest canvas creation. Built with the session,
  // torn down with it. Every decision it takes lives in `files/canvas-create.ts`
  // and `files/canvas-create-decision.ts`; this file supplies measurements and
  // actions and states no rule of its own.
  canvasCreate: CanvasCreateCoordinator | null = null;
  // WP25: the sidecar store + lifecycle + identity store, built by
  // `wireCanvasSidecar`. Held only so the periodic compaction timer can be
  // stopped at teardown.
  private canvasSidecar: CanvasSidecarWiring | null = null;
  // WP2/WP3: one presence controller per open, subscribed canvas (keyed by
  // canonical path). Owns that canvas' cursor/lock awareness + DOM overlay.
  private canvasPresences = new Map<string, CanvasPresence>();
  /** Exact Obsidian view currently owned by each path-level Canvas presence. */
  private canvasPresenceViews = new Map<string, unknown>();
  // WP-scatter: live Canvas adapters keyed by canonical path, so remote deltas can
  // patch the OPEN canvas view (Obsidian ignores external .canvas writes). Kept in
  // lockstep with canvasPresences (same mount/teardown sites).
  //
  // WP89-CORRECTED — "Obsidian ignores external .canvas writes" is FALSE; WP87
  // measured the rebuild on both instances (`canvas-editing-deferral.ts:324` and
  // `main.ts:3053` carry the corrected statement and are this census's positive
  // controls). The map is right anyway, and for a stronger reason: patching
  // through an adapter is how a delta reaches the surface WITHOUT the rebuild
  // that reseats every card. ⚠ This site is NOT in the WP89 charter's §3 table of
  // seven — it was DERIVED from the tree, which is what AC2 exists for.
  private canvasAdapters = new Map<string, CanvasAdapter>();
  // B72 (WP3) — THE RESTORING FORCE. One interval per mounted canvas, driving
  // `adapter.sweepRepaint()` at {@link REPAINT_SWEEP_PERIOD_MS}. Kept in lockstep
  // with `canvasAdapters` (same mount, same teardown), and it is the ONLY clock
  // this fix introduces: the batch selection, the busy gate and the counters all
  // live in the adapter, so this map holds a timer handle and nothing else.
  private canvasRepaintSweeps = new Map<
    string,
    {
      interval: ReturnType<typeof setInterval>;
      active: boolean;
      pending: boolean;
      running: boolean;
      rerun: boolean;
      eventRequests: number;
      coalescedRequests: number;
      eventRuns: number;
      periodicRuns: number;
      lastRunAt: number | null;
      lastTriggerKind: "event" | "periodic" | null;
    }
  >();
  // WP37 (C37) — the per-record deferral queue for view applies withheld while an
  // inline editor is focused. Constructed here and INJECTED; every rule about what
  // goes in, what coalesces and what comes out lives in
  // `canvas/canvas-editing-deferral.ts`. Drained at blur, at view close and at
  // teardown, so nothing it holds can outlive the adapter that produced it.
  private canvasDeferrals: EditingDeferralQueue = createEditingDeferralQueue();
  // WP87 (C87) — the SECOND route's queue, on exactly the `canvasDeferrals`
  // precedent above. The reconcile pass is not the only thing that can rebuild an
  // open canvas: Obsidian reloads the view from an EXTERNAL disk write too
  // (measured — the inherited claim below that it never does is false), and that
  // reload is a full REBUILD, so no substitution can make it harmless. Released
  // by the SAME three drains as `canvasDeferrals`, so a held write can no more
  // outlive its surface than a held record can.
  private canvasWriteHolds: CanvasWriteHoldQueue = createCanvasWriteHoldQueue();
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
  // WP90 (I11): the durable home of every path's refused set. ONE per plugin
  // instance — it is one file for the whole vault, read once and rewritten in
  // place — and its lifetime is deliberately the PLUGIN's, not the session's:
  // the withhold it carries has to survive exactly the boundary a session does
  // not. Built lazily at the first canvas writer attach so a vault that never
  // opens a shared canvas never creates the file.
  private seedRefusalStore: SeedRefusalStore | null = null;
  /**
   * WP92 (C92 AC4 / S64): every teardown flush of the store, serialised.
   *
   * Wiring, and the chain is the wiring: `teardownCanvasPresences` (both destroy
   * paths — `onunload` AND `cleanupSession`) STARTS a flush, and `onunload`
   * AWAITS this chain after its synchronous teardown has run. So the one moment
   * the process may actually be about to end is the one moment that waits, and
   * the sync half of `onunload` still runs synchronously — nothing moved behind
   * an await that was not behind one before.
   */
  private seedRefusalFlush: Promise<void> = Promise.resolve();
  explorerIndicators: ExplorerIndicators | null = null;
  controlChannel: ControlChannel | null = null;
  remoteUsers = new Map<string, PresenceUser>();

  /**
   * S116 — the canonical paths this vault held BEFORE this session's guest arm
   * started, i.e. the files the session did not give us and is not entitled to
   * take away.
   *
   * `null` is not "empty" — it is "never captured", and it REFUSES. The two
   * must not collapse: an empty set means "this guest joined with an empty
   * vault, so everything here now arrived through the session" (a real and
   * permissive state), while `null` means the question was never asked. Only
   * one of those may license a deletion.
   *
   * Session-scoped by construction, and therefore lost on reload — see
   * {@link captureVaultBaseline} for what that costs and why it is the safe
   * direction.
   */
  private vaultBaseline: Set<string> | null = null;
  remoteReadOnlyPatterns: string[] = [];
  presenceManager: PresenceManager | null = null;
  private connectionStateUnsub: (() => void) | null = null;
  statusBarEl!: HTMLElement;
  private isEndingSession = false;
  private isStartingSession = false;
  private currentScrollListener: (() => void) | null = null;
  // --- WP82: connectivity is MEASURED, not latched ---------------------------
  //
  // `muxConnected` and `controlConnected` are still assigned exactly where they
  // always were, and `session.info` still reads them as
  // `Boolean(muxConnected) && Boolean(controlConnected)` — WP46's pinned quartet
  // is byte-unchanged. What changed is that the ASSIGNMENT now records a BELIEF
  // and the READ answers with a MEASUREMENT: the getters below hand the link's
  // live `readyState` to the one pure definer (`sync/link-state.ts`).
  //
  // The two fields used to be latches set on mutually exclusive, role-gated
  // paths, so a peer promoted from guest to host after its socket opened was
  // `connected: false` forever while both sockets were open, and a peer demoted
  // after opening as host was `connected: true` on a role it no longer held.
  // Both peers were wrong, in opposite directions, from one defect.
  //
  // A setter whose value the matching getter may not return is unusual and is
  // deliberate: the belief is kept (AC2 reports it, and it is what makes the
  // belief-vs-socket disagreement observable), it is simply no longer the
  // answer. `muxBelieved` / `controlBelieved` expose it under its own name.
  private muxBelief = false;
  private controlBelief = false;
  private muxBeliefChangedAt: number | null = null;
  private controlBeliefChangedAt: number | null = null;
  /** WP82 — once-then-count state for the sharing announcement (AC5/AC6). */
  private sharingAnnouncement: AnnouncementState = NO_ANNOUNCEMENT;
  /** WP88 (AC3) — once-then-count state for the severance announcement. */
  private severanceAnnouncement: AnnouncementState = NO_ANNOUNCEMENT;
  /** WP88 (AC6) — once-then-count state for the offline-queue seal. */
  private queueSealAnnouncement: AnnouncementState = NO_ANNOUNCEMENT;
  /**
   * WP88 (AC3) — the last severance, or `null` while nothing has severed. Held
   * so the rig and the status surface can read WHY a peer stopped sharing
   * without inferring it, and cleared by a successful re-arm.
   */
  private lastSeverance: { cause: SeveranceCause; links: LinkName[]; at: number } | null = null;

  get muxConnected(): boolean {
    return isLinkUp(this.muxLinkSnapshot());
  }
  set muxConnected(value: boolean) {
    if (this.muxBelief !== value) {
      this.muxBelief = value;
      this.muxBeliefChangedAt = Date.now();
    }
  }
  get controlConnected(): boolean {
    return isLinkUp(this.controlLinkSnapshot());
  }
  set controlConnected(value: boolean) {
    if (this.controlBelief !== value) {
      this.controlBelief = value;
      this.controlBeliefChangedAt = Date.now();
    }
  }
  /** WP82 (AC2) — the peer's own belief, under its own name. Never the verdict. */
  get muxBelieved(): boolean {
    return this.muxBelief;
  }
  get controlBelieved(): boolean {
    return this.controlBelief;
  }

  private manifestHandlerQueue: Promise<void> = Promise.resolve();
  // WP86 (AC6) — what the manifest-change route decided, most recent pass, plus
  // a BOUNDED history. A single "last" slot is not enough to audit this route:
  // the passes are queued and several can run between two reads, so the pass
  // that refused would routinely be overwritten by the next one before anybody
  // could see it — silence again, one step over.
  private manifestChangePasses = 0;
  private lastManifestChange: ManifestChangeDisposition | null = null;
  private manifestChangeHistory: ManifestChangeDisposition[] = [];
  private static readonly MANIFEST_CHANGE_HISTORY_MAX = 40;
  // WP79: the mirror pass is serialised against itself. It is armed at six
  // sites, several of which can fire close together (a join whose manifest
  // changes a moment later), and two concurrent passes would race each other's
  // `isSubscribed` / `localFileExists` observations.
  private canvasMirrorQueue: Promise<void> = Promise.resolve();

  // --- WP82: the definer, its facts, and its consumers ----------------------
  //
  // WIRING AND A READ ONLY. Every decision below is taken by the pure
  // zero-import module `sync/link-state.ts`; nothing in this file decides what
  // "connected" means. That separation is the §7 abort criterion this WP was
  // chartered under, and it is why the same question cannot drift apart again
  // at N call sites the way `main.ts` and `control-handlers.ts` each answered a
  // fragment of it before.

  /** Live facts about the control link. `readyState` is read from the socket. */
  private controlLinkSnapshot() {
    return (
      this.controlChannel?.getLinkSnapshot(this.controlBelief) ?? {
        link: "control" as const,
        hasSocket: false,
        readyState: LINK_READY_STATE.ABSENT,
        believedConnected: this.controlBelief,
        reconnectAttempts: 0,
        maxReconnectAttempts: 0,
        retryChainEnded: false,
        lastChangeAt: this.controlBeliefChangedAt,
        silenced: false,
      }
    );
  }

  /** Live facts about the mux link. `readyState` is read from the socket. */
  private muxLinkSnapshot() {
    return (
      this.syncManager?.getLinkSnapshot(this.muxBelief) ?? {
        link: "mux" as const,
        hasSocket: false,
        readyState: LINK_READY_STATE.ABSENT,
        believedConnected: this.muxBelief,
        reconnectAttempts: 0,
        maxReconnectAttempts: 0,
        retryChainEnded: false,
        lastChangeAt: this.muxBeliefChangedAt,
        silenced: false,
      }
    );
  }

  /** The facts the definer decides over. Assembled here, decided there. */
  private peerLinkFacts(): PeerLinkFacts {
    return {
      control: this.controlLinkSnapshot(),
      mux: this.muxLinkSnapshot(),
      sessionActive: this.sessionManager?.isActive === true,
      role: this.settings?.role ?? null,
      offlineQueueDepth: this.fileOpsManager?.getOfflineState().queueDepth ?? 0,
      connectionState: this.connectionState?.getState() ?? "disconnected",
    };
  }

  /**
   * WP82 (AC6) — THE call. Consumer 1 of 3 in this file
   * (`updateOnlineState`, `updateStatusBar`, `linkReport`).
   */
  getSharingVerdict(facts: PeerLinkFacts = this.peerLinkFacts()): SharingVerdict {
    return decideSharing(facts);
  }

  /**
   * WP82 (AC2) — the per-link report the rig reads. Every field is read at call
   * time from the socket or from the definer; not one is a literal, and not one
   * is an echo of `muxConnected` / `controlConnected` under a second name —
   * those two ARE the values this defect corrupted, so `believedConnected` is
   * reported separately from `readyState` precisely so the two can be seen to
   * disagree.
   */
  linkReport(): Record<string, unknown> {
    const facts = this.peerLinkFacts();
    const verdict = this.getSharingVerdict(facts);
    const offline = this.fileOpsManager?.getOfflineState() ?? {
      online: false,
      queueDepth: 0,
      acceptingIntoQueue: true,
      refusedWhileSealed: 0,
    };
    const describe = (snapshot: PeerLinkFacts["control"] | PeerLinkFacts["mux"]) => ({
      link: snapshot.link,
      hasSocket: snapshot.hasSocket,
      readyState: snapshot.readyState,
      readyStateName: readyStateName(snapshot.readyState),
      // The peer's own belief — the pre-WP82 latch — under its own name.
      believedConnected: snapshot.believedConnected,
      // `true` when the belief contradicts the socket. THE discriminating field.
      beliefDisagrees: snapshot.believedConnected !== isLinkUp(snapshot),
      up: isLinkUp(snapshot),
      reconnectAttempts: snapshot.reconnectAttempts,
      maxReconnectAttempts: snapshot.maxReconnectAttempts,
      retryChainEnded: snapshot.retryChainEnded,
      lastChangeAt: snapshot.lastChangeAt,
      silenced: snapshot.silenced,
    });
    return {
      readAt: Date.now(),
      links: { control: describe(facts.control), mux: describe(facts.mux) },
      offlineQueueDepth: offline.queueDepth,
      fileOpsOnline: offline.online,
      // WP88 (AC6) — BESIDE the landed depth, never instead of it. The depth
      // alone cannot distinguish "the queue stopped growing" from "nothing was
      // produced"; the refusal counter is what makes that testable.
      offlineQueueAccepting: offline.acceptingIntoQueue,
      offlineQueueRefused: offline.refusedWhileSealed,
      // WP88 (AC3/AC4) — PRESENCE ONLY. No credential value, no length that is
      // a fingerprint, and no fragment of any socket URL.
      severance: this.severanceReport(),
      sharing: verdict.sharing,
      roleBacked: verdict.roleBacked,
      role: facts.role,
      sessionActive: facts.sessionActive,
      connectionState: facts.connectionState,
      state: verdict.state,
      healthy: verdict.healthy,
      downLinks: verdict.downLinks,
      endedLinks: verdict.endedLinks,
      desyncedLinks: verdict.desyncedLinks,
      reason: verdict.reason,
      // Read back from the LIVE status-bar element, not recomposed.
      statusBarText: this.statusBarEl?.textContent ?? null,
    };
  }

  /**
   * WP82 (AC3) — the ONLY production-side entry to the break seam, and it is
   * called from `plugin/src/testing/` alone. `testing/` is dead-code-eliminated
   * from the production bundle by `__LS_E2E__`, so this method is unreachable
   * in a production build; it is also reachable from no UI, command, setting or
   * message handler. A link that has no channel object is a NAMED REFUSAL at
   * the boundary, before any state is touched (I11 / WP72 precedent).
   */
  private breakSeq = 0;
  e2eBreakLink(link: LinkName, shape: "close" | "silence"): Record<string, unknown> {
    const before = this.linkReport();
    let result: Record<string, unknown>;
    if (link === "control") {
      if (!this.controlChannel) {
        throw new Error("refused: no control channel exists on this instance");
      }
      result = this.controlChannel.breakLink(shape);
    } else {
      if (!this.syncManager) {
        throw new Error("refused: no mux channel exists on this instance");
      }
      result = this.syncManager.breakLink(shape);
    }
    this.breakSeq += 1;
    this.logger?.log("connection", `${link} link broken by e2e seam (shape=${shape})`);
    return {
      breakId: this.breakSeq,
      ...result,
      readyStateBeforeName: readyStateName(result.readyStateBefore as number),
      readyStateAfterName: readyStateName(result.readyStateAfter as number),
      reportBefore: before,
      reportAfter: this.linkReport(),
    };
  }

  /** WP82 (AC3) — the restore half. Required, and its effect is asserted. */
  e2eRestoreLink(link: LinkName): Record<string, unknown> {
    let result: Record<string, unknown>;
    if (link === "control") {
      if (!this.controlChannel) {
        throw new Error("refused: no control channel exists on this instance");
      }
      result = this.controlChannel.restoreLink();
    } else {
      if (!this.syncManager) {
        throw new Error("refused: no mux channel exists on this instance");
      }
      result = this.syncManager.restoreLink();
    }
    this.logger?.log("connection", `${link} link restored by e2e seam`);
    return {
      ...result,
      readyStateAfterName: readyStateName(result.readyStateAfter as number),
      reportAfter: this.linkReport(),
    };
  }

  /**
   * WP82 (AC4/AC5) — narration and the once-then-count announcement. Wiring:
   * the channels emit facts, `link-state.ts` renders and decides, this method
   * routes the result to the logger, the toast and the status bar.
   */
  private onLinkLifecycle(event: LinkLifecycleEvent): void {
    const line = describeLifecycle(event);
    if (event.kind === "gave-up") {
      this.logger?.error("connection", line);
    } else if (event.kind === "abandoned") {
      this.logger?.warn("connection", line);
    } else {
      this.logger?.log("connection", line);
    }
    this.updateOnlineState();
    this.updateStatusBar();
  }

  /**
   * WP82 (AC5/AC6) — one `Notice` on the transition into an unhealthy state,
   * subsequent occurrences COUNTED rather than repeated, and a recovery
   * re-arms. A toast per backoff tick at 300 ms base delay would be a worse
   * defect than the silence it replaces, so the announcement is bound to the
   * STATE and never to the retry.
   */
  private announceSharingState(verdict: SharingVerdict): void {
    const key = announcementKey(verdict);
    const decision = nextAnnouncement(this.sharingAnnouncement, key);
    this.sharingAnnouncement = decision.state;
    if (decision.announce) {
      this.logger?.warn("connection", `not sharing: ${verdict.reason} (announced once)`);
      new Notice(sharingNoticeText(verdict));
    } else if (key !== null) {
      this.logger?.debug(
        "connection",
        `not sharing: ${verdict.reason} (occurrence ${decision.count}, not re-announced)`,
      );
    } else if (decision.rearmed) {
      this.logger?.log("connection", "sharing restored — announcement re-armed");
    }
  }

  /**
   * WP88 — the control link's four transitions, as a NAMED METHOD.
   *
   * Extracted verbatim from the closure that used to sit inside `connectSync`,
   * with only the two connectivity arms changed. It is a method rather than a
   * closure for one reason that matters: as a closure it could be driven only
   * by booting the entire plugin, so the branch that DESTROYED THE SESSION on a
   * dropped socket had no reachable seam and was never exercised by anything.
   *
   * The `connected` and `reconnecting` arms are byte-unchanged.
   */
  handleControlState(controlState: "connected" | "reconnecting" | "disconnected" | "auth-required") {
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
      // WP82 (AC1) — THE ROLE GATE IS GONE. This callback fires from the
      // control socket's `onopen`, i.e. at a moment when the socket is
      // provably usable, and that is a fact about the LINK. Gating it on
      // `role === "host"` made it one of two mutually exclusive role-gated
      // sites, and a peer that resumed as guest and was promoted a
      // millisecond later fell between both and was never marked again for
      // the life of the session.
      //
      // Marking it here is not the "set it unconditionally" mistake: this is
      // the peer's BELIEF, and `controlConnected` is now derived from the
      // socket's live `readyState` by the pure definer, so a dead link cannot
      // report healthy however this belief is set.
      this.controlConnected = true;
      this.updateOnlineState();
      this.presenceManager?.broadcastPresence();
      if (this.backgroundSync.isRunning()) {
        this.onActiveFileChange();
      }
    } else if (controlState === "reconnecting") {
      this.controlConnected = false;
      this.connectionState.transition({ type: "reconnecting" });
      this.updateOnlineState();
    } else if (controlState === "auth-required") {
      // WP88 — ROUTES E2 and E3, SEVERED. This branch is S39, both halves.
      //
      // The DESTRUCTIVE half: `auth-required` is emitted at exactly three
      // sites in `control-ws.ts` — the socket-construction throw (E3) and the
      // two `everConnected === false` selectors on `onclose` / the exhausted
      // ceiling (E2) — and all three used to end the session. E2 is E1 with
      // one boolean flipped, so repairing one arm of that branch and not the
      // other would have left a network outage still clearing credentials on
      // the first-connect path.
      //
      // The MISLABELLING half: the old `Notice` read "authentication required
      // - sign in via settings". That is a claim about the SERVER'S ANSWER,
      // made in exactly the case where there was no answer at all —
      // `everConnected` is false, so this peer has never heard from the relay
      // on this link. After WP88 the credentials are still present and may
      // well be valid, so instructing the user to fix them would be telling
      // them to repair something that is probably not broken, for a session
      // that has not ended. The replacement names BOTH possibilities and
      // asserts neither; see `severanceNoticeText`.
      this.controlConnected = false;
      this.connectionState.transition({ type: "auth-expired" });
      this.haltSharing("never-established");
    } else {
      // WP88 — ROUTE E1, SEVERED. The control chain exhausted its ceiling
      // (10 attempts, 300 ms base ×2 capped at 30 s ⇒ ≈128 100 ms) after
      // having connected at least once. `endSession()` here meant a laptop
      // lid closed for two minutes destroyed the room for every participant.
      this.controlConnected = false;
      this.connectionState.transition({ type: "disconnect" });
      if (this.sessionManager.isActive && !this.isEndingSession) {
        this.haltSharing("retry-exhausted");
      } else {
        this.updateOnlineState();
      }
    }
  }

  /**
   * WP88 — ROUTE E4, SEVERED. The mux ceiling: 15 attempts, 100 ms base, ×2
   * capped at 30 s. The old body raised "sync connection lost, ending session"
   * and then ended it, so a peer whose network dropped lost its `roomId`, its
   * `token`, both crypto keys, its `role` and its `permission` — and if it
   * happened to be host, the room itself, for everyone still connected fine.
   */
  handleMuxExhausted() {
    this.logger?.error("sync", "mux channel exhausted reconnect attempts");
    this.haltSharing("retry-exhausted");
  }

  updateOnlineState() {
    // WP82 — consumer 1 of the definer. Was
    // `this.muxConnected && this.controlConnected`, i.e. the conjunction of two
    // latches; now the conjunction of two MEASUREMENTS, taken by one definer.
    // This is the call that decides whether a file op goes on the wire or into
    // the offline queue.
    this.fileOpsManager.setOnline(this.getSharingVerdict().sharing);
    // WP88 (AC6) — WIRING ONLY. Whether the queue may still accept is decided
    // by `acceptsIntoOfflineQueue` over the definer's verdict, so the seal and
    // the online state cannot drift apart at two call sites the way `main.ts`
    // and `control-handlers.ts` each held a fragment of "connected" before
    // WP82. The line above is left EXACTLY as WP82 landed it — `wp82`'s
    // structural test pins that expression literally, and hoisting the verdict
    // into a local (which is what this WP first did) reddened it. WP88 holds no
    // §7 licence of any class, so the assertion wins and the verdict is simply
    // read a second time; `getSharingVerdict` is pure over facts read at call
    // time, so the two reads cannot disagree in a way that matters.
    const verdict = this.getSharingVerdict();
    const accepting = acceptsIntoOfflineQueue(verdict, FILE_OP_CARRIER_LINK);
    this.fileOpsManager.setQueueAccepting(accepting);
    this.announceQueueSeal(verdict);
  }

  /**
   * WP88 (AC6) — announce the seal ONCE, then count. Reuses WP82's landed
   * `nextAnnouncement` reducer verbatim rather than authoring a second
   * discipline; only the KEY differs, because "this peer is not sharing" and
   * "this peer has stopped accepting work" are different facts and a user who
   * was told the first is still entitled to be told the second.
   */
  private announceQueueSeal(verdict: SharingVerdict): void {
    const key = offlineQueueSealKey(verdict, FILE_OP_CARRIER_LINK);
    const decision = nextAnnouncement(this.queueSealAnnouncement, key);
    this.queueSealAnnouncement = decision.state;
    if (decision.announce) {
      const offline = this.fileOpsManager.getOfflineState();
      this.logger?.warn(
        "connection",
        `OFFLINE QUEUE SEALED: carrier=${FILE_OP_CARRIER_LINK} retained=${offline.queueDepth} discarded=0`,
      );
      new Notice(offlineQueueSealNoticeText(offline.queueDepth, FILE_OP_CARRIER_LINK));
    } else if (decision.rearmed) {
      this.logger?.log("connection", "offline queue accepting again — seal re-armed");
    }
  }

  /**
   * WP88 — THE SEVERANCE. The non-destructive counterpart to `abortSession`,
   * and the whole repair.
   *
   * Before WP88 five production routes answered "I cannot reach the relay" by
   * calling `SessionManager.endSession()`, which clears SIX settings keys —
   * `roomId`, `token`, `encryptionPassphrase`, `encryptionSalt`, `role`,
   * `permission` — persists them to `data.json`, and, on a host, first issues
   * `DELETE {serverUrl}/rooms/{roomId}`, destroying the room for every
   * participant including the ones whose network is fine.
   *
   * This method stops sharing and keeps the identity. It does not call
   * `sessionManager.endSession()`, it clears no setting, it calls
   * `saveSettings()` for no credential key, and it contacts the relay not at
   * all.
   *
   * ## Why the severance is HERE and not inside `endSession`
   *
   * Making `endSession` conditional on why it was called would put the decision
   * inside the destructive function — which is exactly the ambiguity that hid
   * this defect for the length of the project: ONE call answered both "I chose
   * to leave" and "my Wi-Fi died". `endSession`'s body is preserved byte-for-
   * byte for the user path, host `DELETE` included. The severing happens at the
   * CALLER.
   *
   * ## Why it may refuse to destroy
   *
   * Losing the connection is a fact about the network. Losing `roomId` /
   * `token` / `role` is a fact the client MANUFACTURES about itself, on local,
   * negative, momentary evidence — I11's prohibition, and D2's shape one layer
   * above the file system. The costs are asymmetric: stale credentials cost one
   * failed join; discarded good ones cost a fresh invite for every peer, an
   * out-of-band passphrase recovery for an encrypted room (the invite carries
   * only `r` and `t`), and on a host a room that no longer exists for anybody.
   */
  private haltSharing(cause: SeveranceCause): void {
    const verdict = this.getSharingVerdict();
    const links = verdict.endedLinks.length > 0 ? verdict.endedLinks : verdict.downLinks;
    this.lastSeverance = { cause, links, at: Date.now() };
    // A DECLARED new signature (BUILD_SPEC §10). No existing signature, level,
    // category or volume changes.
    this.logger?.error("connection", severanceLogLine(cause, links));

    // Announce once, then count — WP82's landed discipline, reused rather than
    // rebuilt. A toast per backoff tick at 300 ms base delay would be a worse
    // defect than the silence it replaces.
    const decision = nextAnnouncement(
      this.severanceAnnouncement,
      severanceAnnouncementKey(cause, links),
    );
    this.severanceAnnouncement = decision.state;
    if (decision.announce) {
      new Notice(severanceNoticeText(cause, links));
    } else {
      this.logger?.debug(
        "connection",
        `sharing halted again: ${cause} (occurrence ${decision.count}, not re-announced)`,
      );
    }

    // Stop transmitting, and say so on every surface. `updateOnlineState` also
    // seals the offline queue (AC6) through the same verdict.
    this.updateOnlineState();
    this.updateStatusBar();
  }

  /** WP88 (AC3) — the severance, read-only, for the status surface and the rig. */
  severanceReport(): Record<string, unknown> {
    const offline = this.fileOpsManager?.getOfflineState() ?? {
      online: false,
      queueDepth: 0,
      acceptingIntoQueue: true,
      refusedWhileSealed: 0,
    };
    return {
      // S46 — a digest proves WHICH build, not WHOSE.
      buildMarker: WP88_BUILD_MARKER,
      halted: this.lastSeverance !== null,
      cause: this.lastSeverance?.cause ?? null,
      links: this.lastSeverance?.links ?? [],
      at: this.lastSeverance?.at ?? null,
      // PRESENCE ONLY. This WP's subject IS these keys, so the discipline is
      // absolute: they are named here and their values never leave the process.
      sessionIdentityRetained: {
        roomIdPresent: Boolean(this.settings?.roomId),
        tokenPresent: Boolean(this.settings?.token),
        encryptionPassphrasePresent: Boolean(this.settings?.encryptionPassphrase),
        encryptionSaltPresent: Boolean(this.settings?.encryptionSalt),
        rolePresent: this.settings?.role !== null && this.settings?.role !== undefined,
        permissionPresent: Boolean(this.settings?.permission),
      },
      offlineQueueAccepting: offline.acceptingIntoQueue,
      offlineQueueRefused: offline.refusedWhileSealed,
    };
  }

  /**
   * WP88 (AC3) — THE WAY BACK, reachable from the product.
   *
   * Retention without a re-arm is a worse state than the destruction it
   * replaces: a peer that keeps its credentials and can never use them again
   * has a session that reports itself alive with no edge that can restore it —
   * WP82's own defect, rebuilt by WP88's repair. That is why the re-arm ships
   * in the same work package and not a later one.
   *
   * It re-arms both links through their production `rearm()` seams, which
   * deliberately do NOT reset "has this link ever connected" (S39). Three
   * distinct dead states are reachable and all three are covered, because
   * `shouldConnect = false` is set at three sites in `control-ws.ts` and is
   * cleared by nothing but a fresh `connect()`: the exhausted ceiling, the
   * socket-construction throw, and `destroy()`.
   *
   * If the plugin-load resume itself failed (E5) there may be no control
   * channel at all, in which case re-arming a channel that does not exist would
   * be a no-op that reports success. That case re-runs the resume instead.
   */
  async rearmSharing(): Promise<Record<string, unknown>> {
    if (!this.sessionManager?.isActive) {
      new Notice("Live Share: keine aktive Sitzung");
      return { rearmed: false, reason: "no active session" };
    }
    const before = this.linkReport();
    if (!this.controlChannel) {
      // E5's way back: the resume never got far enough to build a channel.
      this.logger?.log("session", "re-arm: no control channel — resuming session again");
      await this.resumeSession();
      this.severanceAnnouncement = NO_ANNOUNCEMENT;
      this.lastSeverance = null;
      this.updateOnlineState();
      this.updateStatusBar();
      return {
        rearmed: true,
        via: "resume",
        reportBefore: before,
        reportAfter: this.linkReport(),
      };
    }
    const control = this.controlChannel.rearm();
    const mux = this.syncManager?.rearm() ?? null;
    // S143 (A3) — RE-DRIVE THE PATHS `subscribe()` GAVE UP ON.
    //
    // The two links re-arm above; without this line the DOCUMENTS did not.
    // `subscribe()` abandons a path when `getDoc` answers `null` (the manager
    // was neither connected nor connecting) or when `waitForSync` times out,
    // and nothing re-drove it until the next `startAll` — i.e. until the user
    // left and rejoined. That is the permanence half of `S143`, and this is the
    // gesture that already means "try again" (`WP88`, `WP114`), so the recovery
    // belongs on it rather than on a timer a hidden renderer would clamp
    // (`S147`).
    //
    // Only RETRYABLE give-ups are in that set: a cancelled subscribe and a
    // released document never entered it. `I11` — refusal never destroys.
    //
    // GUARDED, and not for tidiness: this awaits `subscribe()` once per
    // abandoned path, and each of those touches the vault and the relay. A
    // recovery that can take down the re-arm it is part of — after both links
    // have already been re-armed above — would be a worse defect than the one
    // it repairs. It reports rather than swallows, which is this package's whole
    // subject.
    let resubscribed: Awaited<ReturnType<BackgroundSync["retryAbandonedSubscribes"]>> | null =
      null;
    try {
      resubscribed = (await this.backgroundSync?.retryAbandonedSubscribes()) ?? null;
    } catch (err) {
      this.logger?.error("connection", "re-arm: re-subscribing abandoned paths failed", err);
    }
    // The announcement re-arms, so a second outage announces again.
    this.severanceAnnouncement = NO_ANNOUNCEMENT;
    this.lastSeverance = null;
    this.logger?.log(
      "connection",
      `re-arm requested by user: control(wasEnded=${control.wasChainEnded}, started=${control.reconnectStarted}) mux(wasEnded=${mux?.wasChainEnded ?? "n/a"}, started=${mux?.reconnectStarted ?? "n/a"})`,
    );
    this.updateOnlineState();
    this.updateStatusBar();
    new Notice("Live Share: Verbindung wird erneut aufgebaut");
    return {
      rearmed: true,
      via: "rearm",
      control,
      mux,
      // S143 — carried up so the rig can READ the recovery instead of inferring
      // it from a file that started changing again. `null` means the sync was
      // not built yet, which is a different answer from `{attempted: 0}`.
      resubscribed: resubscribed ?? null,
      reportBefore: before,
      reportAfter: this.linkReport(),
    };
  }

  private requestBinaryFile = (path: string) => {
    this.controlChannel?.send({ type: "sync-request", path });
  };

  private mutePathEvents = (path: string) => this.fileOpsManager.mutePathEvents(path);
  private unmutePathEvents = (path: string) => this.fileOpsManager.unmutePathEvents(path);

  /**
   * D2 — the retry that keeps the evidence gate from becoming a permanent "no".
   *
   * `cleanupStaleFiles` refuses whenever no live host has published this
   * session, which at resume/join time is the NORMAL state: the guest is usually
   * up before the host has republished. Without a retry the refusal would be
   * final and stale files would never be cleaned — the safe answer would also be
   * the useless one. Here the decision is simply re-asked every time a host
   * publishes, which is the exact event that creates the evidence.
   *
   * Deliberately SEPARATE from `registerManifestChangeHandler`, and deliberately
   * armed earlier than it. Folding the two together meant moving
   * `registerManifestChangeHandler` ahead of `syncFromManifest` and
   * `backgroundSync.startAll("guest")` on the guest paths — and that reordering
   * measurably broke canvas node deletion reaching the guest (E2E scenario [06]
   * went 19/19 -> 17/19 on the same two instances, and back to 19/19 when the
   * order was restored). The retry needs to be armed early; the file-level
   * manifest handler must NOT be. Two concerns, two registrations, and the
   * pre-existing call order is left exactly as it was.
   */
  /**
   * WP80 — WIRING ONLY. One log line per publication, at every call site.
   *
   * There is deliberately NO branch here over manifest or sync state: the
   * decision is taken by the pure core inside `ManifestManager` and this method
   * only forwards what it was handed. Its whole job is that "I published a
   * purging manifest", "I published additively because I could not know the set
   * was complete" and "I could not publish at all" stop being one observation —
   * the same silence class that made the original data loss invisible in the
   * logs until the files were noticed missing.
   */
  private logPublishDecision(site: string, decision: ManifestPublishDecision) {
    this.logger.log(
      "manifest",
      `publish[${site}] verdict=${decision.verdict} published=${decision.published} ` +
        `purged=${decision.purged} entries=${decision.entries} ` +
        `deleted=${decision.deleted.length} unaccounted=${decision.unaccounted.length} — ${decision.reason}`,
    );
  }

  private armStaleReconcileRetry() {
    this.manifestManager.setPublicationChangeHandler(() => {
      if (this.settings.role !== "guest") return;
      this.manifestHandlerQueue = this.manifestHandlerQueue
        .then(async () => {
          const decision = await this.cleanupStaleFiles();
          if (decision.trashed.length > 0) {
            this.notify(`Live Share: removed ${decision.trashed.length} file(s) not on the host`);
          }
        })
        .catch((err) => {
          this.logger.error("manifest", "stale reconcile failed", err);
        });
    });
  }

  /**
   * WP86 — what the vault actually holds at a path, classified BEFORE any
   * decision is taken. `getAbstractFileByPath` returns `TAbstractFile | null`,
   * and the old removal loop tested only `if (file)` before handing whatever it
   * got to `trashFile` — which is how a retired parent-directory entry could
   * take a folder and everything inside it.
   */
  private classifyLocal(localPath: string): LocalKind {
    const file = this.app.vault.getAbstractFileByPath(localPath);
    if (!file) return "absent";
    if (file instanceof TFile) return "file";
    if (file instanceof TFolder) return "folder";
    return "other";
  }

  /** WP86 (AC6) — what the most recent manifest-change passes decided. */
  getLastManifestChangeDisposition(): {
    latest: ManifestChangeDisposition | null;
    recent: ManifestChangeDisposition[];
  } {
    return { latest: this.lastManifestChange, recent: [...this.manifestChangeHistory] };
  }

  private recordManifestChange(disposition: ManifestChangeDisposition): void {
    this.lastManifestChange = disposition;
    this.manifestChangeHistory.push(disposition);
    if (this.manifestChangeHistory.length > LiveSharePlugin.MANIFEST_CHANGE_HISTORY_MAX) {
      this.manifestChangeHistory.splice(
        0,
        this.manifestChangeHistory.length - LiveSharePlugin.MANIFEST_CHANGE_HISTORY_MAX,
      );
    }
    this.logger.log(
      "manifest",
      `change[pass=${disposition.pass}] added=${disposition.added.length} ` +
        `removed=${disposition.removed.length} updated=${disposition.updated.length} ` +
        `renamed=${disposition.renamed.length} delegated=${disposition.delegated.length} ` +
        `destroyed=${disposition.destroyed.length} aborted=${disposition.aborted}` +
        (disposition.error ? ` error=${disposition.error}` : ""),
    );
    for (const removal of disposition.removals) {
      if (removal.verdict === REMOVAL_DECISION.NOTHING_TO_DESTROY) continue;
      this.logger.log(
        "manifest",
        `change[pass=${disposition.pass}] removal ${removal.verdict} ${removal.path} — ${removal.reason}`,
      );
    }
    for (const rename of disposition.renames) {
      if (rename.verdict === RENAME_DECISION.RENAME) continue;
      this.logger.log(
        "manifest",
        `change[pass=${disposition.pass}] rename refused ${rename.oldPath} -> ${rename.newPath} — ${rename.reason}`,
      );
    }
  }

  /**
   * WP86 — A MANIFEST ENTRY DISAPPEARING IS NOT A LICENCE TO DESTROY A LOCAL
   * FILE. See `files/manifest-removal-decision.ts` for the full argument; the
   * two things that changed here are:
   *
   *  - **The trash sink is gone.** This handler no longer calls `trashFile` at
   *    all. A vanished key with a local file behind it is DELEGATED to
   *    `cleanupStaleFiles`, the one landed sink that holds an evidence gate
   *    (host refusal, `hasFreshPublication`, a live host claim, the empty-manifest
   *    floor). Nothing is re-derived here and that method is byte-unchanged.
   *  - **The rename arm requires content identity.** It used to fall back to
   *    `orderedAdded = added` when `matchRenamesByHash` produced no pair, and
   *    then renamed the user's file onto the first arbitrary added key — a shape
   *    that is ROUTINE, because `publishManifest` writes its entry `set`s and
   *    its purge `delete`s in one `doc.transact`.
   *
   * The intra-handler ORDER is unchanged (rename arm -> `syncFromManifest` ->
   * removals -> binary re-requests -> `armCanvasMirrorPass`), and so are the
   * five registration sites: moving either cost the data-loss batch canvas E2E
   * `[06]` (19/19 -> 17/19).
   */
  private registerManifestChangeHandler() {
    this.manifestManager.setManifestChangeHandler((added, removed, updated) => {
      this.manifestHandlerQueue = this.manifestHandlerQueue
        .then(async () => {
          const disposition: ManifestChangeDisposition = {
            pass: ++this.manifestChangePasses,
            added: [...added],
            removed: [...removed],
            updated: [...updated],
            removals: [],
            renames: [],
            renamed: [],
            delegated: [],
            destroyed: [],
            reconcile: null,
            aborted: false,
            error: "",
          };
          this.lastManifestChange = disposition;
          try {
            await this.processManifestChange(added, removed, updated, disposition);
          } catch (err) {
            // WP86 (AC6) — the `.catch` below is no longer the ONLY trace of a
            // pass that aborted mid-way. A throw anywhere here still skips
            // `syncFromManifest`, the removal loop and the canvas mirror for
            // this event; it now says so as observable state, not only as a log
            // line.
            disposition.aborted = true;
            disposition.error = err instanceof Error ? err.message : String(err);
            throw err;
          } finally {
            this.recordManifestChange(disposition);
          }
        })
        .catch((err) => {
          this.logger.error("manifest", "handler error", err);
        });
    });
    // D2 — also arm the retry here, so the HOST paths get it too. Inert while
    // this peer is host (the callback returns immediately on any non-guest
    // role), and live the moment it is demoted — which is exactly the peer most
    // in need of it, since `demoteToGuest` no longer reconciles by itself.
    // `setPublicationChangeHandler` unobserves any previous observer, so calling
    // it again on the guest paths is idempotent rather than a second listener.
    this.armStaleReconcileRetry();
  }

  private async processManifestChange(
    added: string[],
    removed: string[],
    updated: string[],
    disposition: ManifestChangeDisposition,
  ) {
    const renamedOldPaths = new Set<string>();
    const renamedNewPaths = new Set<string>();
    const renameRefusalsReported = new Set<string>();
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
          // Unreadable file — no content identity is available for it, and
          // WP86 refuses to move a file it cannot identify.
        }
      }
      const manifestEntries = this.manifestManager.getEntries();
      // S159 — the pairer now REFUSES when content equality is the only
      // evidence, and it says so per removed key in every branch (S155). The
      // ledger is logged below rather than dropped: a pairer that recorded only
      // its successes would make "it ran and refused" byte-identical to "it
      // never ran", which is the reading that cost this project a round.
      const pairing = pairRenamesByIdentity(
        removed,
        added,
        (p) => removedHashes.get(p),
        (p) => manifestEntries.get(p)?.hash,
      );
      const preferredNew = pairing.pairs;
      disposition.renamePairing = pairing.ledger;
      for (const row of pairing.ledger) {
        this.logger.log(
          "manifest",
          `change[pass=${disposition.pass}] pairing ${row.outcome} ${row.oldPath} -> ` +
            `${row.newPath ?? "<none>"} — ${row.reason}`,
        );
      }

      for (const oldPath of removed) {
        // The hash-matched target is tried first. WP86 — it is also the ONLY
        // target the destructive half will accept; the old positional
        // fallback (`orderedAdded = added`) paired an arbitrary vanished key
        // with an arbitrary added key and renamed the user's file onto it.
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
            const renameDecision = decideManifestRename({
              oldPath,
              newPath,
              hasContentPair: preferred === newPath,
              // S159 — WHY the pairer believes these are the same file, so the
              // core can refuse a basis that is not an identity basis instead
              // of trusting a bare boolean it cannot interrogate.
              identityBasis:
                preferred === newPath
                  ? pairing.ledger.find((row) => row.oldPath === oldPath)?.outcome
                  : undefined,
              oldKind:
                oldFile instanceof TFile ? "file" : oldFile instanceof TFolder ? "folder" : "other",
              newExists: false,
            });
            if (renameDecision.verdict !== RENAME_DECISION.RENAME) {
              // One reported refusal per removed key, not one per candidate
              // pairing — the reason is a property of the key, not of the pair.
              if (!renameRefusalsReported.has(oldPath)) {
                renameRefusalsReported.add(oldPath);
                disposition.renames.push(renameDecision);
              }
              continue;
            }
            disposition.renames.push(renameDecision);
            renamedOldPaths.add(oldPath);
            renamedNewPaths.add(newPath);
            this.fileOpsManager.mutePathEvents(localOld);
            this.fileOpsManager.mutePathEvents(localNew);
            try {
              const parentDir = localNew.substring(0, localNew.lastIndexOf("/"));
              if (parentDir) await ensureFolder(this.app.vault, parentDir, this.logger);
              await this.app.vault.rename(oldFile, localNew);
              disposition.renamed.push(newPath);
            } finally {
              // WP93 (C93 AC3) — P6. Was a bare `setTimeout(...,
              // VAULT_EVENT_SETTLE_MS)`, which a clamped renderer stretches to
              // ~60 s. Same stated ceiling, but the vault `rename` this call
              // just caused now decides the ordinary case. Both endpoints are
              // muted and one event releases both.
              this.fileOpsManager.armMuteRelease([localOld, localNew], {
                consumes: ["rename"],
              });
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
            // Bookkeeping only — nothing on disk is touched by this branch. The
            // local vault has already applied the rename (the file-op route is
            // faster than the manifest), so this only keeps `backgroundSync`'s
            // subscriptions in step. Left exactly as it was.
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
      // S147 — PHASE 1, and it is the other half of the defect. The loop below
      // is SERIAL and it sits on `manifestHandlerQueue`, so before this line
      // existed the second announced path's document was created only once the
      // first one's settle had finished — and on a guest that settle waited for
      // the host's seed with a fixed hop count, which a backgrounded renderer
      // stretches from 2 s to minutes. Sixteen of sixteen live guest/file pairs
      // read `docExists: false`: the loop had not reached them yet, and would
      // not for as long as the window stayed hidden. Registering the whole
      // batch first is synchronous, consults no timer, and does exactly what
      // `subscribe()`'s own first statement does — only where a neighbour
      // cannot prevent it. The loop is otherwise byte-unchanged.
      this.backgroundSync.registerAnnounced(actuallyAdded);
      for (const path of actuallyAdded) {
        if (isTextFile(path)) {
          await this.backgroundSync.onFileAdded(path);
        }
      }
    }
    // WP86 — THE TRASH SINK THAT USED TO BE HERE IS GONE.
    //
    // What stood here was:
    //
    //     const file = this.app.vault.getAbstractFileByPath(toLocalPath(path));
    //     if (file) await this.app.fileManager.trashFile(file);
    //
    // — no role guard, no evidence gate, no completeness check, and no
    // `instanceof TFile`. It destroyed a user file on the strength of a key
    // disappearing from a `Y.Map`, for every peer, on any peer's authority, and
    // it handed a `TFolder` straight to `trashFile` whenever a parent-directory
    // entry was retired for bookkeeping.
    //
    // The non-destructive work — `backgroundSync.onFileRemoved`, which is
    // memory-only (timers, observers, `releaseDoc`) — still runs in EVERY
    // branch: I11, a refusal never destroys and never cancels the pass.
    const manifestNow = this.manifestManager.getEntries();
    let delegateToGatedRoute = false;
    for (const path of actuallyRemoved) {
      this.backgroundSync.onFileRemoved(path);
      const decision = decideManifestRemoval({
        path,
        localKind: this.classifyLocal(toLocalPath(path)),
        stillInManifest: manifestNow.has(path),
      });
      disposition.removals.push(decision);
      if (decision.verdict === REMOVAL_DECISION.DELEGATED) {
        disposition.delegated.push(path);
        delegateToGatedRoute = true;
      }
    }
    if (delegateToGatedRoute) {
      // The ONE landed, gated sink. `cleanupStaleFiles` is byte-unchanged: it
      // refuses outright on a host, requires `hasFreshPublication` past this
      // peer's connect baseline by somebody other than itself, requires a peer
      // present claiming host, keeps D3's empty-manifest floor, iterates
      // `vault.getFiles()` (so a folder can never reach `trashFile`), and mutes
      // path events around the trash. Nothing of that is re-derived here.
      const reconcile = await this.cleanupStaleFiles();
      disposition.reconcile = reconcile;
      disposition.destroyed = [...reconcile.trashed];
    }
    if (disposition.destroyed.length > 0)
      this.notify(`Live Share: removed ${disposition.destroyed.length} file(s)`);

    if (updated.length > 0) {
      for (const path of updated) {
        const entry = this.manifestManager.getEntries().get(path);
        if (entry?.binary) {
          this.requestBinaryFile(path);
        }
      }
    }
    // WP79 — THE RETRY, and it is not optional wiring.
    //
    // The guest's mirror needs a PUBLISHED GUID, and only the host can
    // mint one (`resolveGuidForSubscribe` refuses to mint on a guest, by
    // C27). At a simultaneous start the guest's own pass can easily run
    // before the host's guid lands, and an unresolvable identity is a
    // skip — correctly, but permanently if nothing re-asks. The guid
    // arrives as a manifest entry change, so the decision is re-asked on
    // exactly the event that creates the evidence, in the precedent of
    // `armStaleReconcileRetry`. Unconditional rather than gated on
    // `added`/`updated`: a path whose file the guest already has costs one
    // adapter `exists` and skips.
    this.armCanvasMirrorPass();
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
      // WP81 wiring only: the sink's announcement channel must not be the sink
      // that is failing. The logger decides *whether* and *how often* to
      // announce; main.ts only supplies the toast.
      (message: string) => {
        new Notice(message);
      },
    );
    // US6: SyncManager measures the awareness keep-alive gap whether or not a logger is
    // attached, but only reports `AWARENESS GAP:` once one is. Attached here, right after
    // the DebugLogger exists, because SyncManager is constructed before it.
    this.syncManager.setLogger(this.logger);
    // S129 AC5 — a refused bind leaves the buffer untouched, which from outside
    // is indistinguishable from "nothing happened", so it has to be logged.
    // Wired HERE, below the `DebugLogger` assignment, and not beside
    // `new CollabManager()` where it started: S104's guard caught that the
    // first placement handed a consumer `this.logger` before it existed. The
    // guard was right and the placement was wrong.
    this.collabManager.setLogger(this.logger);
    // S134 AC3 — WIRING ONLY, and the whole point is that `collabBoundFile`
    // stops lying. `onActiveFileChange` sets it SYNCHRONOUSLY before the async
    // activation (deliberately — see the comment there) and nothing ever unset
    // it when that activation failed, so a note whose bind timed out reported
    // "bound" to every internal reader while its editor held no `yCollab` at all.
    //
    // Guarded on identity: an activation that resolves LATE must not clear a
    // flag the user has already moved on from, which is the same stale-write
    // trap the `.then()` at `onActiveFileChange` was removed to avoid.
    //
    // The single-writer invariant does not weaken: `setActiveFile(sharedPath)`
    // is set on the line above `setCollabBoundFile(sharedPath)` and both
    // consumers (`handleLocalTextModify`, the `Y.Text` observer) test the
    // ACTIVE-file identity first, so an open-but-unbound file is still refused
    // by the gate that precedes this one.
    this.collabManager.setBindStateSink(makeBindStateSink(this.backgroundSync));
    // WP93 (C93 AC4) — WIRING ONLY. `MUTE OVERRUN:` has exactly one emitter, in
    // `files/file-ops.ts`; this is the only thing that gives it somewhere to
    // say it.
    //
    // S104: this line used to sit beside the `new FileOpsManager(...)` above,
    // which is FIFTEEN LINES ABOVE `this.logger` being assigned — so the
    // manager was handed `undefined` and, since nothing calls `setLogger` on it
    // again, kept `undefined` for the plugin's whole life. `logger!` suppressed
    // the compiler and `this.logger?.warn(...)` suppressed the crash, so BOTH
    // of this manager's signatures — `MUTE OVERRUN:` and `PROTECTED PATH
    // REFUSED: arm=apply-remote-op` — were unreachable in every real session
    // this project has ever run. It lives here now for the same reason
    // `syncManager` above does: after the sink exists, not before.
    this.fileOpsManager.setLogger(this.logger);
    // S137 — the two writers that hold the EMPTY-WRITE FLOOR had no sink at all,
    // so `EMPTY WRITE REFUSED:` (and three `PROTECTED PATH REFUSED:` arms) could
    // only ever reach `console.warn`. The floor fired twice on an ordinary
    // rejoin and the paths could not be attributed, which is the whole of S137.
    //
    // HERE, in this block, for the reason the two lines above already state: the
    // sink has to exist before a consumer is handed it. Both managers are
    // constructed roughly forty lines above `this.logger`, so wiring them at
    // their `new` — which is where a reader would naturally put it — is exactly
    // the S104 defect, and `?.` on the field would have hidden it just as well
    // the second time.
    this.manifestManager.setLogger(this.logger);
    this.backgroundSync.setLogger(this.logger);
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

  // WP92 (C92 AC4 / S64): `async` so the store's queued writes can be AWAITED.
  // Obsidian ignores the returned promise, which is why the entire pre-existing
  // teardown stays ABOVE the first await and therefore still runs synchronously
  // — the await is appended, never interleaved.
  async onunload() {
    // S125 AC6c — the THIRD session-end path. `onunload` does not call
    // `cleanupSession()`, so without this line a normal Obsidian quit during an
    // active session would leave the stamp stale and the next join would
    // preserve every divergent file. Safe, but it would make the gate inert —
    // the S116 B14 lesson, which was exactly a feature that looked wired and
    // was not. Guarded on an ACTIVE session: stamping on an ordinary quit with
    // no session would move the timestamp forward and start classifying real
    // offline edits as stale, which is the unsafe direction.
    if (this.sessionManager?.isActive) this.stampSessionEnd();
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
    // WP117: in-flight requests and their timers belong to ONE session.
    this.canvasCreate?.reset();
    this.canvasCreate = null;
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

    // WP92 (C92 AC4 / S64) — THE LAST THING, AND THE ONLY AWAIT.
    //
    // WP90 built `save()` to extend its queue synchronously so that a caller
    // which then awaits `idle()` waits for THAT save, and then nothing ever
    // awaited it: a refusal recorded microseconds before a hard kill was lost,
    // and so was WP92's own one-shot migration. Bounded inside
    // `flushSeedRefusalStore`, never rethrowing, so an unwritable store still
    // unloads the plugin.
    await this.flushSeedRefusals();
  }

  /**
   * WP92 (C92 AC3 + AC4): land the store's writes, then name what nobody asked for.
   *
   * Serialised on {@link seedRefusalFlush} so the two destroy paths cannot race
   * each other into two concurrent flushes of one queue. `reportUnmatched()` runs
   * AFTER the flush because the migration is itself a re-key: reporting first
   * would name an entry the flush is about to move.
   */
  private flushSeedRefusals(): Promise<void> {
    const store = this.seedRefusalStore;
    if (!store) return this.seedRefusalFlush;
    this.seedRefusalFlush = this.seedRefusalFlush
      .then(async () => {
        await flushSeedRefusalStore(store, { logger: this.logger });
        store.reportUnmatched();
      })
      .catch(() => {
        /* a teardown that cannot narrate must still be a teardown */
      });
    return this.seedRefusalFlush;
  }

  private async resumeSession() {
    this.logger.log("session", `resuming as ${this.settings.role}`);
    try {
      await this.connectSync();
      await this.manifestManager.connect(this.syncManager);
      if (this.settings.role === "host") {
        // WP80 call site 1 of 4 (`resumeSession`, host arm). Wiring only: the
        // publication decision is taken inside `ManifestManager` by the pure
        // core, and is logged here so a refusal is never silent.
        this.logPublishDecision(
          "resume-host",
          await this.manifestManager.publishManifest({ purge: true }),
        );
        await this.backgroundSync.startAll("host");
        this.registerManifestChangeHandler();
        // WP79 entry point 2 (rejoin/resume), host arm.
        this.armCanvasMirrorPass();
      } else {
        // D2 — the RETRY is armed before the first reconcile attempt, because
        // that attempt is expected to refuse (the host has almost certainly not
        // republished yet) and the host's publication must not arrive with
        // nothing listening. Only the retry moves; `registerManifestChangeHandler`
        // stays exactly where it always was — see `armStaleReconcileRetry`.
        this.armStaleReconcileRetry();
        // S116 — BEFORE the first reconcile and before `syncFromManifest`.
        this.captureVaultBaseline();
        await this.cleanupStaleFiles();
        await this.manifestManager.syncFromManifest(
          this.mutePathEvents,
          this.unmutePathEvents,
          this.requestBinaryFile,
        );
        await this.backgroundSync.startAll("guest");
        this.registerManifestChangeHandler();
        // WP79 entry point 2 (rejoin/resume), guest arm. AFTER
        // `registerManifestChangeHandler`, so no pre-existing call order moves —
        // the [06] regression of the D2 batch was caused by exactly that.
        this.armCanvasMirrorPass();
      }
      this.onActiveFileChange();
    } catch {
      // WP88 — ROUTE E5, SEVERED. This bare `catch` wraps the WHOLE resume —
      // `cleanupStaleFiles`, `syncFromManifest`, `backgroundSync.startAll` and
      // the canvas mirror pass — and it used to route ANY throw at plugin load
      // to `abortSession`, i.e. to `SessionManager.endSession()`: six settings
      // keys cleared and persisted, and on a host a `DELETE /rooms/{roomId}`
      // first. That is not a retry ceiling. It is an UNCLASSIFIED EXCEPTION
      // treated as a decision to leave, and it reaches the destruction with no
      // ceiling at all — which is why the census that found it had to be by
      // reachability rather than by searching for `endSession`.
      //
      // `abortSession` keeps its other three callers (`startSession` and the
      // two join paths), which are NOT connectivity give-ups: a session that
      // failed to START has no identity worth retaining. Those are out of
      // WP88's scope and are deliberately left alone.
      this.logger.error("session", "failed to resume session");
      this.haltSharing("resume-failed");
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

  /**
   * S119 AC5 — the empty-write refusal ledger, exposed so a live validator can
   * read it. A refusal by construction leaves NO other trace: the file is
   * unchanged, which is indistinguishable from "nothing happened" from outside.
   * Routed through the plugin rather than imported by the e2e module, whose
   * import allow-list is frozen on purpose.
   */
  getEmptyWriteRefusals(): { total: number; byArm: Record<string, number> } {
    return getEmptyWriteRefusals();
  }

  /**
   * S141 — the PUBLISH floor's ledger. The write floor above answers "what did
   * this peer refuse to write"; this one answers "what did this peer refuse to
   * SAY", which is the half that turned out to be able to destroy a file on
   * somebody else's disk.
   *
   * Every branch is counted, including both branches that publish, so a live
   * reading can never be ambiguous between "the floor allowed it" and "the floor
   * was never reached" — S155's lesson, in the ledger this package added.
   */
  getAttestationDecisions(): AttestationLedger {
    return getAttestationDecisions();
  }

  /**
   * S142 — the single-writer ledger. A declined write leaves no trace by
   * construction: the file is unchanged, which is exactly what "the arm never
   * ran" also looks like. Both `subscribe()` arms report here.
   */
  getSingleWriterDeclines(): SingleWriterDeclines {
    return getSingleWriterDeclines();
  }

  /**
   * S125 AC10 — the join notice, which used to read "synced N file(s)" while
   * quietly replacing the user's own edits with the host's. If any local
   * version was preserved, the notice says how many and where; a user who is
   * not told a copy was made cannot go and find it.
   */
  private joinSyncNotice(syncedCount: number): string {
    const copies = this.manifestManager.getLastSyncConflictCopies();
    const base = `Live Share: joined session, synced ${syncedCount} file(s)`;
    if (copies === 0) return base;
    const root = conflictsRootFor(this.settings.sharedFolder);
    return `${base}. ${copies} local version(s) differed and were preserved in "${root}"`;
  }

  /**
   * S125 AC10 — the conflict-copy ledger, for a live validator.
   *
   * S148 — `discarded` is part of the contract, not an extra. A live round read
   * `{total: 0, byArm: {}, failed: 0}` off this surface and concluded the guard
   * had never run; the reading was equally consistent with the guard running and
   * deciding DISCARD, and nothing here could tell the two apart.
   */
  getConflictCopies(): ConflictCopyLedger {
    return getConflictCopies();
  }

  /**
   * S143/S144/S157 — the give-up ledger, for a live validator.
   *
   * The three arms it covers all fail by SURVIVING: a path drops out of the
   * session, a path's join reconciliation is skipped, a folder is not created —
   * and in every case the product keeps running and reports healthy. There is
   * no other trace to read, which is why this surface exists.
   *
   * Every branch of all three arms increments, including the successes, so a
   * zero cell means "this arm did not run for this path" and nothing else
   * (`S155`).
   */
  getPathOutcomes(): PathOutcomeLedger {
    return getPathOutcomes();
  }

  /**
   * S143 — which paths `subscribe()` gave up on and why, right now. The ledger
   * above is cumulative; this is the CURRENT set that a re-arm would re-drive.
   * Terminal give-ups (cancelled, released) are deliberately absent from it.
   */
  getAbandonedSubscribes(): Record<string, string> {
    return this.backgroundSync?.getAbandonedSubscribes() ?? {};
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

  /**
   * D2/D3 — reconcile local shared files against the host's manifest, and the
   * one place in this plugin that deletes a user's file on the strength of
   * something NOT being present.
   *
   * ## What went wrong
   *
   * This method used to read
   *
   * ```ts
   * const manifest = this.manifestManager.getEntries();
   * if (manifest.size === 0) return;                 // D3
   * // ... trashFile() every shared local file not in `manifest`
   * ```
   *
   * and on 2026-08-05 it destroyed `hello.md` and `second.canvas` from a real
   * vault. The chain: both peers came back from a restart believing they were
   * guests (D1), so **nobody published a manifest**; the relay replayed the last
   * persisted one; it was non-empty, so the `size === 0` guard (D3) let it
   * through; and every shared file the stale manifest happened not to mention
   * was trashed to the Recycle Bin.
   *
   * The defect is not the guard being too narrow. It is that the code asked the
   * wrong question. "Is the manifest empty?" is a question about a data
   * structure. The question that had to be asked is about the WORLD:
   *
   *     has a live host, during this session, told me this file is gone?
   *
   * "The manifest does not list it" answers that question only if somebody
   * published the manifest. Otherwise it means "nobody told me" — and nobody
   * told me is not permission to delete. This is I11 one level up: an absence of
   * information translated into a destructive action.
   *
   * ## The rule now
   *
   * Deletion requires POSITIVE EVIDENCE, expressed as two independent
   * conditions that must BOTH hold, each of which fails closed on its own:
   *
   *  1. `hasFreshPublication()` — the manifest carries an attestation whose
   *     `seq` advanced past the value present when we connected, i.e. a host
   *     actually published while we were online. Replayed persistence, a
   *     hostless session, and a host that has not published yet all fail this.
   *  2. a peer currently present in the session claims to be host. The
   *     attestation says somebody spoke; this says somebody is still there.
   *
   * Neither condition is a heuristic that can be tuned. Both are statements
   * about whether an assertion was made, and by whom.
   *
   * Everything else — no host, stale manifest, unconfirmed connection, a
   * manifest never published this session — returns a REFUSAL. A refusal is not
   * a failure: it is the correct answer to "I don't know", and it leaves every
   * byte where it was (I11 REFUSAL NEVER DESTROYS).
   *
   * Callers must not treat a refusal as final. The decision is retried from the
   * publication observer ({@link registerManifestChangeHandler}), so the
   * legitimate cleanup still happens — the moment the evidence arrives, and not
   * one instant before.
   */
  /**
   * S116 — snapshot the vault as it stands BEFORE the session delivers
   * anything. Must be called on the guest arm immediately ahead of the first
   * {@link cleanupStaleFiles}.
   *
   * WHY THIS INSTANT IS THE RIGHT ONE, and not merely a convenient one: at all
   * three guest entry points the first `cleanupStaleFiles()` already runs
   * BEFORE `syncFromManifest()`. So at the moment this is called, every file in
   * the vault is by definition the user's own — the session has not written a
   * byte. No ledger, no per-write bookkeeping and no new persisted file are
   * needed to know what the session did not bring; it is the complement of what
   * it later adds, and it is knowable in one `getFiles()`.
   *
   * WHAT IT DOES NOT SURVIVE: a plugin reload or an Obsidian restart. On the
   * next `resumeSession` the baseline is re-taken, and files a PREVIOUS session
   * delivered are then indistinguishable from the user's own — so they become
   * protected. That direction is deliberate: the failure mode is a stale file
   * that outlives the host's deletion of it, which is untidy. The other
   * direction is destroying a user's note, which is the incident this whole
   * subsystem exists because of. Durable cross-restart provenance needs a
   * per-write delivery ledger; see the S116 report for why that is a package of
   * its own and not a line here.
   */
  private captureVaultBaseline(): void {
    this.vaultBaseline = new Set(
      this.app.vault.getFiles().map((file) => toCanonicalPath(normalizePath(file.path))),
    );
    this.logger.log(
      "manifest",
      `pre-join vault baseline captured: ${this.vaultBaseline.size} file(s) pre-date this session`,
    );
  }

  public async cleanupStaleFiles(): Promise<StaleReconcileDecision> {
    const refuse = (rule: StaleReconcileRule, reason: string): StaleReconcileDecision => {
      this.logger.log("manifest", `stale reconcile refused [${rule}]: ${reason}`);
      return {
        ran: false,
        reason,
        candidates: 0,
        trashed: [],
        scope: null,
        rule,
        withheldPreExisting: 0,
      };
    };

    if (this.settings.role === "host") {
      return refuse(
        STALE_RECONCILE_RULE.HOST,
        "this peer is the host; the host is the source of the manifest, not a consumer",
      );
    }
    // Condition 1 — somebody published while we were online.
    if (!this.manifestManager.hasFreshPublication(this.userId)) {
      const pub = this.manifestManager.getPublication();
      return refuse(
        STALE_RECONCILE_RULE.NO_PUBLICATION,
        pub
          ? `no manifest publication observed this session (last attestation seq=${pub.seq} ` +
              "predates this connection, so it proves only that a host once existed)"
          : "no host has ever published a manifest for this room",
      );
    }
    // Condition 2 — that somebody is still here.
    const liveHost = Array.from(this.remoteUsers.values()).find((user) => user.isHost);
    if (!liveHost) {
      return refuse(
        STALE_RECONCILE_RULE.NO_LIVE_HOST,
        "a manifest was published but no peer in this session claims to be host",
      );
    }

    const manifest = this.manifestManager.getEntries();
    // Retained as a third, redundant floor. It is NOT the gate — an empty
    // manifest from a live, freshly-publishing host is a legitimate "the shared
    // folder is empty", but the cost of being wrong here is the whole shared
    // tree, so this one stays paranoid.
    if (manifest.size === 0) {
      return refuse(
        STALE_RECONCILE_RULE.EMPTY_MANIFEST,
        "the freshly published manifest is empty; refusing to empty the shared folder",
      );
    }

    // Condition 4 (S115) — WHAT RANGE DID THE HOST ACTUALLY SPEAK ABOUT?
    //
    // This filter used to be `isSharedPath`, i.e. the LOCAL peer's
    // `sharedFolder`. That field ships EMPTY and empty means "the whole vault",
    // so a guest who never opened the setting selected its entire vault and
    // then removed everything the host's manifest — which describes only the
    // host's subfolder — failed to mention. Private notes were not an edge
    // case of that; they were the bulk of it.
    //
    // "What do I publish?" and "what does the host govern?" are two questions.
    // Only the second one may scope a deletion, and only the host can answer
    // it, so it is read off the host's own attestation.
    const scope = this.manifestManager.getHostSharedScope();
    if (!scope.known) {
      // I11 — REFUSAL NEVER DESTROYS. There is no safe fallback to guess here:
      // the natural default for a shared folder is `""`, which means the entire
      // vault, so guessing wrong in the permissive direction is precisely the
      // data loss. An older host that publishes no scope is a real deployment
      // and it lands here, on purpose, doing nothing at all.
      return refuse(
        STALE_RECONCILE_RULE.UNKNOWN_SCOPE,
        `the host's shared folder is unknown: ${scope.reason}`,
      );
    }

    // Condition 5 (S116) — CONSENT, for the one scope whose blast radius is
    // everything.
    //
    // S115 made a SCOPED host safe. It did not change anything for a host in
    // the default configuration, which publishes `sharedRoot: ""` — a scope
    // that is perfectly KNOWN and happens to mean "all of it". So the guest
    // sailed through the fail-closed branch and reconciled its whole vault, and
    // the only party ever asked to confirm that arrangement was the host.
    if (scope.root === "" && !this.settings.allowWholeVaultReconcile) {
      // Loud, not silent. A reconcile that quietly stops running is the S114
      // shape — a safe-looking default that removes a behaviour the user still
      // believes they have — so the refusal is surfaced, not just logged.
      this.notify(
        "Live Share: the host shares their entire vault. Stale-file cleanup is OFF " +
          "until you enable “Allow whole-vault cleanup” in Live Share settings.",
      );
      return refuse(
        STALE_RECONCILE_RULE.WHOLE_VAULT_NO_CONSENT,
        `host ${liveHost.userId} shares its ENTIRE vault, so every local file this ` +
          "manifest omits would be trashed; this guest has not enabled whole-vault cleanup",
      );
    }

    // Condition 6 (S116) — PROVENANCE. Scoping asks WHERE; this asks WHOSE.
    //
    // A file that was in this vault before the guest joined was never the
    // host's to delete, no matter which folder it sits in. That is the property
    // no amount of scoping can express, and it is why this family of defects
    // kept needing another fix: S115 narrowed the range and a pre-existing note
    // INSIDE the host's range was still destroyed.
    //
    // The baseline is captured at session start, which is exactly the instant
    // at which "everything in this vault is mine" is true — `cleanupStaleFiles`
    // runs BEFORE `syncFromManifest` at all three guest entry points, so
    // nothing the session delivers has landed yet. That ordering was previously
    // just an awkward fact (the first reconcile almost always refuses); here it
    // is the enabling one.
    //
    // `null` means the baseline was never taken, and that REFUSES. A future
    // entry point that forgets to capture it therefore fails closed instead of
    // silently treating the user's whole vault as the session's property.
    const baseline = this.vaultBaseline;
    if (!baseline) {
      return refuse(
        STALE_RECONCILE_RULE.NO_BASELINE,
        "no pre-join vault baseline was captured for this session, so which files " +
          "pre-date the join is unknowable and none of them can be shown to be the session's",
      );
    }

    const manifestPaths = new Set(manifest.keys());
    const localFiles = this.app.vault
      .getFiles()
      .filter((file) => this.manifestManager.isWithinSharedRoot(file.path, scope.root));
    const absentFromManifest = localFiles.filter(
      (file) => !manifestPaths.has(toCanonicalPath(normalizePath(file.path))),
    );
    const stale = absentFromManifest.filter(
      (file) => !baseline.has(toCanonicalPath(normalizePath(file.path))),
    );
    const withheldPreExisting = absentFromManifest.length - stale.length;

    const trashed: string[] = [];
    for (const file of stale) {
      this.fileOpsManager.mutePathEvents(file.path);
      try {
        await this.app.fileManager.trashFile(file);
        trashed.push(file.path);
      } finally {
        // WP93 (C93 AC3) — P7. `trashFile` emits a vault `delete`; a file that
        // was already gone emits nothing at all, and that is precisely the case
        // the ceiling still has to catch.
        this.fileOpsManager.armMuteRelease(file.path, { consumes: ["delete"] });
      }
    }
    const scopeLabel = scope.root === "" ? "<entire vault>" : scope.root;
    const reason =
      `host ${liveHost.userId} published a manifest of ${manifest.size} entry/entries this ` +
      `session, scoped to ${scopeLabel}; ${withheldPreExisting} candidate(s) withheld as ` +
      "pre-dating this join";
    // S115 AC5 — UNCONDITIONAL. This used to fire only when something was
    // trashed, which made the two outcomes that matter most indistinguishable:
    // "I ran and selected nothing" and "I ran and selected your whole vault but
    // every file happened to be in the manifest" both logged silence. The scope
    // and the size of the candidate set are exactly what a reviewer needs to see
    // BEFORE the count of what was destroyed, so both are stated every time.
    this.logger.log(
      "manifest",
      `stale reconcile ran [${STALE_RECONCILE_RULE.RAN}]: scope=${scopeLabel} ` +
        `candidates=${stale.length} withheldPreExisting=${withheldPreExisting} ` +
        `trashed=${trashed.length} — ${reason}`,
    );
    return {
      ran: true,
      reason,
      candidates: stale.length,
      trashed,
      scope: scope.root,
      rule: STALE_RECONCILE_RULE.RAN,
      withheldPreExisting,
    };
  }

  /**
   * S125 AC6c — stamp the moment this peer's session ended.
   *
   * The whole set of session-end paths is THREE, and it is three rather than
   * two because `onunload` does NOT call `cleanupSession()` — verified by
   * reading it, and pinned by a source-derivation test rather than left to a
   * later reader to rediscover. `cleanupSession()` itself covers `endSession`
   * and `abortSession`, which are its only two callers.
   *
   * Fire-and-forget on the save: if the write does not land (a crash, a kill),
   * the stamp stays old or absent, and an absent stamp PRESERVES. The failure
   * mode of this method is therefore extra copies, never lost work.
   */
  private stampSessionEnd(): void {
    this.settings.lastSessionEndedAt = Date.now();
    void this.saveSettings();
  }

  cleanupSession() {
    // S125 — the two callers of this method are `endSession` and
    // `abortSession`; both are genuine session ends.
    this.stampSessionEnd();
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
    // WP117: in-flight requests and their timers belong to ONE session.
    this.canvasCreate?.reset();
    this.canvasCreate = null;
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
    // S123 — a watcher describes ONE session's docs. Leaving them observing a
    // doc that is about to be destroyed would re-arm a mirror pass for a
    // session that has ended.
    for (const path of Array.from(this.canvasRecordWatchers.keys())) {
      this.unwatchCanvasForRecords(path);
    }
    this.lastCanvasMirrorReport = null;
    // S116 — a baseline describes ONE session. Carrying it into the next one
    // would license deletions against a vault snapshot taken before a different
    // host's share; `null` makes the next reconcile refuse until it is retaken.
    this.vaultBaseline = null;
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
    // An EMPTY `sharedFolder` is not "unset" — `isInSharedFolder` returns true
    // for every path, so the session shares the whole vault, and a guest's
    // deletes and renames come back through `applyRemoteOp` onto the host's own
    // files. That is a legitimate and documented mode; what it must not be is
    // SILENT, because empty is also the shipped default, so a user who never
    // opened this setting reaches the widest possible sharing by doing nothing.
    //
    // Placed here and not in `sessionManager.startSession()` deliberately: this
    // is the only surface a human reaches (command palette, ribbon, settings
    // button — three callers, all human). The e2e control server never calls
    // it, so the rig cannot be blocked by a modal it has no way to answer.
    if (sharesEntireVault(this.settings.sharedFolder)) {
      const proceed = await this.confirm(
        "No shared folder is set, so this session will share your ENTIRE vault.\n\n" +
          "Everyone who joins can see every note, and their deletions, renames and " +
          "moves will be applied to your vault.\n\n" +
          "Set a shared folder in Settings → Live Share to limit what is shared.",
      );
      if (!proceed) {
        this.notify("Live Share: session cancelled — no shared folder set");
        return;
      }
    }
    this.isStartingSession = true;
    try {
      const ok = await this.sessionManager.startSession();
      if (ok) {
        try {
          await this.connectSync();
          await this.manifestManager.connect(this.syncManager);
          // WP80 call site 2 of 4 (`startSession`). Wiring only.
          this.logPublishDecision(
            "start-session",
            await this.manifestManager.publishManifest({ purge: true }),
          );
          await this.backgroundSync.startAll("host");
          this.registerManifestChangeHandler();
          // WP79 entry point 1 (session start, host).
          this.armCanvasMirrorPass();
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
          // D2 — only the RETRY is armed early; see `armStaleReconcileRetry`.
          this.armStaleReconcileRetry();
          // S116 — BEFORE the first reconcile and before `syncFromManifest`.
          this.captureVaultBaseline();
          await this.cleanupStaleFiles();
          const syncedCount = await this.manifestManager.syncFromManifest(
            this.mutePathEvents,
            this.unmutePathEvents,
            this.requestBinaryFile,
          );
          await this.backgroundSync.startAll("guest");
          this.registerManifestChangeHandler();
          // WP79 entry point 3 (join).
          this.armCanvasMirrorPass();
          this.onActiveFileChange();
          this.logger.log("session", `joined, room=${this.settings.roomId}`);
          this.notify(this.joinSyncNotice(syncedCount));
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
          // D2 — only the RETRY is armed early; see `armStaleReconcileRetry`.
          this.armStaleReconcileRetry();
          // S116 — BEFORE the first reconcile and before `syncFromManifest`.
          this.captureVaultBaseline();
          await this.cleanupStaleFiles();
          const syncedCount = await this.manifestManager.syncFromManifest(
            this.mutePathEvents,
            this.unmutePathEvents,
            this.requestBinaryFile,
          );
          await this.backgroundSync.startAll("guest");
          this.registerManifestChangeHandler();
          // WP79 entry point 4 (join via invite link).
          this.armCanvasMirrorPass();
          this.onActiveFileChange();
          this.logger.log("session", `joined via link, room=${this.settings.roomId}`);
          this.notify(this.joinSyncNotice(syncedCount));
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
    // WP82 (AC4) — the mux link narrates its own lifecycle. Wired BEFORE
    // `connect()` so the very first open is narrated too; before this WP the
    // mux wiring below recorded nothing at all and `main.ts`'s control-channel
    // callback was the only `"connection"` log site in the entire plugin.
    this.syncManager.onLifecycle((event) => this.onLinkLifecycle(event));
    this.syncManager.connect();
    // WP88 — the two connectivity handlers are NAMED METHODS rather than inline
    // closures. That is not tidying: as closures inside `connectSync` they were
    // reachable only by booting the whole plugin, so the four routes that end a
    // session could not be driven — which is a large part of why a defect this
    // severe survived. They are now individually invocable and individually
    // pinned by the route census.
    this.syncManager.onMaxReconnect(() => this.handleMuxExhausted());
    this.syncManager.onConnectionChange((connected) => {
      this.muxConnected = connected;
      this.updateOnlineState();
      this.updateStatusBar();
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
    // WP82 (AC4/AC5) — the control link's retry chain, its watchdog-forced
    // closes and its three previously-silent exits now reach the logger. The
    // four `onStateChange` transitions it already narrated are UNCHANGED: same
    // signature, same category, same level, same volume.
    this.controlChannel.onLifecycle((event) => this.onLinkLifecycle(event));
    this.controlChannel.onStateChange((controlState) => this.handleControlState(controlState));

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
    // WP117 (S122) — WIRING ONLY. Every member below is a measurement taken from
    // the object that owns it or an action performed by it; there is no
    // conditional over canvas state here and no second copy of any predicate.
    this.canvasCreate = new CanvasCreateCoordinator({
      role: () => (this.settings.role === "host" ? "host" : this.settings.role === "guest" ? "guest" : null),
      send: (message) => {
        const channel = this.controlChannel;
        if (!channel) return false;
        channel.send(message as never);
        return true;
      },
      isSharedPath: (path) => this.manifestManager.isSharedPath(path),
      manifestKnows: (path) =>
        this.manifestManager.getEntries().has(toCanonicalPath(normalizePath(path))),
      isPathSafe: (path) => isPathSafe(path),
      isProtectedPath: (path) => isProtectedPath(path),
      fileExists: (path) => this.app.vault.adapter.exists(toLocalPath(path)),
      readFile: async (path) => {
        try {
          return await this.app.vault.adapter.read(toLocalPath(path));
        } catch {
          return null;
        }
      },
      // The SHARED parser, imported — never a private `JSON.parse`. `degraded`
      // is the one fact that separates "this is not a canvas" from "this is an
      // empty canvas", and an empty canvas is a legitimate thing to create.
      isCanvasDocument: (content) => parseCanvasReport(content).degraded === false,
      createFile: async (path, content) => {
        const diskPath = toLocalPath(path);
        const parentDir = diskPath.substring(0, diskPath.lastIndexOf("/"));
        if (parentDir) await ensureFolder(this.app.vault, parentDir, this.logger);
        // `vault.create`, NOT `adapter.write`, and the difference is load-bearing
        // here: the vault API registers the `TFile` before it resolves, and the
        // manifest publication one step later needs one. It is the same call
        // `applyRemoteOpInner`'s create arm makes.
        //
        // NO PATH MUTE, and that is a decision rather than an omission. Every
        // other remote-originated write in this plugin takes one, because the
        // vault `create` it raises would otherwise be re-emitted as this peer's
        // own authoring gesture. For a `.canvas` on the HOST all three consumers
        // of that event are already correct without one, and each refuses at a
        // line a test can point at:
        //
        //   ├── `FileOpsManager.onFileCreate` refuses the content push for a
        //   │      path `skipsAutoTextSync` claims (WP83);
        //   ├── `BackgroundSync.onFileAdded` refuses the same path with the same
        //   │      predicate, so no second raw `Y.Text` is installed; and
        //   └── `requestCanvasCreate` declines `not-guest` on the host.
        //
        // What the event DOES do is re-publish the manifest entry this method
        // publishes one step later, which is idempotent. A mute here would buy
        // nothing and cost something real: the create would be counted as a
        // `MUTE DROP` on the ledger a live validator reads for swallowed user
        // gestures (S120), where it would be a false positive.
        await this.app.vault.create(diskPath, content);
      },
      publishManifestEntry: async (path, content) => {
        const file = this.app.vault.getAbstractFileByPath(toLocalPath(path));
        if (!(file instanceof TFile)) {
          // Fail LOUDLY rather than quietly leaving a file no peer can resolve.
          // The coordinator turns this into a refusal the guest is shown, which
          // is the whole of A4: a creation that did not work says so.
          throw new Error(`the created canvas is not readable back at ${path}`);
        }
        await this.manifestManager.updateFile(file, content);
      },
      // WP6 AC8: the OBJECT, never a subscribe written in this file. The
      // coordinator issues the call, for the same reason `canvas-mirror.ts`
      // does. See `CanvasCreateEnv.canvasSync`.
      canvasSync: () => this.canvasSync,
      attachWriter: (path) => this.attachCanvasWriter(path),
      identityFor: (path) => this.manifestManager.getCanvasGuid(path),
      // WP122 (S170): an accepted result makes the path adoptable, and nothing
      // else re-asks the mirror. The eleventh call site of this pass; forwarding
      // only, exactly like the other ten.
      armMirrorPass: () => this.armCanvasMirrorPass(),
      notify: (message) => {
        new Notice(message);
      },
      newRequestId: () => crypto.randomUUID(),
      logger: this.logger,
    });
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

    // WP79 / S22 — THE MANIFEST-DRIVEN CANVAS LOOP THAT USED TO LIVE HERE IS
    // GONE, and it is important that it is understood as dead code removal
    // rather than as a behaviour change.
    //
    // It read `this.manifestManager.getEntries()` and subscribed every `.canvas`
    // it found. `connectSync()` is awaited BEFORE `manifestManager.connect(...)`
    // at all four session entry points (`resumeSession`, `startSession`,
    // `joinSession`, `joinWithInvite`), `ManifestManager.connect` is what
    // assigns `this.manifest`, and `getEntries()` is
    // `if (!this.manifest) return new Map();`. `cleanupSession()` calls
    // `manifestManager.destroy()`, which nulls it again, so the state is the
    // same on every subsequent session. THE LOOP ITERATED ZERO ENTRIES, IN
    // EVERY SESSION, FOR BOTH ROLES — always, not on a race. It had never run.
    //
    // It is removed rather than moved for two reasons. It drove
    // `subscribeCanvasWithHandover`, whose unowned branch installs the R10
    // raw-text fallback — over a whole shared folder that would mass-install a
    // second CRDT for every canvas whose guid does not resolve. And the verdict
    // belongs in a testable core, not in an `if` inside this file. Its
    // replacement is `runCanvasMirrorPass()`, armed at the six sites where the
    // manifest is actually populated.
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
    const activeViews = new Map<string, unknown[]>();
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
      // WP85 — the two reads the pass makes about this leaf, taken ONCE and
      // taken HERE, before anything below can move them. `wasSubscribed` in
      // particular is read BEFORE the lazy branch on purpose: `subscribe()`
      // adds to `subscribedPaths` synchronously, so a read taken after it would
      // make a path this very pass has just claimed look like an
      // already-subscribed one and drive the writer attach twice for one open.
      const wasSubscribed = rawPath ? this.canvasSync.isSubscribed(rawPath) : false;
      const isShared = rawPath ? this.manifestManager.isSharedPath(rawPath) : false;
      // Lazily subscribe a shared canvas the user opened AFTER session start. The
      // session-start loop only subscribes canvases present in the manifest at
      // that moment; without this, opening/creating a canvas mid-session leaves it
      // permanently unsubscribed and no presence overlay ever mounts.
      if (rawPath && !wasSubscribed && isShared) {
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
          // ── WP87 — RE-RUN THE PASS ONCE THE SUBSCRIBE HAS RESOLVED ────────
          //
          // MEASURED, and it is why WP37's protection did not exist at all on a
          // guest. `subscribe()` adds to `subscribedPaths` SYNCHRONOUSLY but
          // only creates the doc handle after its first await, and
          // `mountCanvasPresence` bails on `if (!handle) return null;`. So the
          // pass that opens a canvas leaf reaches the mount BEFORE the handle
          // exists, returns null, and — because `syncCanvasPresences` only runs
          // on `layout-change` / `active-leaf-change` — NEVER RETRIES. The leaf
          // then has a disk writer and no CanvasAdapter for the life of the
          // session, which means `reconcileLiveCanvas` returns at its first line
          // and `getEditingNodeId()` cannot be asked by anything.
          //
          // Measured on the live rig (`H:\tmp\liveshare_wp87_adapter_probe.py`,
          // 3/3 rounds): guest `hasAdapter=false` with `hasWriter=true` and
          // `leafOpen=true`, and not one `reconcile <path>:` line in a 15 s
          // window; host `hasAdapter=true` every time, because the host's
          // canvases are already subscribed by WP79's mirror when the leaf opens
          // and the race therefore cannot be lost there.
          //
          // Wiring, not logic: it re-runs the SAME pass, which re-asks every
          // question it already asks. It cannot recurse — the lazy-subscribe
          // branch it re-enters is gated on `!isSubscribed`, which is now true.
          this.syncCanvasPresences();
        });
      }
      const subscribed = rawPath ? this.canvasSync.isSubscribed(rawPath) : false;
      this.logger.debug("canvas", `  leaf path=${rawPath ?? "(none)"} subscribed=${subscribed}`);
      // ── WP85 (C7 / US5 AC13) — THE WRITER-ATTACH CONSULTATION ─────────────
      //
      // Its own question, asked for EVERY open canvas leaf on every pass, not a
      // side effect of the lazy-subscribe branch above. Before WP85 the only
      // leaf-driven `attachCanvasWriter` call lived inside that branch, so a
      // path somebody else had already subscribed — WP79's mirror pass
      // subscribes every shared canvas on the HOST and returns `PUBLISH`
      // without materialising, because C79 AC4 forbids it to write the host's
      // file — consumed the one opportunity and stayed WRITERLESS for the life
      // of the session. The mechanism was never missing; the gate in front of
      // it was wrong.
      //
      // WIRING AND A READ, NO DECISION: the four booleans are measurements, the
      // verdict is `files/canvas-writer-attach-decision.ts`, and exactly one of
      // its five answers licenses the call. `attachCanvasWriter`'s own per-path
      // guard still stands behind this; it is a backstop, never the gate — an
      // "attach whatever, the helper will sort it out" call would attach for
      // paths where `getCanvasDocHandle` returns `null` and fail silently, and
      // it would make ALREADY_ATTACHED unobservable.
      const attachVerdict = decideCanvasWriterAttach({
        hasPath: typeof rawPath === "string" && rawPath.length > 0,
        isShared,
        isSubscribed: wasSubscribed,
        hasWriter: rawPath ? this.hasCanvasWriter(rawPath) : false,
      });
      if (rawPath && attachVerdict === WRITER_ATTACH_VERDICT.ATTACH) {
        this.logger.debug("canvas", `  writer attach verdict for ${rawPath}: ${attachVerdict}`);
        void this.attachCanvasWriter(rawPath);
      }
      if (!rawPath || !subscribed) continue;
      const canonical = toCanonicalPath(normalizePath(rawPath));
      activePaths.add(canonical);
      const viewsForPath = activeViews.get(canonical) ?? [];
      viewsForPath.push(leaf.view);
      activeViews.set(canonical, viewsForPath);
      if (this.canvasPresences.has(canonical)) continue;
      let viewType = "?";
      try {
        viewType = view?.getViewType?.() ?? "?";
      } catch {
        /* ignore */
      }
      this.logger.debug("canvas", `detected canvas leaf path=${rawPath} viewType=${viewType}`);
      const presence = this.mountCanvasPresence(rawPath, leaf.view);
      if (presence) {
        this.canvasPresences.set(canonical, presence);
        this.canvasPresenceViews.set(canonical, leaf.view);
      }
    }
    for (const [path, presence] of this.canvasPresences) {
      const viewsForPath = activeViews.get(path) ?? [];
      const ownerView = this.canvasPresenceViews.get(path);
      if (activePaths.has(path) && ownerView !== undefined && !viewsForPath.includes(ownerView)) {
        // The path is still open, but the exact leaf that owns the adapter was
        // closed. Every path-level repaint route would otherwise keep addressing
        // that detached Canvas forever. Hand ownership to one surviving leaf at
        // the same lifecycle seam that observed the close.
        presence.destroy();
        this.canvasPresences.delete(path);
        this.canvasPresenceViews.delete(path);
        this.canvasAdapters.delete(path);
        this.stopCanvasRepaintSweep(path);
        this.canvasBindings.get(path)?.destroy();
        this.canvasBindings.delete(path);
        this.canvasModelBridges.get(path)?.destroy();
        this.canvasModelBridges.delete(path);

        const replacementView = viewsForPath[0] as
          | { file?: { path?: string }; getViewType?: () => string }
          | undefined;
        const replacementPath = replacementView?.file?.path;
        if (replacementPath) {
          const replacement = this.mountCanvasPresence(replacementPath, replacementView);
          if (replacement) {
            this.canvasPresences.set(path, replacement);
            this.canvasPresenceViews.set(path, replacementView);
          }
        }
      } else if (!activePaths.has(path)) {
        // WP37 (C37 AC5) — the VIEW-CLOSE exit. Drained BEFORE the adapter is
        // dropped, so the queue never outlives the surface it was held for.
        this.drainCanvasDeferrals(path, "canvas view closed");
        presence.destroy();
        this.canvasPresences.delete(path);
        this.canvasPresenceViews.delete(path);
        this.canvasAdapters.delete(path);
        // B72 (WP3) — the sweep's only clock, stopped with the surface it swept.
        this.stopCanvasRepaintSweep(path);
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

  // ── WP30 (C30): wiring for the explicit "Import from file" command ───────
  //
  // Three members, all of them MEASUREMENT and PLUMBING. Every decision they
  // feed belongs elsewhere: availability is decided by
  // `canvas-import-command.ts`, the sequence by `files/canvas-import.ts`, the
  // epoch and the archive by WP28. `main.ts` holds wiring only.

  /**
   * The `.canvas` path the import command targets, or `null` when there is none.
   *
   * "In context" is the canvas the user is LOOKING AT: the active file, only if
   * it is a `.canvas` AND an open canvas leaf is showing it. The leaf check is
   * what makes a markdown view, a non-canvas file and a closed board all answer
   * `null` — an import aimed at a board the user cannot see is exactly the
   * "timing side effect" C30 exists to abolish.
   *
   * Defensive throughout: Obsidian's Canvas view is private and untyped (I5 —
   * degrade, never break), and this runs inside a `checkCallback` on every
   * palette keystroke.
   */
  // --- WP38 (C38) — undo wiring. THREE members, all of them plumbing. --------
  //
  // Every decision is `canvas/canvas-undo.ts`'s: what is undoable, what the
  // scope is, where one step ends, and what happens at the `text` -> `Y.Text`
  // conversion boundary. What lives here is the path resolution (reusing the
  // ONE existing "canvas in context" definer below rather than writing a
  // second) and the hand-off to the registry `CanvasSync` holds.
  //
  // Deliberately NOT here: any test of whether a step exists, any stack
  // arithmetic, any origin, any scope. "Register a command" is wiring;
  // "decide whether this step is undoable" is not, and putting the second in
  // this file is a §7 abort criterion.

  /** The undo state of the canvas in context. Moves nothing. */
  canvasUndoReport(rawPath?: string | null): CanvasUndoReport {
    const registry = this.canvasSync?.getUndoRegistry();
    const path = rawPath ?? this.activeCanvasPathForImport();
    if (!registry) {
      return {
        available: false,
        path,
        reason: "canvas sync is not running",
        undoDepth: 0,
        redoDepth: 0,
        trackedOrigins: [],
        captureTimeoutMs: 0,
        scope: [],
        managers: 0,
      };
    }
    return registry.report(path === null ? null : toCanonicalPath(normalizePath(path)));
  }

  /** Invoke undo/redo on the canvas in context and return what was MEASURED. */
  runCanvasUndo(kind: "undo" | "redo"): CanvasUndoOutcome {
    const registry = this.canvasSync?.getUndoRegistry();
    const raw = this.activeCanvasPathForImport();
    const path = raw === null ? null : toCanonicalPath(normalizePath(raw));
    if (!registry) {
      return {
        seq: 0,
        path,
        available: false,
        reason: "canvas sync is not running",
        kind,
        popped: false,
        changed: false,
        undoDepthBefore: 0,
        undoDepthAfter: 0,
        redoDepthBefore: 0,
        redoDepthAfter: 0,
      };
    }
    return kind === "undo" ? registry.undo(path) : registry.redo(path);
  }

  /** The mechanism's own receipt for the LAST undo/redo invocation, carrying
   * its own sequence number. Read-only; it moves nothing. */
  canvasUndoLastOutcome(): CanvasUndoOutcome | null {
    return this.canvasSync?.getUndoRegistry().lastOutcome() ?? null;
  }

  /** The command's availability. `true` means "there is a canvas in context
   * whose undo history this client owns" — NOT "there is a step", which is the
   * question the invocation answers and must be free to answer with "no". */
  canvasUndoAvailable(): boolean {
    return this.canvasUndoReport().available;
  }

  activeCanvasPathForImport(): string | null {
    try {
      const rawPath = this.app.workspace.getActiveFile()?.path;
      // `isCanvasPath` (`canvas/canvas-epoch.ts`) rather than a private
      // `endsWith` here: the canvas extension has ONE definition in the tree
      // (`CANVAS_EXT`, contract §1), and this file holds wiring, not the test.
      // Not `skipsAutoTextSync`, which also answers true for the sidecar
      // directory and would offer sidecar state as an import target.
      if (!isCanvasPath(rawPath)) return null;
      const leaves = this.app.workspace.getLeavesOfType("canvas") as Array<{
        view?: { file?: { path?: string } };
      }>;
      if (!leaves.some((leaf) => leaf.view?.file?.path === rawPath)) return null;
      return toCanonicalPath(normalizePath(rawPath));
    } catch {
      return null;
    }
  }

  /**
   * AC4's two conditions for `path`. MEASURED, never decided.
   *
   * `owned` is `canvasOwned(path, this.canvasSync)` — the ONE existing ownership
   * predicate (`files/vault-events.ts`), not a second one written here.
   *
   * `degraded` reads the degradation concepts that already exist for a canvas
   * path, and both of them mean the same thing for this command: THIS CLIENT'S
   * VIEW OF THE BOARD IS KNOWN TO BE INCOMPLETE.
   *
   *   ├── a WITHHOLDING `SeedRefusalLedger` (WP63/I11) — this path's seed refused
   *   │   records, so the write-back is suspended and the doc does not hold
   *   │   everything the file did; and
   *   └── a canvas adapter that is registered but reports UNAVAILABLE — the
   *       private Canvas API went away under an open board (I5 DEGRADE).
   *
   * Both are bars rather than caveats: the import publishes a wholesale
   * replacement computed from a local file, and the confirmation quotes what is
   * about to be lost. On a degraded client the user would be told the wrong
   * thing and would then destroy state they were never shown.
   *
   * A path with NO adapter is not degraded — that is an unopened board, not a
   * broken one, and `owned` already answers for it.
   */
  canvasImportAvailability(path: string): ImportAvailability {
    const canonical = toCanonicalPath(normalizePath(path));
    const owned = canvasOwned(canonical, this.canvasSync);
    const withholding = this.canvasSync?.seedRefusalLedger(canonical).hasRefusals() === true;
    const adapter = this.canvasAdapters.get(canonical);
    const surfaceLost = adapter !== undefined && adapter.isAvailable() !== true;
    return { owned, degraded: withholding || surfaceLost };
  }

  /**
   * Builds the real `ImportFromFileEnv` and calls `runImportFromFile`.
   *
   * `adoptEpochWinner` is the ONLY write channel handed over, which is what
   * makes "cancelling performs no write of any kind" a property of the wiring
   * and not merely of the sequence. The confirmation goes through
   * `confirmImportFromFile`, so the dialog and the summary in the result are
   * built from the same object.
   */
  async runCanvasImportFromFile(path: string): Promise<ImportFromFileResult> {
    const canonical = toCanonicalPath(normalizePath(path));
    return runImportFromFile(canonical, {
      availability: (canvasPath) => this.canvasImportAvailability(canvasPath),
      liveDoc: (canvasPath) => this.canvasSync?.getCanvasDocHandle(canvasPath)?.doc ?? null,
      // Everyone else in the session, NOT only the people whose view happens to
      // be on this board right now. A participant reading another file still
      // holds a replica of this canvas, and that replica is what gets archived
      // and replaced — so filtering on `currentFile` would omit exactly the
      // people whose work is destroyed while they were not looking. Naming one
      // extra collaborator is a mild over-statement; omitting one is the dialog
      // failing at the only job AC3 gives it.
      peers: () =>
        Array.from(this.remoteUsers.values())
          .map((user) => ({ displayName: user.displayName }))
          .filter((peer) => typeof peer.displayName === "string" && peer.displayName.length > 0)
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      readCanvasFile: async (canvasPath) => {
        const diskPath = toLocalPath(toCanonicalPath(normalizePath(canvasPath)));
        try {
          if (!(await this.app.vault.adapter.exists(diskPath))) return null;
          return await this.app.vault.adapter.read(diskPath);
        } catch (err) {
          this.logger.error("canvas-import", `failed to read ${diskPath}`, err);
          return null;
        }
      },
      confirm: (summary) => confirmImportFromFile(this.app, summary),
      adoptEpochWinner: async (canvasPath, winner) =>
        (await this.canvasSync?.adoptEpochWinner(canvasPath, winner)) ?? null,
      notify: (message) => this.notify(message),
      logger: this.logger,
    });
  }

  // Scatter fix: patch the OPEN Obsidian canvas view to match a just-integrated
  // remote delta. Obsidian's open canvas is authoritative over its file and
  // ignores our external .canvas writes, so without this the view stays stale
  // (cards "scattered") until a full reload. Geometry-only changes are applied
  // per-node via moveAndResize (smooth, never interrupts an active drag);
  // structural changes (node/edge add/remove) fall back to a full setData reload.
  //
  // WP89-CORRECTED — "Obsidian's open canvas is authoritative over its file and
  // ignores our external .canvas writes" is FALSE, and this is the DOC COMMENT
  // OF THE METHOD THE WHOLE BRANCH LIVES IN, so it is the site most likely to be
  // read as a map. WP87 measured that an external write rebuilds the open view
  // for a change to ANY card.
  //
  // ⚠ This site is in NEITHER the WP89 charter's §3 table of seven NOR the set a
  // fixed-string grep for the charter's own pins returns — it says "ignores our
  // external .canvas writes", with an extra word. It was found only because AC2's
  // deriver matches the SHAPE of the claim instead of its wording, which is the
  // difference between a census and a hand list, and it is why the filed item's
  // `grep -F "external write"` reported zero and concluded the class was closed.
  //
  // The method is right anyway, and for a stronger reason: it exists so the
  // delta reaches the surface WITHOUT the rebuild, not because the rebuild would
  // fail to happen. The trailing rebuild is the damage — it reseats every card,
  // which is what discards an inline editor's unflushed text. And note the third
  // sentence is now doubly wrong as written: "never interrupts an active drag"
  // is true of `moveAndResize`, but the `defer-drag` arm below leaves the DISK
  // WRITE running, and that write does rebuild the view. See that arm's own
  // WP89 note; it is traced, not measured, and it is not repaired here.
  private reconcileLiveCanvas(
    path: string,
    data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] },
    opts?: { initial?: boolean },
  ): void {
    const canonical = toCanonicalPath(normalizePath(path));
    const adapter = this.canvasAdapters.get(canonical);
    // WP89-CORRECTED — "file sync suffices" is right about the OUTCOME and wrong
    // about the mechanism, and the difference matters because the condition is
    // broader than the comment reads. This early return also fires for an OPEN
    // LEAF WITH NO ADAPTER (the S56 guest race, and the documented
    // private-API-unavailable banner). In that state "file sync suffices" means
    // "the file write rebuilds the view" — which WP87 measured to be TRUE, and
    // which is a far stronger statement than the comment intends. It is also the
    // exact predicate `noteExternalDiskWrite` selects its receipt route on, so
    // the two are complementary by construction rather than by coincidence; see
    // that method's WP89 note and `wp89/test_ac3_route_selector_wiring_visible`.
    if (!adapter || !adapter.isAvailable()) return; // canvas not open → file sync suffices
    // WP5 (C5 AC1): the ONE shared Surface-Shadow, obtained fresh from CanvasSync
    // at every use site. It is both the classifier basis below and the capture
    // basis inside CanvasSync — never a copy, never cached in this file, so
    // `setSurfaceShadow(...)` re-points both roles in the same call.
    const shadow = this.canvasSync?.getSurfaceShadow();
    if (!shadow) return; // canvas sync torn down → nothing to reconcile against
    // WP37 (C37 AC1/AC2): `isBusy()` now answers `true` for TWO states that want
    // opposite treatment, so the gate is no longer a raw predicate read. The two
    // measured facts go into `classifyBusyGate` — pure, tested without Obsidian —
    // and this file executes the verdict it returns.
    const gate = classifyBusyGate({
      busy: adapter.isBusy(),
      editingNodeId: adapter.getEditingNodeId?.() ?? null,
    });
    if (gate === "defer-drag") {
      // Never reconcile mid-drag; the trailing disk write keeps data safe and the
      // next delta (or a manual reload) will catch the view up once idle.
      // UNCHANGED from HEAD, deliberately: WP37 adds an arm, it does not touch this one.
      //
      // WP89-CORRECTED — "the trailing disk write keeps data safe" is TRUE about
      // the DATA and FALSE about the VIEW, and the second half is a live exposure
      // this comment reads as if it had ruled out.
      //
      // The disk write is NOT withheld for a drag: `planCanvasDiskWrite`
      // (`canvas/canvas-editing-deferral.ts:365-415`) withholds only for a
      // POSITIVELY IDENTIFIED inline editor, and a drag is `isBusy()`, not
      // `editingNodeId`. So this arm refuses to touch the surface and the writer
      // touches it ~200 ms later — and under WP87's measurement an external write
      // rebuilds the open view for a change to any card. That is R-C with a drag
      // instead of an editor.
      //
      // ⚠ TRACED, NOT MEASURED. WP89 AC4 owns the live row and B60 did NOT run it
      // (a sibling batch held the shared vaults). Whether Obsidian's drag gesture
      // survives the rebuild is UNKNOWN, not benign. The disposition is fixed
      // either way: it is carried up with its receipt, NOT repaired here —
      // extending the withhold to drags inverts `planCanvasDiskWrite`'s
      // deliberate fail-open direction, against which WP87 §4.2 has a measured
      // counter-example (an over-reporting signal withheld a write and left a
      // stale node in a `.canvas`).
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

    // WP37 (C37 AC2/AC4/AC5): what this pass may put on the surface while an
    // inline editor is open. The DECISION — is a record held, what is substituted,
    // what is queued — is made in `planEditingDeferral`; this file supplies the
    // measured facts and executes the answer.
    const deferral = planEditingDeferral({
      path: canonical,
      desired: data,
      lastApplied: shadowToCanvasRecords(shadow, canonical),
      liveNodeIds,
      liveEdgeIds,
      plan,
      initial: opts?.initial === true,
      editingNodeId: adapter.getEditingNodeId?.() ?? null,
      editingSurfaceRecord:
        adapter.getEditingNodeId && adapter.getNodeFields
          ? adapter.getNodeFields(adapter.getEditingNodeId() ?? "")
          : null,
    });
    this.canvasDeferrals.note(canonical, deferral.deferred, data);
    if (deferral.mode === "proceed") {
      // A `proceed` pass hands FULL shared truth to the surface, so anything
      // withheld by an earlier pass is about to be on screen. Clearing here is
      // the second, event-free drain path: it means a queue can never survive a
      // pass that already superseded it, whatever happened to the blur signal.
      this.canvasDeferrals.clear(canonical);
    }
    if (deferral.mode === "hold") {
      // Nothing reaches the surface, and — this is the half today's drag gate
      // never had — nothing is LOST either: the queue is drained at blur, at view
      // close and at teardown. The disk write is untouched and keeps converging.
      // WP89-CORRECTED — "untouched and keeps converging" is stated
      // UNCONDITIONALLY and it is only conditionally true. WP87's write hold
      // covers this arm when an editor is FOCUSED; with no focused editor the
      // write runs, and under WP87's measurement it rebuilds the open view — so
      // on that sub-case the sentence describes the drag exposure above rather
      // than a safe convergence. Recorded, not repaired: same disposition and
      // same reason as the `defer-drag` arm.
      this.logger.debug(
        "canvas",
        `reconcile ${canonical}: ${deferral.reason} ` +
          `(queued=${this.canvasDeferrals.pending(canonical)})`,
      );
      return;
    }
    // From here on the surface sees `surfaceData`, which IS `data` unless a record
    // was substituted. Everything below is HEAD's code with that one substitution.
    const surfaceData = deferral.surfaceData;
    const heldNodeIds = new Set(deferral.heldNodeIds);

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
        reloaded = adapter.reloadCanvasData({
          nodes: surfaceData.nodes,
          edges: surfaceData.edges,
        });
        this.logger.debug(
          "canvas",
          `reconcile ${canonical}: ${opts?.initial ? "initial " : ""}structural reload ` +
            `${reloaded ? "ok" : "unsupported/skipped"} ` +
            `(nodes ${liveNodeIds.size}->${desiredNodeIds.size}, edges ${liveEdgeIds.size}->${desiredEdgeIds.size})` +
            (heldNodeIds.size > 0 ? ` [${deferral.reason}]` : ""),
        );
      } else {
        let applied = 0;
        let interacting = 0;
        let movedEndpoint = false;
        nodeOutcomes = new Map<string, ApplyOutcome>();
        for (const n of surfaceData.nodes) {
          if (
            typeof n.id !== "string" ||
            typeof n.x !== "number" ||
            typeof n.y !== "number" ||
            typeof n.width !== "number" ||
            typeof n.height !== "number"
          ) {
            continue;
          }
          // WP37: a HELD record is not handed to the surface at all, and its
          // outcome is the SAME `"interacting"` a drag-held card already reports
          // — so the existing receipt seam leaves its shadow fields unadvanced
          // without WP5 learning that editing exists.
          const outcome = heldNodeIds.has(n.id)
            ? "interacting"
            : adapter.applyNodeGeometry(n.id, {
                x: n.x,
                y: n.y,
                width: n.width,
                height: n.height,
              });
          nodeOutcomes.set(n.id, outcome);
          if (outcome === "applied") {
            applied++;
            // B72 (WP2) — THE SECOND HALF OF AN APPLY. `applyNodeGeometry` wrote
            // the model; Obsidian only ENQUEUES the pixels (`moveAndResize` calls
            // `markMoved` and never touches `nodeEl`), behind a
            // `requestAnimationFrame` that a hidden window suspends and behind an
            // `isAttached` gate `virtualize()` controls. We hold the id right
            // here, so this is O(1) and needs no sweep. `repaintNode` refuses on
            // its own for a card the user is dragging or typing in.
            adapter.repaintNode?.(n.id);
            if (edgeEndpoints.has(n.id)) movedEndpoint = true;
          } else if (outcome === "interacting") interacting++;
        }
        // A connected node moved → the live edges need re-routing from authoritative
        // data. Per-node geometry cannot do that, so reload once. Bounded: only fires
        // when a card WITH edges actually moved (isolated-node moves stay smooth).
        if (movedEndpoint) {
          reloaded = adapter.reloadCanvasData({
            nodes: surfaceData.nodes,
            edges: surfaceData.edges,
          });
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
      // WP37: the receipt is built from `surfaceData` — WHAT WAS HANDED TO THE
      // SURFACE — and never from `data`. That is the whole of AC4: a substituted
      // record advances the shadow to the values the surface really took (its own
      // previous ones), so the next capture still diffs against something that was
      // genuinely on screen, and the remote values it did NOT take are the ones
      // sitting in the queue.
      const summary = advanceFromReceipt(
        shadow,
        buildApplyReceipt({
          path: canonical,
          // WP87: the receipt is built from `receiptData`, which is `surfaceData`
          // except for a SUBSTITUTED record — there it keeps the shadow's own
          // previous value, so the shadow is never advanced to the user's
          // unflushed editor text and their next save is still read as intent.
          desired: deferral.receiptData,
          plan,
          reloaded,
          nodeOutcomes,
        }),
      );
      // S83: `handed` GRANTS and `summary.revoked` (the `exhaustive` absent
      // sweep) REVOKES. `noteHandover` merges the two, so a pass that confirmed
      // nothing — a structural reload that did not land, every line `"failed"`
      // — leaves the path's existing licences exactly where they were instead
      // of voiding the whole board. Both arguments come straight out of the one
      // receipt; `main.ts` still decides nothing (BUILD_SPEC §3.1 S11).
      this.surfaceState.noteHandover(canonical, summary.handed, summary.revoked);
    } finally {
      // WP93 (C93 AC3) — P8. A reconcile that reloads the view rewrites the
      // file, so a vault `modify` follows; a reconcile that changed nothing
      // emits none and falls to the ceiling. Note that for a CANVAS-OWNED path
      // the `modify` gate returns through WP91's byte-identity branch, which
      // does not consult the mute and therefore reports no consumption — such a
      // mute is released by the ceiling exactly as it was before WP93. Putting
      // a mute-shaped signal back in front of canvas capture is an abort
      // criterion, so that is the intended outcome and not an oversight.
      this.fileOpsManager.armMuteRelease(diskPath, { consumes: ["modify", "create"] });
    }
  }

  /**
   * WP37 (C37 AC5) — the DRAIN. Wiring: take whatever the queue holds for `path`
   * and re-run one ordinary reconcile pass with it.
   *
   * Three call sites, three different exits, one function:
   *   ├── BLUR       — `adapter.onEditingEnd(...)`, wired at mount
   *   ├── VIEW CLOSE — the presence-teardown sweep, before the adapter is dropped
   *   └── TEARDOWN   — `teardownCanvasPresences()`
   *
   * The drain always CLEARS, whether or not the re-apply can run: at close and at
   * teardown there is no surface left to apply to, and a queue that outlived its
   * adapter would be a leak with a private-API reference in it.
   *
   * Fresh shared truth is preferred over the queued snapshot — by the time an
   * editor is blurred the doc may have moved on again, and re-applying a stale
   * snapshot would put the view back to an intermediate state. The queued
   * snapshot is the fallback for the case where the subscription is already gone.
   */
  private drainCanvasDeferrals(path: string, why: string, attempt = 0): void {
    const canonical = toCanonicalPath(normalizePath(path));
    const drained = this.canvasDeferrals.drain(canonical);
    if (!drained) {
      // Nothing was withheld from the VIEW, so there is nothing a disk write
      // could destroy: release it. The two queues fill independently — the
      // writer flushes on every doc change, the reconcile only on a difference —
      // and a held write stranded here would sit on the file until the next
      // editing session, which is the permanently stale file this repair is not
      // allowed to introduce.
      void this.releaseHeldCanvasWrite(canonical, why);
      return;
    }
    // ── WP87 — MAY THIS DRAIN RUN YET? ──────────────────────────────────────
    //
    // Wiring and a verdict read. The two facts per record are MEASUREMENTS —
    // the card's own fields and the shadow's — and `planCanvasDrain` decides.
    // A blur commits the editor into the node model and THEN saves; the capture
    // runs on that save. A drain that arrives first overwrites the card, and the
    // save that follows then carries the peer's value instead of the user's.
    const adapter = this.canvasAdapters.get(canonical);
    const shadow = this.canvasSync?.getSurfaceShadow();
    const lastApplied = shadow ? shadowToCanvasRecords(shadow, canonical) : null;
    const drainVerdict = planCanvasDrain({
      records: drained.records.map((record) => ({
        id: record.id,
        surface: adapter?.getNodeFields?.(record.id) ?? null,
        lastApplied:
          lastApplied?.nodes.find((node) => node && node.id === record.id) ?? null,
      })),
      attempt,
    });
    if (drainVerdict.mode === "retry") {
      // Put it back exactly as it was and ask again later. The disk write stays
      // held for the same reason: releasing it would rebuild the view from the
      // peer's bytes and destroy the very characters this is waiting for.
      this.canvasDeferrals.note(canonical, drained.records, drained.data);
      this.logger.debug(
        "canvas",
        `reconcile ${canonical}: drain HELD — ${drainVerdict.reason} (${why})`,
      );
      setTimeout(
        () => this.drainCanvasDeferrals(canonical, why, attempt + 1),
        CANVAS_EDIT_DRAIN_DELAY_MS,
      );
      return;
    }
    void this.releaseHeldCanvasWrite(canonical, why);
    this.logger.debug(
      "canvas",
      `reconcile ${canonical}: draining ${drained.records.length} deferred record(s) ` +
        `from ${drained.passes} withheld pass(es) (${why})` +
        (drainVerdict.uncapturedIds.length > 0 ? ` [${drainVerdict.reason}]` : ""),
    );
    const fresh = this.canvasSync?.getCanvasSnapshot(canonical) ?? drained.data;
    this.reconcileLiveCanvas(canonical, fresh);
  }

  /**
   * WP87 (C87 AC3/AC5) — put the withheld `.canvas` bytes on disk.
   *
   * WIRING ONLY, and every step of it mirrors what `CanvasPersistence.writeSnapshot`
   * does around its own write, because the withheld content never reached that
   * method's post-write half:
   *   ├── the echo mute, so our write is not read back as a local modify;
   *   ├── `noteExternalDiskWrite`, which advances the byte echo-breaker; and
   *   └── `flush()` afterwards, because the doc may have moved on during the
   *       hold and the writer's own redundant-write skip would otherwise never
   *       re-emit it.
   *
   * The disk write is DELAYED here, never dropped: the three exits that release
   * it are the three WP37 already has (blur, view close, teardown), and the
   * blur exit fires for a watchdog-released editor too — so a focus flag
   * Obsidian never closed still converges the file rather than stranding it.
   */
  private async releaseHeldCanvasWrite(canonical: string, why: string): Promise<void> {
    const held = this.canvasWriteHolds.release(canonical);
    if (!held) return;
    this.logger.debug(
      "canvas",
      `CANVAS WRITE RELEASED: ${canonical} after ${held.holds} withheld flush(es) (${why})`,
    );
    this.fileOpsManager.mutePathEvents(held.diskPath);
    try {
      await this.app.vault.adapter.write(held.diskPath, held.content);
      this.canvasSync?.noteExternalDiskWrite(canonical, held.content);
    } catch (err) {
      this.logger.warn(
        "canvas",
        `CANVAS WRITE RELEASED: ${canonical} write FAILED (${String(err)})`,
      );
    } finally {
      // WP93 (C93 AC3) — P9. Same shape and the same canvas-ownership caveat as
      // P8 above: an adapter write emits a vault `modify` unless the bytes are
      // identical, in which case the ceiling is the release.
      this.fileOpsManager.armMuteRelease(held.diskPath, { consumes: ["modify", "create"] });
    }
    // The doc may have advanced during the hold; the writer's own flush is the
    // one thing that knows the current projection.
    await this.canvasWriters.get(canonical)?.flush();
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
   * WP79 — arm the shared-canvas mirror pass. WIRING ONLY.
   *
   * Every decision — which paths are considered, what the verdict is per path
   * and per role, whether anything is written — lives in `files/canvas-mirror.ts`
   * and `files/canvas-mirror-decision.ts`. This method constructs, injects and
   * forwards, exactly as `wireCanvasSidecar` does, and holds no conditional over
   * canvas state.
   *
   * NOT AWAITED by its callers. A shared folder with many canvases costs one
   * `getDoc` + one `waitForSync` + one sidecar attach per canvas the guest
   * lacks; blocking the join on that would trade one defect for another, so a
   * slow or failing canvas degrades that canvas alone (I5).
   *
   * `localFileExists` goes through the vault ADAPTER, which is the layer the
   * single writer writes through — not `getAbstractFileByPath`, whose cache does
   * not yet know a file `CanvasPersistence` created a moment ago.
   *
   * `CanvasSync` is forwarded WHOLE rather than as three loose callbacks, so
   * this file states no canvas operation of its own and WP6 AC8's "no direct
   * canvas subscribe in `main.ts`" stays true and stays meaningful. The mirror
   * pass deliberately does not use `subscribeCanvasWithHandover` — see the
   * header of `files/canvas-mirror.ts`.
   */
  /**
   * S123 — one-shot watchers on canvas docs whose records had not arrived when
   * the mirror pass last asked. Keyed by path so a path cannot accumulate
   * observers across repeated passes.
   */
  private canvasRecordWatchers = new Map<string, () => void>();

  /** S123 AC5 — what the last mirror pass decided, per path. Previously discarded. */
  private lastCanvasMirrorReport: CanvasMirrorReport | null = null;

  /**
   * S123 — re-ask the mirror when this doc actually gains records.
   *
   * The defect was a readiness signal that did not mean what it said, answered
   * by polling once. This replaces the poll with the event it was trying to
   * approximate: observe the two record maps, and the first time either becomes
   * non-empty, re-run the pass. No timer, no backoff, no retry budget — a
   * wall-clock retry would close this race only on the runs where it happened
   * to be fast enough, which is what "one guest got it in 23 s and the other
   * never did" already looks like.
   */
  private watchCanvasForRecords(path: string): void {
    if (this.canvasRecordWatchers.has(path)) return;
    const doc = this.canvasSync?.getCanvasDocHandle(path)?.doc;
    if (!doc) return;
    const maps = CANVAS_RECORD_MAPS.map((name) => doc.getMap(name));
    let fired = false;
    const onChange = () => {
      if (fired) return;
      if (!maps.some((map) => map.size > 0)) return;
      fired = true;
      this.unwatchCanvasForRecords(path);
      this.logger.log("canvas-mirror", `records arrived for ${path}; re-running the mirror pass`);
      this.armCanvasMirrorPass();
    };
    for (const map of maps) map.observe(onChange);
    this.canvasRecordWatchers.set(path, () => {
      for (const map of maps) map.unobserve(onChange);
    });
    // The records may have landed between the pass's probe and this line.
    onChange();
  }

  private unwatchCanvasForRecords(path: string): void {
    const dispose = this.canvasRecordWatchers.get(path);
    if (!dispose) return;
    this.canvasRecordWatchers.delete(path);
    try {
      dispose();
    } catch {
      /* an unobserve on a destroyed doc is not an error worth surfacing */
    }
  }

  /** S129 AC5 — notes this peer is NOT collaborating on, and why, for a live validator. */
  getCollabBindRefusals(): { total: number; paths: string[] } {
    return getCollabBindRefusals();
  }

  /**
   * S134 AC3 — activations that ended in the `waitForSync` TIMEOUT, kept apart
   * from the refusals above because one is a decision and the other is a
   * failure, and a validator watching a rising number has to be able to tell
   * which it is looking at (S132).
   */
  getCollabBindFailures(): { total: number; paths: string[] } {
    return getCollabBindFailures();
  }

  /** S123 AC5 — the last mirror pass's per-path verdicts, for a live validator. */
  getLastCanvasMirrorReport(): CanvasMirrorReport | null {
    return this.lastCanvasMirrorReport;
  }

  /**
   * S122 AC4 — what host-mediated canvas creation has done and refused, for a
   * live validator. Counts and classes only; never a path, never content.
   */
  getCanvasCreateStats(): CanvasCreateStats | null {
    return this.canvasCreate?.getStats() ?? null;
  }

  /**
   * WP117 — the guest's half, called from the vault `create` event. Forwarding
   * only: every branch, including the six that do nothing, is decided and
   * counted inside the coordinator.
   */
  async requestCanvasCreate(rawPath: string): Promise<void> {
    const coordinator = this.canvasCreate;
    if (!coordinator) return;
    try {
      await coordinator.requestCreate(toCanonicalPath(normalizePath(rawPath)));
    } catch (err) {
      this.logger.error("canvas-create", `canvas creation request failed for ${rawPath}`, err);
    }
  }

  private armCanvasMirrorPass(): void {
    this.canvasMirrorQueue = this.canvasMirrorQueue
      .then(async () => {
        const canvasSync = this.canvasSync;
        if (!canvasSync) return;
        this.lastCanvasMirrorReport = await mirrorSharedCanvases({
          role: this.settings.role === "host" ? "host" : "guest",
          listManifestPaths: () => this.manifestManager.getEntries().keys(),
          localFileExists: (path) => this.app.vault.adapter.exists(toLocalPath(path)),
          guidForPath: (path) => this.manifestManager.getCanvasGuid(path),
          canvasSync,
          materialise: (path) => this.attachCanvasWriter(path),
          // WP122 (S146): the HOST's own canvases get the single writer too, so
          // a guest's edit reaches the host's FILE and not only its document.
          // The SAME route as `materialise` above and as the guest-create
          // handshake's `attachWriter` — `hasCanvasWriter` stays the one
          // definition of "already attached", and this is a second reference to
          // one route rather than a second route.
          bindHostWriter: (path) => this.attachCanvasWriter(path),
          watchForRecords: (path) => this.watchCanvasForRecords(path),
          // WP117 (A6): the ONE path per accepted request whose existing local
          // file is adopted rather than skipped. Both are reads of the
          // coordinator's own state; this file decides nothing.
          originatedHere: (path) => this.canvasCreate?.originatedHere(path) === true,
          noteAdopted: (path) => this.canvasCreate?.noteAdopted(path),
          logger: this.logger,
        });
      })
      .catch((err) => {
        this.logger.error("canvas-mirror", "mirror pass failed", err);
      });
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
  /**
   * WP85 — a READ, not a decision: is the single writer already attached for
   * this path, or is an attach in flight?
   *
   * Both maps, not just the first: an attach awaits `attachCanvasPersistence`
   * (which awaits `coldOpen`), and `syncCanvasPresences` fires on
   * `layout-change` and `active-leaf-change` often enough to re-enter during
   * that await. One definition, consulted by `attachCanvasWriter`'s own guard
   * and by the WP85 consultation, so the two can never disagree about what
   * "already attached" means.
   */
  private hasCanvasWriter(rawPath: string): boolean {
    const canonical = toCanonicalPath(normalizePath(rawPath));
    return this.canvasWriters.has(canonical) || this.canvasWriterAttaching.has(canonical);
  }

  /**
   * WP87 (C87 AC1) — the attribution READ. Wiring only: every field is fetched
   * from the object that owns it (`CanvasAdapter.describeEditingSignal`, the
   * deferral queue, the writer maps). No conditional over canvas state, no
   * verdict, no second predicate — this file holds none of those, and this
   * method decides nothing.
   *
   * It deliberately does NOT call `adapter.getEditingNodeId()` / `isBusy()`:
   * both run the staleness sweep, which can release the editing flag and fire
   * the blur subscribers — i.e. the measurement would trigger WP37's drain,
   * which is one of the four routes AC1 has to tell apart.
   */
  canvasEditingSignal(rawPath: string): Record<string, unknown> {
    const canonical = toCanonicalPath(normalizePath(rawPath));
    const adapter = this.canvasAdapters.get(canonical);
    return {
      path: canonical,
      hasAdapter: adapter !== undefined,
      adapterAvailable: adapter?.isAvailable() ?? false,
      signal: adapter?.describeEditingSignal?.() ?? null,
      liveNodeIds: adapter ? [...adapter.getLiveNodeIds()].sort() : [],
      hasWriter: this.canvasWriters.has(canonical),
      writerAttaching: this.canvasWriterAttaching.has(canonical),
      queuedRecords: this.canvasDeferrals.pending(canonical),
      queuedIds: this.canvasDeferrals.pendingIds(canonical),
      withheldPasses: this.canvasDeferrals.passes(canonical),
      queuedPaths: this.canvasDeferrals.paths(),
    };
  }

  /**
   * B68 (`S188`) — THE ONE ACCESSOR the canvas-disjoint diagnostic reads through.
   *
   * Wiring only, and read-only: it hands back the objects this class already
   * holds in `canvasAdapters` / `canvasPresences`, keyed by the canonical path
   * they are stored under, and decides nothing. It opens nothing, mounts
   * nothing, and calls no method on either object — in particular it does NOT
   * call `adapter.isBusy()` or `adapter.getEditingNodeId()`, both of which run
   * the staleness sweep and can fire WP37's blur drain (the same reason
   * `canvasEditingSignal` above states for avoiding them).
   *
   * `rawPath` filters to one board; omitting it reports every mounted board, so
   * an armed diagnostic can say WHICH paths it could reach rather than
   * silently reporting an empty view plane for a board that is simply not open
   * on this peer.
   */
  canvasDiagTargets(
    rawPath?: string,
  ): Array<{ path: string; adapter: unknown; presence: unknown }> {
    const wanted =
      typeof rawPath === "string" && rawPath.length > 0
        ? toCanonicalPath(normalizePath(rawPath))
        : null;
    const out: Array<{ path: string; adapter: unknown; presence: unknown }> = [];
    for (const [path, adapter] of this.canvasAdapters) {
      if (wanted !== null && path !== wanted) continue;
      out.push({ path, adapter, presence: this.canvasPresences.get(path) ?? null });
    }
    return out;
  }

  private async attachCanvasWriter(rawPath: string): Promise<void> {
    const canonical = toCanonicalPath(normalizePath(rawPath));
    if (this.hasCanvasWriter(canonical)) return;
    const handle = this.canvasSync?.getCanvasDocHandle(rawPath);
    if (!handle) return;
    this.canvasWriterAttaching.add(canonical);
    const baseIo = createVaultPersistenceIO(this.app.vault.adapter, this.fileOpsManager, {
      isPathSafe: (diskPath) => isPathSafe(diskPath),
      ensureFolder: (parentDir) => ensureFolder(this.app.vault, parentDir, this.logger),
    });
    // WP90 (I11): the durable refused set, over WP24's OWN vault I/O adapter —
    // not `baseIo`. `baseIo` is the canvas writer's seam and it is decorated by
    // WP87's editing-aware hold; routing the store through it would put the
    // refusal record behind a gate that exists to defer `.canvas` bytes while
    // an inline editor is open, which has nothing to do with it. The store's
    // path is inside `SIDECAR_DIR`, so it is excluded from every shared surface
    // by `isSidecarPath`'s directory-prefix test (WP26) by construction.
    this.seedRefusalStore ??= new SeedRefusalStore(createVaultSidecarIO(this.app.vault.adapter), {
      logger: this.logger,
    });
    const seedRefusalStore = this.seedRefusalStore;
    // ── WP87 (C87 AC1/AC3) — THE SECOND CONSULTATION ────────────────────────
    //
    // WIRING AND A VERDICT READ, exactly like the WP85 attach consultation
    // above it: the two facts are MEASUREMENTS taken from the object that owns
    // them, the verdict is `canvas/canvas-editing-deferral.ts`'s
    // `planCanvasDiskWrite`, and this file executes it. There is no conditional
    // over canvas state here and no second editing predicate — the editing
    // question is asked of `adapter.getEditingNodeId()`, the SAME definer the
    // reconcile pass consults.
    //
    // The decoration sits on the injected `PersistenceIO` rather than inside
    // `CanvasPersistence`, which stays byte-unchanged: WP85's declared boundary
    // is not re-opened, the writer is never detached, never stopped and never
    // reconfigured, and the observer/debounce/queue all keep running exactly as
    // they did. Only the moment the bytes land moves — and only while an inline
    // editor is open on THIS path.
    const io: PersistenceIO = {
      ...baseIo,
      write: async (diskPath, content) => {
        const adapter = this.canvasAdapters.get(canonical);
        const decision = planCanvasDiskWrite({
          editingNodeId: adapter?.getEditingNodeId?.() ?? null,
          surfaceReadable: adapter !== undefined && adapter.isAvailable(),
          holds: this.canvasWriteHolds.holds(canonical),
        });
        if (decision.mode === "withhold") {
          const holds = this.canvasWriteHolds.hold(canonical, diskPath, content);
          this.logger.debug(
            "canvas",
            `CANVAS WRITE HELD: ${canonical} ${decision.reason} (holds=${holds})`,
          );
          return;
        }
        // A `write` verdict supersedes anything still held: this content is
        // newer, so the held snapshot is stale and re-writing it afterwards
        // would put an older projection back on disk. Dropping it here is also
        // the second, EVENT-FREE release path — the file converges at the next
        // flush after editing ends, whatever happened to the blur signal.
        this.canvasWriteHolds.clear(canonical);
        await baseIo.write(diskPath, content);
      },
    };
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
          // WP90 (I11): and the place that refused set is KEPT, so it is still
          // there next session. Handed in here rather than to `CanvasSync`
          // because `coldOpen` is the one moment it must be consulted — before
          // the `doc-wins` branch flushes the projection over the user's file.
          durableRefusals: seedRefusalStore,
          // WP92 (I11): and the KEY it is kept under — the DOCUMENT's identity,
          // not the file's name. `getCanvasGuid` is WP27's cached, synchronous
          // read of the same token `canvasDocId` is built from, so this is a
          // measurement taken from the object that owns it and not a second
          // identity resolution. It cannot be `null` on this line by the attach
          // precondition above (`getCanvasDocHandle` already returned), and
          // `CanvasPersistence` degrades to WP63 for the path if it ever is.
          refusalIdentity: this.canvasSync?.getCanvasGuid(canonical) ?? null,
          // WP29 (I9/AC1): the two conditions were measured by `subscribe`,
          // which has already resolved by the time we get here — so the cold
          // open reads them from the object that took them.
          // WP117 (S122's residual): and the ROLE, stamped from the live session
          // over whatever `subscribe` recorded. The two agree in the ordinary
          // case; where they cannot — a path whose subscribe left by one of the
          // early exits and therefore recorded nothing — `seedKnowledgeFor`
          // answers `NOTHING_KNOWS_DOC`, which has no role and would fall
          // through to the pre-WP117 table. Stamping here is what makes the
          // "a guest never seeds" rule hold on EVERY cold open rather than on
          // the ones that got as far as recording their knowledge.
          seedKnowledge: {
            ...(this.canvasSync?.seedKnowledgeFor(canonical) ?? {
              sidecarKnowsDoc: false,
              peerKnowsDoc: false,
            }),
            role: this.settings.role === "host" ? "host" : "guest",
          },
          // ── WP121 — WINNING IS NOT A LICENCE TO DISCARD ──────────────────
          //
          // The `doc-wins` branch overwrites the user's `.canvas` from the
          // document. That decision is unchanged; what this adds is the copy
          // the text arm has had since `S125`, for the case the document is
          // missing records the file holds.
          //
          // It travels through `baseIo`, NOT through the decorated `io` above:
          // the decoration is WP87's editing-aware hold, which defers `.canvas`
          // bytes while an inline editor is open and re-plays them under THIS
          // canvas path's key. A one-shot additive copy to a path in the
          // conflicts root has nothing to do with that queue. `baseIo` still
          // carries the two guarantees that matter for any vault write —
          // `isPathSafe` and `ensureFolder` — so the copy cannot escape the
          // vault and its folder is created for it.
          //
          // `copyPath`, never `diskPath`: WP87's surface-route census derives
          // the live-canvas-surface vocabulary from `PersistenceIO`'s own
          // declaration and discriminates on the FIRST PARAMETER'S NAME,
          // because `write(` alone also matches "a markdown sink, a sidecar
          // checkpoint and a conflict archive" (its words). This is the
          // conflict archive, and it never writes the canvas path.
          preserveDiscarded: {
            sharedFolder: this.settings.sharedFolder,
            read: async (diskPath) =>
              (await baseIo.exists(diskPath)) ? await baseIo.read(diskPath) : null,
            write: (copyPath, content) => baseIo.write(copyPath, content),
          },
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
      const canonical = toCanonicalPath(normalizePath(rawPath));
      const adapter = createCanvasAdapter(view, {
        // US6: attach the status console so `ADAPTER PATCH:` and `DRAG WATCHDOG:` are
        // recorded instead of silently dropped. `CanvasAdapterLogger` declares `log`
        // while `DebugLogger` (like `CanvasSyncLogger`/`SyncLogger`) exposes `debug`,
        // so the two names are bridged here rather than churning the adapter's tests.
        logger: {
          log: (category, message) => this.logger.debug(category, message),
          warn: (category, message) => this.logger.warn(category, message),
        },
        requestRepaintSweep: () => this.requestCanvasRepaintSweep(canonical),
        getRepaintTriggerReport: () => this.describeCanvasRepaintTrigger(canonical),
      });
      // Register for live-view reconciliation (kept in lockstep with the presence).
      this.canvasAdapters.set(canonical, adapter);
      // B72 (WP3) — and the restoring sweep, in the same lockstep.
      this.startCanvasRepaintSweep(canonical, adapter);
      // WP37 (C37 AC5) — the BLUR exit of the deferral. Forwarding only: the
      // adapter reports that an inline editor ended, and the drain re-runs one
      // ordinary reconcile pass. Fires for a watchdog-released editor too, so a
      // focus flag Obsidian never closed still drains rather than stranding the
      // queue.
      adapter.onEditingEnd?.(() => {
        setTimeout(
          () => this.drainCanvasDeferrals(rawPath, "inline editor blurred"),
          CANVAS_EDIT_DRAIN_DELAY_MS,
        );
      });
      // Diagnostics: report whether the private Canvas API surface is usable and,
      // if not, exactly which member is missing (the root-cause the user needs).
      const available = adapter.isAvailable();
      // Initial-sync fix: a canvas opened AFTER the CRDT already synced shows the
      // stale on-disk file.
      //
      // ⚠ WP87 — THE CLAIM THAT USED TO STAND HERE IS FALSE, and it is corrected
      // rather than deleted because several work packages read it as a map. It
      // said: *"Obsidian never reloads a canvas from an external write."* It was
      // written for the cold-open case, before WP85 made an open leaf carry a
      // live disk writer, and it had never been tested with an inline editor
      // open. MEASURED, on both vaults, on an UNSHARED board with no plugin path
      // involved at all: an external write to the `.canvas` while a card's
      // editor is open DOES reload the view, and the unflushed characters are
      // destroyed with it. The reload is also a full REBUILD, not `setData`'s
      // node-reuse — a write that changed only ANOTHER card's text still
      // destroyed the edited card's editor. That is C87 AC1's attribution (route
      // R-C) and the reason for the write hold in `attachCanvasWriter`.
      //
      // What survives of the original sentence is the part this line depends on:
      // a freshly-opened view does not snap to shared truth on its own, because
      // the DOC is the authority and the file it was loaded from may be stale.
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
  // tiebreak on `nodeId`. The LIVE view may still show the rejected position, so
  // roll THAT NODE back to shared truth. A null snapshot (shared doc still empty)
  // is a no-op — never wipe the view (BUILD_SPEC § 6).
  //
  // WP119 — THE BLAST RADIUS IS THE DEFECT, AND IT WAS HERE.
  //
  // What this method used to do: take the node id, THROW IT AWAY, and hand the
  // WHOLE snapshot to `reconcileLiveCanvas(..., {initial: true})`. `initial` is an
  // unconditional `"structural"` (`reconcile-plan.ts:166`), so one contested card
  // became `canvas.setData(entire board)` and every OTHER card on the board was
  // re-laid-out from shared truth. The clicked card was typically the one card
  // that did NOT move — it is the one both peers already agree about. That is the
  // owner's report verbatim: *"I select cards on client one, other cards jump
  // around on client 2"*, and it is why the arrows held still (`setData` reuses
  // existing nodes, so an unchanged edge record is handed back identical and
  // nothing re-routes it — see the note at `reconcileLiveCanvas`).
  //
  // ⚠ CORRECTION TO THIS METHOD'S OWN PREVIOUS DOC COMMENT. It claimed "the lock
  // seam denied its optimistic edit and that edit never reached the shared doc
  // (canvas-sync holds its diff baseline back for the same reason)". That has been
  // FALSE since WP21, which removed the lock seam from the capture path outright —
  // `canvas-sync.ts:4411` ("the lock-seam gate lived here. It is REMOVED, not
  // rewritten") and `canvas-sync.ts:3705` (the echo baseline now advances
  // unconditionally). Locks carry no write authority on this tree: the only
  // consumers of `canWriteNode`/`canDeleteNode` are `CanvasBinding`'s optional
  // gates, and `mountCanvasPresence` does not supply them. So the loser's edit
  // DOES reach the shared doc, which means the node this method reverts is
  // normally already equal to shared truth and the apply below is an honest
  // `"unchanged"`. What remains is the VIEW rollback WP21 deliberately kept
  // ("locks ... still revert the loser's VIEW"), and a view rollback of one node
  // is a per-node operation. Whether the loser-revert should survive at all now
  // that its justification has gone is a question for the canvas convergence
  // remodel, NOT for this package.
  //
  // EXPRESSIBILITY (charter A1). `CanvasAdapter` has exactly one per-record write:
  // `applyNodeGeometry`, i.e. x/y/width/height. A per-node revert of `text`,
  // `color`, `type` or an edge field is NOT expressible through it — the only
  // route is `reloadCanvasData`, which is the whole board. Such a difference is
  // therefore REPORTED and not applied: escalating back to a whole-board reload
  // to catch it is precisely the defect this package exists to remove, and since
  // WP21 the loser's non-geometry edit is in the shared doc anyway.
  private revertCanvasNode(rawPath: string, nodeId: string, awareness: AwarenessLike): void {
    const canonical = toCanonicalPath(normalizePath(rawPath));
    let winner: number | null = null;
    try {
      winner = resolveHolder(canonical, nodeId, awareness.getStates());
    } catch {
      /* awareness may be torn down mid-revert; the view rollback still runs */
    }
    const who = `${canonical} node=${nodeId} winner=${winner ?? "unknown"}`;
    const snapshot = this.canvasSync?.getCanvasSnapshot(rawPath) ?? null;
    if (!snapshot) {
      this.logger.warn(
        "canvas",
        `LOCK REVERT: ${who} (no shared snapshot yet; view left untouched)`,
      );
      return;
    }
    // The ONE record this revert is about. Nothing else on the board is read.
    const desired =
      snapshot.nodes.find(
        (record) => record && typeof record.id === "string" && record.id === nodeId,
      ) ?? null;
    if (!desired) {
      // Shared truth does not carry the node (deleted, or never captured). There
      // is nothing to revert TO, and a full reload would be the old blast radius
      // wearing a different hat. `onRemoteNodeDeleted` owns the delete case.
      this.logger.warn(
        "canvas",
        `LOCK REVERT: ${who} (node absent from shared truth; view left untouched)`,
      );
      return;
    }
    this.applyCanvasNodeRevert(canonical, nodeId, desired, who);
  }

  /**
   * WP119 — put ONE node back where shared truth says it is.
   *
   * Deliberately not a call into `reconcileLiveCanvas`: that method's contract is
   * a WHOLE-BOARD pass (its planner compares the desired id set against the live
   * one, so handing it a single-node payload would classify as a membership change
   * and `setData` the rest of the board away). The pieces it shares with this one
   * — the availability guard, the modify mute, and the WP5 receipt that advances
   * the Surface-Shadow — are re-used directly, so the shadow bookkeeping is the
   * same seam and cannot drift.
   */
  /**
   * B72 (WP3) — start the low-rate repaint sweep for one mounted canvas.
   *
   * WHAT IT IS FOR, STATED AS THE WORKAROUND IT IS. WP2 repairs the damage this
   * plugin's OWN applies can leave; this repairs damage from causes nobody has
   * identified yet, by repainting a few cards per second from the model until
   * every card has been visited, then starting again. It cannot fix a wrong
   * MODEL — nothing here reads the doc or the file — so it can only ever repair
   * a view that disagrees with a model that is already right, which is exactly
   * the defect class `S189` measured and nothing else.
   *
   * WHAT IT MASKS, AND THE COUNTER THAT KEEPS IT FROM MASKING SILENTLY. A sweep
   * that quietly repaired everything would destroy the ability to measure the
   * cause: the board would look correct and the paint plane would find nothing.
   * That is why `describeRepaintSweep().repaired` counts every repaint that
   * landed on a card whose element was demonstrably in the wrong place BEFORE it
   * ran. The damage rate stays visible even when the damage does not.
   *
   * Idempotent, and never two intervals for one path.
   */
  private startCanvasRepaintSweep(canonical: string, adapter: CanvasAdapter): void {
    if (this.canvasRepaintSweeps.has(canonical)) return;
    if (typeof adapter.sweepRepaint !== "function") return;
    const state = {
      interval: undefined as unknown as ReturnType<typeof setInterval>,
      active: true,
      pending: false,
      running: false,
      rerun: false,
      eventRequests: 0,
      coalescedRequests: 0,
      eventRuns: 0,
      periodicRuns: 0,
      lastRunAt: null as number | null,
      lastTriggerKind: null as "event" | "periodic" | null,
    };
    const handle = setInterval(() => {
      const live = this.canvasAdapters.get(canonical);
      // The adapter can be replaced or dropped between ticks; a sweep must never
      // paint through a handle its own registry has moved on from.
      if (!live || live !== adapter) {
        this.stopCanvasRepaintSweep(canonical);
        return;
      }
      try {
        live.sweepRepaint?.();
        state.periodicRuns++;
        state.lastRunAt = Date.now();
        state.lastTriggerKind = "periodic";
      } catch (err) {
        this.logger.debug("canvas", `repaint sweep ${canonical}: tick threw — ${String(err)}`);
      }
    }, REPAINT_SWEEP_PERIOD_MS);
    state.interval = handle;
    this.canvasRepaintSweeps.set(canonical, state);
  }

  private requestCanvasRepaintSweep(canonical: string): void {
    const state = this.canvasRepaintSweeps.get(canonical);
    if (!state?.active) return;
    state.eventRequests++;
    if (state.running) {
      state.rerun = true;
      state.coalescedRequests++;
      return;
    }
    if (state.pending) {
      state.coalescedRequests++;
      return;
    }
    state.pending = true;
    queueMicrotask(() => {
      if (!state.active || this.canvasRepaintSweeps.get(canonical) !== state) return;
      state.pending = false;
      state.running = true;
      try {
        this.canvasAdapters.get(canonical)?.sweepRepaint?.();
        state.eventRuns++;
        state.lastRunAt = Date.now();
        state.lastTriggerKind = "event";
      } finally {
        state.running = false;
        if (state.rerun) {
          state.rerun = false;
          this.requestCanvasRepaintSweep(canonical);
        }
      }
    });
  }

  private describeCanvasRepaintTrigger(canonical: string): Record<string, unknown> | null {
    const state = this.canvasRepaintSweeps.get(canonical);
    if (!state) return null;
    return {
      eventRequests: state.eventRequests,
      coalescedRequests: state.coalescedRequests,
      eventRuns: state.eventRuns,
      periodicRuns: state.periodicRuns,
      lastTriggerKind: state.lastTriggerKind,
      lastRunAgeMs: state.lastRunAt === null ? null : Math.max(0, Date.now() - state.lastRunAt),
      pending: state.pending,
    };
  }

  /** B72 (WP3) — stop it. Called from every path that drops an adapter. */
  private stopCanvasRepaintSweep(canonical: string): void {
    const state = this.canvasRepaintSweeps.get(canonical);
    if (state === undefined) return;
    state.active = false;
    state.pending = false;
    state.rerun = false;
    clearInterval(state.interval);
    this.canvasRepaintSweeps.delete(canonical);
  }

  private applyCanvasNodeRevert(
    canonical: string,
    nodeId: string,
    desired: Record<string, unknown>,
    who: string,
  ): void {
    const adapter = this.canvasAdapters.get(canonical);
    if (!adapter || !adapter.isAvailable()) return; // canvas not open → file sync suffices
    const shadow = this.canvasSync?.getSurfaceShadow();
    if (!shadow) return; // canvas sync torn down → nothing to reconcile against
    const { x, y, width, height } = desired;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      this.logger.warn(
        "canvas",
        `LOCK REVERT: ${who} (shared record has no usable geometry; view left untouched)`,
      );
      return;
    }
    // WP87 (C87) — THE ONE editing/drag predicate, the same definer
    // `reconcileLiveCanvas` consults and never a second one (rule 10). A revert is
    // a remote change like any other and `applyNodeGeometry` is a
    // `GUARDED-BY-CALLER` surface sink: every live caller of it must consult this
    // and act on the answer, which `v2/wp87/test_tp01_surface_route_census` derives
    // from the tree rather than from a list. Without this the loser-revert would be
    // a route from a peer's selection straight onto a card the local user is typing
    // in — WP87's destruction class, re-opened by a repair.
    const gate = classifyBusyGate({
      busy: adapter.isBusy(),
      editingNodeId: adapter.getEditingNodeId?.() ?? null,
    });
    if (gate === "defer-drag") {
      // Never reconcile mid-drag. Same arm, same reason, as `reconcileLiveCanvas`.
      this.logger.debug("canvas", `LOCK REVERT: ${who} deferred (user dragging)`);
      return;
    }
    if (gate === "editing") {
      // An inline editor is open on this board. `applyNodeGeometry` reseats the
      // card it is handed, and WP37 measured that reseating a card with an open
      // editor discards its unflushed text. A lock revert is never worth that, and
      // nothing is lost: since WP21 the loser's edit is in the shared doc, so the
      // ordinary convergence path still carries the value.
      this.logger.debug("canvas", `LOCK REVERT: ${who} withheld (inline editor open)`);
      return;
    }
    // Diagnostics only (see the expressibility note above): which fields shared
    // truth disagrees about that a per-node apply cannot carry. Never escalates.
    const live = adapter.getNodeFields?.(nodeId) ?? null;
    const unexpressible: string[] = [];
    if (live) {
      for (const key of new Set([...Object.keys(desired), ...Object.keys(live)])) {
        if (key === "id" || RECONCILE_GEOMETRY_KEYS.has(key)) continue;
        if (desired[key] !== live[key]) unexpressible.push(key);
      }
    }
    // NO MUTE HERE, and that is a decision rather than an omission. The geometry
    // branch of `reconcileLiveCanvas` brackets itself with
    // `mutePathEvents`/`armMuteRelease`, and for a CANVAS-OWNED path that bracket
    // is inert: the vault `modify` gate takes the canvas branch at
    // `files/vault-events.ts:378-409`, whose WP91 note says in its own words that
    // "THE MUTE AND THE DISK-WRITE WINDOW ARE NOT ASKED HERE" — the decision is the
    // byte echo breaker instead. Arming a mute a canvas path never consults would
    // add a refcount only the ceiling releases, and a release site to WP93's census,
    // in exchange for nothing. This route is strictly FEWER writes than the
    // whole-board reload it replaces, never more.
    const outcome: ApplyOutcome = adapter.applyNodeGeometry(nodeId, { x, y, width, height });
    // B72 (WP2) — the same second half, on the revert route. This method arms no
    // mute (see the note above) and that difference is deliberate and unchanged:
    // a repaint writes inline styles onto a card and produces no vault `modify`
    // of its own, so it needs nothing from the mute either way.
    if (outcome === "applied") adapter.repaintNode?.(nodeId);
    // WP5 (C5 AC1/AC2/AC3): the same receipt seam every other apply route uses.
    // `plan: "geometry"` ⇒ `exhaustive === false`, so this pass grants a licence
    // for the one node it confirmed and revokes nothing — a per-node revert proves
    // nothing about the membership of the rest of the board (S83).
    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: canonical,
        desired: { nodes: [desired], edges: [] },
        plan: "geometry",
        nodeOutcomes: new Map<string, ApplyOutcome>([[nodeId, outcome]]),
      }),
    );
    this.surfaceState.noteHandover(canonical, summary.handed, summary.revoked);
    this.logger.warn(
      "canvas",
      `LOCK REVERT: ${who} geometry=${outcome}` +
        (unexpressible.length > 0
          ? ` [not applied: ${unexpressible.join(",")} — a per-node revert cannot ` +
            "express non-geometry fields; shared truth carries them]"
          : ""),
    );
  }

  private teardownCanvasPresences() {
    // WP37 (C37 AC5) — the TEARDOWN exit. Every path is drained while its adapter
    // is still registered, and the queue is then cleared unconditionally: nothing
    // it holds may survive the surfaces it was held for.
    for (const path of this.canvasDeferrals.paths()) {
      this.drainCanvasDeferrals(path, "canvas teardown");
    }
    // WP87 — the same exit for the DISK half. Iterated separately because the
    // two queues do not fill together: a path can hold a write with nothing
    // queued for the view, and a teardown that only walked `canvasDeferrals`
    // would leave that path's file stale for good. Released BEFORE the writers
    // are destroyed below, so `flush()` still has a writer to run on.
    for (const path of this.canvasWriteHolds.paths()) {
      void this.releaseHeldCanvasWrite(path, "canvas teardown");
    }
    this.canvasDeferrals.clearAll();
    this.canvasWriteHolds.clearAll();
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
    // WP92 (C92 AC4 / S64): THE WRITER DETACH is a moment a refusal write can be
    // in flight, and this method is the one both destroy paths (`onunload` and
    // `cleanupSession`) go through. Started here and JOINED at `onunload`, which
    // awaits the same chain — a `void` here would be the fire-and-forget S64
    // names, and this method cannot be async without changing two sync callers.
    void this.flushSeedRefusals();
    this.canvasPresences.clear();
    this.canvasPresenceViews.clear();
    // B72 (WP3) — every sweep interval, on BOTH destroy paths. A timer that
    // outlived its adapter would keep a private-canvas reference alive and paint
    // through a view the plugin has already let go of.
    for (const path of [...this.canvasRepaintSweeps.keys()]) this.stopCanvasRepaintSweep(path);
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
        const healthyText = `Live Share: ${role}${users}${latencyStr}${presentingLabel}`;
        // --- WP82 (AC6) -----------------------------------------------------
        // Consumer 2 of the definer. This is the ONE branch that asserts health,
        // and until now it asserted it from `ConnectionStateManager`, which is
        // driven exclusively by control-channel transitions and NEVER SEES THE
        // MUX: if the sync socket died, this still read `Live Share: hosting`.
        // Vault A read exactly that while `session.info` said `connected:false`
        // and every file op it performed was going into an undrainable queue.
        //
        // The healthy string is returned VERBATIM by `sharingStatusText` when
        // the verdict is healthy, so nothing changes in the healthy state.
        const verdict = this.getSharingVerdict();
        this.statusBarEl.setText(sharingStatusText(verdict, healthyText));
        break;
      }
      case "error":
        this.statusBarEl.setText("Live Share: error");
        break;
      case "auth-required":
        this.statusBarEl.setText("Live Share: auth needed");
        break;
    }
    // WP82 (AC5/AC6) — announce once, then count; recovery re-arms. Bound to
    // the state, never to the retry.
    this.announceSharingState(this.getSharingVerdict());
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

  /**
   * D1 — accept the server's ruling that THIS peer is the host.
   *
   * The counterpart {@link demoteToGuest} has always existed; this direction did
   * not, and its absence is why a session could converge to zero hosts (see the
   * long note on the `join-response` handler in `sync/control-handlers.ts`).
   *
   * Idempotent, because the server re-states its verdict on every reconnect and
   * a promotion must not republish the manifest once per reconnect storm.
   *
   * The `purge: true` republish is inherited from the existing host-transfer
   * path and is deliberate: the semantics of this product are that the host's
   * disk is the truth.
   *
   * WP80 — it used to carry the hazard that made this the LAST live route from
   * a correct promotion to a destroyed user file: a peer promoted before it
   * finished syncing published a manifest that omitted files it simply had not
   * received yet, and the purge deleted their entries. The claim that this was
   * "bounded on the consuming side" was WRONG, and is corrected here rather
   * than left in place: a newly-promoted host's truncated manifest satisfies
   * BOTH of `cleanupStaleFiles`' conditions — the promotion itself advances
   * `seq` under a `hostId` that is not the guest's, and the promoted peer IS a
   * live peer claiming host — and the manifest is short, not empty, so D3's
   * floor never fires either. The gate was not wrong; it answers "did a live
   * host say this?", and a live host did.
   *
   * The `purge: true` below is now a REQUEST, not an instruction.
   * `ManifestManager` decides whether to grant it (`files/manifest-purge-decision.ts`),
   * and a peer that entered the session as a guest cannot establish
   * completeness until its local set accounts for every entry it holds — so
   * this call publishes ADDITIVELY and says so.
   */
  async promoteToHost(reason = "server designated this peer as the room host"): Promise<void> {
    if (this.settings.role === "host") return;
    this.logger.log("session", `promoted to host - ${reason}`);
    this.settings.role = "host";
    this.settings.permission = "read-write";
    await this.saveSettings();
    await this.backgroundSync.startAll("host");
    // WP80 call site 3 of 4 (`promoteToHost`) — THE defect site. Wiring only.
    this.logPublishDecision(
      "promote-to-host",
      await this.manifestManager.publishManifest({ purge: true }),
    );
    this.presenceManager?.broadcastPresence();
    this.updateStatusBar();
    this.refreshPresenceView();
    // WP79 entry point 5a (reconnect / role change). A peer that has just become
    // the host is the only client that can give its shared canvases a published
    // identity, and until it does no guest can resolve them.
    this.armCanvasMirrorPass();
    this.onActiveFileChange();
    this.notify("Live Share: you are now the host");
  }

  /**
   * D1/D2 — accept the server's ruling that somebody else is host.
   *
   * The `cleanupStaleFiles()` call that used to sit in the middle of this method
   * is DELIBERATELY GONE, and it must not come back. A peer arriving here has,
   * by construction, just been told it is not the host — which means the only
   * manifest it holds is one it published itself, as the host it no longer is.
   * Reconciling local files against that manifest is a peer deleting files on
   * the authority of a claim it has just been stripped of. In the 2026-08-05
   * incident this was one of the two live trash paths.
   *
   * Nothing is lost by removing it: the new host will publish, the publication
   * observer will fire, and `cleanupStaleFiles` will then run with the evidence
   * it needs. Later and correct beats immediate and wrong when the operation is
   * irreversible from the user's point of view.
   */
  async demoteToGuest() {
    this.logger.log("session", "demoted from host - another host exists");
    this.settings.role = "guest";
    if (this.presenceManager?.getIsPresenting()) {
      this.presenceManager.togglePresent();
    }
    await this.saveSettings();
    await this.backgroundSync.startAll("guest");
    await this.manifestManager.syncFromManifest(
      this.mutePathEvents,
      this.unmutePathEvents,
      this.requestBinaryFile,
    );
    this.notify("Live Share: reconnected as guest - another user is host");
    this.updateStatusBar();
    this.refreshPresenceView();
    // WP79 entry point 5b (reconnect / role change, the demotion arm).
    this.armCanvasMirrorPass();
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
    // WP79 entry point 6 (reload-from-host). `syncFromManifest` skips `.canvas`
    // by design, so before this call the user command could not reach a canvas
    // at all — which is the whole "there is not even an option to share it
    // afterwards" complaint.
    this.armCanvasMirrorPass();
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
