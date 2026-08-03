import type * as Y from "yjs";

import { isTombstoneSuppressed, readTombstoneEntry } from "../canvas/canvas-tombstone";
import {
  SIDECAR_LOAD_ORIGIN,
  type SidecarIO,
  type SidecarLoadResult,
  type SidecarStore,
  createSidecarStore,
} from "./canvas-sidecar";
import {
  type CanvasIdentityStore,
  DELETED_MAP_NAME,
  createCanvasIdentityStore,
} from "./canvas-sync";

// ---------------------------------------------------------------------------
// WP25 — Sidecar LIFECYCLE, COMPACTION and the wiring WP27 could not do (C25).
//
// WP24 shipped the sidecar STORE — framing, checkpointing, degradation — with
// every byte moving through an injected `SidecarIO` and with an explicit ban on
// importing Obsidian or `node:fs`. What it could not ship is everything that
// decides WHEN those operations happen. That is this module:
//
//   ├── LOAD BEFORE SYNC (AC1). `CanvasSync.subscribe` awaits {@link
//   │   SidecarLifecycle.load} between `getDoc(docId)` and `waitForSync(docId)`.
//   │   The end state is identical under either order — Yjs merges commute — so
//   │   only the SEQUENCE distinguishes "resumes a related replica" from "meets
//   │   its peer as a stranger and then merges two unrelated histories".
//   ├── EXACTLY-ONCE CAPTURE (AC2). One `doc.on("update", …)` handler per guid,
//   │   no origin filter except `SIDECAR_LOAD_ORIGIN`. Filtering on `tr.local`
//   │   would drop one whole side of "every local AND remote update"; NOT
//   │   excluding the load's own apply doubles the history every session while
//   │   the reconstructed doc stays perfect and no state oracle can see it.
//   ├── COMPACTION (AC3). Yjs' own GC plus a Lamport-horizon tombstone sweep, in
//   │   ONE transaction, followed by WP24's `checkpoint` (which is what writes
//   │   and then truncates). Observable state is unchanged by construction: a
//   │   tombstone is only ever removed TOGETHER with the record it suppresses.
//   └── THE WIRING (§7.0(e)). `createVaultSidecarIO` is the Obsidian-side
//       adapter WP24's AC4 forbade it to write, and `wireCanvasSidecar` is the
//       whole wiring decision as one testable unit — the precedent being
//       `attachCanvasPersistence`, which exists because `main.ts` may hold
//       wiring only and has no test file.
//
// WP25 owns exactly two names: the two `SIDECAR_COMPACTION_*` tunables below.
// Everything else — paths, extensions, the store, the doc-id constructor, the
// tombstone predicates — is imported from its owner (Shared Ownership Contract
// §1). Nothing here concatenates a sidecar path or re-spells `"deleted"`.
// ---------------------------------------------------------------------------

// ── tunables — WP25 OWNS these, and the UNIT is part of the NAME ────────────

/**
 * Wall-clock interval between compaction runs, in MILLISECONDS.
 *
 * Five minutes: long enough that a busy board pays for a full-state encode and
 * one file rewrite a handful of times an hour rather than continuously, short
 * enough that a crash never costs more than a few minutes of frame log to
 * replay. Overridable per lifecycle through {@link SidecarLifecycleOpts.periodMs}.
 */
export const SIDECAR_COMPACTION_PERIOD_MS = 300_000;

/**
 * Tombstone GC horizon in LAMPORT TICKS — never milliseconds.
 *
 * `TombstoneEntry.t` is a Lamport counter produced by `nextTombstoneTime`
 * (`canvas-sync.ts`), and `canvas-tombstone.ts` never reads a clock. A horizon
 * expressed in milliseconds would compare a counter to a duration: it would
 * type-check, it would look reasonable, and it would collect a DIFFERENT set of
 * tombstones on every peer — which is divergence produced by the garbage
 * collector itself.
 *
 * A tombstone is collected only once 1000 further tombstone ops have happened on
 * the board, which is far beyond any window in which a concurrent stale edit for
 * that id could still arrive.
 */
export const SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS = 1000;

// ── the injected seams ─────────────────────────────────────────────────────

/**
 * The timer seam. Injected so the period is testable without wall-clock waits
 * (BUILD_SPEC: no timing-based oracles, no new `setTimeout` constants).
 */
export interface SidecarLifecycleScheduler {
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/**
 * The globals, reached through arrows so the lookup happens at CALL time — a
 * test that installs fake timers before constructing a lifecycle still gets the
 * fakes.
 *
 * `unref` is called when the host provides it (Node/Electron main-style timers)
 * so a lifecycle nobody destroyed cannot hold a process open. Obsidian's
 * renderer returns a plain number and the optional call is a no-op there.
 */
const DEFAULT_SCHEDULER: SidecarLifecycleScheduler = {
  setInterval(cb: () => void, ms: number): unknown {
    const handle = setInterval(cb, ms);
    (handle as unknown as { unref?: () => void }).unref?.();
    return handle;
  },
  clearInterval(handle: unknown): void {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export interface SidecarCompactionResult {
  readonly removedTombstoneIds: readonly string[];
  readonly removedRecordIds: readonly string[];
  readonly checkpointWritten: boolean;
  readonly horizonTicks: number;
}

export interface SidecarLifecycleOpts {
  scheduler?: SidecarLifecycleScheduler;
  periodMs?: number;
  horizonTicks?: number;
  logger?: { debug(c: string, m: string): void; warn?(c: string, m: string): void };
}

export interface SidecarLifecycle {
  /** AC1: replay this guid's sidecar into `doc`. Never throws (WP24 AC3). */
  load(guid: string, doc: Y.Doc): Promise<SidecarLoadResult>;
  /** AC2: begin appending every local and remote update for this doc. */
  attach(guid: string, doc: Y.Doc): void;
  /** AC2: stop appending and make the tail durable. */
  detach(guid: string): Promise<void>;
  /** AC3: run one compaction now. */
  compact(guid: string, doc: Y.Doc): Promise<SidecarCompactionResult>;
  /** Stop the periodic timer and detach everything. Idempotent. */
  destroy(): Promise<void>;
}

/** What `attach` installed for one guid. */
interface AttachedDoc {
  readonly doc: Y.Doc;
  readonly handler: (update: Uint8Array, origin: unknown) => void;
  /** The chain of in-flight appends; awaited by `detach` to make the tail durable. */
  tail: Promise<void>;
}

// ── the lifecycle ──────────────────────────────────────────────────────────

/**
 * Creates the lifecycle over an already-built {@link SidecarStore}.
 *
 * ONE interval covers every attached doc rather than one timer per doc: a vault
 * with thirty boards open would otherwise hold thirty timers whose ticks
 * interleave with each other's checkpoint/truncate windows for no benefit. A
 * tick that arrives while the previous one is still running is DROPPED, not
 * queued — compaction is idempotent, so a skipped run costs one period, whereas
 * stacking them would let two full-state encodes of the same doc race.
 */
export function createSidecarLifecycle(
  store: SidecarStore,
  opts: SidecarLifecycleOpts = {},
): SidecarLifecycle {
  const scheduler = opts.scheduler ?? DEFAULT_SCHEDULER;
  const periodMs = opts.periodMs ?? SIDECAR_COMPACTION_PERIOD_MS;
  const horizonTicks = opts.horizonTicks ?? SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS;
  const logger = opts.logger ?? null;

  const attached = new Map<string, AttachedDoc>();
  let destroyed = false;
  let compacting = false;

  function retire(guid: string, entry: AttachedDoc): void {
    entry.doc.off("update", entry.handler);
    if (attached.get(guid) === entry) attached.delete(guid);
  }

  function attach(guid: string, doc: Y.Doc): void {
    const existing = attached.get(guid);
    if (existing) {
      // Idempotent per guid. Re-attaching the SAME doc must not install a second
      // handler (the history would double while the doc stayed perfect); a
      // DIFFERENT doc retires the previous one, because a retired doc that keeps
      // writing pollutes the history the next session replays.
      if (existing.doc === doc) return;
      retire(guid, existing);
    }

    const entry: AttachedDoc = {
      doc,
      tail: Promise.resolve(),
      handler: (update: Uint8Array, origin: unknown): void => {
        // The ONLY origin filter. `SIDECAR_LOAD_ORIGIN` is the stamp WP24 puts on
        // the single `Y.applyUpdate` its `load` performs, so excluding it stops a
        // session re-appending the state it just read. There is deliberately no
        // `tr.local` test: AC2 says every local AND remote update.
        if (origin === SIDECAR_LOAD_ORIGIN) return;
        const appended = store.append(guid, update).catch((error: unknown) => {
          logger?.warn?.(
            "canvas-sidecar",
            `append failed for ${guid}: ${describe(error)} - this update is not in the history`,
          );
        });
        entry.tail = entry.tail.then(() => appended);
      },
    };

    attached.set(guid, entry);
    doc.on("update", entry.handler);
  }

  async function detach(guid: string): Promise<void> {
    const entry = attached.get(guid);
    if (!entry) return;
    // Synchronous, before the first await: anything the doc emits from here on
    // belongs to no subscription.
    retire(guid, entry);
    // The tail is what a dropped queue would eat — the LAST edit of the session.
    await entry.tail;
  }

  /**
   * One compaction, in the order the charter pins (§7.0(b)):
   *
   *   1. `newest := max(entry.t)` over the `deleted` container (0 when empty),
   *   2. select `isTombstoneSuppressed(entry) && entry.t + horizon <= newest`,
   *   3. ONE transaction removing each selected id from `deleted` AND from
   *      `nodes` / `edges`,
   *   4. then `store.checkpoint`, which writes the full (GC'd) state and only
   *      then truncates the history.
   *
   * Step 4 after step 3 is not a preference: a checkpoint taken first preserves
   * exactly the tombstones the sweep is about to collect, and the next load
   * brings every one of them back.
   */
  async function compact(guid: string, doc: Y.Doc): Promise<SidecarCompactionResult> {
    const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    // `readTombstoneEntry` is the single authority: a malformed value reads as
    // NO tombstone, i.e. VISIBLE, and is therefore never collected and never
    // contributes to `newest`.
    const entries: { id: string; t: number; suppressed: boolean }[] = [];
    let newest = 0;
    for (const id of deleted.keys()) {
      const entry = readTombstoneEntry(deleted, id);
      if (entry === undefined) continue;
      if (entry.t > newest) newest = entry.t;
      entries.push({ id, t: entry.t, suppressed: isTombstoneSuppressed(entry) });
    }

    // `on:false` is an UNDO — the record is VISIBLE and real. Collecting one
    // would delete a card the user restored, however old the entry is.
    const removedTombstoneIds = entries
      .filter((entry) => entry.suppressed && entry.t + horizonTicks <= newest)
      .map((entry) => entry.id)
      .sort();

    const removedRecordIds: string[] = [];
    if (removedTombstoneIds.length > 0) {
      // ONE transaction. N transactions means N deltas on the wire and N
      // intermediate states a peer can observe — one of which has a record with
      // no tombstone, i.e. a RESURRECTED card.
      doc.transact(() => {
        for (const id of removedTombstoneIds) {
          deleted.delete(id);
          // Both halves, always. The tombstone was the only thing suppressing
          // the record, so removing it alone puts the card back on screen.
          // Tombstones are id-keyed across BOTH id spaces (WP12), and an id
          // whose record is already gone is a no-op rather than an error.
          if (nodes.has(id)) {
            nodes.delete(id);
            removedRecordIds.push(id);
          } else if (edges.has(id)) {
            edges.delete(id);
            removedRecordIds.push(id);
          }
        }
      });
    }

    // GC is the DOC's own `gc` flag doing the work at transaction cleanup. The
    // checkpoint is encoded from THIS doc: re-encoding through a
    // `new Y.Doc({ gc: false })` would preserve every deleted byte forever, and
    // rebuilding into a fresh doc would change `clientID` and sever the causal
    // chain to every peer.
    let checkpointWritten = true;
    try {
      await store.checkpoint(guid, doc);
    } catch (error) {
      checkpointWritten = false;
      logger?.warn?.("canvas-sidecar", `checkpoint failed for ${guid}: ${describe(error)}`);
    }

    logger?.debug(
      "canvas-sidecar",
      `compact ${guid}: ${removedTombstoneIds.length} tombstone(s), ${removedRecordIds.length} record(s), horizon ${horizonTicks} ticks`,
    );

    return {
      removedTombstoneIds,
      removedRecordIds: removedRecordIds.sort(),
      checkpointWritten,
      horizonTicks,
    };
  }

  function tick(): void {
    // A tick arriving while a compaction is in flight does not stack.
    if (compacting || destroyed) return;
    compacting = true;
    void (async () => {
      try {
        for (const [guid, entry] of [...attached]) {
          // A doc detached since the snapshot was taken is not compacted.
          if (attached.get(guid) !== entry) continue;
          try {
            await compact(guid, entry.doc);
          } catch (error) {
            logger?.warn?.("canvas-sidecar", `compaction failed for ${guid}: ${describe(error)}`);
          }
        }
      } finally {
        compacting = false;
      }
    })();
  }

  // Armed at construction, not at the first attach: the timer is the
  // lifecycle's, not a doc's.
  let timer: unknown = scheduler.setInterval(tick, periodMs);

  return {
    load(guid: string, doc: Y.Doc): Promise<SidecarLoadResult> {
      return store.load(guid, doc);
    },
    attach,
    detach,
    compact,
    async destroy(): Promise<void> {
      if (!destroyed) {
        destroyed = true;
        scheduler.clearInterval(timer);
        timer = null;
      }
      await Promise.all([...attached.keys()].map((guid) => detach(guid)));
    },
  };
}

// ── the adapter WP24 was forbidden to ship (its AC4: no Obsidian, no node:fs) ─

/**
 * The slice of Obsidian's `DataAdapter` the sidecar needs. Obsidian's own
 * `DataAdapter` satisfies it structurally, so `main.ts` passes
 * `this.app.vault.adapter` with no cast and this module imports nothing from
 * `obsidian`.
 *
 * Note what is NOT here: `append` and `write` (the STRING ones). That omission
 * is the design — see {@link createVaultSidecarIO}.
 */
export interface SidecarVaultAdapterLike {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(data.byteLength);
  new Uint8Array(out).set(data);
  return out;
}

/**
 * WP24's `SidecarIO`, over an Obsidian vault adapter.
 *
 * `append` is the whole reason this function is delicate. Obsidian's
 * `DataAdapter.append(path, data)` takes a **string**, and a frame log is
 * binary: every byte in `0x80–0xFF` that is not part of a valid UTF-8 sequence
 * round-trips through `U+FFFD`, which means the payload is destroyed while the
 * u32 length header still parses. The corruption therefore reads as a perfectly
 * valid frame carrying garbage, and it surfaces a session later as an
 * unreadable history rather than as a failed write. So `append` is
 * read-modify-write through `readBinary` / `writeBinary` and there is no string
 * path anywhere in this adapter.
 *
 * `truncate` reduces the file to zero bytes and LEAVES IT IN PLACE — a truncate
 * that unlinked would make `exists` false and the store would report MISSING
 * instead of an empty (i.e. freshly compacted) history. `remove` unlinks.
 */
export function createVaultSidecarIO(adapter: SidecarVaultAdapterLike): SidecarIO {
  async function ensureDir(dirPath: string): Promise<void> {
    // Every ancestor, not just the leaf: `mkdir` creates one level and throws on
    // an existing directory, so both the guard and the walk are load-bearing.
    const segments = dirPath.split("/").filter((segment) => segment.length > 0);
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      if (await adapter.exists(prefix)) continue;
      try {
        await adapter.mkdir(prefix);
      } catch {
        // A concurrent creator won the race. Nothing to repair.
      }
    }
  }

  async function readBytes(filePath: string): Promise<Uint8Array> {
    return new Uint8Array(await adapter.readBinary(filePath));
  }

  return {
    ensureDir,
    exists: (filePath: string) => adapter.exists(filePath),
    read: (filePath: string) => readBytes(filePath),
    write: (filePath: string, data: Uint8Array) =>
      adapter.writeBinary(filePath, toArrayBuffer(data)),
    async append(filePath: string, data: Uint8Array): Promise<void> {
      const previous = (await adapter.exists(filePath))
        ? await readBytes(filePath)
        : new Uint8Array(0);
      const next = new Uint8Array(previous.length + data.length);
      next.set(previous, 0);
      next.set(data, previous.length);
      await adapter.writeBinary(filePath, toArrayBuffer(next));
    },
    truncate: (filePath: string) => adapter.writeBinary(filePath, new ArrayBuffer(0)),
    remove: (filePath: string) => adapter.remove(filePath),
  };
}

// ── the whole wiring decision, as ONE testable unit ─────────────────────────

export interface CanvasSidecarWiring {
  store: SidecarStore;
  lifecycle: SidecarLifecycle;
  identityStore: CanvasIdentityStore;
}

/**
 * §7.0(e) — close the gap `ImplementationReport_WP27.md` Escalation 2 left open.
 *
 * WP27 shipped a two-mode identity design and deliberately left
 * `setIdentityStore(...)` with NO production caller, because
 * `createCanvasIdentityStore` needs a `SidecarIO` adapter that only WP25 can
 * supply. Until this runs, WP27's AC1/AC2 are true of the MODULE and false of
 * the shipped plugin — the plugin a user installs still addresses canvas docs by
 * path.
 *
 * `sidecar: null` is NOT a smaller version of this wiring, it is a live
 * regression: a guest that subscribes before the host's manifest entry has
 * replicated would resolve nothing, open nothing, and drop into the R10 raw-text
 * fallback with no retry. The sidecar `index.json` — scanned by VALUE, `guid ->
 * path` — is precisely what closes that window.
 *
 * This lives here rather than in `main.ts` because `main.ts` may hold wiring
 * only, never logic, and has no test file. The precedent is
 * `attachCanvasPersistence`.
 */
export function wireCanvasSidecar(deps: {
  canvasSync: {
    setIdentityStore(store: CanvasIdentityStore): void;
    setSidecarLifecycle(lifecycle: SidecarLifecycle): void;
  };
  manifest: {
    getCanvasGuid(p: string): string | null;
    setCanvasGuid(p: string, g: string): void;
  } | null;
  io: SidecarIO;
  opts?: SidecarLifecycleOpts;
}): CanvasSidecarWiring {
  const store = createSidecarStore(deps.io);
  const identityStore = createCanvasIdentityStore({
    manifest: deps.manifest,
    sidecar: store,
  });
  const lifecycle = createSidecarLifecycle(store, deps.opts);

  // BOTH injections, or the wiring is half done in a way nothing downstream can
  // detect: identity without the lifecycle gives guid-addressed docs with no
  // durable history, and the lifecycle without identity writes a history keyed
  // by a path-derived token that the next session cannot find.
  deps.canvasSync.setIdentityStore(identityStore);
  deps.canvasSync.setSidecarLifecycle(lifecycle);

  return { store, lifecycle, identityStore };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
