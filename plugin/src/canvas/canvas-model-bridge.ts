// ---------------------------------------------------------------------------
// createCanvasModelBridge — CanvasModelBridge (SPEC_02, Phase 3 / SPEC_04 §4).
//
// This wires the `CanvasModelBridge` surface that `CanvasBinding` consumes over
// the real `CanvasAdapter`. BOTH halves are now live:
//
//   * APPLY (remote → model): `applyNode*` / `applyEdge*` drive the open canvas
//     view via the adapter's EXISTING members (`applyNodeGeometry` for pure
//     geometry, `reloadCanvasData` / `setData` for structural add/remove/content).
//   * CAPTURE (model → CRDT): `onLocalChange` fires for USER-ORIGINATED edits only.
//     It is sourced from SYNCHRONOUS interaction signals + a snapshot-diff
//     (SPEC_02 §4), NEVER from the programmatic apply path (`applyNodeGeometry` /
//     `moveAndResize`) — capturing from the apply path is the false-green trap the
//     file bridge fell into. See `CAPTURE_TRIGGERS` below for the pinned trigger set.
//
// Read-model (the "shadow"): the bridge keeps its own record of what it has
// applied / captured so far. `getNode*/getEdge*` project THAT shadow, not raw
// private-canvas fields — so `CanvasBinding.applyRemote`'s `recordsEqual` diff is
// meaningful (avoiding constant structural `setData` churn) WITHOUT depending on
// the spike-gated full-record read (SPEC_02 §3/§9). The shadow doubles as the
// capture baseline: it is updated both when apply lands a remote change AND when
// capture emits a local one, so the next snapshot-diff only surfaces genuinely-new
// local intent (never a remote apply — I5). An apply skipped because the user is
// mid-drag (adapter returns "interacting"/`false`) is retried on the next delta.
// ---------------------------------------------------------------------------

import type { CanvasAdapter, NodeGeometry } from "./canvas-adapter";
import type { CanvasModelBridge, CanvasRecord, LocalChange } from "./canvas-binding";

/** Optional status-console logger (shape matches CanvasBindingLogger / DebugLogger). */
export interface CanvasModelBridgeLogger {
  debug(category: string, message: string): void;
}

export interface CanvasModelBridgeOpts {
  logger?: CanvasModelBridgeLogger;
  /**
   * Suppression seam (SPEC_02 §4.3 / SPEC_01 I2): capture emits NOTHING while the
   * binding is applying a remote delta, so an interaction signal that Obsidian
   * fires as a *side effect* of our own `applyNode*`/`setData` (e.g. a selection
   * reset) is never mistaken for user intent. The binding injects
   * `() => binding.applyingRemote`. Absent ⇒ never applying (capture always live);
   * capture-only unit tests pass a controllable stub. SPEC_01 I3 (empty diff ⇒ no
   * write) is the async backup guard behind this synchronous one.
   */
  isApplying?: () => boolean;
}

/**
 * The bridge as returned by {@link createCanvasModelBridge}: the full
 * `CanvasModelBridge` surface plus a `destroy()` that detaches the adapter
 * interaction subscriptions the capture half installs. Assignable to
 * `CanvasModelBridge` for callers that do not manage teardown.
 */
export interface CanvasModelBridgeHandle extends CanvasModelBridge {
  /** Detach capture subscriptions from the adapter. Idempotent. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// CAPTURE_TRIGGERS — the ONE place to correct after the real-vault spike.
//
// The interaction signals that count as "local intent committed" (SPEC_02 §4.1).
// The adapter fans BOTH `onNodeInteractionStart` (from patched `updateSelection`)
// and `onNodeInteractionEnd` (from patched `setDragging(false)`) out of Obsidian's
// private Canvas API; on EITHER, the bridge runs a synchronous snapshot-diff of
// the live model against its shadow and emits the minimal `onLocalChange` for
// whatever genuinely changed. The mapping below records which signal is expected
// to COMMIT each edit kind:
//
//   - drag   → interaction-END   (setDragging(false): geometry committed)
//   - resize → interaction-END   (a resize rides the same drag bracket)
//   - delete → interaction-END   (selection collapses off the removed entity)
//   - add    → interaction-START (new node becomes selected → updateSelection)
//   - edge   → interaction-START (new/removed edge changes the selection)
//
// ⚠ ASSUMPTION — Phase-0 real-vault spike (SPEC_02 §9). This set is inferred from
// the adapter's two patched signals and the headless interaction-driver; it has
// NOT been certified against a live Obsidian vault. The spike MUST confirm which
// signals actually fire for: single move, EACH resize handle, multi-select drag,
// paste, text-node content edit, node add/delete, edge add/delete. Because capture
// runs a full snapshot-diff on every trigger, a signal that fires "too often" is
// harmless (empty diff ⇒ no write, I3); the only risk is an edit kind that fires
// NEITHER signal — its capture is then delayed until the next interaction. If the
// spike finds such a kind, add its committing signal HERE (and, if it is neither
// start nor end, extend the adapter to surface it).
// ---------------------------------------------------------------------------
export const CAPTURE_TRIGGERS = {
  interactionStart: ["add", "edge"],
  interactionEnd: ["drag", "resize", "delete"],
} as const;

/** The four geometry keys the adapter can move live via `applyNodeGeometry`. */
const GEOMETRY_KEYS: ReadonlySet<string> = new Set(["x", "y", "width", "height"]);

/** Pull `{x,y,width,height}` off a record iff all four are numbers, else null. */
function extractGeometry(rec: CanvasRecord): NodeGeometry | null {
  const { x, y, width, height } = rec as Record<string, unknown>;
  if (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number"
  ) {
    return { x, y, width, height };
  }
  return null;
}

/** True iff `rec`'s geometry keys already equal `geo` (no capture-worthy move). */
function sameGeometry(rec: CanvasRecord, geo: NodeGeometry): boolean {
  return rec.x === geo.x && rec.y === geo.y && rec.width === geo.width && rec.height === geo.height;
}

/**
 * True iff `prev` and `next` have the SAME key set and every non-geometry key is
 * equal — i.e. the only differences (if any) are among x/y/width/height. Such a
 * change can be applied smoothly with `applyNodeGeometry`; anything else
 * (new/removed keys, changed content) needs a structural `reloadCanvasData`.
 */
function onlyGeometryChanged(prev: CanvasRecord, next: CanvasRecord): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const k of nextKeys) {
    if (GEOMETRY_KEYS.has(k)) continue;
    if (!(k in prev) || prev[k] !== next[k]) return false;
  }
  return true;
}

/**
 * Build the PARTIAL (apply-only) bridge over `adapter`. The CanvasDouble stands in
 * for the adapter in headless tests (via `createCanvasAdapter(double.view)`), so
 * this is fully unit-testable without Obsidian.
 */
export function createCanvasModelBridge(
  adapter: CanvasAdapter,
  opts: CanvasModelBridgeOpts = {},
): CanvasModelBridgeHandle {
  const logger = opts.logger;
  // I2 suppression seam: default to "never applying" so capture-only tests fire.
  const isApplying = opts.isApplying ?? (() => false);
  // Shadow read-model AND capture baseline: the records the bridge believes are
  // already agreed with the doc (updated by BOTH apply and capture).
  const nodes = new Map<string, CanvasRecord>();
  const edges = new Map<string, CanvasRecord>();
  const localListeners = new Set<(change: LocalChange) => void>();
  // Capture teardown: unsubscribe fns for the adapter interaction hooks.
  const captureUnsubs: Array<() => void> = [];
  let destroyed = false;

  /**
   * Structural reload: rebuild the live canvas from the full shadow via the
   * adapter's `reloadCanvasData` (wraps `setData`). Returns false if the adapter
   * skipped it (user mid-drag) or the private API is unavailable.
   */
  function structuralReload(): boolean {
    return adapter.reloadCanvasData({
      nodes: [...nodes.values()],
      edges: [...edges.values()],
    });
  }

  /** Emit one user-originated change to the binding and log it. */
  function emitLocal(change: LocalChange): void {
    logger?.debug(
      "canvas-bridge",
      `capture ${change.kind} ${change.id} ${change.record ? "changed" : "removed"}`,
    );
    for (const cb of [...localListeners]) cb(change);
  }

  /**
   * THE capture crux (SPEC_02 §4.2). Run on every CAPTURE_TRIGGERS signal: diff
   * the LIVE model (adapter reads) against the shadow and emit one minimal
   * `onLocalChange` per genuinely-changed entity, then advance the shadow so the
   * change is not re-emitted. Suppressed wholesale while the binding is applying a
   * remote delta (I2) — the primary guard against re-capturing our own applies.
   *
   * Records are reconstructed from adapter reads + the shadow: a moved node merges
   * its live geometry over the shadow record (preserving content the adapter can't
   * read live); a locally-ADDED node/edge is geometry/id-only, because reading a
   * new entity's full content is spike-gated (SPEC_02 §5/§9). Removal emits `null`.
   */
  function captureFromModel(): void {
    if (destroyed) return;
    if (isApplying()) return; // I2 — never re-capture our own remote apply

    // ---- nodes: geometry-move + membership diff -----------------------------
    const liveNodeIds = adapter.getLiveNodeIds();
    for (const id of liveNodeIds) {
      const prev = nodes.get(id);
      const geo = adapter.getNodeGeometry(id);
      if (prev === undefined) {
        // Local ADD. Content beyond geometry is spike-gated (§9) → geometry-only.
        const rec: CanvasRecord = geo ? { id, ...geo } : { id };
        nodes.set(id, rec);
        emitLocal({ kind: "node", id, record: rec });
      } else if (geo && !sameGeometry(prev, geo)) {
        // Local MOVE/RESIZE. Merge live geometry over the shadow's content.
        const rec: CanvasRecord = { ...prev, ...geo };
        nodes.set(id, rec);
        emitLocal({ kind: "node", id, record: rec });
      }
    }
    for (const id of [...nodes.keys()]) {
      if (!liveNodeIds.has(id)) {
        nodes.delete(id);
        emitLocal({ kind: "node", id, record: null }); // local DELETE
      }
    }

    // ---- edges: membership diff (side/cosmetic content spike-gated) ---------
    const liveEdgeIds = adapter.getLiveEdgeIds();
    for (const id of liveEdgeIds) {
      if (!edges.has(id)) {
        const rec: CanvasRecord = { id };
        edges.set(id, rec);
        emitLocal({ kind: "edge", id, record: rec });
      }
    }
    for (const id of [...edges.keys()]) {
      if (!liveEdgeIds.has(id)) {
        edges.delete(id);
        emitLocal({ kind: "edge", id, record: null });
      }
    }
  }

  // Wire capture to BOTH interaction triggers (CAPTURE_TRIGGERS). These COMPOSE
  // with presence's own lock subscription on the same hooks (the adapter fans one
  // physical patch out to every subscriber) — this adds a listener, never replaces.
  // No-op unsubscribe when the private API is unavailable (adapter returns NOOP).
  captureUnsubs.push(adapter.onNodeInteractionStart(() => captureFromModel()));
  captureUnsubs.push(adapter.onNodeInteractionEnd(() => captureFromModel()));

  return {
    // ---- reads (project the shadow read-model) ------------------------------
    getNodeIds(): Iterable<string> {
      return [...nodes.keys()];
    },
    getEdgeIds(): Iterable<string> {
      return [...edges.keys()];
    },
    getNode(id: string): CanvasRecord | null {
      const rec = nodes.get(id);
      return rec ? { ...rec } : null;
    },
    getEdge(id: string): CanvasRecord | null {
      const rec = edges.get(id);
      return rec ? { ...rec } : null;
    },

    // ---- remote → model appliers (I5: MUST NOT emit onLocalChange) ----------
    applyNodeUpsert(id: string, record: CanvasRecord): void {
      const next = { ...record };
      const prev = nodes.get(id);
      // Smooth per-node geometry move when only x/y/width/height changed.
      if (prev && onlyGeometryChanged(prev, next)) {
        const geo = extractGeometry(next);
        if (geo) {
          const outcome = adapter.applyNodeGeometry(id, geo);
          // B72 (WP2) — the second half of the apply, on the THIRD remote-apply
          // seam. `useCanvasBinding` is off by default, so this route is not the
          // one the live rig exercises; it is wired anyway because "after the
          // plugin applies a remote change to a node, that node is repainted" is
          // a property of every such seam or of none, and a seam that is right
          // only while a flag is off is the wiring gap §3.11 keeps finding.
          if (outcome === "applied") adapter.repaintNode?.(id);
          // Commit the shadow only when the move landed; a deferred move
          // ("interacting") or a missing/unsupported node retries next delta.
          if (outcome === "applied" || outcome === "unchanged") nodes.set(id, next);
          logger?.debug("canvas-bridge", `node ${id} geometry ${outcome}`);
          return;
        }
      }
      // Structural: new node, changed content, or non-numeric geometry.
      nodes.set(id, next);
      const ok = structuralReload();
      if (!ok) {
        if (prev) nodes.set(id, prev);
        else nodes.delete(id);
      }
      logger?.debug("canvas-bridge", `node ${id} structural upsert ${ok ? "ok" : "skipped"}`);
    },

    applyNodeRemove(id: string): void {
      const prev = nodes.get(id);
      if (prev === undefined) return;
      nodes.delete(id);
      const ok = structuralReload();
      if (!ok) nodes.set(id, prev); // busy/unsupported → retry next delta
      logger?.debug("canvas-bridge", `node ${id} remove ${ok ? "ok" : "skipped"}`);
    },

    applyEdgeUpsert(id: string, record: CanvasRecord): void {
      // Edges have no live per-edge setter in Phase 2 — always structural.
      const next = { ...record };
      const prev = edges.get(id);
      edges.set(id, next);
      const ok = structuralReload();
      if (!ok) {
        if (prev) edges.set(id, prev);
        else edges.delete(id);
      }
      logger?.debug("canvas-bridge", `edge ${id} upsert ${ok ? "ok" : "skipped"}`);
    },

    applyEdgeRemove(id: string): void {
      const prev = edges.get(id);
      if (prev === undefined) return;
      edges.delete(id);
      const ok = structuralReload();
      if (!ok) edges.set(id, prev);
      logger?.debug("canvas-bridge", `edge ${id} remove ${ok ? "ok" : "skipped"}`);
    },

    // ---- capture (Phase 3) — fed by captureFromModel on interaction triggers -
    onLocalChange(cb: (change: LocalChange) => void): () => void {
      localListeners.add(cb);
      return () => localListeners.delete(cb);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const unsub of captureUnsubs.splice(0)) {
        try {
          unsub();
        } catch {
          /* ignore */
        }
      }
      localListeners.clear();
    },
  };
}
