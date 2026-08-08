import { Notice, type TFile, TFolder, type Vault } from "obsidian";
import type * as Y from "yjs";

import type { DocHandle, SyncManager } from "../sync/sync";
import type { LiveShareSettings, ManifestPublishDecision, SessionRole } from "../types";
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
import {
  CONFLICT_PRESERVATION,
  conflictCopyPath,
  decideConflictPreservation,
  isConflictsPath,
  noteConflictCopy,
  noteConflictCopyFailure,
} from "./conflict-copy";
import {
  EMPTY_WRITE_DECISION,
  type EmptyWriteRefusalLogger,
  decideEmptyWrite,
  noteEmptyWriteRefusal,
} from "./empty-write-guard";
import type { ExclusionManager } from "./exclusion";
import { PUBLICATION_DECISION, decidePublication } from "./manifest-purge-decision";
import {
  isProtectedPath,
  noteProtectedRefusal,
  protectedRefusalMessage,
} from "./protected-paths";

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

/**
 * D2 — the ATTESTATION that turns "the manifest does not list it" from an
 * inference into a fact.
 *
 * Before this existed the manifest was a bare `path -> entry` map with no
 * provenance whatsoever, so a guest holding one could not distinguish
 *
 *     "a live host published this set and your file is not in it"   (a fact)
 *
 * from
 *
 *     "this is whatever the relay replayed at me and nobody has said
 *      anything since"                                              (an absence)
 *
 * and it treated both as a licence to `trashFile`. That is I11 at the top
 * level: absence of information translated into a destructive action. The two
 * cases are now structurally different values, not the same value read
 * charitably.
 *
 * Written ONLY by {@link ManifestManager.publishManifest}, which only the host
 * calls, and written inside the same Yjs transaction as the entries it
 * describes — so a peer can never observe a published entry set without the
 * attestation that vouches for it, nor an attestation ahead of its entries.
 */
export interface ManifestPublication {
  /** The publisher's `userId` — i.e. who claims to be the host. */
  hostId: string;
  /**
   * Monotonic publication counter. The FRESHNESS signal, and deliberately not a
   * timestamp: freshness has to survive two peers whose clocks disagree, and a
   * counter compared against a baseline taken at connect time answers exactly
   * the question that matters — "did a publication happen AFTER I connected?" —
   * without trusting anybody's clock.
   */
  seq: number;
  /** Publisher wall clock. DIAGNOSTICS ONLY. Never gate anything on this. */
  publishedAt: number;
  /**
   * S115 — THE SCOPE THIS ENTRY SET DESCRIBES: the publisher's own
   * `sharedFolder`, trimmed. `""` means "the whole vault", exactly as it does
   * in {@link ManifestManager.isSharedPath}.
   *
   * Why it lives ON the attestation rather than in a second `meta` key: a
   * consumer of this manifest is about to decide which of ITS files the
   * publisher failed to mention, and "not mentioned" is only meaningful
   * relative to the range the publisher was speaking about. Entry set and
   * range are one statement, so they ride one `set` inside one transaction —
   * the same argument that put the attestation in the entries' transaction one
   * level up, applied to the attestation's own fields.
   *
   * OPTIONAL, and it must stay optional. A host running an older build
   * publishes an attestation without this field; that is a real deployment and
   * it must be SAFE, not merely tolerated. It is deliberately NOT validated in
   * {@link ManifestManager.getPublication} — freshness must keep working for
   * such a host (it still proves a live host exists), while the scope question
   * answers "unknown" and every destructive consumer refuses. Widening
   * `getPublication`'s shape check would conflate the two and turn an old host
   * into a peer that appears absent.
   */
  sharedRoot?: string;
}

/**
 * S115 — the answer to "what range does the host actually govern?", as a closed
 * two-state value rather than a `string | null` the caller has to interpret.
 *
 * `null` would have been ambiguous against the one value that legitimately
 * means "everything": the empty string. A guest that cannot tell "the host
 * shares the whole vault" from "I could not find out what the host shares"
 * deletes the wrong vault. Naming the states removes the choice.
 */
export type HostSharedScope =
  | { known: true; root: string }
  | { known: false; root: null; reason: string };

/** The Yjs map holding {@link ManifestPublication}, beside the `files` map. */
const META_MAP = "meta";
const PUBLICATION_KEY = "publication";

async function hashBuffer(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hashContent(content: string): Promise<string> {
  return hashBuffer(new TextEncoder().encode(content).buffer);
}

/**
 * S115 — "is this canonical path inside `root`?", with `""` meaning the whole
 * vault. THE one place that answers it, for the local setting and for a host's
 * published root alike, so the two arms cannot drift apart.
 *
 * S114's trim is here rather than at either call site, for S114's own reason:
 * `"  "` is truthy, so an untrimmed whitespace value takes the scoped branch
 * and builds the prefix `"   /"`, which nothing matches — a scope that shares
 * NOTHING, silently. That failure is merely useless when it comes from the
 * local settings box; arriving from a remote peer it would be a scope this
 * peer could not act on at all, so the trim has to be common to both.
 */
function matchesSharedRoot(canonicalPath: string, root: string): boolean {
  const trimmed = root.trim();
  if (!trimmed) return true;
  const folder = normalizePath(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
  return canonicalPath.startsWith(folder) || canonicalPath === normalizePath(trimmed);
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

  /**
   * S125 AC10 — how many local versions the most recent `syncFromManifest`
   * preserved. Reported alongside the "synced N file(s)" notice, which on its
   * own read as unambiguous success while it was quietly replacing the user's
   * edits.
   *
   * A field rather than a widened return type: `syncFromManifest` has six
   * callers, and changing its signature to carry one diagnostic would touch
   * every one of them for no benefit at five of the six.
   */
  private lastSyncConflictCopies = 0;

  /** D2 — the attestation map, and the baseline against which it is judged. */
  private meta: Y.Map<ManifestPublication> | null = null;
  private metaObserver: ((events: Y.YMapEvent<ManifestPublication>) => void) | null = null;
  /**
   * The publication `seq` observed at the moment `connect()` finished waiting
   * for the relay's replay. Everything at or below this number is state that
   * was ALREADY THERE when we arrived — it says nothing about whether a host is
   * alive now, which is precisely the confusion that destroyed files.
   */
  private seqAtConnect = 0;

  /**
   * WP80 — the two facts the publication decision turns on, both owned here so
   * that `main.ts` and `sync/control-handlers.ts` gain CALLS ONLY and no
   * conditional over manifest or sync state.
   *
   * `roleAtConnect` is the role this peer held when it connected the manifest.
   * A peer that connected as host never populated its disk from anybody else's
   * manifest; a peer that connected as GUEST pulled its disk out of the room
   * manifest and, until that pull has accounted for every entry, its local set
   * is a statement about how far it got. `promoteToHost` is exactly the
   * transition that turns the second kind of peer into a publisher, and it is
   * why "am I host?" is not the question — "what was I when my disk was
   * filled?" is.
   */
  private roleAtConnect: SessionRole = null;
  /**
   * WP80 — `true` only after `connect()`'s `waitForSync` has returned. An empty
   * `getEntries()` because the replay has not landed looks exactly like an empty
   * room, and "every entry is accounted for" is trivially true of a set nobody
   * has told us about yet.
   */
  private manifestSynced = false;
  /**
   * WP80 — STICKY for this session: another peer has published this manifest
   * SINCE WE CONNECTED. Exactly D2's `hasFreshPublication(ownId)`, latched.
   *
   * Latched rather than sampled, because a peer whose first publication is
   * additive stamps its OWN id into the attestation — a "the attestation is
   * mine" test would grant the very NEXT publication a purge and re-open the
   * hole one republish later.
   *
   * Scoped to freshness rather than to the replayed state, because a replayed
   * attestation is the room's persistence speaking, not a live peer talking
   * over us. Latching on the replay was measured to disable the host's own
   * deletion propagation for whole sessions after a single role flip.
   */
  private foreignPublicationSinceConnect = false;
  /** WP80 — what the most recent real publication decided. Diagnostics + the E2E instrument. */
  private lastPublishDecision: ManifestPublishDecision | null = null;

  private exclusionManager: ExclusionManager | null = null;
  /**
   * S137 — the debug-log sink for this module's REFUSALS.
   *
   * Null until `main.ts` wires it, and every use is `?.`-guarded, so the many
   * harnesses that construct a `ManifestManager` directly are unaffected. Wired
   * AFTER the `DebugLogger` is assigned, never beside the constructor call —
   * S104's lesson, and the reason `main.ts` groups every `setLogger` in one
   * block below the sink rather than beside each `new`.
   */
  private logger: EmptyWriteRefusalLogger | null = null;

  constructor(
    private vault: Vault,
    private settings: LiveShareSettings,
  ) {}

  /**
   * S137 — wiring only. See {@link logger}: after the `DebugLogger` exists, not
   * beside `new ManifestManager(...)`.
   */
  setLogger(logger: EmptyWriteRefusalLogger | null): void {
    this.logger = logger;
  }

  setExclusionManager(manager: ExclusionManager) {
    this.exclusionManager = manager;
  }

  /**
   * The same identity `main.ts` sends as `join-request.userId` and the same one
   * `session.ts` registers as the room's `hostUserId`. Spelled once here so the
   * attestation's `hostId` is comparable to both without a second convention.
   */
  private get localUserId(): string {
    return this.settings.githubUserId || this.settings.clientId || "";
  }

  updateSettings(settings: LiveShareSettings) {
    this.settings = settings;
  }

  async connect(syncManager: SyncManager): Promise<void> {
    this.syncManager = syncManager;
    // WP80 — captured BEFORE the awaits below, because a `join-response` can
    // land while `waitForSync` is still pending and promote this peer mid-call.
    // The question is what this peer was when its disk was filled, and that is
    // decided here, not after the race.
    this.roleAtConnect = this.settings.role ?? null;
    this.manifestSynced = false;
    this.foreignPublicationSinceConnect = false;
    this.docHandle = syncManager.getDoc("__manifest__");
    if (!this.docHandle) return;
    this.manifest = this.docHandle.doc.getMap("files");
    this.meta = this.docHandle.doc.getMap<ManifestPublication>(META_MAP);
    await syncManager.waitForSync("__manifest__");
    // D2 — take the freshness baseline AFTER the replay has landed, so the
    // relay's persisted state can never be mistaken for a live host speaking.
    this.seqAtConnect = this.getPublication()?.seq ?? 0;
    // WP80 — same instant, same reason: only now is an empty entry set evidence
    // of an empty room rather than of a replay that has not arrived.
    this.manifestSynced = true;
    this.noteForeignPublication();
  }

  /**
   * WP80 — OR the sticky "somebody else has spoken" flag with what the doc says
   * right now. Called at connect and before every publication; the attestation
   * only changes when a peer publishes, so this sees every foreign publication
   * that happened since the previous call.
   */
  private noteForeignPublication(): void {
    // Reuses D2's freshness predicate verbatim rather than re-deriving it: a
    // publication past our connect baseline, by somebody who is not us.
    if (this.hasFreshPublication(this.localUserId)) this.foreignPublicationSinceConnect = true;
  }

  /** D2 — the attestation currently in the doc, or `null` if nobody ever published. */
  getPublication(): ManifestPublication | null {
    const raw = this.meta?.get(PUBLICATION_KEY);
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.seq !== "number" || !Number.isFinite(raw.seq)) return null;
    if (typeof raw.hostId !== "string") return null;
    return raw;
  }

  /**
   * D2 — POSITIVE EVIDENCE that a live host published during THIS session.
   *
   * True only when the attestation's `seq` has advanced past the value that was
   * already in the doc when we connected. A stale manifest replayed from relay
   * persistence, a session with no host at all, and a host that has not yet
   * published all answer `false` — they are all "I don't know", and "I don't
   * know" must never delete.
   *
   * `excludeUserId` lets the caller refuse to be its own witness: a peer must
   * not accept its own publication as proof that somebody else is alive.
   */
  hasFreshPublication(excludeUserId?: string): boolean {
    const pub = this.getPublication();
    if (!pub) return false;
    if (pub.seq <= this.seqAtConnect) return false;
    if (excludeUserId && pub.hostId === excludeUserId) return false;
    return true;
  }

  /**
   * S115 — WHAT RANGE THE HOST GOVERNS, or an explicit "I don't know".
   *
   * The only correct input to a consumer's destructive reconcile. A guest's own
   * `sharedFolder` answers "what would I publish?" — a different question, and
   * the one that made `cleanupStaleFiles` propose the guest's entire vault for
   * the trash whenever the two settings disagreed (which they do by default:
   * the field ships empty, and empty means everything).
   *
   * Reads the attestation, so the scope this returns is the scope of the SAME
   * publication `hasFreshPublication` vouches for — a scope can never be
   * carried over from an older host than the entries it is applied to.
   *
   * Answers `known: false` when nobody has published, and when the publisher
   * did not state a scope (an older build). Both are "I don't know", and I11
   * says an unknown must refuse, never guess: there is no default that is safe
   * here, because the natural default — "" — means the whole vault.
   */
  getHostSharedScope(): HostSharedScope {
    const pub = this.getPublication();
    if (!pub) {
      return { known: false, root: null, reason: "no host has published a manifest for this room" };
    }
    if (typeof pub.sharedRoot !== "string") {
      return {
        known: false,
        root: null,
        reason:
          `host ${pub.hostId} published manifest seq=${pub.seq} without stating its shared ` +
          "folder (a build older than S115), so the range it describes is unknown",
      };
    }
    return { known: true, root: pub.sharedRoot.trim() };
  }

  /** D2 — fires whenever the attestation changes, i.e. whenever a host publishes. */
  setPublicationChangeHandler(callback: (publication: ManifestPublication) => void): void {
    if (!this.meta) return;
    if (this.metaObserver) this.meta.unobserve(this.metaObserver);
    this.metaObserver = () => {
      const pub = this.getPublication();
      if (pub) callback(pub);
    };
    this.meta.observe(this.metaObserver);
  }

  /** WP80 — what the most recent real publication decided, or `null` if none has run. */
  getLastPublishDecision(): ManifestPublishDecision | null {
    return this.lastPublishDecision;
  }

  private recordDecision(decision: ManifestPublishDecision): ManifestPublishDecision {
    this.lastPublishDecision = decision;
    return decision;
  }

  /**
   * WP80 — publishes, and REPORTS what it published.
   *
   * Two changes, both load-bearing:
   *
   *   1. The purge is no longer the caller's bare boolean. `options.purge` is
   *      now a REQUEST; whether it is granted is decided by
   *      {@link decidePublication} from facts this peer already holds, and it
   *      fails closed. A peer that cannot establish completeness still
   *      publishes — additively — so the refusal is of the DELETION, never of
   *      the publication (I11).
   *   2. The early return is a NAMED REFUSAL rather than a bare `return`.
   *      `promoteToHost` can reach this method while `connect()` is still
   *      awaiting `waitForSync`, and before this the peer was host, believed it
   *      had published, and no attestation existed — with nothing anywhere able
   *      to show it.
   */
  async publishManifest(options?: { purge?: boolean }): Promise<ManifestPublishDecision> {
    if (!this.manifest || !this.docHandle) {
      const refusal = decidePublication({
        manifestConnected: false,
        manifestSynced: this.manifestSynced,
        isHost: this.settings.role === "host",
        enteredSessionAsHost: this.roleAtConnect === "host",
        purgeRequested: options?.purge === true,
        foreignPublicationSinceConnect: this.foreignPublicationSinceConnect,
        manifestPaths: [],
        localPaths: [],
        readFailures: 0,
      });
      return this.recordDecision({
        published: false,
        purged: false,
        verdict: refusal.decision,
        reason: refusal.reason,
        entries: 0,
        deleted: [],
        unaccounted: [],
      });
    }

    const files = this.getSharedFiles();

    // WP80 / S28 — counted, not swallowed. Each failure silently omits a file
    // from `entries`, and under a granted purge that omission is a DELETION.
    let readFailures = 0;
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
        readFailures++;
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

    // WP80 — the verdict is taken by the pure core, from facts this peer already
    // holds, BEFORE the transaction opens. No clock is consulted anywhere in
    // this path: `publishedAt` remains diagnostics-only, and freshness stays
    // `seq`, exactly as D2 established.
    this.noteForeignPublication();
    const verdict = decidePublication({
      manifestConnected: true,
      manifestSynced: this.manifestSynced,
      isHost: this.settings.role === "host",
      enteredSessionAsHost: this.roleAtConnect === "host",
      purgeRequested: options?.purge === true,
      foreignPublicationSinceConnect: this.foreignPublicationSinceConnect,
      manifestPaths: Array.from(this.manifest.keys()),
      localPaths: Array.from(entries.keys()),
      readFailures,
    });
    const purgeGranted = verdict.decision === PUBLICATION_DECISION.PURGE;
    const deleted: string[] = [];

    this.docHandle.doc.transact(() => {
      if (purgeGranted) {
        // Collected first, then deleted: the keys are the same set the verdict
        // was taken over, and mutating a Y.Map while iterating its own key
        // iterator is not something to rely on.
        for (const filePath of Array.from(this.manifest?.keys() ?? [])) {
          if (!entries.has(filePath)) deleted.push(filePath);
        }
        for (const filePath of deleted) {
          this.manifest?.delete(filePath);
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
      // D2 — the attestation rides the SAME transaction as the entry set it
      // describes. Not a separate write: a peer must never be able to observe a
      // purged entry set without the statement that vouches for it (it would
      // read as "the host says these files are gone" when the purge had not
      // been vouched for), nor an attestation whose entries have not landed yet
      // (it would licence deletion against a manifest that is still arriving).
      // One transaction makes both orderings unrepresentable.
      const previous = this.getPublication();
      this.meta?.set(PUBLICATION_KEY, {
        hostId: this.localUserId,
        seq: (previous?.seq ?? 0) + 1,
        publishedAt: Date.now(),
        // S115 — the range this entry set was built over, stated by the only
        // peer that knows it. `getSharedFiles()` above filtered the vault with
        // `isSharedPath`, i.e. with THIS setting; publishing it makes the
        // manifest self-describing instead of leaving every consumer to guess
        // with its own copy of the field. Trimmed at the source for the same
        // reason `isSharedPath` trims (S114): `"  "` is truthy and would
        // otherwise cross the wire as a scope matching nothing.
        sharedRoot: this.settings.sharedFolder.trim(),
      });
    });

    return this.recordDecision({
      published: true,
      purged: purgeGranted,
      verdict: verdict.decision,
      reason: verdict.reason,
      entries: entries.size,
      deleted,
      unaccounted: verdict.unaccounted,
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
    // S125 AC10 — counted per call, so the JOIN NOTICE can say it. The module
    // ledger counts the whole session; this counts this pass.
    let conflictCopies = 0;
    this.lastSyncConflictCopies = 0;
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
      // WP95 — THE MANIFEST-DRIVEN ARM, and it never reached `isSharedPath`.
      //
      // This loop's paths are the KEYS OF A PEER-PUBLISHED `Y.Map`. Between them
      // and `vault.create` / `vault.modify` below stood `isPathSafe` (a
      // traversal test) and `isSidecarPath` (one directory) — and nothing else.
      // `isSharedPath` is not consulted anywhere in this method, so the
      // `ExclusionManager` config-directory pattern that keeps the create arm
      // out of the Obsidian config tree does not apply here at all. A hostile host
      //
      // (The glob form of those two trees is deliberately NOT spelled out in
      // this comment. `wp83-source-derivation.ts`'s `stripComments` strips
      // block comments BEFORE line comments and with a non-greedy scan, so the
      // two-character sequence that opens a doc comment — which is what a
      // directory glob ends with — opens one HERE, inside a `//` line, and
      // swallows every line down to the next comment terminator. That silently
      // ate `syncFromManifest`'s `skipsAutoTextSync` call site 40 lines below
      // and reddened WP83 AC2. Measured, not guessed.)
      // publishing an entry for `.obsidian/plugins/live-share/main.js` reaches
      // the writer at the bottom of this loop directly.
      //
      // Placed beside the sidecar skip, ahead of the directory branch: the
      // directory branch runs `ensureFolder` on a peer-chosen path and would
      // otherwise create `.git/hooks` for the op that follows it.
      if (isProtectedPath(path)) {
        // S137 (B2) — the SIBLING refusal on the same arm, with the same defect:
        // counted, never said. Same shared emitter as the four arms that already
        // log it, so the census is over arms and not over phrasings.
        noteProtectedRefusal("manifest-sync", path);
        this.logger?.warn("file-op", protectedRefusalMessage("manifest-sync", path));
        continue;
      }

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
        // S125 AC11 — BINARIES ARE COVERED. The actual bytes arrive later, over
        // the chunked transfer, and land through `FileOpsManager` rather than
        // here — but the DECISION to replace this file is taken on this line,
        // and the local version still exists at this instant. Preserving it
        // here is both correct and the only place in this arm where the old
        // bytes are still readable. A user's replaced image is the same loss as
        // a replaced note.
        if (localFile && (await this.preserveLocalVersion(path, localFile, "binary"))) {
          conflictCopies++;
        }
        requestBinary?.(path);
        synced++;
        continue;
      }

      const tempHandle = this.syncManager.getDoc(path);
      if (!tempHandle) continue;

      try {
        await this.syncManager.waitForSync(path);

        const content = tempHandle.text.toString();

        // S119 — THE FLOOR. `waitForSync` resolving does NOT mean the document
        // has arrived: `SyncManager.handleSubscribed` flips a doc to synced the
        // instant the relay reports `peerCount === 0`, which happens BEFORE the
        // stored replay batch lands. This read then returns `""`, and the write
        // below used to truncate the user's note to zero bytes. That is exactly
        // what emptied every `.md` in a live shared folder on three clients.
        //
        // The evidence is already on the wire and costs nothing extra to check:
        // `entry.hash` is the HOST'S OWN hash for this path. If the host really
        // does hold an empty file, `entry.hash` is the hash of `""` and the
        // write proceeds (that legitimate case must keep working). If the doc is
        // empty while the host says the file hashes to something else, this peer
        // is holding an absence, not a fact.
        //
        // Checked against the hash rather than merely against emptiness because
        // the hash is strictly stronger: it also refuses a half-replayed
        // document, which is the same failure one notch less visible.
        const verdict = decideEmptyWrite({
          incoming: content,
          existing: localFile ? normalizeLineEndings(await this.vault.read(localFile)) : null,
          intentional: (await hashContent(content)) === entry.hash,
          evidenceLabel: "the host's published hash for this path",
        });
        if (verdict.decision !== EMPTY_WRITE_DECISION.ALLOW) {
          // S137 — THE ARM THAT FIRED TWICE ON AN ORDINARY REJOIN, and the two
          // firings could not be attributed to a path because this line went to
          // the console and nowhere else. Counted, LOGGED with the path and the
          // arm, and still said on the console. One shared emitter.
          noteEmptyWriteRefusal("manifest-sync", path, verdict.reason, this.logger);
          continue;
        }

        // S125 AC6 — PRESERVE, and note the ORDER. The empty-write floor above
        // has already had its say: if it refused, we `continue`d and never got
        // here, so a refusal writes no copy. Nothing is being destroyed on that
        // branch and littering the vault with copies on every refusal would be
        // its own defect.
        //
        // Only the destructive branch copies. A file that does not exist
        // locally is being CREATED, which destroys nothing; a file whose hash
        // already matched never reached this loop body at all.
        if (localFile && (await this.preserveLocalVersion(path, localFile, "text"))) {
          conflictCopies++;
        }

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

    this.lastSyncConflictCopies = conflictCopies;
    return synced;
  }

  /** S125 AC10 — local versions preserved by the most recent sync pass. */
  getLastSyncConflictCopies(): number {
    return this.lastSyncConflictCopies;
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

  /**
   * S115 — is `rawPath` inside `root`, where `""` means the whole vault?
   *
   * THE ROOT IS A PARAMETER, and that is the entire point. The local safety
   * floors below (sidecar, protected, exclusions) are properties of THIS vault
   * and stay local no matter whose root is being applied — a remote peer must
   * never be able to talk this peer into touching `.obsidian/`, `.git/` or the
   * sidecar directory by naming them as its shared folder. Only the range is
   * taken from the argument.
   *
   * {@link isSharedPath} is this function partially applied to the LOCAL
   * setting, which is the correct question for "what do I publish?" and the
   * wrong one for "what did the host govern?".
   */
  isWithinSharedRoot(rawPath: string, root: string): boolean {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (!this.passesLocalSafetyFloors(path)) return false;
    return matchesSharedRoot(path, root);
  }

  /**
   * S115 — the three refusals that are true of a path regardless of any shared
   * folder, local or remote. Extracted verbatim from `isSharedPath`, whose
   * comments (retained below) are the reasons each one is owned here rather
   * than delegated to `ExclusionManager`. Takes an ALREADY-CANONICAL path.
   */
  private passesLocalSafetyFloors(path: string): boolean {
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
    // WP95 — the same answer as the line above, for the same reason, over a
    // wider tree. This is NOT redundant with the `exclusionManager` line below
    // it, and the comment above already says why in the sidecar's case: that
    // gate excludes `.obsidian/**` only by COINCIDENCE. Three configurations
    // break the coincidence (no `ExclusionManager` installed — the `?.` on the
    // next line is not decorative; a `setPatterns` that has not run yet; a
    // non-default `app.vault.configDir`), and NO configuration of it has ever
    // excluded `.git/**`. Owned here, unconditionally, so the answer does not
    // depend on the local user's settings.
    if (isProtectedPath(path)) {
      noteProtectedRefusal("shared-path", path);
      return false;
    }
    // S125 AC7 — THE CONFLICTS FOLDER IS NEVER SHARED, and this is where that
    // is owned.
    //
    // Placed beside `isSidecarPath` and `isProtectedPath` for their reason,
    // which applies here with more force: a conflict copy is BY CONSTRUCTION
    // different from the host's content, so if one ever counted as shared it
    // would be published, come back as a permanent `needsSync`, and be
    // re-conflicted on every join — copies multiplying without bound.
    //
    // Not delegated to `ExclusionManager` (the user can reconfigure it away)
    // and not left to the folder's sibling POSITION, which does not exist in
    // the whole-vault case: when `sharedFolder` is empty the conflicts root
    // sits at the vault root, which is inside the share by definition. A
    // positional exclusion cannot express this; an owned one can.
    if (isConflictsPath(path, this.settings.sharedFolder)) return false;
    if (this.exclusionManager?.isExcluded(path)) return false;
    return true;
  }

  /**
   * S125 — copy the guest's about-to-be-overwritten version beside the share.
   *
   * NEVER THROWS. Preservation is strictly additive to the sync: a vault that
   * refuses the copy (permissions, a name collision, a full disk) must still
   * receive the host's content, because failing the sync would turn a
   * best-effort safety net into a new outage. The failure is counted instead,
   * so it is visible rather than silent.
   */
  private async preserveLocalVersion(
    path: string,
    localFile: TFile,
    arm: "text" | "binary",
  ): Promise<boolean> {
    // S125 AC6a — only what the GUEST changed while offline. Most divergences
    // are staleness (the host edited while we were away), and copying those
    // would fill the folder with versions the user never touched until nobody
    // read it. Every uncertain input resolves to PRESERVE — see the decision.
    const verdict = decideConflictPreservation({
      mtime: localFile.stat?.mtime,
      lastSessionEndedAt: this.settings.lastSessionEndedAt,
    });
    if (verdict.decision === CONFLICT_PRESERVATION.DISCARD) return false;
    try {
      const target = conflictCopyPath(path, this.settings.sharedFolder, new Date());
      const parent = target.substring(0, target.lastIndexOf("/"));
      if (parent) await ensureFolder(this.vault, parent);
      if (arm === "binary") {
        const bytes = await this.vault.readBinary(localFile);
        await this.vault.createBinary(target, bytes);
      } else {
        await this.vault.create(target, await this.vault.read(localFile));
      }
      noteConflictCopy(arm);
      return true;
    } catch (err) {
      // S137 (B2) — the third member of this family. Not a refusal but a FAILED
      // SAFETY NET: the guest's about-to-be-overwritten bytes were not preserved
      // and the sync proceeds regardless (by design — see the doc comment). It
      // was counted and said on the console only, so the same "which file?"
      // question was unanswerable here too. The `err` is NOT put in the debug
      // log line: it can carry an adapter message quoting the path only, but the
      // message shape stays fixed and content-free either way.
      noteConflictCopyFailure();
      this.logger?.warn(
        "file-op",
        `CONFLICT COPY FAILED: path=${path} the local version was not preserved before ` +
          "the host's content replaced it",
      );
      console.warn(`[live-share] could not preserve local version of ${path}`, err);
      return false;
    }
  }

  isSharedPath(rawPath: string): boolean {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (!this.passesLocalSafetyFloors(path)) return false;
    // S114 — TRIM FIRST, and trim ONCE for both branches.
    //
    // This used to read `if (!this.settings.sharedFolder) return true;` against
    // the raw value. `"   "` is truthy, so a field holding only whitespace took
    // the SCOPED branch and built the prefix `"   /"`. Nothing in any vault
    // starts with that, so `isSharedPath` answered `false` for every path: the
    // session connected, published an empty manifest, raised no error, and
    // synced NOTHING. It is the worst-behaved value the field accepts — an
    // empty field shares everything and a typo shares nothing, but at least a
    // typo is visible in the box; whitespace is not.
    //
    // `normalizePath` here is this project's own (`utils.ts`) and only maps
    // backslashes — it does not trim, so no downstream call was going to
    // rescue this. Trimming at the single point where "is a folder configured"
    // is decided keeps the two branches from disagreeing about what empty is.
    //
    // S115 — the trim and the prefix test now live in `matchesSharedRoot` so
    // that the remote-root arm cannot drift from this one; the local setting is
    // simply the argument this call site supplies.
    return matchesSharedRoot(path, this.settings.sharedFolder);
  }

  destroy(): void {
    if (this.observer && this.manifest) {
      this.manifest.unobserve(this.observer);
      this.observer = null;
    }
    if (this.metaObserver && this.meta) {
      this.meta.unobserve(this.metaObserver);
      this.metaObserver = null;
    }
    if (this.syncManager) {
      this.syncManager.releaseDoc("__manifest__");
    }
    this.docHandle = null;
    this.manifest = null;
    this.meta = null;
    // WP80 — a torn-down manifest has not replayed anything, and a session that
    // has ended tells this peer nothing about the next one's role. Both reset to
    // the fail-closed value so a `publishManifest` between `destroy()` and the
    // next `connect()` cannot inherit the previous session's standing.
    this.manifestSynced = false;
    this.roleAtConnect = null;
    this.foreignPublicationSinceConnect = false;
    // D2 — a session that has ended has no live host by construction. Resetting
    // the baseline to 0 would make the NEXT connect's replayed state look fresh
    // if `connect()` ever failed to re-baseline; leaving it high cannot cause a
    // false "fresh", only a false "stale", which is the safe direction.
    this.syncManager = null;
  }

  private getSharedFiles(): TFile[] {
    return this.vault.getFiles().filter((file) => this.isSharedPath(file.path));
  }
}
