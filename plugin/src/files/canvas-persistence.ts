import * as Y from "yjs";

import { migrateV1ToV2 } from "../canvas/canvas-schema";
import {
  NOTHING_KNOWS_DOC,
  SEED_DECISION,
  type SeedKnowledge,
  decideSeed,
} from "./canvas-seed-decision";
import {
  DEBOUNCE_MS,
  DELETED_MAP_NAME,
  type FlatCanvasData,
  MAX_WAIT_MS,
  type SeedRefusal,
  SeedRefusalLedger,
  buildCanvasData,
  decodeCanvasDataToFlat,
  isSeedRefusalResolved,
  parseCanvas,
  seedRecordsIntoYMaps,
  serializeCanvas,
} from "./canvas-sync";
import type { DurableSeedRefusals } from "./seed-refusal-store";

// ---------------------------------------------------------------------------
// CanvasPersistence — downstream-only `.canvas` writer (SPEC_03, Phase 1).
//
// One instance per shared canvas path. It observes the SAME per-path Y.Doc
// (`nodes`/`edges` maps) as the CanvasBinding, but strictly DOWNSTREAM: it emits
// ZERO CRDT writes — nothing it does opens a Y.Doc transaction. Its only side
// effect is a debounced disk write of the pruned, tab-serialized `.canvas`.
//
// This severs the two-writer race: the file is a persistence sink, never a sync
// input while the canvas is open (SPEC_03 §2/§3). The binding feeds the model;
// this feeds the disk; neither feeds the other.
//
// Reuse (SPEC_03 §3, RepoMap §3): `buildCanvasData` (dangling-edge-pruned
// serializer), `serializeCanvas` (= JSON.stringify(buildCanvasData, null, "\t")),
// the `DEBOUNCE_MS`/`MAX_WAIT_MS` trailing+cap debounce constants, and
// `parseCanvas` + `decodeCanvasDataToFlat` + `seedRecordsIntoYMaps` (WP18's
// validated, create-once, upsert-only seed writer) for the one-time cold-open
// file parse — all imported from `canvas-sync.ts`, never reimplemented.
//
// Headless discipline (mirrors canvas-binding.ts): no Obsidian runtime import.
// File I/O, echo-suppression, and the clock/scheduler are injected so the whole
// class is certifiable without a real vault or real timers.
// ---------------------------------------------------------------------------

/** Settle window before unmuting our own write echo. Mirrors VAULT_EVENT_SETTLE_MS
 * (utils.ts) but inlined to keep this module free of the Obsidian-importing utils
 * module.
 *
 * Mechanical echo suppression: it exists so a burst of flushes takes and releases
 * the mute ONCE instead of N times, not so the mute can decide whose write an
 * event belongs to. Until WP91 this sentence read "NOT a correctness mechanism",
 * and that was false on the capture side: the mute it holds was the only thing
 * standing between a user's `.canvas` save and the doc, and a save landing inside
 * the window was discarded unread. The decision now belongs to the byte echo
 * breaker (`canvas-sync.ts` `handleLocalModify`, WP4 AC2), which compares the
 * file's bytes against what this writer last put there. */
const DISK_WRITE_SETTLE_MS = 250;

/**
 * WP91 (C91 AC5) — the ABSOLUTE ceiling on one continuous mute, measured from the
 * FIRST write of a burst rather than from the last.
 *
 * `armSettleRelease` clears and re-arms on every write, so before WP91 the number
 * above was not the window a reader got: a stream of remote changes re-armed it
 * indefinitely and the mute had no ceiling at all — exactly the case the product
 * exists to serve. The cap makes the documented number computable again from the
 * two constants this module already depends on:
 *
 *   MAX_WAIT_MS (500, the flush debounce cap) + DISK_WRITE_SETTLE_MS (250) = 750
 *
 * The cap is NOT the fix. Discrimination is content identity, one seam upstream;
 * this only stops the window from being a function of peer activity.
 */
const MAX_MUTE_MS = MAX_WAIT_MS + DISK_WRITE_SETTLE_MS;

/**
 * Injected file I/O + echo-suppression seam. Production wires this to the Obsidian
 * vault adapter + `FileOpsManager` (see `createVaultPersistenceIO`); tests wire an
 * in-memory fake. `mutePathEvents`/`unmutePathEvents` suppress the writer's OWN
 * `modify` echo only — there is nothing to feed back into (SPEC_03 §3.4).
 */
export interface PersistenceIO {
  read(diskPath: string): Promise<string>;
  write(diskPath: string, content: string): Promise<void>;
  exists(diskPath: string): Promise<boolean>;
  mutePathEvents(diskPath: string): void;
  unmutePathEvents(diskPath: string): void;
}

/**
 * Clock/scheduler seam so the trailing+cap debounce is testable without real
 * timers. Defaults route to the globals (so `vi.useFakeTimers()` intercepts them);
 * a test may also inject a manual scheduler. Methods are called through arrows so
 * fake-timer replacement of the globals is picked up even post-construction.
 */
export interface PersistenceScheduler {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_SCHEDULER: PersistenceScheduler = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Dedicated transaction-origin stamp for the one-time cold-open file→CRDT seed
 * (SPEC_03 §4). Distinct from `CANVAS_BINDING_ORIGIN`; the seed runs before any
 * binding/persistence observer is attached, so the origin is informational. */
export const CANVAS_SEED_ORIGIN: unique symbol = Symbol("canvas-seed-origin");

/** The migration's transaction-origin stamp, re-exported next to the seed's so
 * an observer of cold open can import both from one place. It is DEFINED in
 * `canvas/canvas-schema.ts`, beside the transaction it stamps — this module
 * imports that one, so declaring it here would close an import cycle. */
export { CANVAS_MIGRATION_ORIGIN } from "../canvas/canvas-schema";

/** Outcome of the cold-open load decision (SPEC_03 §4). */
export type ColdOpenResult =
  | "seeded-from-file" // doc was empty → file parsed and seeded into the doc
  | "doc-wins" // doc non-empty → file NOT read; stale file overwritten from doc
  | "empty"; // doc empty AND file missing/empty → nothing to seed

export interface CanvasPersistenceOpts {
  /** Injected clock/scheduler. Default: real globals (fake-timer friendly). */
  scheduler?: PersistenceScheduler;
  /** Settle window (ms) before unmuting the write echo. Default 250. */
  settleMs?: number;
  /**
   * WP91 (C91 AC5): absolute ceiling (ms) on one continuous mute, measured from
   * the first write of the burst. Default `MAX_WAIT_MS + DISK_WRITE_SETTLE_MS`.
   * `Number.POSITIVE_INFINITY` restores the pre-WP91 unbounded re-arm, which is
   * what AC5's control fixture uses to show the cap is doing the work.
   */
  maxMuteMs?: number;
  /** Optional debug logger. */
  logger?: { debug(category: string, message: string): void; warn?(c: string, m: string): void };
  /**
   * WP7 (§ 6.2, US5 AC15): invoked with the content that just landed on disk,
   * right after `lastWrittenContent` advances. Production feeds this into
   * `CanvasSync.noteExternalDiskWrite(path, content)` so the sync layer's
   * three-way-diff baseline never goes stale now that it no longer writes the
   * file itself, and so its `isRecentDiskWrite` echo guard still covers OUR
   * write (`vault-events.ts:121`, unchanged).
   */
  onWritten?: (content: string) => void;
  /**
   * WP63 (I11): the per-path refused set this writer must consult before it
   * overwrites the file.
   *
   * Injected rather than owned because the HOST seed refuses records during
   * `CanvasSync.subscribe`, which runs BEFORE this instance exists — so the
   * ledger has to be shared with `CanvasSync` (`canvasSync.seedRefusalLedger(path)`).
   * Omit it and the writer owns a private one, which the cold-open seed fills:
   * that is the whole mechanism for a guest, and it is why a caller cannot
   * accidentally opt out of the protection by forgetting to wire anything.
   */
  seedRefusals?: SeedRefusalLedger;
  /**
   * WP90 (I11): where the refused set is kept so it OUTLIVES THE PROCESS.
   *
   * Optional, and omitting it is exactly WP63: the ledger keeps its per-session
   * lifetime and every existing caller behaves as it did. Supplying it makes
   * `coldOpen` consult the store BEFORE the `doc-wins` branch can flush a
   * projection over the user's file — which is where the deletion happens and
   * the only reason this seam exists.
   *
   * Injected rather than constructed here for the same reason `seedRefusals` is:
   * one store serves every canvas path in the vault, and this class is headless
   * (its I/O arrives through {@link PersistenceIO}, the store's through WP24's
   * `SidecarIO`).
   */
  durableRefusals?: DurableSeedRefusals;
  /**
   * WP92 (C92 AC1 / I11): the DOCUMENT's identity, and the store's key.
   *
   * WP90 keyed the durable store by `diskPath` — `toLocalPath(canonical)` — a
   * string that is a function of the running host AND of the file's current
   * name. The host half (S63) has a real mechanism and a falsified reproduction;
   * the NAME half is reachable today by one ordinary gesture: `handleRename`
   * re-keys `guidByPath`, the manifest guid, every `index.json` row and the
   * in-memory ledger, and tells the store nothing — so the standing withhold is
   * left under the retired name and the new path cold-opens with none.
   *
   * This is WP27's guid, the same token `canvasDocId`, `<guid>.yhistory`,
   * `<guid>.ycheckpoint` and `index.json`'s KEYS are built from. Production
   * fills it from `CanvasSync.getCanvasGuid`, which is cached and synchronous
   * and cannot be `null` here by the attach precondition — `attachCanvasWriter`
   * returns early unless `getCanvasDocHandle` answered, and that answers `null`
   * unless the path has a guid or the identity store is absent (in which case
   * the canonical path IS the identity token, by `canvasDocIdFor`'s own rule).
   *
   * OMITTED AND `null` ARE DIFFERENT ANSWERS, on this file's own precedent
   * ({@link CanvasPersistenceOpts.seedKnowledge}: "only an OMITTED probe
   * defaults"):
   *
   *   ├── OMITTED — the caller predates WP92 and has no opinion, so the key
   *   │   stays WP90's `diskPath` and every such caller behaves exactly as it
   *   │   did. Production never omits it, and `wp92/` asserts that structurally
   *   │   over `main.ts` so the compatibility default cannot be reached by the
   *   │   product.
   *   └── `null` — the caller ASKED and this document has no stable identity.
   *       That is I5 DEGRADE: the store is not consulted for this path at all,
   *       narrated, for this path only and never for the session. It does NOT
   *       fall back to the path — a second vocabulary in the file is the defect,
   *       and "the withhold is in memory only" is honest where "the withhold is
   *       under a key the next rename will orphan" is not.
   */
  refusalIdentity?: string | null;
  /**
   * BUILD_SPEC §8 DISCRIMINATION SEAM — test-only, no production caller.
   *
   * `false` restores the pre-WP63 composition exactly: a seed refusal drops the
   * record from the doc and the very next flush writes that projection over the
   * user's file, deleting it. AC4's pin runs the same scenario through both
   * settings and compares the FILE BYTES, so a change that quietly neutralises
   * the withhold breaks a test instead of going unnoticed. Defaults to armed —
   * the seam cannot ship switched off.
   */
  withholdOnSeedRefusal?: boolean;
  /**
   * WP29 (I9/AC1) — what this client learned about the doc before the cold open.
   * Read on every `coldOpen()`. Default: {@link NOTHING_KNOWS_DOC}.
   *
   * Optional, and the default is load-bearing: every caller that predates WP29
   * supplies nothing, and must keep behaving exactly as it did rather than
   * silently refusing to seed a genuinely new board. Production fills it from
   * `CanvasSync.seedKnowledgeFor(path)`, which measures the two conditions
   * during `subscribe`.
   */
  seedKnowledge?: SeedKnowledge;
}

export class CanvasPersistence {
  private readonly doc: Y.Doc;
  private readonly io: PersistenceIO;
  private readonly diskPath: string;
  private readonly nodesMap: Y.Map<Y.Map<unknown>>;
  private readonly edgesMap: Y.Map<Y.Map<unknown>>;
  // WP19 AC1/AC3: the tombstone container. The single writer must see it, or the
  // file keeps a record the doc says is deleted — and, because the same
  // suppression rule drives the node→edge cascade, keeps that record's edges
  // too. It is read-only here: `CanvasPersistence` emits zero CRDT writes (I3).
  private readonly deletedMap: Y.Map<unknown>;
  private readonly scheduler: PersistenceScheduler;
  private readonly settleMs: number;
  private readonly maxMuteMs: number;
  private readonly logger?: {
    debug(category: string, message: string): void;
    warn?(category: string, message: string): void;
  };
  private readonly onWritten?: (content: string) => void;
  // WP63 (I11): the refused set for THIS path, and the seam that arms the guard.
  private readonly refusals: SeedRefusalLedger;
  private readonly withholdOnSeedRefusal: boolean;
  // WP90 (I11): where that set is kept so it survives a restart. Absent = WP63.
  private readonly durableRefusals?: DurableSeedRefusals;
  // WP92 (I11): the key that set is kept UNDER — the document's identity, not
  // the file's name and not the host's spelling of it. Absent = WP63 for this
  // path, narrated. `diskPath` remains the LEGACY key and is read once, at
  // hydrate, so a WP90-era entry is found and re-keyed rather than abandoned.
  private readonly refusalIdentity?: string | null;
  // WP90: the hydration is once per instance, at cold open, and never repeated
  // — a second hydration after a lift would restore what the lift just dropped.
  private durableHydrated = false;
  // WP29 (I9/AC1): the seed-knowledge probe `coldOpen` consults. Held as a whole
  // object rather than as two booleans so `decideSeed` sees exactly what the
  // caller supplied — including a field the caller failed to fill, which the
  // fail-closed rule must be able to notice.
  private readonly seedKnowledge: SeedKnowledge;
  // The `SEED REFUSED:` line last emitted at warn level, so the arming (and any
  // later change to the refused set) is narrated exactly once instead of on
  // every debounced flush.
  private lastWithholdSignature: string | undefined;

  private started = false;
  private destroyed = false;
  private writeTimer: unknown = undefined;
  // Timestamp of the first not-yet-flushed change, for the MAX_WAIT_MS cap.
  private writeFirstScheduled: number | undefined;
  private settleTimer: unknown = undefined;
  private recentDiskWrite = false;
  // Last content that actually LANDED on disk (assigned after the await).
  private lastWrittenContent: string | undefined;
  // WP7 (US5 AC16): last content handed to the write queue, assigned
  // SYNCHRONOUSLY at flush time. The redundant-write skip must test this, not
  // `lastWrittenContent` — the latter only advances after the await, so two
  // overlapping flushes would both see the pre-write value and both proceed.
  private lastQueuedContent: string | undefined;
  // WP7 (US5 AC16 / AC18b): serialized write chain, mirroring BackgroundSync's
  // `writeQueue` (`background-sync.ts:43`/`:391`). Guarantees the LAST enqueued
  // snapshot is the last one to reach disk, so an older flush can never resolve
  // after a newer one and leave stale bytes behind.
  private writeQueue: Promise<void> = Promise.resolve();
  // WP7 (US5 AC18a): outstanding mutes we hold on `diskPath`. `FileOpsManager`
  // mutes are REFCOUNTED (`file-ops.ts:112-125`), so an unbalanced mute is not a
  // transient glitch — it drops every vault `modify` event for this canvas
  // FOREVER. This counter keeps mute/unmute exactly 1:1 no matter how many
  // flushes overlap inside one settle window (the normal case: DEBOUNCE_MS=200,
  // MAX_WAIT_MS=500 vs settleMs=250).
  private muteDepth = 0;
  // WP91 (C91 AC5): `scheduler.now()` at the instant `muteDepth` went 0 → 1, i.e.
  // the first write of the current burst. `armSettleRelease` measures the cap
  // from here, never from the write that is re-arming — measuring from the last
  // write is what gave the window no ceiling.
  private muteOpenedAt = 0;

  constructor(doc: Y.Doc, io: PersistenceIO, diskPath: string, opts: CanvasPersistenceOpts = {}) {
    this.doc = doc;
    this.io = io;
    this.diskPath = diskPath;
    this.nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
    this.edgesMap = doc.getMap<Y.Map<unknown>>("edges");
    this.deletedMap = doc.getMap<unknown>(DELETED_MAP_NAME);
    this.scheduler = opts.scheduler ?? REAL_SCHEDULER;
    this.settleMs = opts.settleMs ?? DISK_WRITE_SETTLE_MS;
    this.maxMuteMs = opts.maxMuteMs ?? MAX_MUTE_MS;
    this.logger = opts.logger;
    this.onWritten = opts.onWritten;
    // A rebuilt persistence instance with no shared ledger starts with an EMPTY
    // refused set by construction (charter §5: the predicate is about THIS
    // session's refusals for this path).
    this.refusals = opts.seedRefusals ?? new SeedRefusalLedger();
    this.withholdOnSeedRefusal = opts.withholdOnSeedRefusal ?? true;
    // WP90 (I11): "starts with an EMPTY refused set by construction" above is
    // still true of the LEDGER — the store is what fills it, and only at cold
    // open, which is the one moment before the `doc-wins` flush.
    this.durableRefusals = opts.durableRefusals;
    // WP92 (I11): held exactly as supplied. An omitted identity and a `null` one
    // mean the same thing — "no stable name for this document" — and both must
    // degrade rather than be laundered into the path, which is the key this WP
    // exists to stop using.
    this.refusalIdentity = opts.refusalIdentity;
    // Only an OMITTED probe defaults to "nothing knows the doc". Anything the
    // caller actually passed is handed to `decideSeed` unchanged, so a probe
    // that answered `null` stays an unanswered question instead of being
    // laundered into permission to seed.
    this.seedKnowledge = opts.seedKnowledge === undefined ? NOTHING_KNOWS_DOC : opts.seedKnowledge;
  }

  /**
   * Begin observing the doc. On ANY change — a local capture (binding-authored,
   * `CANVAS_BINDING_ORIGIN`) OR a remote delta — schedule a debounced disk write.
   * Unlike the binding's observer, there is NO origin filter: both directions must
   * persist. This observer never opens a transaction, so it can never loop back
   * into the CRDT (SPEC_03 §3.1).
   */
  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.nodesMap.observeDeep(this.observer);
    this.edgesMap.observeDeep(this.observer);
    // WP19 AC1: a delete now writes ONLY to the tombstone container, so a writer
    // that observed the two record maps alone would never be woken by one and
    // the deleted card would sit in the user's file until some unrelated edit
    // happened to trigger a flush.
    this.deletedMap.observeDeep(this.observer);
  }

  private readonly observer = (): void => {
    if (this.destroyed) return;
    this.scheduleWrite();
  };

  /** True while the settle window of our own last write is open — lets a vault
   * `modify` handler suppress the echo of our write (mechanical, not correctness). */
  isRecentDiskWrite(): boolean {
    return this.recentDiskWrite;
  }

  /**
   * SPEC_03 §3.2: reuse the existing trailing debounce (DEBOUNCE_MS) capped by a
   * max wait since the first pending change (MAX_WAIT_MS), so a continuous stream
   * of deltas still flushes at least ~every MAX_WAIT_MS instead of the trailing
   * timer resetting forever.
   */
  private scheduleWrite(): void {
    const now = this.scheduler.now();
    if (this.writeFirstScheduled === undefined) {
      this.writeFirstScheduled = now;
    }
    if (this.writeTimer !== undefined) {
      this.scheduler.clearTimeout(this.writeTimer);
    }
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, this.writeFirstScheduled + MAX_WAIT_MS - now));
    this.writeTimer = this.scheduler.setTimeout(() => {
      this.writeTimer = undefined;
      this.writeFirstScheduled = undefined;
      void this.flushToDisk();
    }, delay);
  }

  /**
   * Cancel any pending debounce and write the current doc snapshot immediately.
   * Used by the cold-open doc-wins branch to overwrite a stale file at once.
   */
  async flush(): Promise<void> {
    if (this.writeTimer !== undefined) {
      this.scheduler.clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    this.writeFirstScheduled = undefined;
    await this.flushToDisk();
  }

  /**
   * Serialize the doc (pruned + tab) and hand it to the serialized write queue.
   * Reads ONLY the doc — no transaction is opened.
   *
   * The snapshot is taken SYNCHRONOUSLY here, immediately before enqueueing,
   * with no interleaving `await` between serialization and the queue push. That
   * is what makes the retired `remoteSeq` gate unnecessary rather than merely
   * absent: a stale snapshot cannot exist, because the observer re-arms the
   * debounce on EVERY change (local capture or remote delta, no origin filter),
   * so the last flush of any burst always carries the newest doc state — and the
   * queue guarantees it is also the last write to reach disk (US5 AC14/AC16).
   */
  private flushToDisk(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    // WP63 / I11 — REFUSAL NEVER DESTROYS. The guard sits HERE, ahead of the
    // serializer, because this is the only place that knows both the refused set
    // and the impending write. Returning before `serializeCanvas` also means
    // `lastQueuedContent` never advances past a snapshot that was never written,
    // so the first flush after the lift is the ordinary canonical projection.
    if (this.writeIsWithheld()) return Promise.resolve();
    // WP19 AC1/AC3: the THREE-argument call. A two-argument call suppresses
    // nothing, so the file would keep every tombstoned record — and every edge
    // the node→edge cascade is supposed to take with it.
    const content = serializeCanvas(this.nodesMap, this.edgesMap, this.deletedMap);
    // Skip a redundant write against what is already on disk OR already queued
    // to land there.
    if (this.lastQueuedContent === content) return Promise.resolve();
    this.lastQueuedContent = content;
    this.writeQueue = this.writeQueue.then(() => this.writeSnapshot(content));
    return this.writeQueue;
  }

  /**
   * WP63 (I11) — is this path's write-back suspended right now?
   *
   * Public so the withhold is observable state rather than an invisible skip
   * (AC2: "never a silent no-op"). Consulting it does NOT run the lift check; it
   * reports the state as of the last write attempt, because the lift is bound to
   * the write trigger and asking a question must not move the mechanism.
   */
  isWriteWithheld(): boolean {
    return this.withholdOnSeedRefusal && this.refusals.hasRefusals();
  }

  /** The refused set for this path, for narration and for tests. */
  seedRefusals(): readonly SeedRefusal[] {
    return this.refusals.list();
  }

  /**
   * The withhold decision, taken on every write attempt (AC1–AC3).
   *
   * The lift is checked HERE, on the same trigger as the write and never on a
   * timer, because a withhold that outlives its cause is its own data-loss
   * class: a canvas stuck withheld stops persisting the user's real edits. So
   * every write attempt first re-asks whether the refused records have since
   * become valid, and the moment the set empties the write proceeds normally.
   *
   * It is a degrade, not a failure (I5): no throw, no session teardown, nothing
   * that reaches another path. The observer, the debounce, the CRDT and the
   * remote deltas all keep running — only the disk write is suspended.
   */
  private writeIsWithheld(): boolean {
    if (!this.withholdOnSeedRefusal) return false;
    if (!this.refusals.hasRefusals()) return false;

    // AC3: a later delta or a user repair may have made every refused record
    // valid. Re-ask before deciding, never after.
    this.refusals.prune((refusal) => isSeedRefusalResolved(this.doc, refusal));
    if (!this.refusals.hasRefusals()) {
      this.lastWithholdSignature = undefined;
      this.logger?.warn?.(
        "canvas-persistence",
        `SEED RESTORED: ${this.diskPath} refused set is empty — ` +
          "resuming the canonical projection write",
      );
      return false;
    }

    const signature =
      `SEED REFUSED: ${this.diskPath} write WITHHELD — ` +
      `${this.refusals.size} refused: ${this.refusals.describe()}`;
    if (signature !== this.lastWithholdSignature) {
      // The arming, and any later change to the refused set, is the event.
      this.lastWithholdSignature = signature;
      this.logger?.warn?.("canvas-persistence", signature);
    } else {
      // Every subsequent withheld flush is still narrated — quieter, but never
      // silent.
      this.logger?.debug("canvas-persistence", signature);
    }
    return true;
  }

  /** One queued disk write, wrapped in the echo-suppression window. */
  private async writeSnapshot(content: string): Promise<void> {
    if (this.destroyed) return;
    this.recentDiskWrite = true;
    this.acquireMute();
    try {
      await this.io.write(this.diskPath, content);
      this.lastWrittenContent = content;
      // US6: one greppable line per canvas disk write, naming the owning
      // component. Ids/paths/counts only — never file contents or node text.
      this.logger?.debug(
        "canvas-persistence",
        `CANVAS WRITER: ${this.diskPath} owner=CanvasPersistence ` +
          `nodes=${this.nodesMap.size} edges=${this.edgesMap.size}`,
      );
      this.onWritten?.(content);
    } catch (err) {
      // The write never landed: roll the queued-content marker back to what is
      // actually on disk so an identical later snapshot is retried rather than
      // deduplicated away.
      if (this.lastQueuedContent === content) this.lastQueuedContent = this.lastWrittenContent;
      this.logger?.warn?.(
        "canvas-persistence",
        `CANVAS WRITER: ${this.diskPath} owner=CanvasPersistence write FAILED (${String(err)})`,
      );
    } finally {
      this.armSettleRelease();
    }
  }

  /** Take the echo mute for this write, at most ONCE per open settle window. */
  private acquireMute(): void {
    if (this.settleTimer !== undefined) {
      this.scheduler.clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
    if (this.muteDepth === 0) {
      this.io.mutePathEvents(this.diskPath);
      this.muteDepth = 1;
      // WP91 AC5: the burst starts HERE, and the cap is measured from here.
      this.muteOpenedAt = this.scheduler.now();
    }
  }

  /**
   * (Re)arm the settle window; releases exactly the mute we took, exactly once.
   *
   * WP91 (C91 AC5): the re-arm is BOUNDED. The trailing window is still
   * `settleMs` from this write, but never past `maxMuteMs` from the first write
   * of the burst — so a stream of remote changes can no longer hold one
   * continuous mute for as long as it keeps arriving. When the cap is already
   * spent the delay clamps to 0 and the mute is released on the next tick, while
   * writes are still landing; the next write re-acquires and opens a new window,
   * which is the same take-and-release shape, just with a stated ceiling.
   */
  private armSettleRelease(): void {
    if (this.settleTimer !== undefined) this.scheduler.clearTimeout(this.settleTimer);
    const capRemaining = this.muteOpenedAt + this.maxMuteMs - this.scheduler.now();
    const delay = Math.max(0, Math.min(this.settleMs, capRemaining));
    this.settleTimer = this.scheduler.setTimeout(() => {
      this.settleTimer = undefined;
      this.recentDiskWrite = false;
      this.releaseMute();
    }, delay);
  }

  private releaseMute(): void {
    if (this.muteDepth === 0) return;
    this.muteDepth = 0;
    this.io.unmutePathEvents(this.diskPath);
  }

  /**
   * SPEC_03 §4 cold-open load decision. Call BEFORE constructing the binding and
   * BEFORE `start()`, once the doc has synced:
   *
   *  - Doc NON-EMPTY → the doc wins: the file is NOT read (no file→CRDT input).
   *    The stale file is overwritten from the doc so disk reflects shared truth.
   *  - WP29: doc EMPTY but a sidecar or a peer KNOWS it → `"empty"`. The file is
   *    not read, nothing is written, no transaction is opened. An empty board
   *    somebody already holds is a cleared board, not a new one.
   *  - Doc EMPTY + file present & non-empty → read the file ONCE and seed it
   *    into the doc under `CANVAS_SEED_ORIGIN` through WP18's validated
   *    create-once writer. This is the only file→CRDT read, and it happens
   *    exactly once, before any concurrent editing.
   *  - Doc EMPTY + file missing/empty → nothing to do.
   *
   * WP18: the V1→V2 migration runs LAST, AFTER any seeding — see
   * {@link migrateRecordBearingDoc}.
   *
   * The caller then binds (with `seedModelFromDoc: true`) and calls `start()`.
   *
   * WP90 (I11) — ONE STATEMENT WAS ADDED AND ITS POSITION IS THE WHOLE POINT.
   * {@link hydrateDurableRefusals} runs FIRST, ahead of the `docNonEmpty`
   * branch, because `doc-wins` flushes and that flush is where a refused record
   * is deleted from the user's file one restart after it was protected. It is
   * NOT a second file→CRDT input: it reads the refusal STORE, never the
   * `.canvas`, opens no transaction, and can only ever cause the writer to
   * write LESS. `"Doc wins. Never read the file."` is untouched, and so are the
   * three outcomes and the order they are decided in (C29 AC4).
   */
  async coldOpen(seedOrigin: symbol = CANVAS_SEED_ORIGIN): Promise<ColdOpenResult> {
    if (this.destroyed) return "empty";
    await this.hydrateDurableRefusals();

    const docNonEmpty = this.nodesMap.size > 0 || this.edgesMap.size > 0;
    if (docNonEmpty) {
      // Doc wins. Never read the file. Migrate what the relay handed us, THEN
      // overwrite the (possibly stale) file so disk matches shared truth — in
      // that order, so the snapshot that reaches disk is the post-migration one
      // and a second cold open has nothing left to write.
      this.migrateRecordBearingDoc();
      await this.flush();
      return "doc-wins";
    }
    // ── WP29 (I9/AC1) — SEED ONCE PER LIFETIME ──────────────────────────────
    //
    // The doc is empty. Before WP29 that alone was read as "nobody has ever
    // seen this board", and the local `.canvas` was pushed in. But an empty doc
    // that SOMEBODY KNOWS is a different thing entirely: the user cleared the
    // board last session (the sidecar replays exactly that), or the peers
    // cleared it and this client's file is a week old. Seeding there resurrects
    // deleted cards on every replica — R4, wearing cold open's clothes.
    //
    // POSITION IS PART OF THE CONTRACT, in both directions:
    //   ├── AFTER the `docNonEmpty` branch, never before it. WP25's returning
    //   │   client resumes a sidecar replica, arrives NON-empty and knows the
    //   │   doc; it must still overwrite its stale file from the doc.
    //   └── BEFORE `io.exists`, so a doc somebody knows takes NO file input at
    //       all — not a read, not a parse, not a byte.
    //
    // The outcome is `"empty"` and not a fourth `ColdOpenResult` (AC4), and not
    // `"doc-wins"`: `doc-wins` flushes, and flushing an empty projection over a
    // `.canvas` that still holds the user's cards is a second, worse data-loss
    // class than the one this branch exists to remove. It writes nothing, reads
    // nothing, and opens no transaction (I3).
    if (decideSeed(this.seedKnowledge) === SEED_DECISION.LOAD_OR_MERGE) return "empty";
    if (!(await this.io.exists(this.diskPath))) return "empty";
    const content = await this.io.read(this.diskPath);
    // WP16's decode bridge stays: the seed writes the FLAT file shape, exactly
    // as it did before WP18. The migration below is what makes the doc V2, and
    // it runs after this, so nothing lands behind its one-shot guard.
    const data = decodeCanvasDataToFlat(parseCanvas(content));
    if (isFlatCanvasDataEmpty(data)) return "empty";
    this.seedDocFromCanvasData(data, seedOrigin);
    this.migrateRecordBearingDoc();
    return "seeded-from-file";
  }

  /**
   * ── WP90 (I11): THE WITHHOLD OUTLIVES THE SESSION ─────────────────────────
   *
   * Connect this path's ledger to the durable store, once, at cold open. With
   * no store this is a no-op and the whole class behaves exactly as WP63's.
   *
   * THE ORDER OF THE FOUR STEPS IS THE DESIGN:
   *
   *   1. ASK WHETHER A SEED ALREADY RAN. `hasSeededThisSession` is true when
   *      the HOST seed (`CanvasSync.applyCanvasToYMaps`, which runs during
   *      `subscribe`, i.e. before this instance existed) has already re-derived
   *      the verdict from the file it just read. A stored verdict is then OLDER
   *      than the file, and restoring it would resurrect a withhold the user
   *      already earned their way out of by REPAIRING the `.canvas`. That is
   *      `reset()`'s rule — a stale verdict never outlives its file — carried
   *      across the restart instead of being abandoned at it.
   *   2. RESTORE, and only in the other case. `restore()` deliberately does not
   *      report.
   *   3. ASSIGN THE SINK — AFTER the restore, never before. Hydration and
   *      persistence must not be the same event: a rebuild that read the store
   *      would otherwise immediately write it back, and a partial read would
   *      launder itself into the file as the new truth.
   *   4. ADOPT a seed verdict the sink was not there to hear. This is the one
   *      write hydration causes and it is deliberately NOT hydration: the value
   *      being persisted came from a seed reading the user's file moments ago,
   *      not from the store. Without it the host arm's refusal would never
   *      become durable — and the host arm is the one that is only ACCIDENTALLY
   *      safe today, saved by producer A happening to re-derive.
   *
   * It reads the store, never the `.canvas`, and it emits no CRDT write (I3).
   * A store that cannot answer degrades to WP63 and is narrated by the store.
   */
  private async hydrateDurableRefusals(): Promise<void> {
    const store = this.durableRefusals;
    if (store === undefined || this.durableHydrated) return;
    this.durableHydrated = true;

    // ── WP92 (C92 AC1): THE KEY IS THE DOCUMENT'S, NOT THE FILE'S ───────────
    //
    // I5 DEGRADE, and the direction is deliberate: with no stable identity the
    // store is not consulted at ALL for this path, which is exactly WP63 —
    // in-memory, this session, narrated. The tempting alternative (fall back to
    // `diskPath`) would put a second vocabulary in the file and re-arm the very
    // orphan this change removes, under a key nothing would ever migrate.
    // An OMITTED identity is a pre-WP92 caller and keeps WP90's key; an identity
    // the caller actually supplied as `null` (or empty) is an ANSWER, and the
    // answer is "this document has no stable name".
    const key = this.refusalIdentity === undefined ? this.diskPath : this.refusalIdentity;
    if (key === null || key.length === 0) {
      this.logger?.warn?.(
        "canvas-persistence",
        `SEED REFUSAL STORE: ${this.diskPath} has no stable document identity — the ` +
          "refused set for this path is in-memory only for this session",
      );
      return;
    }

    const reseeded = this.refusals.hasSeededThisSession;
    // WP92 (AC2): WP90's key, read ONCE and only as a fallback. It is the exact
    // expression WP90 used (`main.ts` handed `toLocalPath(canonical)` in as
    // `diskPath`), so a store written by the previous build is found rather than
    // silently stopping to match — which is the cheap answer this AC forbids.
    const legacyKey = this.diskPath;
    let migrateFrom: string | undefined;
    let stored: readonly SeedRefusal[] = [];
    if (!reseeded) {
      try {
        stored = await store.load(key);
        if (stored.length === 0 && legacyKey !== key) {
          const legacy = await store.load(legacyKey);
          if (legacy.length > 0) {
            stored = legacy;
            migrateFrom = legacyKey;
          }
        }
      } catch (err) {
        // Defence in depth: the store already degrades internally rather than
        // throwing. If it ever throws anyway, this path becomes WP63 — never a
        // failed cold open, and never a silent full-trust "no refusals".
        this.logger?.warn?.(
          "canvas-persistence",
          `SEED REFUSAL STORE: ${this.diskPath} could not be read (${String(err)}) — ` +
            "the refused set for this path is in-memory only for this session",
        );
        stored = [];
      }
      if (stored.length > 0) {
        this.refusals.restore(stored);
        // AC2's narration: the withhold is observable state in session N+1 even
        // though NO seed ran to produce it. Ids and reason codes only.
        this.logger?.warn?.(
          "canvas-persistence",
          `SEED REFUSAL STORE: ${this.diskPath} restored ${stored.length} standing ` +
            `refusal(s) from the durable store — ${this.refusals.describe()}`,
        );
      }
    }

    this.refusals.setDurableSink((refusals) => store.save(key, refusals));

    // WP92 (AC2): the re-key, AFTER the sink and only when a legacy entry was
    // actually found. It is a WRITE and it is named as one — `load()` still
    // performs none, so property 5 (hydration and persistence are different
    // events) survives: an ordinary hydrate, which is every hydrate after the
    // first upgraded open, touches the file zero times.
    if (migrateFrom !== undefined) {
      store.migrate?.(migrateFrom, key);
      this.logger?.debug(
        "canvas-persistence",
        `SEED REFUSAL STORE: ${this.diskPath} carried ${stored.length} standing refusal(s) ` +
          "forward from the legacy path key onto the document's identity",
      );
    }

    if (reseeded) {
      store.save(key, this.refusals.list());
      this.logger?.debug(
        "canvas-persistence",
        `SEED REFUSAL STORE: ${this.diskPath} adopted this session's seed verdict ` +
          `(${this.refusals.size} refused) — the stored set is re-derived, not restored`,
      );
    }
  }

  /**
   * ── WP18: THE V1→V2 MIGRATION CALL SITE (WP8's open HIGH risk) ────────────
   *
   * `migrateV1ToV2` was landed, unit-proven and idempotent — and had NO
   * production caller, so "an existing V1 canvas doc opens as a valid V2 doc"
   * was never achieved end to end. Cold open is the one moment a doc is in this
   * client's hands with no editing in flight, so it is where the translation
   * belongs.
   *
   * TWO PLACEMENT RULES, and both are load-bearing:
   *
   *   ├── AFTER the seed, never before. `migrateV1ToV2`'s guard is ONE-SHOT on
   *   │   the presence of `meta`, so anything written after the stamp is
   *   │   untranslatable forever. Seeding first and migrating second means the
   *   │   seed keeps writing the flat file vocabulary every pre-V2 reader still
   *   │   expects, and the migration then translates exactly what was just
   *   │   written. On the doc-wins branch there is nothing to seed, so the two
   *   │   orderings coincide — which is why ONE post-condition covers both
   *   │   branches (charter §7 TC11).
   *   └── ONLY on a doc that actually holds records. Stamping `meta` on an
   *       empty doc would manufacture a schema claim about a board with no
   *       content — and would make the "empty" cold open emit a CRDT delta,
   *       which is the one thing this class must never do outside a seed.
   *
   * Two properties it must not lose, both enforced inside `migrateV1ToV2`:
   *   ├── it is guarded BEFORE its transaction, so an already-V2 doc produces
   *   │   zero delta and fires no `update` — otherwise every join of every
   *   │   board would echo a same-value rewrite to every peer (WP8 AC3). A
   *   │   second cold open therefore finds `meta` present and no-ops.
   *   └── it is purely ADDITIVE. It never deletes the flat V1 keys it just
   *       translated: `encodeStateAsUpdate` always ships the doc's WHOLE delete
   *       set, so a single `delete()` would make every later update non-empty
   *       forever and the zero-delta property could never be shown again.
   */
  private migrateRecordBearingDoc(): void {
    if (this.nodesMap.size === 0 && this.edgesMap.size === 0) return;
    migrateV1ToV2(this.doc);
  }

  /**
   * WP18 AC1 — the COLD-OPEN SEED write boundary.
   *
   * The write itself (validation, create-once, upsert-only, one transaction)
   * belongs to `seedRecordsIntoYMaps`, which lives next to the host seed's
   * sibling logic so the two boundaries cannot drift apart. All this adds is the
   * narration: a refusal is signed with the boundary and the reason, on the same
   * `<NAME> signature: …` line shape the rest of the canvas path uses.
   *
   * WP63 (I11): it also RECORDS those refusals for the write path. The ledger is
   * reset first — this is a re-seed of the path, so whatever a previous seed
   * decided about it is stale, and carrying an old verdict forward would leave a
   * canvas withheld for a record the file no longer even proposes.
   */
  private seedDocFromCanvasData(data: FlatCanvasData, seedOrigin: symbol): void {
    const refusals: SeedRefusal[] = [];
    this.refusals.reset();
    this.lastWithholdSignature = undefined;
    for (const signature of seedRecordsIntoYMaps(this.doc, data, seedOrigin, refusals)) {
      this.logger?.warn?.("canvas-persistence", signature);
    }
    this.refusals.note(refusals);
  }

  /** SPEC_03 §6.4-equivalent teardown: stop observing, cancel timers, go inert. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.started) {
      this.nodesMap.unobserveDeep(this.observer);
      this.edgesMap.unobserveDeep(this.observer);
      this.deletedMap.unobserveDeep(this.observer);
    }
    if (this.writeTimer !== undefined) {
      this.scheduler.clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    if (this.settleTimer !== undefined) {
      this.scheduler.clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
    // WP7 (US5 AC18a): the settle timer we just cancelled was the ONLY thing
    // that would have released our mute. Dropping it here without unmuting
    // leaks the refcount for the rest of the session — the same class of bug as
    // the overlapping-flush leak, on the teardown path.
    this.releaseMute();
    this.writeFirstScheduled = undefined;
    this.recentDiskWrite = false;
  }
}

function isFlatCanvasDataEmpty(data: FlatCanvasData): boolean {
  return Object.keys(data.nodes).length === 0 && Object.keys(data.edges).length === 0;
}

// Re-export the pruned serializer so a wiring layer can snapshot without reaching
// back into canvas-sync directly.
export { buildCanvasData, serializeCanvas };

// ---------------------------------------------------------------------------
// Production factory (thin — the only place that references the real vault).
//
// Kept out of the testable core (SPEC_03 wiring note): the class above never
// imports Obsidian. This adapter shape is structural (duck-typed) so it still
// compiles and unit-tests without pulling the Obsidian runtime; main.ts passes
// the real `Vault.adapter` + `FileOpsManager`.
// ---------------------------------------------------------------------------

/** Minimal structural view of the Obsidian vault adapter used by the writer. */
export interface VaultAdapterLike {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** Minimal structural view of the FileOpsManager mute surface. */
export interface FileOpsLike {
  mutePathEvents(path: string): void;
  unmutePathEvents(path: string): void;
}

/**
 * WP7 (US5 AC16): the two guarantees the retired `CanvasSync.writeToDisk`
 * provided that a bare `adapter.write` does not. Injected rather than imported
 * so this module keeps its headless discipline — `utils.ts` imports the Obsidian
 * runtime, and the `CanvasPersistence` core must stay certifiable without it.
 * Both are REQUIRED: a caller that forgets one silently loses the guarantee, and
 * a canvas write is exactly where that must not be possible.
 */
export interface PersistenceGuards {
  /** Path-safety gate. Mirrors `canvas-sync.ts:898` — no write escapes the vault. */
  isPathSafe(diskPath: string): boolean;
  /** Ensure the parent folder exists. Mirrors `canvas-sync.ts:912-913`. */
  ensureFolder(parentDir: string): Promise<void>;
}

/**
 * Build a `PersistenceIO` from the real vault adapter + file-ops mute surface.
 * This is the thin production seam; the `CanvasPersistence` core stays headless.
 */
export function createVaultPersistenceIO(
  adapter: VaultAdapterLike,
  fileOps: FileOpsLike,
  guards: PersistenceGuards,
): PersistenceIO {
  return {
    read: (diskPath) => adapter.read(diskPath),
    write: async (diskPath, content) => {
      // Final defense-in-depth gate: every canvas disk write funnels through
      // here, exactly as it did through the retired writer.
      if (!guards.isPathSafe(diskPath)) {
        throw new Error(`unsafe canvas path rejected: ${diskPath}`);
      }
      const parentDir = diskPath.substring(0, diskPath.lastIndexOf("/"));
      if (parentDir) await guards.ensureFolder(parentDir);
      await adapter.write(diskPath, content);
    },
    exists: (diskPath) => adapter.exists(diskPath),
    mutePathEvents: (diskPath) => fileOps.mutePathEvents(diskPath),
    unmutePathEvents: (diskPath) => fileOps.unmutePathEvents(diskPath),
  };
}

/** What `attachCanvasPersistence` hands back to the wiring layer. */
export interface AttachedCanvasPersistence {
  persistence: CanvasPersistence;
  coldOpen: ColdOpenResult;
}

/**
 * WP7: the whole per-path attach decision, as one testable unit so `main.ts`
 * stays pure wiring (it has no test file of its own).
 *
 * Ordering is the contract and it is not negotiable: `coldOpen()` runs AFTER the
 * doc has synced (the caller awaits `CanvasSync.subscribe`, which awaits
 * `waitForSync`) and BEFORE `start()`, so the one-time file→CRDT seed can never
 * race the observer that would otherwise persist it straight back out
 * (US5 AC17).
 */
export async function attachCanvasPersistence(
  doc: Y.Doc,
  io: PersistenceIO,
  diskPath: string,
  opts: CanvasPersistenceOpts = {},
): Promise<AttachedCanvasPersistence> {
  const persistence = new CanvasPersistence(doc, io, diskPath, opts);
  const coldOpen = await persistence.coldOpen();
  persistence.start();
  return { persistence, coldOpen };
}
