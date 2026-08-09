// ===========================================================================
// B72 — A CANVAS DOUBLE THAT HAS A PAINT LAYER, BECAUSE THE EXISTING ONE DOES NOT.
//
// `harness/canvas-double.ts` models the canvas MODEL faithfully and has no
// pixels at all: its `DoubleNode.moveAndResize` assigns four numbers and stops.
// That is the exact blindness `S192` named — a double built like the model can
// never show a model/paint divergence, so a test written over it would pass on a
// build with no repaint in it. This double adds the second half.
//
// WHAT IS REPRODUCED, AND IT IS QUOTED RATHER THAN INVENTED. Every behaviour
// below was read out of Obsidian's shipped renderer (`obsidian.asar` → `app.js`)
// during B72 and is reproduced verbatim in shape:
//
//   CanvasNode.moveAndResize = function (e) {
//     this.x = Math.round(e.x); this.y = Math.round(e.y);
//     this.width = Math.round(e.width); this.height = Math.round(e.height);
//     this.canvas.markMoved(this)                 // nodeEl is NOT touched
//   }
//   CanvasNode.render = function () { … t.setCssStyles({
//     transform: "translate(".concat(n,"px, ").concat(i,"px)"), width: …, height: … }) }
//   CanvasNode.attach = function () { … e.parentNode || t.canvasEl.appendChild(e) … }
//   CanvasNode.detach = function () { this.nodeEl.parentNode && this.nodeEl.detach() }
//   get isAttached()  { return !!this.nodeEl.parentNode }
//   Canvas.markMoved  = function (e) { this.moved.add(e), this.requestFrame() }
//   Canvas.markDirty  = function (e) { this.dirty.add(e), … this.requestFrame() }
//   Canvas.requestFrame = … rAF(function () { …
//       for (re of Array.from(moved)) { … dirty.add(re) }      // moved → dirty
//       t.virtualize();                                        // detach off-screen
//       for (re of Array.from(dirty)) { re.isAttached && (re.render(), dirty.delete(re)) }
//       … moved.clear() })                                     // moved cleared, dirty NOT
//   Canvas.virtualize = function () { … intersecting.attach() … absent.detach() … }
//
// ## HONEST LIMITS — what this double CAN and CANNOT catch
//
// It is a REIMPLEMENTATION of those lines, not the lines themselves, so it
// cannot catch a mistake in my reading of them. B71 established the stronger
// instrument for that: brace-match the real functions out of the built bundle
// and run them. This double's job is different — it is the only way to express
// "a remote change arrived while the card was off screen" as a test, and it is
// deliberately faithful about the ONE property that decides the fix's value:
// `render()` is the only writer of a card's position, it is called only from the
// frame, and only for an attached node.
//
// It also cannot reproduce a lost receiver or a never-constructed element (B71's
// finding): it is an object literal that closes over its own data lexically. A
// wiring gap of that kind is covered by the source census, not by this.
//
// THE FRAME IS NOT AUTOMATIC. `requestFrame()` records that a frame is OWED;
// `runFrame()` runs it. That is on purpose — a test that let frames run by
// themselves would be measuring `setTimeout`, and `S85` ("a false green from
// sleep-as-settle") is on this project's own list.
// ===========================================================================

/** The minimal element shape the adapter and the paint reading actually touch. */
export interface FakeEl {
  parentNode: unknown;
  isConnected: boolean;
  style: { transform: string; width: string; height: string };
  className: string;
}

function makeEl(): FakeEl {
  return {
    parentNode: null,
    isConnected: false,
    style: { transform: "", width: "", height: "" },
    className: "canvas-node",
  };
}

export class RenderNode {
  readonly id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeEl: FakeEl = makeEl();
  /** Obsidian's own flag; the adapter's editing probe reads it. */
  isEditing = false;
  /** How many times `render()` actually ran — the pixel-side event counter. */
  renderCount = 0;
  private readonly canvas: RenderCanvas;

  constructor(
    canvas: RenderCanvas,
    rec: { id: string; x: number; y: number; width: number; height: number },
  ) {
    this.canvas = canvas;
    this.id = rec.id;
    this.x = rec.x;
    this.y = rec.y;
    this.width = rec.width;
    this.height = rec.height;
  }

  get isAttached(): boolean {
    return !!this.nodeEl.parentNode;
  }

  /** Verbatim in shape: four rounded numbers and `markMoved`. NOTHING touches `nodeEl`. */
  moveAndResize(geo: { x: number; y: number; width: number; height: number }): void {
    this.x = Math.round(geo.x);
    this.y = Math.round(geo.y);
    this.width = Math.round(geo.width);
    this.height = Math.round(geo.height);
    this.canvas.markMoved(this);
  }

  /** The ONLY writer of this card's position. */
  render(): void {
    this.renderCount++;
    this.nodeEl.style.transform = `translate(${this.x}px, ${this.y}px)`;
    this.nodeEl.style.width = `${this.width}px`;
    this.nodeEl.style.height = `${this.height}px`;
  }

  /** `attach()` APPENDS THE CARD WITHOUT POSITIONING IT. That is the whole point. */
  attach(): void {
    if (!this.nodeEl.parentNode) {
      this.nodeEl.parentNode = this.canvas.canvasEl;
      this.nodeEl.isConnected = true;
    }
  }

  detach(): void {
    this.nodeEl.parentNode = null;
    this.nodeEl.isConnected = false;
  }

  /** What the paint plane reads: the inline instruction, or `null` if there is none. */
  paintedAt(): { x: number; y: number } | null {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(this.nodeEl.style.transform);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  }
}

export class RenderCanvas {
  readonly nodes = new Map<string, RenderNode>();
  readonly edges = new Map<string, unknown>();
  readonly moved = new Set<RenderNode>();
  readonly dirty = new Set<RenderNode>();
  readonly canvasEl = { tag: "canvasEl" };
  wrapperEl: unknown = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
  };
  x = 0;
  y = 0;
  zoom = 0;
  scale = 1;
  selection = new Set<{ id: string }>();
  nodeInteractionLayer: { target: { id: string } | null } = { target: null };
  /** Ids currently considered inside the viewport by `virtualize()`. */
  visible: Set<string>;
  framesOwed = 0;
  framesRun = 0;

  constructor(records: { id: string; x: number; y: number; width: number; height: number }[]) {
    for (const rec of records) this.nodes.set(rec.id, new RenderNode(this, rec));
    this.visible = new Set(records.map((r) => r.id));
  }

  // ---- the patchable surface the adapter monkey-patches --------------------
  updateSelection(_fn?: unknown): void {}
  setDragging(_dragging: boolean): void {}
  markViewportChanged(): void {}
  requestSave(): void {}

  setData(data: unknown): void {
    // Obsidian's `importData` reuses existing node objects and calls
    // `node.setData(rec)`, which marks moved/dirty only for values that CHANGED.
    const nodes = (
      data as { nodes?: { id: string; x: number; y: number; width: number; height: number }[] }
    )?.nodes;
    for (const rec of nodes ?? []) {
      const node = this.nodes.get(rec.id);
      if (!node) continue;
      if (
        node.x !== rec.x ||
        node.y !== rec.y ||
        node.width !== rec.width ||
        node.height !== rec.height
      ) {
        node.x = rec.x;
        node.y = rec.y;
        node.width = rec.width;
        node.height = rec.height;
        this.markMoved(node);
      }
    }
  }

  markMoved(node: unknown): void {
    if (node instanceof RenderNode) this.moved.add(node);
    this.requestFrame();
  }

  markDirty(node: unknown): void {
    if (node instanceof RenderNode) this.dirty.add(node);
    this.requestFrame();
  }

  /** Records that a frame is OWED. `if (this.frame)` — a pending frame is not re-scheduled. */
  requestFrame(): void {
    this.framesOwed = 1;
  }

  /** Detach every card outside the viewport, attach every card inside it. */
  virtualize(): void {
    for (const [id, node] of this.nodes) {
      if (this.visible.has(id)) node.attach();
      else node.detach();
    }
  }

  /**
   * Run the owed frame. Returns false when none was owed — a test that expects a
   * repaint and gets `false` has learned something, so this is not a no-op.
   */
  runFrame(): boolean {
    if (this.framesOwed === 0) return false;
    this.framesOwed = 0;
    this.framesRun++;
    for (const node of [...this.moved]) this.dirty.add(node);
    this.virtualize();
    for (const node of [...this.dirty]) {
      if (node.isAttached) {
        node.render();
        this.dirty.delete(node);
      }
    }
    this.moved.clear();
    return true;
  }

  /** Move the viewport: which cards are on screen. Obsidian re-virtualizes on the next frame. */
  setVisible(ids: string[]): void {
    this.visible = new Set(ids);
    this.requestFrame();
  }

  /**
   * Paint the whole board once, as a fresh mount does. Obsidian's `importData`
   * calls `addNode(node)` then `markMoved(node)` for every node it creates, so a
   * mount really does start with every card in the moved set.
   */
  paintAll(): void {
    for (const node of this.nodes.values()) this.markMoved(node);
    this.runFrame();
  }
}

/** The `{ canvas }` view object `createCanvasAdapter` reads. */
export function renderView(
  records: { id: string; x: number; y: number; width: number; height: number }[],
): { view: { canvas: RenderCanvas }; canvas: RenderCanvas } {
  const canvas = new RenderCanvas(records);
  return { view: { canvas }, canvas };
}
