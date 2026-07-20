// WP2/WP3 — thin isolation layer around Obsidian's PRIVATE, UNTYPED Canvas view
// API. Nothing outside this file may touch `view.canvas` internals.
//
// GROUND TRUTH (researched against the real Obsidian Canvas controller):
//   * The canvas is NOT an event emitter — there is NO `canvas.on/off`. Activity
//     is detected by MONKEY-PATCHING canvas methods (wrap → call our cb → call
//     original; original stored; restored on destroy):
//       - `canvas.updateSelection(fn)` → selection changed; read `canvas.selection`
//         (a Set of elements each with `.id`).
//       - `canvas.setDragging(bool)`   → drag start/end; hovered node is
//         `canvas.nodeInteractionLayer?.target`.
//       - `canvas.markViewportChanged()` → every pan/zoom → reposition overlay.
//   * LIVE viewport is `canvas.x`, `canvas.y`, `canvas.zoom` (linear). `tx/ty/tZoom`
//     are ANIMATION TARGETS — never used for live rendering.
//   * `canvas.posFromEvt(evt)` maps a client point to canvas space (preferred);
//     manual fallback uses `canvas.wrapperEl.getBoundingClientRect()`.
//   * `canvas.nodes: Map<string, CanvasNode>`; node has `.id/.x/.y/.width/.height`
//     (canvas coords) and `.nodeEl` (the card DOM). There is NO `.containerEl`.
//   * `canvas.wrapperEl` is the fixed screen-space container (overlay mount point).
//
// The adapter degrades gracefully: when a member is missing `isAvailable()` is
// false and the hooks become no-ops — the trigger for the DIFF-INFERRED FALLBACK
// (lock on first node-key change) in canvas-sync.ts, a real, tested path.

// Live viewport transform (linear zoom). Read from canvas.x / canvas.y / canvas.zoom.
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasAdapter {
  /** True only when the private Canvas API surface we rely on is present. */
  isAvailable(): boolean;
  /** Human-readable reason string for diagnostics (which member is missing). */
  availabilityReport(): string;
  /** The DOM element the presence overlay should be mounted into (canvas wrapper). */
  getOverlayHost(): unknown | null;
  /** Current LIVE viewport transform (canvas.x/y/zoom); null if not derivable. */
  getViewport(): CanvasViewport | null;
  /** Map a client (screen) point to canvas space; null if not derivable. */
  clientToCanvas(clientX: number, clientY: number): { x: number; y: number } | null;
  /**
   * Map a canvas-space point to a SCREEN point relative to the wrapper element
   * (so an overlay div that is a child of wrapperEl can place a marker directly).
   */
  canvasToScreenRelativeToWrapper(x: number, y: number): { x: number; y: number } | null;
  /** The card DOM element for a node id (`canvas.nodes.get(id).nodeEl`) or null. */
  getNodeEl(nodeId: string): HTMLElement | null;
  // ---- Live-view reconciliation (scatter fix) ----------------------------
  /** Ids of nodes currently present in the LIVE canvas view. */
  getLiveNodeIds(): Set<string>;
  /** Ids of edges currently present in the LIVE canvas view. */
  getLiveEdgeIds(): Set<string>;
  /** Live geometry of a node (canvas coords) or null if the node/coords are absent. */
  getNodeGeometry(nodeId: string): NodeGeometry | null;
  /** True while the user is actively dragging a node (reconciliation must defer). */
  isBusy(): boolean;
  /**
   * Reposition/resize a LIVE node to match synced geometry. Never touches a node
   * the local user is actively dragging. Returns the outcome for diagnostics.
   */
  applyNodeGeometry(
    nodeId: string,
    geo: NodeGeometry,
  ): "applied" | "unchanged" | "interacting" | "missing" | "unsupported";
  /**
   * Structural reload of the LIVE canvas from full canvas data (handles node/edge
   * add + remove that per-node patching cannot). Returns false if unsupported or
   * skipped because the user is busy.
   */
  reloadCanvasData(data: unknown): boolean;
  /**
   * Register for node interaction START (a node became selected / dragged). The
   * callback receives the node id. Returns an unsubscribe fn. No-op unsubscribe
   * when the private API is absent — the diff-inferred fallback takes over.
   */
  onNodeInteractionStart(cb: (nodeId: string) => void): () => void;
  /** Register for node interaction END (deselected / drag end). Returns unsubscribe. */
  onNodeInteractionEnd(cb: (nodeId: string) => void): () => void;
  /** Register for pointer movement; callback receives CANVAS-space coords. */
  onPointerMove(cb: (canvasX: number, canvasY: number) => void): () => void;
  /** Register for viewport changes (pan/zoom). Returns unsubscribe. */
  onViewportChange(cb: () => void): () => void;
  /** Restore every patched canvas method and detach every listener. */
  destroy(): void;
}

// ---- Pure transform helpers (deterministic, DOM-free, unit-tested) ----------

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Canvas-space → screen point relative to the wrapper element. Mirrors Obsidian's
 * transform: `s = (c - origin) * zoom + halfSize`. Because the overlay div is a
 * child of wrapperEl, the wrapper's own left/top are NOT added (coords are
 * already wrapper-relative).
 */
export function canvasToScreenRel(
  cx: number,
  cy: number,
  vp: CanvasViewport,
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (cx - vp.x) * vp.zoom + size.width / 2,
    y: (cy - vp.y) * vp.zoom + size.height / 2,
  };
}

/**
 * Client (screen) point → canvas space, manual fallback when `posFromEvt` is
 * unavailable. Inverse of {@link canvasToScreenRel} including the wrapper offset.
 */
export function clientToCanvasManual(
  clientX: number,
  clientY: number,
  vp: CanvasViewport,
  rect: ScreenRect,
): { x: number; y: number } | null {
  if (vp.zoom === 0) return null;
  return {
    x: (clientX - rect.left - rect.width / 2) / vp.zoom + vp.x,
    y: (clientY - rect.top - rect.height / 2) / vp.zoom + vp.y,
  };
}

// ---- Private-shape typing (validated defensively at every access) -----------

interface CanvasNode {
  id?: string;
  nodeEl?: HTMLElement;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // Live reposition/resize of a node card (updates model + DOM). Present on the
  // real Obsidian CanvasNode; validated defensively before every call.
  moveAndResize?: (geo: { x: number; y: number; width: number; height: number }) => void;
}

export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PrivateCanvas {
  wrapperEl?: HTMLElement;
  canvasEl?: HTMLElement;
  x?: number;
  y?: number;
  zoom?: number;
  nodes?: Map<string, CanvasNode>;
  edges?: Map<string, unknown>;
  selection?: Set<{ id?: string }>;
  nodeInteractionLayer?: { target?: { id?: string } | null };
  posFromEvt?: (evt: unknown) => { x: number; y: number };
  updateSelection?: (...args: unknown[]) => unknown;
  setDragging?: (...args: unknown[]) => unknown;
  markViewportChanged?: (...args: unknown[]) => unknown;
  // Live-view reconciliation surface (private, validated before use):
  //   setData(data)     → replace canvas contents (structural add/remove)
  //   requestFrame()    → schedule a re-render
  //   requestSave()     → persist to the .canvas file
  setData?: (data: unknown) => void;
  requestFrame?: () => void;
  requestSave?: () => void;
}

interface PrivateCanvasView {
  canvas?: PrivateCanvas;
}

const NOOP = () => {};

type AnyFn = (...args: unknown[]) => unknown;
// Marker so we never restore over a wrapper that isn't ours, and never double-wrap.
type PatchedFn = AnyFn & {
  __lsOriginal?: AnyFn;
  __lsWrapped?: true;
};

/**
 * Build an adapter around an Obsidian canvas leaf view. `view` is deliberately
 * `unknown`; the private shape is validated defensively so a shape change can
 * never throw into the plugin. Patches are applied lazily (first subscription).
 */
export function createCanvasAdapter(view: unknown): CanvasAdapter {
  const canvas = (view as PrivateCanvasView | null | undefined)?.canvas as PrivateCanvas | undefined;
  const hasCanvas = !!canvas && typeof canvas === "object";

  // Listener registries — one physical patch fans out to many subscribers.
  const startListeners = new Set<(id: string) => void>();
  const endListeners = new Set<(id: string) => void>();
  const viewportListeners = new Set<() => void>();
  // Node ids currently considered "held" (selected or dragged), so we can emit
  // start on newly-held ids and end on released ids from the coarse patch signals.
  const held = new Set<string>();
  // Live-drag state (for reconciliation deferral): true between setDragging(true)
  // and setDragging(false); dragTargetId is the node under the drag, if known.
  let isDragging = false;
  let dragTargetId: string | null = null;
  // Disposers for physical patches / DOM listeners (installed once, lazily).
  const unpatchers: Array<() => void> = [];
  const patchState = { selection: false, dragging: false, viewport: false, pointer: false };

  function viewport(): CanvasViewport | null {
    if (!hasCanvas) return null;
    const { x, y, zoom } = canvas as PrivateCanvas;
    if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return null;
    return { x, y, zoom };
  }

  function patch(name: "updateSelection" | "setDragging" | "markViewportChanged", after: (args: unknown[]) => void): void {
    if (!hasCanvas) return;
    const c = canvas as unknown as Record<string, PatchedFn | undefined>;
    const original = c[name];
    if (typeof original !== "function" || original.__lsWrapped) return;
    const wrapper: PatchedFn = function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      try {
        after(args);
      } catch {
        /* diagnostics must never break canvas interaction */
      }
      return result;
    };
    wrapper.__lsWrapped = true;
    wrapper.__lsOriginal = original;
    c[name] = wrapper;
    unpatchers.push(() => {
      if (c[name] === wrapper) c[name] = original;
    });
  }

  function emitHeld(nextIds: Set<string>): void {
    for (const id of nextIds) {
      if (!held.has(id)) {
        held.add(id);
        for (const cb of startListeners) cb(id);
      }
    }
    for (const id of [...held]) {
      if (!nextIds.has(id)) {
        held.delete(id);
        for (const cb of endListeners) cb(id);
      }
    }
  }

  function readSelectionIds(): Set<string> {
    const ids = new Set<string>();
    const sel = canvas?.selection;
    if (sel && typeof (sel as Set<unknown>).forEach === "function") {
      for (const el of sel as Set<{ id?: string }>) {
        if (el && typeof el.id === "string") ids.add(el.id);
      }
    }
    return ids;
  }

  function ensureSelectionPatch(): void {
    if (patchState.selection) return;
    patchState.selection = true;
    patch("updateSelection", () => emitHeld(readSelectionIds()));
  }

  function ensureDraggingPatch(): void {
    if (patchState.dragging) return;
    patchState.dragging = true;
    patch("setDragging", (args) => {
      const dragging = args[0] === true;
      const target = canvas?.nodeInteractionLayer?.target;
      const targetId = target && typeof target.id === "string" ? target.id : null;
      // Track live-drag state for reconciliation deferral.
      isDragging = dragging;
      dragTargetId = dragging ? targetId : null;
      if (dragging && targetId) {
        // Dragging a node holds it (union with current selection).
        emitHeld(new Set([...readSelectionIds(), targetId]));
      } else {
        // Drag end: fall back to whatever is still selected.
        emitHeld(readSelectionIds());
      }
    });
  }

  function ensureViewportPatch(): void {
    if (patchState.viewport) return;
    patchState.viewport = true;
    patch("markViewportChanged", () => {
      for (const cb of viewportListeners) cb();
    });
  }

  return {
    isAvailable(): boolean {
      // Correct gate: nodes is a Map and zoom is a live number. posFromEvt is
      // optional (manual fallback exists), so it is NOT part of the gate.
      return !!canvas && canvas.nodes instanceof Map && typeof canvas.zoom === "number";
    },

    availabilityReport(): string {
      if (!hasCanvas) return "no view.canvas";
      const missing: string[] = [];
      if (!(canvas?.nodes instanceof Map)) missing.push("nodes(Map)");
      if (typeof canvas?.zoom !== "number") missing.push("zoom");
      if (!canvas?.wrapperEl) missing.push("wrapperEl");
      if (typeof canvas?.posFromEvt !== "function") missing.push("posFromEvt(optional)");
      if (typeof canvas?.updateSelection !== "function") missing.push("updateSelection(optional)");
      if (typeof canvas?.setDragging !== "function") missing.push("setDragging(optional)");
      if (typeof canvas?.markViewportChanged !== "function") missing.push("markViewportChanged(optional)");
      return missing.length ? `missing: ${missing.join(", ")}` : "all members present";
    },

    getOverlayHost(): unknown | null {
      if (!hasCanvas) return null;
      return canvas?.wrapperEl ?? canvas?.canvasEl ?? null;
    },

    getViewport(): CanvasViewport | null {
      return viewport();
    },

    clientToCanvas(clientX: number, clientY: number): { x: number; y: number } | null {
      if (!hasCanvas) return null;
      const c = canvas as PrivateCanvas;
      if (typeof c.posFromEvt === "function") {
        try {
          const p = c.posFromEvt({ clientX, clientY });
          if (p && typeof p.x === "number" && typeof p.y === "number") return p;
        } catch {
          /* fall through to manual transform */
        }
      }
      const vp = viewport();
      const rectEl = c.wrapperEl;
      if (!vp || !rectEl || typeof rectEl.getBoundingClientRect !== "function") return null;
      const r = rectEl.getBoundingClientRect();
      return clientToCanvasManual(clientX, clientY, vp, {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      });
    },

    canvasToScreenRelativeToWrapper(x: number, y: number): { x: number; y: number } | null {
      const vp = viewport();
      const rectEl = canvas?.wrapperEl;
      if (!vp || !rectEl || typeof rectEl.getBoundingClientRect !== "function") return null;
      const r = rectEl.getBoundingClientRect();
      return canvasToScreenRel(x, y, vp, { width: r.width, height: r.height });
    },

    getNodeEl(nodeId: string): HTMLElement | null {
      const node = canvas?.nodes?.get(nodeId);
      return (node?.nodeEl as HTMLElement | undefined) ?? null;
    },

    getLiveNodeIds(): Set<string> {
      const ids = new Set<string>();
      if (canvas?.nodes instanceof Map) for (const id of canvas.nodes.keys()) ids.add(id);
      return ids;
    },

    getLiveEdgeIds(): Set<string> {
      const ids = new Set<string>();
      if (canvas?.edges instanceof Map) for (const id of canvas.edges.keys()) ids.add(id);
      return ids;
    },

    getNodeGeometry(nodeId: string): NodeGeometry | null {
      const node = canvas?.nodes?.get(nodeId);
      if (
        !node ||
        typeof node.x !== "number" ||
        typeof node.y !== "number" ||
        typeof node.width !== "number" ||
        typeof node.height !== "number"
      ) {
        return null;
      }
      return { x: node.x, y: node.y, width: node.width, height: node.height };
    },

    isBusy(): boolean {
      // Ensure the dragging patch is live so isDragging reflects reality even if no
      // interaction listener was subscribed yet.
      ensureDraggingPatch();
      return isDragging;
    },

    applyNodeGeometry(
      nodeId: string,
      geo: NodeGeometry,
    ): "applied" | "unchanged" | "interacting" | "missing" | "unsupported" {
      ensureDraggingPatch();
      const node = canvas?.nodes?.get(nodeId);
      if (!node) return "missing";
      // Never fight the user's own in-progress drag of THIS node.
      if (isDragging && dragTargetId === nodeId) return "interacting";
      if (typeof node.moveAndResize !== "function") return "unsupported";
      if (
        node.x === geo.x &&
        node.y === geo.y &&
        node.width === geo.width &&
        node.height === geo.height
      ) {
        return "unchanged";
      }
      try {
        node.moveAndResize({ x: geo.x, y: geo.y, width: geo.width, height: geo.height });
        return "applied";
      } catch {
        return "unsupported";
      }
    },

    reloadCanvasData(data: unknown): boolean {
      if (isDragging) return false; // never yank the view out from under an active drag
      const c = canvas as PrivateCanvas | undefined;
      if (!c || typeof c.setData !== "function") return false;
      try {
        c.setData(data);
        c.requestFrame?.();
        return true;
      } catch {
        return false;
      }
    },

    onNodeInteractionStart(cb: (nodeId: string) => void): () => void {
      if (!this.isAvailable()) return NOOP;
      ensureSelectionPatch();
      ensureDraggingPatch();
      startListeners.add(cb);
      return () => startListeners.delete(cb);
    },

    onNodeInteractionEnd(cb: (nodeId: string) => void): () => void {
      if (!this.isAvailable()) return NOOP;
      ensureSelectionPatch();
      ensureDraggingPatch();
      endListeners.add(cb);
      return () => endListeners.delete(cb);
    },

    onPointerMove(cb: (canvasX: number, canvasY: number) => void): () => void {
      const wrapper = canvas?.wrapperEl;
      if (!wrapper || typeof wrapper.addEventListener !== "function") return NOOP;
      const listener = (e: Event) => {
        const evt = e as MouseEvent;
        const p = this.clientToCanvas(evt.clientX, evt.clientY);
        if (p) cb(p.x, p.y);
      };
      wrapper.addEventListener("pointermove", listener);
      const dispose = () => wrapper.removeEventListener("pointermove", listener);
      unpatchers.push(dispose);
      return dispose;
    },

    onViewportChange(cb: () => void): () => void {
      if (!hasCanvas) return NOOP;
      ensureViewportPatch();
      viewportListeners.add(cb);
      return () => viewportListeners.delete(cb);
    },

    destroy(): void {
      for (const dispose of unpatchers.splice(0)) {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      }
      startListeners.clear();
      endListeners.clear();
      viewportListeners.clear();
      held.clear();
      patchState.selection = false;
      patchState.dragging = false;
      patchState.viewport = false;
      patchState.pointer = false;
    },
  };
}
