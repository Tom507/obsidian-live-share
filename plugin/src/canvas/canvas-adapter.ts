// WP2/WP3 — thin isolation layer around Obsidian's PRIVATE, UNTYPED Canvas view
// API. Nothing outside this file may touch `view.canvas` internals. The adapter
// degrades gracefully: when the private surface is missing or shaped differently
// (Obsidian is free to change it), `isAvailable()` returns false and every hook
// becomes a no-op. That is the trigger for the mandatory DIFF-INFERRED FALLBACK
// (lock on first node-key change) implemented in canvas-sync.ts — the fallback is
// a real, tested path, not a stub.

export interface CanvasViewport {
  tx: number;
  ty: number;
  tZoom: number;
}

export interface CanvasAdapter {
  /** True only when the private Canvas API surface we rely on is present. */
  isAvailable(): boolean;
  /** The DOM element the presence overlay should be mounted into (canvas wrapper). */
  getOverlayHost(): unknown | null;
  /** Current viewport transform, used to map canvas coords to screen coords. */
  getViewport(): CanvasViewport | null;
  /** Map a client (screen) point to canvas space; null if not derivable. */
  clientToCanvas(clientX: number, clientY: number): { x: number; y: number } | null;
  /**
   * Register for node interaction START (drag / edit / selection). The callback
   * receives the node id. Returns an unsubscribe fn. No-op (returns a no-op
   * unsubscribe) when the private API is absent — the diff-inferred fallback
   * takes over in that case.
   */
  onNodeInteractionStart(cb: (nodeId: string) => void): () => void;
  /** Register for node interaction END (drag end / blur). Returns unsubscribe. */
  onNodeInteractionEnd(cb: (nodeId: string) => void): () => void;
  /** Register for pointer movement over the canvas surface. Returns unsubscribe. */
  onPointerMove(cb: (clientX: number, clientY: number) => void): () => void;
}

interface PrivateCanvas {
  wrapperEl?: unknown;
  canvasEl?: unknown;
  tx?: number;
  ty?: number;
  tZoom?: number;
  posFromEvt?: (evt: unknown) => { x: number; y: number };
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  off?: (event: string, cb: (...args: unknown[]) => void) => void;
}

interface PrivateCanvasView {
  canvas?: PrivateCanvas;
}

const NOOP = () => {};

// Extract a node id from whatever the private API hands the interaction callback.
function extractNodeId(arg: unknown): string | null {
  if (!arg || typeof arg !== "object") return null;
  const obj = arg as Record<string, unknown>;
  if (typeof obj.id === "string") return obj.id;
  const node = obj.node as Record<string, unknown> | undefined;
  if (node && typeof node.id === "string") return node.id;
  return null;
}

/**
 * Build an adapter around an Obsidian canvas leaf view. `view` is deliberately
 * `unknown` — the private shape is validated defensively at every access so a
 * shape change can never throw into the plugin.
 */
export function createCanvasAdapter(view: unknown): CanvasAdapter {
  const canvas = (view as PrivateCanvasView | null | undefined)?.canvas;
  const hasCanvas = !!canvas && typeof canvas === "object";
  const canListen = hasCanvas && typeof canvas?.on === "function" && typeof canvas?.off === "function";

  return {
    isAvailable(): boolean {
      // We consider the API "available" only when we can both read a viewport
      // and attach interaction listeners — the two things WP3 acquisition needs.
      return !!canListen && typeof canvas?.tZoom === "number";
    },

    getOverlayHost(): unknown | null {
      if (!hasCanvas) return null;
      return canvas?.wrapperEl ?? canvas?.canvasEl ?? null;
    },

    getViewport(): CanvasViewport | null {
      if (!hasCanvas) return null;
      const { tx, ty, tZoom } = canvas as PrivateCanvas;
      if (typeof tx !== "number" || typeof ty !== "number" || typeof tZoom !== "number") {
        return null;
      }
      return { tx, ty, tZoom };
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
      const vp = this.getViewport();
      if (!vp || vp.tZoom === 0) return null;
      return { x: (clientX - vp.tx) / vp.tZoom, y: (clientY - vp.ty) / vp.tZoom };
    },

    onNodeInteractionStart(cb: (nodeId: string) => void): () => void {
      if (!canListen) return NOOP;
      const handler = (arg: unknown) => {
        const id = extractNodeId(arg);
        if (id) cb(id);
      };
      // Obsidian fires various node events; we subscribe to the ones that mark a
      // held node. Unknown events simply never fire.
      canvas?.on?.("node:startmove", handler);
      canvas?.on?.("node:edit", handler);
      canvas?.on?.("selection:change", handler);
      return () => {
        canvas?.off?.("node:startmove", handler);
        canvas?.off?.("node:edit", handler);
        canvas?.off?.("selection:change", handler);
      };
    },

    onNodeInteractionEnd(cb: (nodeId: string) => void): () => void {
      if (!canListen) return NOOP;
      const handler = (arg: unknown) => {
        const id = extractNodeId(arg);
        if (id) cb(id);
      };
      canvas?.on?.("node:endmove", handler);
      canvas?.on?.("node:blur", handler);
      return () => {
        canvas?.off?.("node:endmove", handler);
        canvas?.off?.("node:blur", handler);
      };
    },

    onPointerMove(cb: (clientX: number, clientY: number) => void): () => void {
      const host = this.getOverlayHost() as
        | { addEventListener?: (t: string, l: (e: unknown) => void) => void; removeEventListener?: (t: string, l: (e: unknown) => void) => void }
        | null;
      if (!host || typeof host.addEventListener !== "function") return NOOP;
      const listener = (e: unknown) => {
        const evt = e as { clientX?: number; clientY?: number };
        if (typeof evt.clientX === "number" && typeof evt.clientY === "number") {
          cb(evt.clientX, evt.clientY);
        }
      };
      host.addEventListener("pointermove", listener);
      return () => host.removeEventListener?.("pointermove", listener);
    },
  };
}
