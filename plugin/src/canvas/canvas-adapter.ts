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
//   * LIVE viewport is `canvas.x`, `canvas.y`, `canvas.zoom` — and `canvas.zoom` is
//     NOT a multiplier: it is `log2(scale)`, clamped to `[-4, 1]` (so 0 = 100 %,
//     -1 = 50 %, 1 = 200 %). The LINEAR factor is `canvas.scale` (`2 ** zoom`), and
//     that is what every screen transform must multiply by. `tx/ty/tZoom`
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
//
// TWO STATES THIS FILE MAKES UNREACHABLE (both are observable in the log, neither
// is a claim about any particular reported symptom):
//   1. A drag flag that stays set forever. `isBusy()` is an INACTIVITY predicate
//      bounded by DRAG_WATCHDOG_MS, not a raw flag read, and every consulting path
//      goes through the same seam. Release emits `DRAG WATCHDOG:`.
//   2. An adapter with no patches. `patch()` ADOPTS a wrapper another adapter over
//      the same `view.canvas` already installed instead of returning early, so the
//      newest adapter always owns the patch. Mount outcome emits `ADAPTER PATCH:`.

// B72 — the ONE busy/editing classifier, imported rather than re-implemented.
// This is the file's first import and it is deliberate: `repaintNode` is a live
// surface mutator, and rule 10 says a new mutator consults the definer every
// other mutator consults, not a private lookalike that can drift from it.
// `canvas-editing-deferral.ts` → `reconcile-plan.ts` is pure and package-free,
// so this adds no runtime dependency and no transport.
import { classifyBusyGate } from "./canvas-editing-deferral";

// Live viewport transform. Read from canvas.x / canvas.y / canvas.zoom / canvas.scale.
export interface CanvasViewport {
  x: number;
  y: number;
  /**
   * Obsidian's `canvas.zoom` — `log2(scale)`, clamped to `[-4, 1]`. It is a
   * LOGARITHMIC value, never a multiplier: 0 = 100 %, -1 = 50 %, 1 = 200 %.
   * Multiplying a canvas-space offset by it is a bug (0 collapses, negatives mirror).
   */
  zoom: number;
  /**
   * The LINEAR scale factor as Obsidian reports it (`canvas.scale`). Absent when the
   * private shape does not expose it; callers then derive `2 ** zoom`. Use
   * {@link viewportScale} rather than reading this directly.
   */
  scale?: number;
}

/**
 * WP87 (C87 AC1) — what the editing signal HOLDS and what its probe SEES, taken
 * without moving either. Diagnostics only; no decision reads it.
 */
export interface EditingSignalReport {
  /** The raw internal flag, un-swept. `null` = nothing is flagged as editing. */
  flag: string | null;
  /**
   * `probeEditingNode().available` — is there any readable answer at all? When
   * this is `false` the caller must NOT read `probeNodeId === null` as "nothing
   * is being edited" (I11: absence of evidence is not evidence).
   */
  probeAvailable: boolean;
  /** `probeEditingNode().nodeId` — the id the probe reports right now, or null. */
  probeNodeId: string | null;
  /** Did the PRIMARY probe (Obsidian's own `node.isEditing`) answer at all? */
  isEditingSeen: boolean;
  /** Ids of live nodes whose `isEditing === true`, as Obsidian reports them. */
  isEditingIds: string[];
  /** Age of the last editing-related signal, in ms. Compare with EDIT_WATCHDOG_MS. */
  idleMs: number;
  /** The inactivity budget this adapter is measuring `idleMs` against. */
  watchdogMs: number;
  /** Is the WP37 editing poll armed (i.e. an editing session is considered open)? */
  pollArmed: boolean;
  /** Number of blur subscribers currently registered. */
  editingEndListeners: number;
  /** Is the flagged node still in the live node map? (the POSITIVE liveness arm) */
  flaggedNodeLive: boolean | null;
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
  /**
   * True while the user is actively interacting and reconciliation must not
   * simply overwrite the view. TWO arms, added rather than merged:
   *
   *   ├── DRAG — unchanged by WP37. An INACTIVITY predicate, not a raw flag: true
   *   │   only while the drag flag is set AND a drag-related signal arrived within
   *   │   the last {@link DRAG_WATCHDOG_MS}. Consulting it is also what releases a
   *   │   flag that stopped being refreshed, so a `setDragging` pair that never
   *   │   closes cannot keep reconciliation switched off indefinitely.
   *   └── EDITING (WP37) — an inline editor is focused inside a card. Same
   *       inactivity shape, its own budget ({@link EDIT_WATCHDOG_MS}) and its own
   *       release signature, plus a POSITIVE liveness check: a focus flag whose
   *       node no longer exists is released immediately rather than after a timeout.
   *
   * The two are never folded together. `isDragTarget` and the `DRAG WATCHDOG:`
   * signature keep their exact previous behaviour.
   */
  isBusy(): boolean;
  /**
   * WP37 — the id of the node whose inline editor currently has focus, or `null`.
   *
   * OPTIONAL on the interface, on the `canvasFile` / `clearFlags` precedent, so
   * every hand-rolled adapter double in the existing tests stays valid. Callers
   * read it as `adapter.getEditingNodeId?.() ?? null`.
   *
   * Consulting it sweeps the same staleness release `isBusy()` does, so a caller
   * can never observe an id the watchdog would have retired.
   */
  getEditingNodeId?(): string | null;
  /**
   * WP37 — the live card's OWN record, as Obsidian holds it right now.
   *
   * This is a MEASUREMENT of the surface, not a recollection of it, and it is what
   * lets the deferral substitute a record that provably changes nothing. `null`
   * when the node is absent or the private shape cannot answer. Optional for the
   * same reason as above.
   */
  getNodeFields?(nodeId: string): Record<string, unknown> | null;
  /**
   * WP37 — fires when an inline editor loses focus (the BLUR half of the guard).
   * The callback receives the id that was being edited. Returns unsubscribe.
   * Optional for the same reason as above.
   */
  onEditingEnd?(cb: (nodeId: string) => void): () => void;
  /**
   * WP37 — report an editing focus change directly, bypassing the DOM listeners.
   *
   * The seam exists because C37 AC1's truth table has to be asserted row by row
   * without a browser. It is a REPORT and not a decision: it sets exactly the flag
   * `focusin` sets, and every read still goes through the same staleness release.
   * Optional for the same reason as the members above.
   */
  noteEditingFocus?(nodeId: string | null): void;
  /**
   * WP87 (C87 AC1) — the editing signal's own facts, READ WITHOUT MOVING IT.
   *
   * NOT a second predicate (rule 10) and not consulted by any decision: it takes
   * no verdict, and nothing in `plugin/src` calls it outside the read-only E2E
   * reader. It exists because AC1 has to record what `getEditingNodeId()` would
   * answer on a peer AT THE MOMENT ITS EDITOR IS DESTROYED — and
   * `getEditingNodeId()` cannot be used for that: it runs the staleness sweep,
   * which may RELEASE the flag and FIRE THE BLUR SUBSCRIBERS, i.e. the
   * instrument would itself trigger one of the four routes it is measuring.
   *
   * So this reports the inputs instead of the answer: the raw flag, what the
   * probe sees right now, and how long the inactivity budget has run. The
   * verdict is reconstructed by the reader, never manufactured here.
   */
  describeEditingSignal?(): EditingSignalReport;
  /**
   * Reposition/resize a LIVE node to match synced geometry. Never touches a node
   * the local user is actively dragging. Returns the outcome for diagnostics.
   */
  applyNodeGeometry(
    nodeId: string,
    geo: NodeGeometry,
  ): "applied" | "unchanged" | "interacting" | "missing" | "unsupported";
  /**
   * B72 (WP2) — REPAINT ONE CARD, NOW. The second half of an apply.
   *
   * `applyNodeGeometry` writes the model and Obsidian only ENQUEUES the pixels
   * (see the B72 block above); this pushes them through synchronously for the one
   * id we already hold, so it is O(1) and needs no sweep. Refuses — never acts —
   * for a card the local user is dragging or typing in.
   *
   * OPTIONAL on the interface, on the `getEditingNodeId` / `canvasFile` /
   * `clearFlags` precedent, so every hand-rolled adapter double in the existing
   * tests stays valid. Callers read it as `adapter.repaintNode?.(id)`.
   */
  repaintNode?(nodeId: string, source?: RepaintSource): RepaintOutcome;
  /**
   * B72 (WP3) — ONE TICK of the low-rate restoring sweep. Caller-driven on
   * purpose: the adapter owns no timer for it, so a test drives the coverage
   * property directly and the only clock in the product is the single interval
   * `main.ts` starts at mount and clears at unmount.
   */
  sweepRepaint?(): RepaintSweepTick;
  /**
   * B72 (WP3) — what the sweep has actually done. Counts only, no verdict. A
   * sweep that cannot be shown to have repaired anything is a sweep that hides
   * the defect instead of measuring it, so this is not optional in spirit.
   */
  describeRepaintSweep?(): RepaintSweepReport;
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
 * The LINEAR scale factor of a viewport — the only value a screen transform may
 * multiply by. Prefers `canvas.scale` (what Obsidian itself renders with) and falls
 * back to `2 ** zoom`, which is the same number because Obsidian defines
 * `zoom = log2(scale)`. A non-finite `scale` is treated as absent (shape drift).
 */
export function viewportScale(vp: CanvasViewport): number {
  return typeof vp.scale === "number" && Number.isFinite(vp.scale) ? vp.scale : 2 ** vp.zoom;
}

/**
 * Canvas-space → screen point relative to the wrapper element. Mirrors Obsidian's
 * own `domFromPos`: `s = (c - origin) * scale + halfSize`, where `scale` is the
 * LINEAR factor ({@link viewportScale}) and NOT `canvas.zoom`. Because the overlay
 * div is a child of wrapperEl, the wrapper's own left/top are NOT added (coords are
 * already wrapper-relative).
 */
export function canvasToScreenRel(
  cx: number,
  cy: number,
  vp: CanvasViewport,
  size: { width: number; height: number },
): { x: number; y: number } {
  const scale = viewportScale(vp);
  return {
    x: (cx - vp.x) * scale + size.width / 2,
    y: (cy - vp.y) * scale + size.height / 2,
  };
}

/**
 * Client (screen) point → canvas space, manual fallback when `posFromEvt` is
 * unavailable. Exact inverse of {@link canvasToScreenRel} including the wrapper
 * offset — it divides by the same LINEAR factor.
 */
export function clientToCanvasManual(
  clientX: number,
  clientY: number,
  vp: CanvasViewport,
  rect: ScreenRect,
): { x: number; y: number } | null {
  const scale = viewportScale(vp);
  // Bail ONLY on a degenerate factor. Obsidian never produces one (`2 ** z > 0` for
  // every finite z, so zoom === 0 is a perfectly valid 100 % viewport); this guards
  // private-shape drift that yields 0 / NaN, not a legitimate zoom level.
  if (scale === 0 || !Number.isFinite(scale)) return null;
  return {
    x: (clientX - rect.left - rect.width / 2) / scale + vp.x,
    y: (clientY - rect.top - rect.height / 2) / scale + vp.y,
  };
}

// ===========================================================================
// B72 (`S196`) — THE REPAINT PLANE. WHY A REMOTE APPLY NEEDS A SECOND STEP.
//
// Read out of Obsidian's shipped renderer (`obsidian.asar` → `app.js`), verbatim,
// because every sentence below is a quotation and not a model of one:
//
//   CanvasNode.moveAndResize = function (e) {
//     this.x = …; this.y = …; this.width = …; this.height = …;
//     this.canvas.markMoved(this)          // ← the whole body. nodeEl is untouched.
//   }
//   Canvas.markMoved  = function (e) { this.moved.add(e), this.requestFrame() }
//   Canvas.requestFrame = … requestAnimationFrame(function () { …
//       t.virtualize();                                     // ← GATE 2
//       for (… of Array.from(dirty)) { n.isAttached && (n.render(), dirty.delete(n)) }
//   })
//   CanvasNode.attach = function () { … e.parentNode || t.canvasEl.appendChild(e); … }
//                                     // ← appends the card WITHOUT positioning it
//   CanvasNode.render = function () { … t.setCssStyles({ transform: "translate(…)" … }) }
//                                     // ← the ONLY writer of a card's position
//
// So the model and the pixels are written by TWO steps, and the second one is
// asynchronous and doubly conditional:
//
//   ├── GATE 1 — the frame must run at all. `requestAnimationFrame` is suspended
//   │   for a hidden or occluded window, and `requestFrame()` is guarded by
//   │   `if (this.frame)`, so nothing re-schedules while one is pending.
//   └── GATE 2 — the node must be ATTACHED when it does. `virtualize()` detaches
//       every card outside the viewport and re-attaches at most TEN per frame.
//       `render()` is skipped for a detached node.
//
// WHAT THIS FIX DOES AND DOES NOT CLAIM. Obsidian's own bookkeeping is better
// than `S193` assumed and this file says so rather than overselling the repair:
// the `dirty` set is only `.delete()`d for nodes that were actually rendered
// (`moved` is drained INTO `dirty` first, then cleared), so a repaint enqueued
// for a detached card is not forgotten — it is owed. `repaintNode` is therefore
// not "the missing repaint"; it is the SYNCHRONOUS one. It writes the position
// through `render()` in the same turn as the apply, so the pixels do not depend
// on a frame that may never run and on a `virtualize()` pass that may never
// re-attach the card while the user is looking at it.
//
// IT MUST NOT FIGHT THE USER. `render()` re-seats a card from the model, so on a
// card the local user is dragging or typing in it would yank the thing out from
// under their cursor. Every entry point consults the SAME predicate seam
// `applyNodeGeometry` does (`isDragTarget`) plus the WP37 editing flag, and
// answers `"interacting"` rather than acting. That is rule 10: one predicate,
// not a second one that can disagree with the first.
// ===========================================================================

/** What one repaint attempt did. Never a boolean — the reasons are not the same. */
export type RepaintOutcome =
  /** Repainted, AND the element was demonstrably in the wrong place before. */
  | "repaired"
  /** Repainted; the element already agreed (or its staleness was not readable). */
  | "repainted"
  /**
   * The card is DETACHED — `virtualize()` has it off screen. Nothing is painted,
   * so nothing can be visibly wrong; the repaint is enqueued through Obsidian's
   * own `markMoved` and will land when the card comes back. Deliberately NOT
   * `render()`: rendering a detached card can run `initialize()` and mount
   * content for a node the user cannot see, which on a large board is a real
   * cost paid for no pixel.
   */
  | "deferred"
  /** No `render()` on this private shape — enqueued through `markMoved` instead. */
  | "requested"
  /** The local user is dragging or typing in this exact card. Never touched. */
  | "interacting"
  | "missing"
  | "unsupported";

export type RepaintSource = "perNodeSeam" | "structuralSeam" | "sweep";

export interface RepaintSourceCounters {
  attempts: number;
  repairs: number;
  deferred: number;
  interacting: number;
}

/** One sweep tick's tally. Every field is a count of outcomes actually returned. */
export interface RepaintSweepTick {
  /** Ids the plan selected this tick. */
  visited: string[];
  /** Outcome counts, keyed by {@link RepaintOutcome}. */
  outcomes: Record<string, number>;
  /** `null` unless the whole tick was skipped, in which case: why. */
  skipped: "busy" | "no-nodes" | "unavailable" | null;
}

/** The sweep's whole history, for the diagnostic. Counts, never verdicts. */
export interface RepaintSweepReport {
  ticks: number;
  skippedBusy: number;
  skippedEmpty: number;
  visited: number;
  /**
   * THE NUMBER THAT MATTERS. How many times the sweep repainted a card whose
   * element was demonstrably in the wrong place. A sweep that silently hides the
   * defect would be worse than no sweep, because it would destroy the ability to
   * measure the cause; this counter is what keeps the damage rate observable.
   * Zero here on a board that looks correct is the honest "nothing to repair".
   */
  repaired: number;
  repainted: number;
  deferred: number;
  requested: number;
  interacting: number;
  missing: number;
  unsupported: number;
  /** Round-robin position, so a reader can see coverage advancing. */
  cursor: number;
  /** Ids waiting for a card that was off screen when its remote change landed. */
  pendingCount: number;
  /** The batch size the last tick used, and the node count it was derived from. */
  lastBatchSize: number;
  lastNodeCount: number;
  sources: Record<RepaintSource, RepaintSourceCounters>;
  structuralChangedIds: number;
  trigger: Record<string, unknown> | null;
}

/**
 * The translation of an inline `transform`, in px. `null` — never `{x:0,y:0}` —
 * for anything unreadable: a card at the origin is a real answer and must not be
 * manufactured out of "there was no transform".
 *
 * Only the spelling Obsidian's own `render()` writes is accepted
 * (`translate(<n>px, <n>px)`); a computed `matrix(...)` is deliberately NOT
 * parsed here, because this function's only job is to answer "did `render()`
 * write this, and with what", and `getComputedStyle` is not that witness.
 */
export function parseTranslatePx(text: unknown): { x: number; y: number } | null {
  if (typeof text !== "string") return null;
  const m =
    /translate\(\s*(-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)px\s*,\s*(-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)px/i.exec(
      text,
    );
  if (!m) return null;
  const x = Number.parseFloat(m[1]);
  const y = Number.parseFloat(m[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Ticks the sweep aims to need for one full pass over the board. */
export const REPAINT_SWEEP_TARGET_TICKS = 20;
/** Never fewer than this many cards per tick — a small board must still converge. */
export const REPAINT_SWEEP_MIN_BATCH = 3;
/** Never more than this many — the ceiling that keeps a huge board invisible. */
export const REPAINT_SWEEP_MAX_BATCH = 25;
/** The tick period main.ts drives the sweep at, in ms. */
export const REPAINT_SWEEP_PERIOD_MS = 1000;

/**
 * How far a card's painted position may sit from its model before the repaint is
 * counted as a REPAIR rather than a no-op. Obsidian `Math.round`s every geometry
 * it accepts (`moveAndResize`, `setData`), so both sides are integral in
 * practice; half a pixel is slack for a fractional value the plugin sent, not a
 * tolerance for real drift.
 */
export const REPAINT_STALE_TOL_PX = 0.5;

/**
 * Cards per tick for a board of `n` nodes.
 *
 * BOUNDED WORST-CASE REPAIR LATENCY IS THE WHOLE POINT, and it is why this is
 * not "a couple of random nodes each frame". Uniform random sampling has
 * coupon-collector coverage — `n ln n` draws for one full pass in expectation,
 * and NO bound at all on how long one particular card can stay broken. A
 * round-robin over a sorted id list repairs every card within
 * `ceil(n / batch)` ticks, always. On the 11-node test board that is one tick;
 * on a 500-node board it is 20 ticks (20 s at {@link REPAINT_SWEEP_PERIOD_MS}),
 * at a cost of 25 inline style writes per second.
 */
export function repaintBatchSize(n: number): number {
  if (n <= 0) return 0;
  const target = Math.ceil(n / REPAINT_SWEEP_TARGET_TICKS);
  return Math.min(REPAINT_SWEEP_MAX_BATCH, Math.max(REPAINT_SWEEP_MIN_BATCH, target));
}

/**
 * Which cards this tick repaints, and where the cursor lands. Pure — no DOM, no
 * canvas, no clock — so the coverage property is a unit test and not a claim.
 *
 * `priority` ids go FIRST and do not consume round-robin progress: they are the
 * cards whose remote change landed while they were off screen, so they are the
 * ones most likely to be wrong the moment they come back. Ids in `priority` that
 * are not (or no longer) live are dropped rather than carried forever.
 */
export function planRepaintSweep(input: {
  ids: readonly string[];
  cursor: number;
  batchSize: number;
  priority?: readonly string[];
}): { ids: string[]; cursor: number } {
  const live = [...input.ids].sort();
  const n = live.length;
  const batch = Math.max(0, Math.min(input.batchSize, n));
  if (n === 0 || batch === 0) return { ids: [], cursor: 0 };
  const liveSet = new Set(live);
  const picked: string[] = [];
  const seen = new Set<string>();
  // Priority is latency, never ownership. Reserve one slot for round-robin on
  // multi-node boards so a permanently detached priority set cannot starve the
  // rest of the board. A one-node board is both priority and round-robin.
  const priorityLimit = n > 1 ? Math.max(0, batch - 1) : batch;
  for (const id of input.priority ?? []) {
    if (picked.length >= priorityLimit) break;
    if (!liveSet.has(id) || seen.has(id)) continue;
    picked.push(id);
    seen.add(id);
  }
  // The round-robin resumes from the cursor and wraps exactly once, so no card
  // is visited twice in one tick even when the batch is the whole board.
  let cursor = Number.isInteger(input.cursor) && input.cursor >= 0 ? input.cursor % n : 0;
  for (let step = 0; step < n && picked.length < batch; step++) {
    const id = live[cursor];
    cursor = (cursor + 1) % n;
    if (seen.has(id)) continue;
    picked.push(id);
    seen.add(id);
  }
  return { ids: picked, cursor };
}

// ---- Private-shape typing (validated defensively at every access) -----------

interface CanvasNode {
  id?: string;
  nodeEl?: HTMLElement;
  /**
   * WP37 — Obsidian's own "this card's inline editor is open" flag. Present on
   * the real `CanvasTextNode`; validated defensively before every read, and its
   * absence is a defined answer ("this shape cannot tell us"), never a guess.
   */
  isEditing?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // Live reposition/resize of a node card (updates model + DOM). Present on the
  // real Obsidian CanvasNode; validated defensively before every call.
  //
  // ⚠ B72 — "updates model + DOM" is HALF TRUE and the half it gets wrong is the
  // whole of this batch. Obsidian's `moveAndResize` writes the four numbers and
  // calls `markMoved(this)`; it never touches `nodeEl`. The DOM half happens
  // later, in `render()`, inside a `requestAnimationFrame` and only for an
  // ATTACHED node. See the B72 block above.
  moveAndResize?: (geo: { x: number; y: number; width: number; height: number }) => void;
  /**
   * B72 — Obsidian's `CanvasNode.render()`: the ONLY writer of a card's inline
   * `transform` / `width` / `height`, i.e. the only thing that moves the pixels.
   * Normally called only by the canvas's `requestAnimationFrame` loop, and only
   * for attached nodes. Calling it directly is what makes a repaint synchronous.
   */
  render?: () => void;
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
  /** `log2(scale)`, clamped `[-4, 1]` — logarithmic, never a multiplier. */
  zoom?: number;
  /** The linear factor Obsidian renders with (`2 ** zoom`); may be absent. */
  scale?: number;
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
  //   markMoved(node)   → enqueue ONE node's repaint into the frame loop's set
  setData?: (data: unknown) => void;
  requestFrame?: () => void;
  requestSave?: () => void;
  /**
   * B72 — `Canvas.markMoved(node)`: `this.moved.add(node), this.requestFrame()`.
   * The enqueue half of the repaint, used when a synchronous `render()` is not
   * the right instrument (a detached card) or not available (shape drift).
   */
  markMoved?: (node: unknown) => void;
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

/** The canvas methods this adapter monkey-patches, in log order. */
type PatchName = "updateSelection" | "setDragging" | "markViewportChanged";
const PATCHED_METHODS: readonly PatchName[] = [
  "updateSelection",
  "setDragging",
  "markViewportChanged",
];

/** What happened (or would happen) to one patched method for a given adapter. */
type PatchOutcome = "installed" | "adopted" | "unavailable";

/**
 * INACTIVITY budget for the live-drag flag, in ms. The flag is set inside the
 * `setDragging` patch and cleared by the matching `setDragging(false)`; if that
 * closing call is never delivered, the flag would otherwise stay set for the whole
 * lifetime of the view and `isBusy()` would keep reporting a drag that is not
 * happening. This budget is therefore measured against the LAST drag-related signal
 * (`setDragging`, `markViewportChanged`, `pointermove`) and NOT against the drag's
 * total length: during a real drag those signals arrive continuously, so 5 s of
 * complete silence is far outside anything an in-progress drag produces.
 */
export const DRAG_WATCHDOG_MS = 5000;

/**
 * WP37 — INACTIVITY budget for the inline-editing flag, in ms.
 *
 * Why it must exist at all: an editing flag that is never cleared — the view is
 * swapped, the node is deleted under the editor, Obsidian's own focus handling
 * misses an exit — would freeze reconciliation for the whole life of the view.
 * **A permanently stale canvas is a worse defect than the one being fixed**, and
 * it would present as "sync stopped working".
 *
 * Why it is far longer than {@link DRAG_WATCHDOG_MS}: 5 s of silence is far
 * outside anything an in-progress drag produces, but well inside what a person
 * thinking mid-sentence produces. The budget is measured against the last
 * EDITING-related signal (focus, key, input, pointer), and releasing a real
 * editor because its owner paused would destroy exactly the characters this WP
 * exists to protect. The timeout is therefore a backstop; the primary release is
 * the POSITIVE liveness check in `editingActive()`, which fires immediately when
 * the node under the editor is gone.
 */
export const EDIT_WATCHDOG_MS = 120_000;

/**
 * WP37 — how often the adapter re-reads its own editing predicate WHILE an
 * editing session is open, in ms.
 *
 * It exists because the blur has to be noticed even when nothing else happens on
 * the board: the drain is what puts the withheld remote changes on the surface,
 * and a drain that only runs when the NEXT remote delta arrives is a stale view
 * with no bound. The poll is armed on focus and disarmed on release, so it costs
 * nothing outside an editing session.
 */
export const EDIT_POLL_MS = 400;

/** Optional status-console logger (shape matches DebugLogger / CanvasSyncLogger). */
export interface CanvasAdapterLogger {
  log(category: string, message: string): void;
  warn(category: string, message: string): void;
}

export interface CanvasAdapterOpts {
  /** Diagnostics sink for the `ADAPTER PATCH:` and `DRAG WATCHDOG:` signatures. */
  logger?: CanvasAdapterLogger;
  /**
   * WP37 — injected clock for the EDITING staleness budget, so its release is
   * asserted by advancing a clock and never by sleeping. Defaults to `Date.now`.
   *
   * Deliberately NOT wired into `dragActive()`: the drag watchdog's timing
   * behaviour is required to be byte-for-byte what it was, so it keeps reading
   * `Date.now()` directly and this option cannot reach it.
   */
  now?: () => number;
  /** Ask the lifecycle owner for one coalesced, event-driven sweep. */
  requestRepaintSweep?: () => void;
  getRepaintTriggerReport?: () => Record<string, unknown> | null;
}

/**
 * Build an adapter around an Obsidian canvas leaf view. `view` is deliberately
 * `unknown`; the private shape is validated defensively so a shape change can
 * never throw into the plugin. Patches are applied lazily (first subscription) and
 * ADOPT any patch a previous adapter over the same canvas already owns, so the
 * newest adapter for a canvas always has live patches.
 */
export function createCanvasAdapter(view: unknown, opts: CanvasAdapterOpts = {}): CanvasAdapter {
  const logger = opts.logger;
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const requestRepaintSweep = opts.requestRepaintSweep;
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
  // Watchdog bookkeeping: timestamp of the last drag-related signal, and a one-shot
  // guard so a released flag logs once per drag rather than once per poll (US6 AC5).
  let lastDragSignalAt = 0;
  let watchdogLogged = false;
  // WP37 — live inline-editing state. `editingNodeId` is the card whose editor
  // holds focus; `lastEditSignalAt` is the watchdog's reference point; the
  // one-shot guard mirrors `watchdogLogged` so a released flag warns once per
  // editing session rather than once per poll.
  let editingNodeId: string | null = null;
  let lastEditSignalAt = 0;
  let editWatchdogLogged = false;
  let editingPoll: ReturnType<typeof setInterval> | null = null;
  const editingEndListeners = new Set<(nodeId: string) => void>();
  // Disposers for physical patches / DOM listeners (installed once, lazily).
  const unpatchers: Array<() => void> = [];
  const patchState = {
    selection: false,
    dragging: false,
    viewport: false,
    pointer: false,
    editing: false,
  };

  // ---- B72 (WP2/WP3) — repaint state, all of it per-adapter ----------------
  //
  // Ids whose remote change landed while the card was DETACHED (off screen). The
  // sweep drains this first, so a card comes back already correct instead of
  // waiting for its turn in the round-robin. Bounded by the node count: an entry
  // is removed when the node is repainted or when it stops existing.
  const repaintPending = new Set<string>();
  let sweepCursor = 0;
  const sweepCounters = {
    ticks: 0,
    skippedBusy: 0,
    skippedEmpty: 0,
    visited: 0,
    repaired: 0,
    repainted: 0,
    deferred: 0,
    requested: 0,
    interacting: 0,
    missing: 0,
    unsupported: 0,
    lastBatchSize: 0,
    lastNodeCount: 0,
  };
  const sourceCounters: Record<RepaintSource, RepaintSourceCounters> = {
    perNodeSeam: { attempts: 0, repairs: 0, deferred: 0, interacting: 0 },
    structuralSeam: { attempts: 0, repairs: 0, deferred: 0, interacting: 0 },
    sweep: { attempts: 0, repairs: 0, deferred: 0, interacting: 0 },
  };
  let structuralChangedIds = 0;

  /** Record one repaint outcome and hand it straight back. Counting is not deciding. */
  function tallyRepaint(outcome: RepaintOutcome, source: RepaintSource): RepaintOutcome {
    sweepCounters[outcome]++;
    const counters = sourceCounters[source];
    counters.attempts++;
    if (outcome === "repaired") counters.repairs++;
    if (outcome === "deferred") counters.deferred++;
    if (outcome === "interacting") counters.interacting++;
    return outcome;
  }

  /**
   * Obsidian's own enqueue, for the two cases a synchronous `render()` is the
   * wrong instrument. `markMoved` puts the node in the frame loop's `moved` set,
   * which that loop drains into `dirty` and only clears per RENDERED node — so an
   * enqueue for a detached card is owed, not lost. `requestFrame` alone would
   * schedule a frame that renders nothing new.
   */
  function enqueueRepaint(node: CanvasNode): void {
    const c = canvas as PrivateCanvas | undefined;
    try {
      if (typeof c?.markMoved === "function") c.markMoved(node);
      else c?.requestFrame?.();
    } catch {
      /* a private shape that refuses is not a reason to fail an apply */
    }
  }

  /** Refresh the watchdog: a real drag-related signal reached the adapter. */
  function noteDragSignal(): void {
    lastDragSignalAt = Date.now();
  }

  /**
   * Watchdog-aware live-drag predicate — the single seam `isBusy()`,
   * `applyNodeGeometry()` and `reloadCanvasData()` all consult instead of reading the
   * raw flag. When the flag is set but no drag-related signal arrived for a whole
   * {@link DRAG_WATCHDOG_MS} window, the flag is released here and one
   * `DRAG WATCHDOG:` warn is emitted. `dragTargetId` is deliberately RETAINED so the
   * one card the user may still be holding stays protected while whole-canvas
   * reconciliation becomes possible again.
   */
  function dragActive(): boolean {
    if (!isDragging) return false;
    const idleFor = Date.now() - lastDragSignalAt;
    if (idleFor < DRAG_WATCHDOG_MS) return true;
    isDragging = false;
    if (!watchdogLogged) {
      watchdogLogged = true;
      logger?.warn(
        "canvas-adapter",
        `DRAG WATCHDOG: isDragging released after ${idleFor}ms with no drag signal ` +
          `(limit ${DRAG_WATCHDOG_MS}ms); dragTargetId=${dragTargetId ?? "none"} retained`,
      );
    }
    return false;
  }

  /**
   * True when `nodeId` is the node the local user is — or may still be — holding.
   * Sweeps the watchdog first, then compares against `dragTargetId`, which outlives a
   * watchdog release and is cleared only by a genuine `setDragging(false)`.
   */
  function isDragTarget(nodeId: string): boolean {
    dragActive();
    return dragTargetId === nodeId;
  }

  // ---- WP37: the inline-editing signal ------------------------------------
  //
  // Detected in the DOM rather than by patching a per-node method, and that is a
  // decision, not a shortcut. Canvas nodes are created and destroyed by
  // `setData`, so a per-node patch would have to be re-installed on every reload
  // — i.e. exactly at the moment this WP exists to survive — and a node whose
  // patch was missed would report "not editing" while the user is typing in it.
  // A `focusin` listener on the canvas WRAPPER catches every editor, including
  // ones created after this adapter was built, because focus bubbles.
  //
  // The discriminator is `isContentEditable` (or an input/textarea): merely
  // SELECTING a card focuses the card element, which is not an editing session
  // and must not switch reconciliation off.

  /** Refresh the editing watchdog: a real editing-related signal reached the adapter. */
  function noteEditSignal(): void {
    lastEditSignalAt = now();
  }

  /** Is `target` an element the user can type into? */
  function isEditableTarget(target: unknown): boolean {
    if (!target || typeof target !== "object") return false;
    const el = target as { isContentEditable?: unknown; tagName?: unknown };
    if (el.isContentEditable === true) return true;
    const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
    return tag === "INPUT" || tag === "TEXTAREA";
  }

  /** The canvas node whose element contains `target`, or null. */
  function nodeIdContaining(target: unknown): string | null {
    if (!(canvas?.nodes instanceof Map) || !target) return null;
    for (const [id, node] of canvas.nodes) {
      const el = node?.nodeEl as { contains?: (n: unknown) => boolean } | undefined;
      if (!el || typeof el.contains !== "function") continue;
      try {
        if (el.contains(target)) return typeof id === "string" ? id : null;
      } catch {
        /* a node element that cannot answer is not the one holding focus */
      }
    }
    return null;
  }

  /**
   * WP37 — keep the editing flag honest without needing a DOM event.
   *
   * MEASURED (run 034401): with the flag detected correctly, the BLUR was still
   * never noticed, so a held queue was never drained and a card the peer added
   * stayed off the canvas for good. The reason is that the release only ran when
   * something consulted the predicate, and the only consumer is a reconcile pass
   * — which arrives when a REMOTE delta arrives, i.e. exactly never once the
   * board has gone quiet.
   *
   * The DOM listeners were supposed to cover that, and they cannot be relied on:
   * they are installed on `canvas.wrapperEl`, which the private shape does not
   * always expose, and the card's editor is not reachable through a
   * `contenteditable` selector at all on this build.
   *
   * So while — and ONLY while — an editing session is open, the adapter polls its
   * own predicate. It is self-limiting (started on focus, stopped on release and
   * on destroy), it is the same seam every other consultation uses, and it is
   * `unref`ed so it can never hold a process open.
   */
  function armEditingPoll(): void {
    if (editingPoll !== null || typeof setInterval !== "function") return;
    editingPoll = setInterval(() => {
      if (editingNodeId === null) {
        disarmEditingPoll();
        return;
      }
      editingActive();
    }, EDIT_POLL_MS);
    (editingPoll as unknown as { unref?: () => void }).unref?.();
  }

  function disarmEditingPoll(): void {
    if (editingPoll === null) return;
    clearInterval(editingPoll);
    editingPoll = null;
  }

  /** Clear the editing flag and tell every subscriber, exactly once per session. */
  function releaseEditing(reason: string | null): void {
    const released = editingNodeId;
    editingNodeId = null;
    editWatchdogLogged = false;
    disarmEditingPoll();
    if (reason !== null) {
      logger?.warn(
        "canvas-adapter",
        `EDIT WATCHDOG: editing flag released for node=${released ?? "none"} — ${reason}`,
      );
    }
    if (released !== null) {
      for (const cb of editingEndListeners) {
        try {
          cb(released);
        } catch {
          /* a subscriber must never break focus handling */
        }
      }
    }
  }

  /**
   * PULL the editing state out of the DOM, rather than waiting to be told.
   *
   * MEASURED, and it is why this exists: on a live instance the editor is
   * routinely focused BEFORE this adapter is mounted (a canvas leaf opens and the
   * user — or the rig — clicks straight into a card, while the plugin's own
   * layout-change handler has not run yet). An event-only signal misses that
   * focus and then reports "nothing is being edited" for the whole session, which
   * is indistinguishable from the defect this WP fixes. Measured on the live rig,
   * run 033302: the event-only build deferred nothing at all.
   *
   * So the flag is a MEASUREMENT taken on every consultation, and the `focusin` /
   * `focusout` listeners are a fast path on top of it, not the source of truth.
   *
   * Returns `available: false` when there is no DOM to read — a headless double,
   * a private shape without `wrapperEl`. In that case the caller must NOT treat
   * "no editor found" as "no editor", or the direct `noteEditingFocus` seam would
   * be overruled by an absence of evidence (I11).
   */
  function probeEditingNode(): { available: boolean; nodeId: string | null } {
    // PRIMARY — Obsidian's own answer. A canvas node carries `isEditing`, which
    // is exactly "this card's inline editor is open" as the canvas itself
    // understands it. Measured on the live rig: this is `true` for the whole
    // editing session, while `nodeEl.querySelector("[contenteditable]")` finds
    // NOTHING inside the card (run 031340, `contenteditableFound: false`) — so a
    // DOM-shape discriminator alone reports "nothing is being edited" while the
    // user is typing, which is indistinguishable from the defect.
    let sawIsEditing = false;
    if (canvas?.nodes instanceof Map) {
      for (const [id, node] of canvas.nodes) {
        const flag = (node as { isEditing?: unknown } | undefined)?.isEditing;
        if (typeof flag !== "boolean") continue;
        sawIsEditing = true;
        if (flag === true && typeof id === "string" && id.length > 0) {
          return { available: true, nodeId: id };
        }
      }
    }
    // FALLBACK — the focused element, for a private shape that does not expose
    // `isEditing`. Kept because I5 says degrade, never break.
    const wrapper = canvas?.wrapperEl as { ownerDocument?: unknown } | undefined;
    const doc = wrapper?.ownerDocument as { activeElement?: unknown } | undefined;
    if (doc && typeof doc === "object" && "activeElement" in doc) {
      const active = doc.activeElement;
      if (isEditableTarget(active)) {
        const id = nodeIdContaining(active);
        if (id !== null) return { available: true, nodeId: id };
      }
      return { available: true, nodeId: null };
    }
    // `sawIsEditing` without a `true` is still an ANSWER: every card reported
    // "not editing". Without either mechanism there is no answer at all, and the
    // caller must then not read absence as evidence.
    return { available: sawIsEditing, nodeId: null };
  }

  /**
   * Reconcile the flag with the DOM. Called at the head of `editingActive()`, so
   * every consultation of the editing arm is a fresh measurement.
   */
  function syncEditingFromDom(): void {
    const probe = probeEditingNode();
    if (!probe.available) return;
    if (probe.nodeId !== null) {
      if (editingNodeId !== null && editingNodeId !== probe.nodeId) releaseEditing(null);
      if (editingNodeId !== probe.nodeId) editWatchdogLogged = false;
      editingNodeId = probe.nodeId;
      noteEditSignal();
      armEditingPoll();
      return;
    }
    // The DOM is readable and says nothing editable inside a card has focus.
    // That is EVIDENCE of a blur, not an absence of evidence, so it releases —
    // and firing the subscribers here is what makes the blur drain work even
    // when `focusout` was never delivered.
    if (editingNodeId !== null) releaseEditing(null);
  }

  /**
   * Watchdog-aware inline-editing predicate — the single seam `isBusy()` and
   * `getEditingNodeId()` both consult instead of reading the raw flag.
   *
   * TWO releases, and the order is the point:
   *
   *   ├── POSITIVE LIVENESS, first and immediate — the card under the editor is
   *   │   no longer in the live node map. That happens whenever the view is
   *   │   rebuilt or the node is deleted remotely, and waiting out a timeout for
   *   │   it would leave reconciliation switched off for a card that is gone.
   *   └── INACTIVITY, second — no editing-related signal for a whole
   *       {@link EDIT_WATCHDOG_MS} window. The backstop for an exit path
   *       Obsidian's private focus handling never told us about.
   *
   * Both emit `EDIT WATCHDOG:`, deliberately distinct from `DRAG WATCHDOG:` so
   * the two can never be confused in a log, and both fire the blur subscribers —
   * a released editor must drain its queue exactly like a real blur.
   */
  function editingActive(): boolean {
    // Measure first; the listeners are an optimisation, not the oracle.
    syncEditingFromDom();
    if (editingNodeId === null) return false;
    if (canvas?.nodes instanceof Map && !canvas.nodes.has(editingNodeId)) {
      if (!editWatchdogLogged) editWatchdogLogged = true;
      releaseEditing(`node '${editingNodeId}' is no longer in the live canvas`);
      return false;
    }
    const idleFor = now() - lastEditSignalAt;
    if (idleFor < EDIT_WATCHDOG_MS) return true;
    if (!editWatchdogLogged) editWatchdogLogged = true;
    releaseEditing(
      `no editing signal for ${idleFor}ms (limit ${EDIT_WATCHDOG_MS}ms)`,
    );
    return false;
  }

  /**
   * Install the focus/keystroke listeners, once, lazily — the same discipline
   * every other patch in this file follows, with its disposer in `unpatchers`.
   */
  function ensureEditingPatch(): void {
    if (patchState.editing) return;
    patchState.editing = true;
    const wrapper = canvas?.wrapperEl;
    if (!wrapper || typeof wrapper.addEventListener !== "function") return;

    const onFocusIn = (e: Event) => {
      const target = (e as unknown as { target?: unknown }).target;
      if (!isEditableTarget(target)) return;
      const id = nodeIdContaining(target);
      if (id === null) return;
      noteEditSignal();
      editWatchdogLogged = false;
      if (editingNodeId !== null && editingNodeId !== id) {
        // Focus moved straight from one card's editor to another's: the first
        // one really did end, and its queue must drain.
        releaseEditing(null);
      }
      editingNodeId = id;
      armEditingPoll();
    };
    const onFocusOut = (e: Event) => {
      const related = (e as unknown as { relatedTarget?: unknown }).relatedTarget;
      // Focus moving to another editor inside a card is not an exit; `focusin`
      // will re-aim the flag. Anything else is a genuine blur.
      if (isEditableTarget(related) && nodeIdContaining(related) !== null) return;
      releaseEditing(null);
    };
    const onEditSignal = () => {
      if (editingNodeId !== null) noteEditSignal();
    };

    wrapper.addEventListener("focusin", onFocusIn, true);
    wrapper.addEventListener("focusout", onFocusOut, true);
    wrapper.addEventListener("keydown", onEditSignal, true);
    wrapper.addEventListener("beforeinput", onEditSignal, true);
    unpatchers.push(() => {
      wrapper.removeEventListener("focusin", onFocusIn, true);
      wrapper.removeEventListener("focusout", onFocusOut, true);
      wrapper.removeEventListener("keydown", onEditSignal, true);
      wrapper.removeEventListener("beforeinput", onEditSignal, true);
    });
  }

  /**
   * TEST/PRIVATE SEAM — the two facts the DOM listeners would deliver, delivered
   * directly. It exists because the truth table in C37 AC1 has to be asserted row
   * by row without a browser, and because a live instance can be asked to report
   * its editing state through the same seam it uses in production.
   *
   * It is a REPORT, never a decision: it sets the same flag `focusin` sets and
   * goes through the same `editingActive()` release on every read.
   */
  function noteEditingFocus(nodeId: string | null): void {
    ensureEditingPatch();
    if (nodeId === null) {
      releaseEditing(null);
      return;
    }
    noteEditSignal();
    editWatchdogLogged = false;
    if (editingNodeId !== null && editingNodeId !== nodeId) releaseEditing(null);
    editingNodeId = nodeId;
    armEditingPoll();
  }

  function viewport(): CanvasViewport | null {
    if (!hasCanvas) return null;
    const { x, y, zoom, scale } = canvas as PrivateCanvas;
    if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return null;
    // `scale` is the linear factor when the private shape exposes it; otherwise it is
    // omitted and consumers derive `2 ** zoom` via viewportScale().
    return typeof scale === "number" && Number.isFinite(scale)
      ? { x, y, zoom, scale }
      : { x, y, zoom };
  }

  /**
   * Classify what patching `name` on this canvas means right now, WITHOUT mutating
   * anything: `unavailable` when the private shape has no such method, `adopted` when
   * some adapter already owns it (a duplicate or re-mount over the same `view.canvas`),
   * `installed` when the method is still pristine. Single source of truth for both the
   * `ADAPTER PATCH:` diagnostics line and `patch()`'s own decision.
   */
  function classifyPatch(name: PatchName): PatchOutcome {
    if (!hasCanvas) return "unavailable";
    const fn = (canvas as unknown as Record<string, PatchedFn | undefined>)[name];
    if (typeof fn !== "function") return "unavailable";
    return fn.__lsWrapped === true ? "adopted" : "installed";
  }

  function patch(name: PatchName, after: (args: unknown[]) => void): void {
    if (!hasCanvas) return;
    const c = canvas as unknown as Record<string, PatchedFn | undefined>;
    const existing = c[name];
    if (typeof existing !== "function") return;
    // ADOPTION (US4 AC14): an early return here would leave THIS adapter with no
    // patch at all — invisible to every drag/selection signal — whenever another
    // adapter over the same `view.canvas` got there first. Instead, unwrap the
    // existing marked wrapper via its `__lsOriginal` and re-wrap the pristine
    // method, so the newest adapter always owns the patch and no wrapper stacking
    // (and no double invocation of the original) can accumulate. If the marker is
    // present but the stored original is not usable, wrap what is there: never lose
    // the method, and never leave this adapter patch-less.
    const adopted = classifyPatch(name) === "adopted";
    const unwrapped = adopted ? existing.__lsOriginal : undefined;
    const original: AnyFn = typeof unwrapped === "function" ? unwrapped : existing;
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
      // Track live-drag state for reconciliation deferral. Either edge is a drag
      // signal, so it also refreshes the watchdog and re-arms its one-shot warn:
      // a genuine setDragging(false) leaves no stale flag and no stale target.
      noteDragSignal();
      watchdogLogged = false;
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
      // Pan/zoom is real interaction: refresh the watchdog so a long but ACTIVE drag
      // never trips it (US4 AC10). Harmless outside a drag — the timestamp is only
      // read while the drag flag is set.
      noteDragSignal();
      for (const cb of viewportListeners) cb();
    });
  }

  // Mount observability (US4 AC17 / US6): exactly ONE line per adapter construction,
  // naming the patch outcome per method as classified by the same rule `patch()`
  // applies. `adopted` on any method is the greppable signal that this canvas was
  // already owned by another adapter — i.e. a duplicate or repeated mount — and
  // `unavailable` names a private-shape member that is simply not there. Path-
  // independent by construction: the adapter never learns the file path.
  logger?.log(
    "canvas-adapter",
    `ADAPTER PATCH: ${PATCHED_METHODS.map((n) => `${n}=${classifyPatch(n)}`).join(" ")}`,
  );

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
      // WP37: and the editing listeners, for the same reason.
      ensureEditingPatch();
      // Watchdog-aware, never the raw flag (US4 AC9): a drag flag that stopped being
      // refreshed is released here rather than blocking every future reconcile.
      //
      // WP37 — the second arm, ADDED beside the first and never merged into it.
      // Order matters only for the releases: both seams must be swept on every
      // call, so `||` short-circuiting must not skip the editing sweep. It does
      // not: `dragActive()` runs first and `editingActive()` runs whenever the
      // drag arm is false, which is every case in which the editing flag could
      // be the one holding reconciliation off.
      const dragging = dragActive();
      const editing = editingActive();
      return dragging || editing;
    },

    // ---- WP37 --------------------------------------------------------------

    getEditingNodeId(): string | null {
      ensureEditingPatch();
      // Sweep the release first: a caller must never see an id `isBusy()` would
      // already have retired, or the deferral would hold a queue for a card that
      // is not being edited any more.
      return editingActive() ? editingNodeId : null;
    },

    getNodeFields(nodeId: string): Record<string, unknown> | null {
      const node = canvas?.nodes?.get(nodeId) as
        | (CanvasNode & { getData?: () => unknown; text?: unknown; color?: unknown; type?: unknown })
        | undefined;
      if (!node) return null;
      // Obsidian's own `getData()` is the authoritative read: it returns the
      // record this card would be serialised as. Preferred over assembling one
      // from members, because an assembled record can silently omit a field and
      // a substitution built from it would then DELETE that field from the view.
      const getData = (node as { getData?: unknown }).getData;
      if (typeof getData === "function") {
        try {
          const data = (getData as () => unknown).call(node);
          if (data && typeof data === "object" && !Array.isArray(data)) {
            return { ...(data as Record<string, unknown>) };
          }
        } catch {
          /* fall through to the member read */
        }
      }
      // Fallback: the members this adapter already knows are on the private
      // shape. Deliberately does NOT invent keys — a caller that gets this
      // partial record must treat it as partial, which `planEditingDeferral`
      // does by comparing over the union of both records' keys.
      const fields: Record<string, unknown> = { id: nodeId };
      for (const key of ["x", "y", "width", "height", "text", "type", "color"] as const) {
        const value = (node as unknown as Record<string, unknown>)[key];
        if (value !== undefined) fields[key] = value;
      }
      return fields;
    },

    onEditingEnd(cb: (nodeId: string) => void): () => void {
      ensureEditingPatch();
      editingEndListeners.add(cb);
      return () => editingEndListeners.delete(cb);
    },

    noteEditingFocus(nodeId: string | null): void {
      noteEditingFocus(nodeId);
    },

    // ---- WP87 (C87 AC1) — the attribution instrument ------------------------
    //
    // READ-ONLY AND NON-MUTATING, and both halves matter. It does not call
    // `editingActive()` / `getEditingNodeId()`, because those SWEEP: a sweep can
    // release the flag and fire the blur subscribers, and the blur subscriber is
    // WP37's drain — i.e. reading the instrument would trigger route R-D while
    // measuring for it. It does not call `ensureEditingPatch()` either, so it
    // cannot install a listener that was not already there.
    //
    // It is NOT a second editing predicate (rule 10): it returns no verdict, and
    // no production decision consults it. `probeEditingNode()` is the SAME probe
    // the real predicate uses — invoked, not re-implemented.
    describeEditingSignal(): EditingSignalReport {
      const probe = probeEditingNode();
      const isEditingIds: string[] = [];
      let isEditingSeen = false;
      if (canvas?.nodes instanceof Map) {
        for (const [id, node] of canvas.nodes) {
          const flag = (node as { isEditing?: unknown } | undefined)?.isEditing;
          if (typeof flag !== "boolean") continue;
          isEditingSeen = true;
          if (flag === true && typeof id === "string" && id.length > 0) isEditingIds.push(id);
        }
      }
      return {
        flag: editingNodeId,
        probeAvailable: probe.available,
        probeNodeId: probe.nodeId,
        isEditingSeen,
        isEditingIds,
        idleMs: now() - lastEditSignalAt,
        watchdogMs: EDIT_WATCHDOG_MS,
        pollArmed: editingPoll !== null,
        editingEndListeners: editingEndListeners.size,
        flaggedNodeLive:
          editingNodeId === null
            ? null
            : canvas?.nodes instanceof Map
              ? canvas.nodes.has(editingNodeId)
              : null,
      };
    },

    applyNodeGeometry(
      nodeId: string,
      geo: NodeGeometry,
    ): "applied" | "unchanged" | "interacting" | "missing" | "unsupported" {
      ensureDraggingPatch();
      const node = canvas?.nodes?.get(nodeId);
      if (!node) return "missing";
      // Never fight the user's own in-progress drag of THIS node. Routed through the
      // same watchdog-aware seam as isBusy() (US4 AC12), so consulting it also
      // releases a flag that stopped being refreshed — while the retained
      // `dragTargetId` keeps protecting this one card (US4 AC11).
      if (isDragTarget(nodeId)) return "interacting";
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

    // ---- B72 (WP2/WP3) — the repaint half of an apply ----------------------

    repaintNode(nodeId: string, source: RepaintSource = "perNodeSeam"): RepaintOutcome {
      const node = canvas?.nodes?.get(nodeId);
      if (!node) {
        repaintPending.delete(nodeId);
        return tallyRepaint("missing", source);
      }
      // THE ONE DEFINER, not a second predicate (rule 10). `classifyBusyGate` is
      // the same pure classifier `main.ts#reconcileLiveCanvas` and
      // `main.ts#applyCanvasNodeRevert` execute, fed from the same two measured
      // facts. A repaint re-seats a card from the model, and WP37 MEASURED that
      // re-seating a card with an open inline editor destroys its unflushed
      // text — so this refuses on the same verdicts the applies refuse on, and
      // it refuses by returning rather than by acting differently.
      const gate = classifyBusyGate({
        busy: this.isBusy(),
        editingNodeId: this.getEditingNodeId?.() ?? null,
      });
      if (gate === "defer-drag" || gate === "editing") return tallyRepaint("interacting", source);
      // …and the per-card arm on top of the board-wide one, exactly as
      // `applyNodeGeometry` has it: `dragTargetId` OUTLIVES a watchdog release,
      // so the one card the user may still be holding stays protected after the
      // board-wide flag has been let go.
      if (isDragTarget(nodeId)) return tallyRepaint("interacting", source);

      const el = node.nodeEl as (HTMLElement & { parentNode?: unknown }) | undefined;
      const attached = !!el?.parentNode;
      if (!attached) {
        // Off screen. Nothing is painted for this card, so nothing can be
        // visibly wrong — and `render()` here would risk mounting content for a
        // node the user cannot see. Enqueue instead, and remember the id so the
        // sweep repaints it first when it comes back (bounded by node count).
        repaintPending.add(nodeId);
        enqueueRepaint(node);
        // A sweep finding the same off-screen card must not recursively schedule
        // itself forever. Apply seams request recovery; the periodic clock gives
        // a detached card later opportunities after it becomes visible.
        if (source !== "sweep") requestRepaintSweep?.();
        return tallyRepaint("deferred", source);
      }
      if (typeof node.render !== "function") {
        enqueueRepaint(node);
        return tallyRepaint("requested", source);
      }
      // Was it demonstrably wrong BEFORE we touched it? Read first, repaint
      // second — this is the only moment the answer exists, and it is what makes
      // the sweep's "repairs" counter a measurement rather than a claim.
      const before = parseTranslatePx(
        (el as unknown as { style?: { transform?: unknown } } | undefined)?.style?.transform,
      );
      const stale =
        typeof node.x === "number" && typeof node.y === "number"
          ? before === null ||
            Math.abs(before.x - node.x) > REPAINT_STALE_TOL_PX ||
            Math.abs(before.y - node.y) > REPAINT_STALE_TOL_PX
          : false;
      try {
        node.render();
      } catch {
        return tallyRepaint("unsupported", source);
      }
      repaintPending.delete(nodeId);
      return tallyRepaint(stale ? "repaired" : "repainted", source);
    },

    sweepRepaint(): RepaintSweepTick {
      sweepCounters.ticks++;
      const empty: RepaintSweepTick = { visited: [], outcomes: {}, skipped: null };
      if (!this.isAvailable()) {
        return { ...empty, skipped: "unavailable" };
      }
      // NEVER while the user is interacting — the same rule WP2 follows, and the
      // reason a fix that makes dragging feel worse is a regression even if the
      // board converges. `isBusy()` is the watchdog-aware seam, so a stuck flag
      // cannot switch the sweep off for the lifetime of the view.
      if (this.isBusy()) {
        sweepCounters.skippedBusy++;
        return { ...empty, skipped: "busy" };
      }
      const ids = [...this.getLiveNodeIds()];
      sweepCounters.lastNodeCount = ids.length;
      const batchSize = repaintBatchSize(ids.length);
      sweepCounters.lastBatchSize = batchSize;
      if (ids.length === 0) {
        sweepCounters.skippedEmpty++;
        return { ...empty, skipped: "no-nodes" };
      }
      const plan = planRepaintSweep({
        ids,
        cursor: sweepCursor,
        batchSize,
        priority: [...repaintPending],
      });
      sweepCursor = plan.cursor;
      const outcomes: Record<string, number> = {};
      for (const id of plan.ids) {
        const outcome = this.repaintNode?.(id, "sweep") ?? "unsupported";
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      sweepCounters.visited += plan.ids.length;
      return { visited: plan.ids, outcomes, skipped: null };
    },

    describeRepaintSweep(): RepaintSweepReport {
      return {
        ...sweepCounters,
        cursor: sweepCursor,
        pendingCount: repaintPending.size,
        sources: {
          perNodeSeam: { ...sourceCounters.perNodeSeam },
          structuralSeam: { ...sourceCounters.structuralSeam },
          sweep: { ...sourceCounters.sweep },
        },
        structuralChangedIds,
        trigger: opts.getRepaintTriggerReport?.() ?? null,
      };
    },

    reloadCanvasData(data: unknown): boolean {
      // Never yank the view out from under an ACTIVE drag — watchdog-aware, never the
      // raw flag (US4 AC12), so a flag nobody refreshed can no longer keep structural
      // reloads switched off for the lifetime of the view.
      if (dragActive()) return false;
      const c = canvas as PrivateCanvas | undefined;
      if (!c || typeof c.setData !== "function") return false;
      const handed = (data as { nodes?: unknown } | null | undefined)?.nodes;
      const changed: string[] = [];
      if (Array.isArray(handed)) {
        for (const record of handed) {
          if (!record || typeof record !== "object") continue;
          const r = record as Record<string, unknown>;
          if (typeof r.id !== "string") continue;
          const live = c.nodes?.get(r.id);
          if (!live) continue;
          if (
            typeof r.x === "number" && typeof r.y === "number" &&
            typeof r.width === "number" && typeof r.height === "number" &&
            (live.x !== r.x || live.y !== r.y || live.width !== r.width || live.height !== r.height)
          ) changed.push(r.id);
        }
      }
      try {
        c.setData(data);
        structuralChangedIds += changed.length;
        for (const id of changed) this.repaintNode?.(id, "structuralSeam");
        requestRepaintSweep?.();
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
        // Pointer movement over the canvas is the primary drag-related signal: it
        // refreshes the watchdog first, unconditionally, so an active drag never trips
        // it even when the coordinate mapping fails (US4 AC10).
        noteDragSignal();
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
      // WP37 — the TEARDOWN exit of the blur guard. Subscribers are notified
      // BEFORE the listener sets are cleared, so a queue held for an editor that
      // is being torn down drains instead of outliving the adapter that produced
      // it. Silent when nothing was being edited.
      releaseEditing(null);
      disarmEditingPoll();
      startListeners.clear();
      endListeners.clear();
      viewportListeners.clear();
      editingEndListeners.clear();
      held.clear();
      // B72 — a detached adapter must not keep a queue of ids for a view it can
      // no longer paint. The COUNTERS are left alone on purpose: they are this
      // adapter's record of what it did, and a torn-down adapter reporting zero
      // repairs it actually made would be the "sweep that cannot be shown to
      // work" this package exists to avoid.
      repaintPending.clear();
      sweepCursor = 0;
      patchState.selection = false;
      patchState.dragging = false;
      patchState.viewport = false;
      patchState.pointer = false;
      patchState.editing = false;
      // A detached adapter must not keep reporting a drag it can no longer observe.
      isDragging = false;
      dragTargetId = null;
      watchdogLogged = false;
      // …nor an edit.
      editingNodeId = null;
      lastEditSignalAt = 0;
      editWatchdogLogged = false;
    },
  };
}
