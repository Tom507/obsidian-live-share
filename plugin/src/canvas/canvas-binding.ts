import * as Y from "yjs";

// ---------------------------------------------------------------------------
// CanvasBinding — the "y-canvas" binding (SPEC_01, Phase 0).
//
// Binds a per-canvas `Y.Doc` to a live canvas model so that the Y.Doc is the
// single source of truth (I1) and the model is a pure projection of it, while
// local user edits are captured back into the Y.Doc with minimal diffs and no
// echo. The `.canvas` file is NOT involved (I6 — headless, `yjs` only).
//
// This module is intentionally self-contained: the equality + minimal-diff
// helpers below re-implement the semantics of `canvasRecordsEqual` /
// `applyKeyDiff` in `src/files/canvas-sync.ts` LOCALLY (those module-level
// helpers are not exported today). See BUILD_SPEC §3 decision 4.
// ---------------------------------------------------------------------------

/** A flat canvas record. All values are primitives, so shallow equality is exact. */
export type CanvasRecord = Record<string, unknown>;

/** A user-originated change surfaced by the model. `record === null` ⇒ removed. */
export type LocalChange =
  | { kind: "node"; id: string; record: CanvasRecord | null }
  | { kind: "edge"; id: string; record: CanvasRecord | null };

/**
 * What the binding needs from the live canvas model (implemented by SPEC_02 in a
 * later phase; a fake in-memory bridge stands in for Phase 0 tests).
 */
export interface CanvasModelBridge {
  getNodeIds(): Iterable<string>;
  getEdgeIds(): Iterable<string>;
  getNode(id: string): CanvasRecord | null;
  getEdge(id: string): CanvasRecord | null;
  // Remote → model. MUST NOT surface back through onLocalChange (I5).
  applyNodeUpsert(id: string, record: CanvasRecord): void;
  applyNodeRemove(id: string): void;
  applyEdgeUpsert(id: string, record: CanvasRecord): void;
  applyEdgeRemove(id: string): void;
  // User-originated changes only. Returns an unsubscribe function.
  onLocalChange(cb: (change: LocalChange) => void): () => void;
}

/** Optional status-console logger (off by default; no console noise in tests). */
export interface CanvasBindingLogger {
  debug(category: string, message: string): void;
}

/** Constructor options. */
export interface CanvasBindingOpts {
  logger?: CanvasBindingLogger;
  /** Run one `applyRemote()` on construct to seed the model. Default: true. */
  seedModelFromDoc?: boolean;
  /** §8 read-only guard (Bug G). Absent ⇒ allow. */
  canWrite?: (path: string) => boolean;
  /** §8 per-node advisory-lock write gate (WP3). Absent ⇒ allow. */
  canWriteNode?: (path: string, id: string) => boolean;
  /** §8 per-node advisory-lock delete gate (WP3). Absent ⇒ allow. */
  canDeleteNode?: (path: string, id: string) => boolean;
  /** Canonical path passed to the injected predicates. Default: "". */
  path?: string;
}

/**
 * Transaction-origin stamp for every binding-authored write (I4). The observer
 * ignores transactions carrying this origin so capture writes never re-enter
 * apply on the same peer.
 */
export const CANVAS_BINDING_ORIGIN: unique symbol = Symbol("canvas-binding-origin");

// ---------------------------------------------------------------------------
// Zero-cost instrumentation seam (WP4 / E2E only).
//
// Off by default: the module-level hook is `null` in production, so every
// counter site is a single null-check with no allocation and no test-only
// identifier bundled into `main.js` (CanvasBinding itself is not referenced by
// `main.ts`, so this whole module is already tree-shaken out of production —
// this hook only carries cost when the flag-gated control server installs it).
// The four counters mirror BUILD_SPEC §4 / US2 AC4.
// ---------------------------------------------------------------------------

export type CanvasBindingCounter = "applyRemote" | "captureLocal" | "rePush" | "originUpdate";
export type CanvasBindingInstrument = (counter: CanvasBindingCounter) => void;

let bindingInstrument: CanvasBindingInstrument | null = null;

/** Install (or clear with `null`) the binding instrumentation hook. */
export function setCanvasBindingInstrument(hook: CanvasBindingInstrument | null): void {
  bindingInstrument = hook;
}

// ---------------------------------------------------------------------------
// Local helpers — semantics MUST match canvas-sync.ts `canvasRecordsEqual` /
// `applyKeyDiff` (BUILD_SPEC §3 dec.4). Re-implemented, NOT imported.
// ---------------------------------------------------------------------------

/**
 * Order-independent shallow primitive equality of two records — matches the
 * per-record semantics of `canvasRecordsEqual` (canvas-sync.ts L118-135).
 */
function recordsEqual(a: CanvasRecord, b: CanvasRecord): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Flatten a single node/edge `Y.Map` to a plain record. */
function ymapToRecord(ymap: Y.Map<unknown>): CanvasRecord {
  const obj: CanvasRecord = {};
  for (const [k, v] of ymap) obj[k] = v;
  return obj;
}

/**
 * I3 minimal-diff write — matches `applyKeyDiff` semantics (canvas-sync.ts
 * L172-193): set each key in `next` iff its value differs from current Y state;
 * delete keys present in the ymap but absent from `next`. Returns whether
 * anything changed (empty diff ⇒ `false` ⇒ no Yjs update is produced).
 *
 * No geometry-key exception: unlike the file bridge, the binding's `next` is a
 * complete model record, never a partial disk read, so there is no scatter
 * hazard to guard against (SPEC_01 §6.2 wording — no exception).
 */
function writeRecordMinimal(ymap: Y.Map<unknown>, next: CanvasRecord): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(next)) {
    if (ymap.get(key) !== value) {
      ymap.set(key, value);
      changed = true;
    }
  }
  // Snapshot keys first — deleting while iterating a Y.Map is unsafe.
  for (const key of [...ymap.keys()]) {
    if (!(key in next)) {
      ymap.delete(key);
      changed = true;
    }
  }
  return changed;
}

export class CanvasBinding {
  private readonly doc: Y.Doc;
  private readonly model: CanvasModelBridge;
  private readonly nodesMap: Y.Map<Y.Map<unknown>>;
  private readonly edgesMap: Y.Map<Y.Map<unknown>>;
  private readonly logger?: CanvasBindingLogger;
  private readonly path: string;
  private readonly canWrite: (path: string) => boolean;
  private readonly canWriteNode: (path: string, id: string) => boolean;
  private readonly canDeleteNode: (path: string, id: string) => boolean;
  private readonly unsubscribeLocal: () => void;

  // I2 reentrancy guard: true only for the synchronous span of applyRemote().
  private _applyingRemote = false;
  // Lifecycle guard: any late observer / onLocalChange callback is inert.
  private destroyed = false;

  /** I2: true only while `applyRemote()` is running. */
  get applyingRemote(): boolean {
    return this._applyingRemote;
  }

  constructor(doc: Y.Doc, model: CanvasModelBridge, opts: CanvasBindingOpts = {}) {
    this.doc = doc;
    this.model = model;
    this.nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
    this.edgesMap = doc.getMap<Y.Map<unknown>>("edges");
    this.logger = opts.logger;
    this.path = opts.path ?? "";
    this.canWrite = opts.canWrite ?? (() => true);
    this.canWriteNode = opts.canWriteNode ?? (() => true);
    this.canDeleteNode = opts.canDeleteNode ?? (() => true);

    // Lifecycle (§6.4): wire the observer on both maps and subscribe onLocalChange.
    this.nodesMap.observeDeep(this.observer);
    this.edgesMap.observeDeep(this.observer);
    this.unsubscribeLocal = this.model.onLocalChange(this.onLocalChangeHandler);

    // Seed: one applyRemote() to bring an already-open view up to doc truth.
    if (opts.seedModelFromDoc !== false) {
      this.applyRemote();
    }
  }

  /**
   * §6.3 observer demux (I4): ignore our own writes — `tr.local === true` (this
   * peer authored it) OR `tr.origin === CANVAS_BINDING_ORIGIN` — and reconcile
   * only for genuine remote deltas.
   */
  private readonly observer = (
    _events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
    tr: Y.Transaction,
  ): void => {
    if (this.destroyed) return;
    if (tr.local || tr.origin === CANVAS_BINDING_ORIGIN) return;
    this.applyRemote();
  };

  private readonly onLocalChangeHandler = (change: LocalChange): void => {
    this.captureLocal(change);
  };

  /**
   * §6.1 applyRemote — CRDT → model, targeted reconcile. Only entities that
   * differ are touched (I1 + no redundant re-render). `applyingRemote` is held
   * true for exactly this synchronous span and reset in `finally` (I2).
   */
  applyRemote(): void {
    if (this.destroyed) return;
    bindingInstrument?.("applyRemote");
    this._applyingRemote = true; // I2
    let upserts = 0;
    let removes = 0;
    try {
      // Nodes before edges: an edge may reference a newly-added node.
      const liveNodeIds = new Set<string>(this.model.getNodeIds());
      for (const [id, ymap] of this.nodesMap) {
        const next = ymapToRecord(ymap);
        const cur = this.model.getNode(id);
        if (cur === null || !recordsEqual(cur, next)) {
          this.model.applyNodeUpsert(id, next);
          upserts++;
        }
        liveNodeIds.delete(id);
      }
      for (const id of liveNodeIds) {
        this.model.applyNodeRemove(id); // in model but gone from doc
        removes++;
      }

      const liveEdgeIds = new Set<string>(this.model.getEdgeIds());
      for (const [id, ymap] of this.edgesMap) {
        const next = ymapToRecord(ymap);
        const cur = this.model.getEdge(id);
        if (cur === null || !recordsEqual(cur, next)) {
          this.model.applyEdgeUpsert(id, next);
          upserts++;
        }
        liveEdgeIds.delete(id);
      }
      for (const id of liveEdgeIds) {
        this.model.applyEdgeRemove(id);
        removes++;
      }
      this.logger?.debug("apply", `upserts=${upserts} removes=${removes}`);
    } finally {
      this._applyingRemote = false; // I2 — reset even on throw
    }
  }

  /**
   * §6.2 captureLocal — model → CRDT, minimal diff. No-ops while applying a
   * remote delta (I2) and honors the §8 write-authorization seams. All writes
   * run inside a single `CANVAS_BINDING_ORIGIN` transaction (I4); an empty diff
   * produces no Yjs update (I3).
   */
  captureLocal(change: LocalChange): void {
    if (this.destroyed) return;
    if (this._applyingRemote) return; // I2 — synchronous echo killer
    bindingInstrument?.("captureLocal");

    // §8 seams — read-only guard (Bug G) and per-node advisory-lock gates (WP3).
    // Absent predicates default to allow. A dropped capture writes no transaction.
    if (!this.canWrite(this.path)) return;
    if (change.kind === "node") {
      if (change.record === null) {
        if (!this.canDeleteNode(this.path, change.id)) return;
      } else if (!this.canWriteNode(this.path, change.id)) {
        // Also enforces GAP-2 no-resurrect: an upsert for a node a lock reports
        // as remotely-deleted is dropped (SPEC_01 §7).
        return;
      }
    }

    const map = change.kind === "node" ? this.nodesMap : this.edgesMap;
    let produced = false; // did this capture write an actual Yjs update? (I3)
    this.doc.transact(() => {
      if (change.record === null) {
        if (map.has(change.id)) {
          map.delete(change.id);
          produced = true;
          this.logger?.debug("capture", `${change.kind} ${change.id} deleted`);
        }
        return;
      }
      let ymap = map.get(change.id);
      if (!ymap) {
        ymap = new Y.Map<unknown>();
        map.set(change.id, ymap);
      }
      const changed = writeRecordMinimal(ymap, change.record); // I3
      if (changed) {
        produced = true;
        this.logger?.debug("capture", `${change.kind} ${change.id} pushed`);
      }
    }, CANVAS_BINDING_ORIGIN);
    // A capture that produced a Yjs update is both a re-push and an origin-
    // stamped update (BUILD_SPEC §4). The zero-re-push invariant (US2 AC6) is
    // observable as `rePush` staying 0 for a peer that only integrates remotes.
    if (produced) {
      bindingInstrument?.("rePush");
      bindingInstrument?.("originUpdate");
    }
  }

  /** §6.4 destroy: unobserve, unsubscribe, and set the `destroyed` guard. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.nodesMap.unobserveDeep(this.observer);
    this.edgesMap.unobserveDeep(this.observer);
    this.unsubscribeLocal();
  }
}
