export type SessionRole = "host" | "guest" | null;

/**
 * D2 — the answer `cleanupStaleFiles` returns instead of `void`.
 *
 * The old method returned nothing, so "I deleted three files", "there was
 * nothing to delete" and "I had no business deciding" were the same
 * observation: silence. A destructive operation that cannot report which of
 * those happened cannot be tested and cannot be audited — the data loss was
 * invisible in the logs until the files were noticed missing. Every outcome now
 * has a name and a stated reason.
 */
export interface StaleReconcileDecision {
  /** `true` only when the evidence gate opened and the reconcile actually ran. */
  ran: boolean;
  /** Why it ran, or which piece of evidence was missing. Always populated. */
  reason: string;
  /** Shared local files the published manifest did not mention. */
  candidates: number;
  /** Vault-relative paths actually sent to the trash. Empty on a refusal. */
  trashed: string[];
  /**
   * S115 — the HOST'S shared root that scoped the candidate set, as published
   * on the manifest attestation. `""` means the host shares its whole vault;
   * `null` means the reconcile refused before a scope was established.
   *
   * Reported as a field rather than only inside `reason` so a live validator
   * can assert on it without parsing prose — an observable a validator cannot
   * read is not an observable. Never the local `sharedFolder`: that value is
   * the answer to a different question and reading it here is the defect this
   * field exists to make visible.
   */
  scope: string | null;
}

/**
 * WP80 — the answer `publishManifest` returns instead of `void`.
 *
 * Same reason as {@link StaleReconcileDecision} one level up, and the same
 * class of silence: "I published a purging manifest", "I published additively
 * because I could not know the set was complete" and "I could not publish at
 * all" were one observation — a bare `return`. `promoteToHost` can reach
 * `publishManifest` while the manifest document is still connecting, in which
 * case the peer is host, believes it published, and no attestation exists. That
 * state was indistinguishable from a successful publication from outside the
 * method.
 *
 * MUST stay at the TOP of this file, beside `StaleReconcileDecision`. The
 * `DEFAULT_SETTINGS` block below contains a `//` comment holding the literal
 * `` `${configDir}/**` ``, and the WP22 dormancy test strips comments with a
 * naive non-greedy `/\*[\s\S]*?\*\/` — so that `/**` opens a block comment as
 * far as that test is concerned, and any JSDoc placed BELOW it supplies the
 * `*\/` that closes the pairing, swallowing `useCanvasBinding: false,` and
 * reddening a test that has nothing to do with this change. Position, not
 * style; it was paid for once already.
 */
export interface ManifestPublishDecision {
  /** `true` when entries were written to the manifest document. */
  published: boolean;
  /** `true` only when the completeness gate opened and entries were deleted. */
  purged: boolean;
  /** `"purge" | "additive" | "nothing-to-publish"` — the closed verdict set. */
  verdict: string;
  /** Why this verdict was reached. Always populated, in every branch. */
  reason: string;
  /** How many entries this publication asserted. */
  entries: number;
  /** Manifest keys actually deleted. Empty on every additive publication. */
  deleted: string[];
  /**
   * Manifest keys the local set did not account for — i.e. what a purge WOULD
   * have deleted. Non-empty alongside `purged: false` is the whole point of
   * this work package: those are the files this peer cannot know about.
   */
  unaccounted: string[];
}

/**
 * WP86 — what `registerManifestChangeHandler` decided about ONE manifest change.
 *
 * Same class of silence as {@link StaleReconcileDecision} and
 * {@link ManifestPublishDecision}, one route over. Before this, "I trashed
 * three files", "there was nothing at those paths", "a folder entry was retired
 * for bookkeeping and I trashed the folder" and "the pass threw halfway and
 * skipped the sync, the removals and the canvas mirror" were the same
 * observation: a `Notice` counting paths, and one `.catch` logging a line.
 *
 * MUST stay at the TOP of this file, beside `StaleReconcileDecision` and
 * `ManifestPublishDecision` — see the position note on `ManifestPublishDecision`
 * above; the `DEFAULT_SETTINGS` comment-strip trap is below.
 */
export interface ManifestChangeDisposition {
  /** Monotonic counter, so a reader can tell a fresh pass from a repeated read. */
  pass: number;
  /** The `(added, removed, updated)` key counts the pass was handed. */
  added: string[];
  removed: string[];
  updated: string[];
  /** Per vanished key: the verdict and the stated reason. Never empty-reasoned. */
  removals: { path: string; verdict: string; reason: string }[];
  /** Per candidate rename pairing that was considered. */
  renames: { oldPath: string; newPath: string; verdict: string; reason: string }[];
  /** Paths actually moved by the rename arm. */
  renamed: string[];
  /**
   * Paths this route handed to the gated stale reconcile. Non-empty means "a
   * local file existed at a key that vanished"; it does NOT mean anything was
   * destroyed.
   */
  delegated: string[];
  /** Paths actually trashed, by the gated route, during this pass. */
  destroyed: string[];
  /** The reconcile decision this pass delegated to, or `null` if it did not. */
  reconcile: StaleReconcileDecision | null;
  /**
   * `true` when the pass threw. The handler's `.catch` used to be the only
   * trace of a pass that aborted mid-way, skipping `syncFromManifest`, the
   * removal loop and the canvas mirror for that event.
   */
  aborted: boolean;
  /** The failure, when `aborted`. Empty string otherwise. */
  error: string;
}

export type Permission = "read-write" | "read-only";

export interface LiveShareSettings {
  serverUrl: string;
  roomId: string;
  token: string;
  jwt: string;
  githubUserId: string;
  avatarUrl: string;
  displayName: string;
  cursorColor: string;
  sharedFolder: string;
  role: SessionRole;
  encryptionPassphrase: string;
  encryptionSalt: string;
  permission: Permission;
  requireApproval: boolean;
  serverPassword: string;
  clientId: string;
  notificationsEnabled: boolean;
  debugLogging: boolean;
  debugLogPath: string;
  autoReconnect: boolean;
  excludePatterns: string[];
  readOnlyPatterns: string[];
  approvalTimeoutSeconds: number;
  // WP2/WP3 canvas presence display toggles (default ON).
  showCanvasCursors: boolean;
  showCanvasPresence: boolean;
  // Canvas-redesign rollout flag (SPEC_04). When ON, remote canvas updates are
  // driven by the new CanvasBinding.applyRemote path instead of the legacy
  // reconcileLiveCanvas. Default OFF ⇒ production behaviour is byte-identical.
  // Experimental; removed in Phase 5.
  useCanvasBinding: boolean;
}

export const DEFAULT_SETTINGS: LiveShareSettings = {
  serverUrl: "http://localhost:3000",
  roomId: "",
  token: "",
  jwt: "",
  githubUserId: "",
  avatarUrl: "",
  displayName: "Anonymous",
  cursorColor: "#7c3aed",
  sharedFolder: "",
  role: null,
  encryptionPassphrase: "",
  encryptionSalt: "",
  permission: "read-write",
  requireApproval: false,
  serverPassword: "",
  clientId: "",
  notificationsEnabled: true,
  debugLogging: false,
  // Inside the config directory, NOT the vault root. At the root Obsidian indexes
  // it as an ordinary note — it joins the graph, search and Quick Switcher, and it
  // grows without bound, which Obsidian reports as slow indexing. `.obsidian/` is
  // not indexed, and `ExclusionManager` already prepends `${configDir}/**`, so this
  // location is also excluded from sharing by the rule that already exists rather
  // than by a second one added here.
  debugLogPath: ".obsidian/live-share-debug.md",
  autoReconnect: true,
  excludePatterns: [],
  readOnlyPatterns: [],
  approvalTimeoutSeconds: 60,
  showCanvasCursors: true,
  showCanvasPresence: true,
  useCanvasBinding: false,
};

export interface FileCreateOp {
  type: "create";
  path: string;
  content: string;
  binary?: boolean;
}

export interface FileModifyOp {
  type: "modify";
  path: string;
  content: string;
  binary?: boolean;
}

export interface FileDeleteOp {
  type: "delete";
  path: string;
}

export interface FileRenameOp {
  type: "rename";
  oldPath: string;
  newPath: string;
}

export interface FileChunkStartOp {
  type: "chunk-start";
  path: string;
  totalSize: number;
  binary?: boolean;
  transferId?: string;
}

export interface FileChunkDataOp {
  type: "chunk-data";
  path: string;
  index: number;
  data: string;
  transferId?: string;
}

export interface FileChunkEndOp {
  type: "chunk-end";
  path: string;
  transferId?: string;
}

export interface FileChunkResumeOp {
  type: "chunk-resume";
  path: string;
  transferId: string;
  receivedSeqs: number[];
}

export interface FolderCreateOp {
  type: "folder-create";
  path: string;
}

export type FileOp =
  | FileCreateOp
  | FileModifyOp
  | FileDeleteOp
  | FileRenameOp
  | FileChunkStartOp
  | FileChunkDataOp
  | FileChunkEndOp
  | FileChunkResumeOp
  | FolderCreateOp;

export interface FileOpMessage {
  type: "file-op";
  op: FileOp;
}

export interface ChunkStartMessage {
  type: "file-chunk-start";
  path: string;
  totalSize: number;
  binary?: boolean;
  transferId?: string;
}

export interface ChunkDataMessage {
  type: "file-chunk-data";
  path: string;
  index: number;
  data: string;
  transferId?: string;
}

export interface ChunkEndMessage {
  type: "file-chunk-end";
  path: string;
  transferId?: string;
}

export interface ChunkResumeMessage {
  type: "file-chunk-resume";
  path: string;
  transferId: string;
  receivedSeqs: number[];
}

export interface PresenceUpdateMessage {
  type: "presence-update";
  userId: string;
  displayName: string;
  cursorColor: string;
  currentFile: string;
  avatarUrl?: string;
  scrollTop?: number;
  isHost?: boolean;
  line?: number;
  permission?: Permission;
}

export interface PresenceLeaveMessage {
  type: "presence-leave";
  userId: string;
}

export interface JoinRequestMessage {
  type: "join-request";
  userId: string;
  displayName: string;
  avatarUrl: string;
  verified?: boolean;
}

export interface JoinResponseMessage {
  type: "join-response";
  userId?: string;
  approved: boolean;
  permission?: Permission;
  readOnlyPatterns?: string[];
  isHost?: boolean;
}

export interface KickMessage {
  type: "kick";
  userId: string;
}

export interface KickedMessage {
  type: "kicked";
}

export interface SetPermissionMessage {
  type: "set-permission";
  userId: string;
  permission: Permission;
}

export interface PermissionUpdateMessage {
  type: "permission-update";
  permission: Permission;
}

export interface FocusRequestMessage {
  type: "focus-request";
  fromUserId: string;
  fromDisplayName: string;
  filePath: string;
  line: number;
  ch: number;
}

export interface SummonMessage {
  type: "summon";
  fromUserId: string;
  fromDisplayName: string;
  targetUserId: string;
  filePath: string;
  line: number;
  ch: number;
}

export interface PresentStartMessage {
  type: "present-start";
  userId: string;
}

export interface PresentStopMessage {
  type: "present-stop";
  userId: string;
}

export interface SyncRequestMessage {
  type: "sync-request";
  path?: string;
}

export interface SessionEndMessage {
  type: "session-end";
}

export interface PingMessage {
  type: "ping";
  timestamp: number;
}

export interface PongMessage {
  type: "pong";
  timestamp?: number;
}

export interface HostTransferOfferMessage {
  type: "host-transfer-offer";
  userId: string;
  displayName?: string;
}

export interface HostTransferAcceptMessage {
  type: "host-transfer-accept";
  userId: string;
}

export interface HostTransferDeclineMessage {
  type: "host-transfer-decline";
  userId: string;
  displayName?: string;
}

export interface HostTransferCompleteMessage {
  type: "host-transfer-complete";
  userId: string;
  displayName: string;
}

export interface HostDisconnectedMessage {
  type: "host-disconnected";
}

export interface HostChangedMessage {
  type: "host-changed";
  userId: string;
  displayName: string;
}

export type ControlMessage =
  | FileOpMessage
  | ChunkStartMessage
  | ChunkDataMessage
  | ChunkEndMessage
  | ChunkResumeMessage
  | PresenceUpdateMessage
  | PresenceLeaveMessage
  | JoinRequestMessage
  | JoinResponseMessage
  | KickMessage
  | KickedMessage
  | SetPermissionMessage
  | PermissionUpdateMessage
  | FocusRequestMessage
  | SummonMessage
  | PresentStartMessage
  | PresentStopMessage
  | SyncRequestMessage
  | SessionEndMessage
  | PingMessage
  | PongMessage
  | HostTransferOfferMessage
  | HostTransferAcceptMessage
  | HostTransferDeclineMessage
  | HostTransferCompleteMessage
  | HostDisconnectedMessage
  | HostChangedMessage;

export type ControlMessageType = ControlMessage["type"];

export interface ControlMessageMap {
  "file-op": FileOpMessage;
  "file-chunk-start": ChunkStartMessage;
  "file-chunk-data": ChunkDataMessage;
  "file-chunk-end": ChunkEndMessage;
  "file-chunk-resume": ChunkResumeMessage;
  "presence-update": PresenceUpdateMessage;
  "presence-leave": PresenceLeaveMessage;
  "join-request": JoinRequestMessage;
  "join-response": JoinResponseMessage;
  kick: KickMessage;
  kicked: KickedMessage;
  "set-permission": SetPermissionMessage;
  "permission-update": PermissionUpdateMessage;
  "focus-request": FocusRequestMessage;
  summon: SummonMessage;
  "present-start": PresentStartMessage;
  "present-stop": PresentStopMessage;
  "sync-request": SyncRequestMessage;
  "session-end": SessionEndMessage;
  ping: PingMessage;
  pong: PongMessage;
  "host-transfer-offer": HostTransferOfferMessage;
  "host-transfer-accept": HostTransferAcceptMessage;
  "host-transfer-decline": HostTransferDeclineMessage;
  "host-transfer-complete": HostTransferCompleteMessage;
  "host-disconnected": HostDisconnectedMessage;
  "host-changed": HostChangedMessage;
}
