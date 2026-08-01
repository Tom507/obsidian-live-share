import * as Y from "yjs";

import {
  type CanvasData,
  DEBOUNCE_MS,
  MAX_WAIT_MS,
  applyToYMap,
  buildCanvasData,
  parseCanvas,
  serializeCanvas,
} from "./canvas-sync";

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
// the `DEBOUNCE_MS`/`MAX_WAIT_MS` trailing+cap debounce constants, `parseCanvas`
// + `applyToYMap` (geometry-key guard) for the one-time cold-open file parse —
// all imported from `canvas-sync.ts`, never reimplemented.
//
// Headless discipline (mirrors canvas-binding.ts): no Obsidian runtime import.
// File I/O, echo-suppression, and the clock/scheduler are injected so the whole
// class is certifiable without a real vault or real timers.
// ---------------------------------------------------------------------------

/** Settle window before unmuting our own write echo. Mirrors VAULT_EVENT_SETTLE_MS
 * (utils.ts) but inlined to keep this module free of the Obsidian-importing utils
 * module. Purely mechanical echo suppression — NOT a correctness mechanism. */
const DISK_WRITE_SETTLE_MS = 250;

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
}

export class CanvasPersistence {
  private readonly doc: Y.Doc;
  private readonly io: PersistenceIO;
  private readonly diskPath: string;
  private readonly nodesMap: Y.Map<Y.Map<unknown>>;
  private readonly edgesMap: Y.Map<Y.Map<unknown>>;
  private readonly scheduler: PersistenceScheduler;
  private readonly settleMs: number;
  private readonly logger?: {
    debug(category: string, message: string): void;
    warn?(category: string, message: string): void;
  };
  private readonly onWritten?: (content: string) => void;

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

  constructor(doc: Y.Doc, io: PersistenceIO, diskPath: string, opts: CanvasPersistenceOpts = {}) {
    this.doc = doc;
    this.io = io;
    this.diskPath = diskPath;
    this.nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
    this.edgesMap = doc.getMap<Y.Map<unknown>>("edges");
    this.scheduler = opts.scheduler ?? REAL_SCHEDULER;
    this.settleMs = opts.settleMs ?? DISK_WRITE_SETTLE_MS;
    this.logger = opts.logger;
    this.onWritten = opts.onWritten;
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
    const content = serializeCanvas(this.nodesMap, this.edgesMap);
    // Skip a redundant write against what is already on disk OR already queued
    // to land there.
    if (this.lastQueuedContent === content) return Promise.resolve();
    this.lastQueuedContent = content;
    this.writeQueue = this.writeQueue.then(() => this.writeSnapshot(content));
    return this.writeQueue;
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
    }
  }

  /** (Re)arm the settle window; releases exactly the mute we took, exactly once. */
  private armSettleRelease(): void {
    if (this.settleTimer !== undefined) this.scheduler.clearTimeout(this.settleTimer);
    this.settleTimer = this.scheduler.setTimeout(() => {
      this.settleTimer = undefined;
      this.recentDiskWrite = false;
      this.releaseMute();
    }, this.settleMs);
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
   *  - Doc EMPTY + file present & non-empty → read the file ONCE, parse it with
   *    the retained geometry-key guard (`applyToYMap`), and seed it into the doc
   *    under `CANVAS_SEED_ORIGIN`. This is the only file→CRDT read, and it happens
   *    exactly once, before any concurrent editing.
   *  - Doc EMPTY + file missing/empty → nothing to do.
   *
   * The caller then binds (with `seedModelFromDoc: true`) and calls `start()`.
   */
  async coldOpen(seedOrigin: symbol = CANVAS_SEED_ORIGIN): Promise<ColdOpenResult> {
    if (this.destroyed) return "empty";
    const docNonEmpty = this.nodesMap.size > 0 || this.edgesMap.size > 0;
    if (docNonEmpty) {
      // Doc wins. Never read the file. Overwrite the (possibly stale) file so disk
      // matches shared truth. This write reads only the doc — no file→CRDT read.
      await this.flush();
      return "doc-wins";
    }
    if (!(await this.io.exists(this.diskPath))) return "empty";
    const content = await this.io.read(this.diskPath);
    const data = parseCanvas(content);
    if (isCanvasDataEmpty(data)) return "empty";
    seedDocFromCanvasData(this.doc, data, seedOrigin);
    return "seeded-from-file";
  }

  /** SPEC_03 §6.4-equivalent teardown: stop observing, cancel timers, go inert. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.started) {
      this.nodesMap.unobserveDeep(this.observer);
      this.edgesMap.unobserveDeep(this.observer);
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

function isCanvasDataEmpty(data: CanvasData): boolean {
  return Object.keys(data.nodes).length === 0 && Object.keys(data.edges).length === 0;
}

/**
 * Seed parsed `.canvas` data into an (empty) doc under `seedOrigin`. Reuses
 * `applyToYMap` so the geometry-key guard (SPEC_03 §4 / v0.5.6) is retained for
 * this one-time file parse: a partial disk read can never strip x/y/w/h from a
 * seeded node. Wrapped in a single transaction.
 */
function seedDocFromCanvasData(doc: Y.Doc, data: CanvasData, seedOrigin: symbol): void {
  doc.transact(() => {
    const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = doc.getMap<Y.Map<unknown>>("edges");
    for (const [id, node] of Object.entries(data.nodes)) {
      let yNode = nodesMap.get(id);
      if (!yNode) {
        yNode = new Y.Map<unknown>();
        nodesMap.set(id, yNode);
      }
      applyToYMap(yNode, node);
    }
    for (const [id, edge] of Object.entries(data.edges)) {
      let yEdge = edgesMap.get(id);
      if (!yEdge) {
        yEdge = new Y.Map<unknown>();
        edgesMap.set(id, yEdge);
      }
      applyToYMap(yEdge, edge);
    }
  }, seedOrigin);
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
