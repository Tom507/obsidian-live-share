// WP1 — Contract-faithful `CanvasDouble` for headless canvas E2E tests.
//
// This LIFTS the `FakeNode` / `makeView` pattern from
// `plugin/src/__tests__/canvas-adapter.test.ts` (L64-104) into a reusable harness
// module. It is deliberately NOT imported from that `.test.ts` file (test files are
// not modules to depend on) — the shape is re-expressed here as the single
// contract-faithful double consumed by WP1 (self-test), WP2 (two-peer harness), and
// WP3 (matrix).
//
// GROUND TRUTH the double must honor (see `canvas-adapter.ts`):
//   * `createCanvasAdapter(view)` reads `view.canvas`.
//   * `isAvailable()` gates on `canvas.nodes instanceof Map` AND
//     `typeof canvas.zoom === "number"` — the double MUST satisfy both.
//   * Activity is detected by MONKEY-PATCHING `canvas.updateSelection` /
//     `canvas.setDragging` / `canvas.markViewportChanged`. The double exposes those
//     as real (reassignable) methods so the adapter can wrap them; the interaction
//     driver (interaction-driver.ts) calls them through `canvas.*` so the wrappers
//     fire — this is the signal-injection fidelity the whole harness turns on.
//   * Drag target is `canvas.nodeInteractionLayer.target` (`{ id } | null`).
//   * Selection is `canvas.selection` (a Set of `{ id }`).
//   * Live viewport is numeric `canvas.x` / `canvas.y` / `canvas.zoom` / `canvas.scale`,
//     where `zoom` is `log2(scale)` (0 = 100 %) and `scale` is the linear factor.
//   * A node has live `id/x/y/width/height` and a `moveAndResize` that mutates them.
//   * `canvas.setData` / `canvas.requestFrame` / `canvas.requestSave` are the
//     structural-reload surface (observable here via instrumentation).

/** Flat node record — mirrors an Obsidian `.canvas` node (primitive values). */
export interface DoubleNodeRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
  text?: string;
  file?: string;
  [key: string]: unknown;
}

/** Flat edge record — mirrors an Obsidian `.canvas` edge. */
export interface DoubleEdgeRecord {
  id: string;
  fromNode: string;
  toNode: string;
  [key: string]: unknown;
}

/** Snapshot returned by {@link CanvasDouble.getData}. */
export interface CanvasDoubleData {
  nodes: DoubleNodeRecord[];
  edges: DoubleEdgeRecord[];
}

/**
 * A live canvas node inside the double. Carries live geometry the adapter reads
 * directly (`getNodeGeometry`) plus a `moveAndResize` that mutates that geometry —
 * exactly the `FakeNode` behavior from canvas-adapter.test.ts, promoted to a class
 * so it is reusable and always exposes a `typeof … === "function"` mutator.
 */
export class DoubleNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
  text?: string;
  file?: string;
  /** Present on the real Obsidian CanvasNode; the adapter validates it defensively. */
  nodeEl?: HTMLElement;
  [key: string]: unknown;

  constructor(record: DoubleNodeRecord) {
    this.id = record.id;
    this.x = record.x;
    this.y = record.y;
    this.width = record.width;
    this.height = record.height;
    if (record.type !== undefined) this.type = record.type;
    if (record.text !== undefined) this.text = record.text;
    if (record.file !== undefined) this.file = record.file;
    for (const [k, v] of Object.entries(record)) {
      if (!(k in this)) this[k] = v;
    }
  }

  moveAndResize(geo: { x: number; y: number; width: number; height: number }): void {
    this.x = geo.x;
    this.y = geo.y;
    this.width = geo.width;
    this.height = geo.height;
  }

  toRecord(): DoubleNodeRecord {
    const rec: DoubleNodeRecord = {
      id: this.id,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
    if (this.type !== undefined) rec.type = this.type;
    if (this.text !== undefined) rec.text = this.text;
    if (this.file !== undefined) rec.file = this.file;
    for (const [k, v] of Object.entries(this)) {
      if (k === "moveAndResize" || k === "nodeEl" || k === "toRecord") continue;
      if (!(k in rec)) rec[k] = v;
    }
    return rec;
  }
}

/** A live canvas edge inside the double. */
export class DoubleEdge {
  id: string;
  fromNode: string;
  toNode: string;
  [key: string]: unknown;

  constructor(record: DoubleEdgeRecord) {
    this.id = record.id;
    this.fromNode = record.fromNode;
    this.toNode = record.toNode;
    for (const [k, v] of Object.entries(record)) {
      if (!(k in this)) this[k] = v;
    }
  }

  toRecord(): DoubleEdgeRecord {
    const rec: DoubleEdgeRecord = {
      id: this.id,
      fromNode: this.fromNode,
      toNode: this.toNode,
    };
    for (const [k, v] of Object.entries(this)) {
      if (k === "toRecord") continue;
      if (!(k in rec)) rec[k] = v;
    }
    return rec;
  }
}

/**
 * The private-canvas surface the adapter monkey-patches and reads. Members are
 * mutable so the adapter can replace the patchable methods with wrappers, and so the
 * interaction driver can set `selection` / `nodeInteractionLayer.target`.
 */
export interface DoubleCanvas {
  nodes: Map<string, DoubleNode>;
  edges: Map<string, DoubleEdge>;
  /** `log2(scale)` as in Obsidian — 0 is 100 %, not 1. See {@link CanvasDoubleOptions}. */
  zoom: number;
  /** The linear factor the adapter multiplies by (`2 ** zoom` unless overridden). */
  scale: number;
  x: number;
  y: number;
  selection: Set<{ id: string }>;
  nodeInteractionLayer: { target: { id: string } | null };
  wrapperEl?: HTMLElement;
  updateSelection: (fn?: unknown) => void;
  setDragging: (dragging: boolean) => void;
  markViewportChanged: () => void;
  setData: (data: unknown) => void;
  requestFrame: () => void;
  requestSave: () => void;
}

/** The `{ canvas }` view object passed to `createCanvasAdapter`. */
export interface DoubleView {
  canvas: DoubleCanvas;
}

export interface CanvasDoubleOptions {
  nodes?: DoubleNodeRecord[];
  edges?: DoubleEdgeRecord[];
  /**
   * Obsidian's `canvas.zoom` — `log2(scale)`, clamped `[-4, 1]`. **Defaults to `0`,
   * which is 100 %.** (It defaulted to `1` = 200 %, so every harness case silently ran
   * double-scaled; see US1 AC7.)
   */
  zoom?: number;
  /** Explicit linear factor. Defaults to `2 ** zoom`, matching the real controller. */
  scale?: number;
  x?: number;
  y?: number;
}

/**
 * Reusable, contract-faithful canvas double. Pass {@link CanvasDouble.view} to
 * `createCanvasAdapter`; drive interactions with `InteractionDriver` (which calls the
 * patchable methods through this canvas so the adapter's wrappers fire).
 */
export class CanvasDouble {
  readonly canvas: DoubleCanvas;

  // ---- instrumentation (observable structural-reload surface) ---------------
  setDataCount = 0;
  requestFrameCount = 0;
  requestSaveCount = 0;
  lastSetData: unknown = null;

  constructor(opts: CanvasDoubleOptions = {}) {
    const nodes = new Map<string, DoubleNode>();
    for (const rec of opts.nodes ?? []) nodes.set(rec.id, new DoubleNode(rec));
    const edges = new Map<string, DoubleEdge>();
    for (const rec of opts.edges ?? []) edges.set(rec.id, new DoubleEdge(rec));

    // CORRECTED (US1 AC7): the zoom default was `1`, i.e. 200 % in Obsidian, so every
    // harness case ran double-scaled. `0` is 100 %; `scale` is the linear factor the
    // adapter actually multiplies by and can be overridden independently.
    const zoom = opts.zoom ?? 0;
    this.canvas = {
      nodes,
      edges,
      zoom,
      scale: opts.scale ?? 2 ** zoom,
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      selection: new Set<{ id: string }>(),
      nodeInteractionLayer: { target: null },
      // Patchable no-ops — the adapter wraps these; the driver invokes them.
      updateSelection: (_fn?: unknown) => {},
      setDragging: (_dragging: boolean) => {},
      markViewportChanged: () => {},
      // Structural-reload surface — instrumented for observability. `setData`
      // rebuilds the live nodes/edges maps from the supplied data, matching the
      // real canvas's "replace contents" semantics.
      setData: (data: unknown) => {
        this.setDataCount += 1;
        this.lastSetData = data;
        this.replaceFromData(data);
      },
      requestFrame: () => {
        this.requestFrameCount += 1;
      },
      requestSave: () => {
        this.requestSaveCount += 1;
      },
    };
  }

  /** The `{ canvas }` view to hand to `createCanvasAdapter`. */
  get view(): DoubleView {
    return { canvas: this.canvas };
  }

  // ---- record access --------------------------------------------------------

  /** getData()-style read of current live records (US1 AC6). */
  getData(): CanvasDoubleData {
    return {
      nodes: [...this.canvas.nodes.values()].map((n) => n.toRecord()),
      edges: [...this.canvas.edges.values()].map((e) => e.toRecord()),
    };
  }

  getNode(id: string): DoubleNode | undefined {
    return this.canvas.nodes.get(id);
  }

  getEdge(id: string): DoubleEdge | undefined {
    return this.canvas.edges.get(id);
  }

  // ---- structural mutation (used by the interaction driver) -----------------

  upsertNode(record: DoubleNodeRecord): DoubleNode {
    const existing = this.canvas.nodes.get(record.id);
    if (existing) {
      Object.assign(existing, record);
      return existing;
    }
    const node = new DoubleNode(record);
    this.canvas.nodes.set(node.id, node);
    return node;
  }

  removeNode(id: string): boolean {
    return this.canvas.nodes.delete(id);
  }

  upsertEdge(record: DoubleEdgeRecord): DoubleEdge {
    const existing = this.canvas.edges.get(record.id);
    if (existing) {
      Object.assign(existing, record);
      return existing;
    }
    const edge = new DoubleEdge(record);
    this.canvas.edges.set(edge.id, edge);
    return edge;
  }

  removeEdge(id: string): boolean {
    return this.canvas.edges.delete(id);
  }

  /** Edge ids that dangle after a set of node ids is removed. */
  incidentEdgeIds(nodeId: string): string[] {
    const ids: string[] = [];
    for (const edge of this.canvas.edges.values()) {
      if (edge.fromNode === nodeId || edge.toNode === nodeId) ids.push(edge.id);
    }
    return ids;
  }

  private replaceFromData(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const d = data as { nodes?: DoubleNodeRecord[]; edges?: DoubleEdgeRecord[] };
    if (Array.isArray(d.nodes)) {
      this.canvas.nodes.clear();
      for (const rec of d.nodes) this.canvas.nodes.set(rec.id, new DoubleNode(rec));
    }
    if (Array.isArray(d.edges)) {
      this.canvas.edges.clear();
      for (const rec of d.edges) this.canvas.edges.set(rec.id, new DoubleEdge(rec));
    }
  }
}
