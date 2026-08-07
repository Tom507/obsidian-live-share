import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CanvasViewport,
  DRAG_WATCHDOG_MS,
  canvasToScreenRel,
  clientToCanvasManual,
  createCanvasAdapter,
  viewportScale,
} from "../canvas/canvas-adapter";

// The DOM/patch layer of the adapter (monkey-patching updateSelection/setDragging/
// markViewportChanged, pointer listeners) is inherently NOT unit-testable in a
// node environment — it requires a live Obsidian canvas instance. These tests
// cover the pure canvas <-> screen transform math, which is the version-fragile
// part most likely to regress silently.

// CORRECTED (US1 AC7): the old fixture was `{ x: 100, y: 50, zoom: 2 }`, written on
// the assumption that `zoom` is a multiplier. In Obsidian `zoom` is `log2(scale)`
// clamped to `[-4, 1]`, so `zoom: 2` is both a 4x factor AND an impossible viewport.
// This is a real 200 % viewport: zoom 1 with the linear factor Obsidian reports.
const VP: CanvasViewport = { x: 100, y: 50, zoom: 1, scale: 2 };
const SIZE = { width: 800, height: 600 };
const RECT = { left: 0, top: 0, width: 800, height: 600 };

describe("canvas <-> screen transforms", () => {
  it("canvasToScreenRel places the viewport origin at the wrapper center", () => {
    const s = canvasToScreenRel(VP.x, VP.y, VP, SIZE);
    expect(s).toEqual({ x: SIZE.width / 2, y: SIZE.height / 2 });
  });

  // CORRECTED (US1 AC7): was "canvasToScreenRel scales by live zoom", which asserted a
  // x2 factor for `zoom: 2`. The factor is the LINEAR scale, never `vp.zoom` itself.
  it("canvasToScreenRel scales by the linear factor, not by vp.zoom", () => {
    // VP is 200 % (scale 2): a point 10 canvas-units right of origin lands 20 px right.
    const s = canvasToScreenRel(VP.x + 10, VP.y + 5, VP, SIZE);
    expect(s).toEqual({ x: SIZE.width / 2 + 20, y: SIZE.height / 2 + 10 });

    // And with no explicit scale, the old fixture's `zoom: 2` is a x4 factor — the
    // arithmetic the previous assertion got wrong.
    const derived: CanvasViewport = { x: 100, y: 50, zoom: 2 };
    const s4 = canvasToScreenRel(derived.x + 10, derived.y + 5, derived, SIZE);
    expect(s4).toEqual({ x: SIZE.width / 2 + 40, y: SIZE.height / 2 + 20 });
  });

  it("US1 AC2: the linear factor is canvas.scale when finite, else 2 ** zoom", () => {
    expect(viewportScale({ x: 0, y: 0, zoom: 0 })).toBe(1);
    expect(viewportScale({ x: 0, y: 0, zoom: -1 })).toBe(0.5);
    expect(viewportScale({ x: 0, y: 0, zoom: -4 })).toBe(0.0625);
    expect(viewportScale({ x: 0, y: 0, zoom: 1 })).toBe(2);
    // An explicit scale wins over the derived value...
    expect(viewportScale({ x: 0, y: 0, zoom: 0, scale: 3 })).toBe(3);
    // ...but a non-finite one is treated as absent (private-shape drift).
    expect(viewportScale({ x: 0, y: 0, zoom: 1, scale: Number.NaN })).toBe(2);
  });

  it("clientToCanvasManual inverts canvasToScreenRel (round-trip)", () => {
    const cx = 137;
    const cy = -42;
    const s = canvasToScreenRel(cx, cy, VP, SIZE);
    // canvasToScreenRel is wrapper-relative (no left/top); use a zero-origin rect.
    const back = clientToCanvasManual(s.x, s.y, VP, RECT);
    expect(back).not.toBeNull();
    expect(back?.x).toBeCloseTo(cx, 6);
    expect(back?.y).toBeCloseTo(cy, 6);
  });

  it("clientToCanvasManual accounts for the wrapper rect offset", () => {
    const offsetRect = { left: 30, top: 20, width: 800, height: 600 };
    const centered = clientToCanvasManual(
      offsetRect.left + offsetRect.width / 2,
      offsetRect.top + offsetRect.height / 2,
      VP,
      offsetRect,
    );
    // The wrapper center maps back to the viewport origin.
    expect(centered).toEqual({ x: VP.x, y: VP.y });
  });

  // CORRECTED (US1 AC7): was "clientToCanvasManual returns null on zero zoom (no
  // divide-by-zero)". `zoom: 0` is Obsidian's 100 % — a fully valid viewport whose
  // linear factor is 1. The old bail made the manual fallback dead at default zoom.
  it("clientToCanvasManual treats zoom 0 as a valid 100 % viewport", () => {
    const back = clientToCanvasManual(
      RECT.width / 2 + 100,
      RECT.height / 2,
      { x: 0, y: 0, zoom: 0 },
      RECT,
    );
    expect(back).not.toBeNull();
    expect(back?.x).toBeCloseTo(100, 6);
    expect(back?.y).toBeCloseTo(0, 6);
  });

  it("clientToCanvasManual returns null only on a degenerate linear scale", () => {
    // Unreachable from any real Obsidian zoom (2 ** z > 0 for every finite z); this
    // guards private-shape drift, which is the only way to produce these.
    expect(clientToCanvasManual(0, 0, { x: 0, y: 0, zoom: 0, scale: 0 }, RECT)).toBeNull();
    expect(clientToCanvasManual(0, 0, { x: 0, y: 0, zoom: Number.NaN }, RECT)).toBeNull();
    expect(
      clientToCanvasManual(0, 0, { x: 0, y: 0, zoom: Number.NEGATIVE_INFINITY }, RECT),
    ).toBeNull();
  });

  // US1 AC6 — round-trip property across Obsidian's whole clamp range, zero-origin rect.
  it.each([-4, -1, 0, 1])(
    "clientToCanvasManual exactly inverts canvasToScreenRel at zoom %i",
    (zoom) => {
      const vp: CanvasViewport = { x: 100, y: 50, zoom };
      for (const [cx, cy] of [
        [137, -42],
        [vp.x, vp.y],
        [-1000.5, 2500.25],
      ]) {
        const s = canvasToScreenRel(cx, cy, vp, SIZE);
        const back = clientToCanvasManual(s.x, s.y, vp, RECT);
        expect(back).not.toBeNull();
        expect(back?.x).toBeCloseTo(cx, 6);
        expect(back?.y).toBeCloseTo(cy, 6);
      }
    },
  );

  // US1 AC3 — Obsidian's zoom === 0 is 100 %, so the linear factor is 1.
  it("US1 AC3: at zoom 0 (100 %) a point 100 units right renders 100 px right of centre", () => {
    const vp: CanvasViewport = { x: 0, y: 0, zoom: 0 };
    const s = canvasToScreenRel(100, 0, vp, SIZE);
    expect(s.x).toBeCloseTo(SIZE.width / 2 + 100, 6);
    expect(s.y).toBeCloseTo(SIZE.height / 2, 6);
  });

  // US1 AC4 — zoom === -1 is 50 %, factor 0.5: same side, half the distance.
  it("US1 AC4: at zoom -1 (50 %) the same point renders 50 px right of centre", () => {
    const vp: CanvasViewport = { x: 0, y: 0, zoom: -1 };
    const s = canvasToScreenRel(100, 0, vp, SIZE);
    expect(s.x).toBeCloseTo(SIZE.width / 2 + 50, 6);
    expect(s.x).toBeGreaterThan(SIZE.width / 2);
  });
});

// ---- Live-view reconciliation (scatter fix) --------------------------------
// A fake Obsidian canvas is enough to exercise the reconciliation surface, which
// is the version-fragile code driving moveAndResize / setData on the real canvas.

interface FakeNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  moveAndResize?: (g: { x: number; y: number; width: number; height: number }) => void;
}

function makeView(opts: {
  nodes: FakeNode[];
  edges?: string[];
  setData?: (data: unknown) => void;
  requestFrame?: () => void;
  dragTargetId?: string | null;
  zoom?: number;
  scale?: number;
  // WP3: records every call that reaches the PRISTINE canvas method, so a test can
  // prove patch adoption re-wraps the original instead of stacking wrappers.
  onSetDragging?: (dragging: boolean) => void;
  // WP3: the pointermove refresh source for the drag watchdog needs a wrapper element.
  wrapperEl?: FakeWrapperEl;
}) {
  for (const n of opts.nodes) {
    if (!n.moveAndResize) {
      n.moveAndResize = (g) => {
        n.x = g.x;
        n.y = g.y;
        n.width = g.width;
        n.height = g.height;
      };
    }
  }
  const canvas = {
    nodes: new Map(opts.nodes.map((n) => [n.id, n])),
    edges: new Map((opts.edges ?? []).map((id) => [id, {}])),
    // 0 is Obsidian's 100 % (`zoom` is log2 of the linear factor), not 1.
    zoom: opts.zoom ?? 0,
    // Only present when a case supplies it, so the `2 ** zoom` fallback is exercised.
    scale: opts.scale,
    x: 0,
    y: 0,
    setDragging(dragging: boolean) {
      opts.onSetDragging?.(dragging);
    },
    updateSelection(_fn: unknown) {},
    markViewportChanged() {},
    setData: opts.setData,
    requestFrame: opts.requestFrame,
    wrapperEl: opts.wrapperEl as unknown as HTMLElement | undefined,
    nodeInteractionLayer: { target: opts.dragTargetId ? { id: opts.dragTargetId } : null },
  };
  return { canvas };
}

// ---- WP3 fixtures (US4 AC9-AC17) -------------------------------------------

// Minimal DOM-free stand-in for `canvas.wrapperEl`: enough for onPointerMove's
// addEventListener + the manual clientToCanvas fallback, plus a manual dispatcher.
interface FakeWrapperEl {
  addEventListener(type: string, cb: (e: unknown) => void): void;
  removeEventListener(type: string, cb: (e: unknown) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  dispatch(type: string, evt: unknown): void;
  listenerCount(type: string): number;
}

function makeWrapperEl(): FakeWrapperEl {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  return {
    addEventListener(type, cb) {
      const set = listeners.get(type) ?? new Set();
      set.add(cb);
      listeners.set(type, set);
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
    dispatch(type, evt) {
      for (const cb of [...(listeners.get(type) ?? [])]) cb(evt);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/** Logger spy shaped like DebugLogger's `log`/`warn` seam (US6 AC1/AC2). */
function makeLoggerSpy() {
  return { log: vi.fn(), warn: vi.fn() };
}

/** Every message a spy recorded at the given level that carries `prefix`. */
function linesWith(
  spy: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> },
  level: "log" | "warn",
  prefix: string,
): string[] {
  return spy[level].mock.calls
    .map((c) => String(c[1]))
    .filter((m) => m.startsWith(prefix) || m.includes(prefix));
}

describe("adapter viewport reads the linear scale", () => {
  it("US1 AC2: getViewport surfaces canvas.scale when the private shape exposes it", () => {
    const a = createCanvasAdapter(makeView({ nodes: [], zoom: -1, scale: 0.5 }));
    expect(a.getViewport()).toEqual({ x: 0, y: 0, zoom: -1, scale: 0.5 });
  });

  it("US1 AC2: getViewport omits scale when absent, so 2 ** zoom is derived", () => {
    const a = createCanvasAdapter(makeView({ nodes: [], zoom: -1 }));
    const vp = a.getViewport();
    expect(vp).toEqual({ x: 0, y: 0, zoom: -1 });
    expect(vp?.scale).toBeUndefined();
    expect(vp && viewportScale(vp)).toBe(0.5);
  });

  it("US1 AC2: a non-finite canvas.scale is ignored in favour of 2 ** zoom", () => {
    const a = createCanvasAdapter(makeView({ nodes: [], zoom: 1, scale: Number.NaN }));
    const vp = a.getViewport();
    expect(vp?.scale).toBeUndefined();
    expect(vp && viewportScale(vp)).toBe(2);
  });
});

describe("live-view reconciliation", () => {
  const GEO = { x: 10, y: 20, width: 100, height: 80 };

  it("getLiveNodeIds / getLiveEdgeIds reflect the live canvas", () => {
    const a = createCanvasAdapter(
      makeView({ nodes: [{ id: "n1", ...GEO }], edges: ["e1", "e2"] }),
    );
    expect([...a.getLiveNodeIds()]).toEqual(["n1"]);
    expect([...a.getLiveEdgeIds()].sort()).toEqual(["e1", "e2"]);
  });

  it("applyNodeGeometry returns 'missing' for an unknown node", () => {
    const a = createCanvasAdapter(makeView({ nodes: [{ id: "n1", ...GEO }] }));
    expect(a.applyNodeGeometry("ghost", GEO)).toBe("missing");
  });

  it("applyNodeGeometry returns 'unchanged' when geometry already matches", () => {
    const a = createCanvasAdapter(makeView({ nodes: [{ id: "n1", ...GEO }] }));
    expect(a.applyNodeGeometry("n1", GEO)).toBe("unchanged");
  });

  it("applyNodeGeometry moves the live node when geometry differs", () => {
    const node: FakeNode = { id: "n1", ...GEO };
    const a = createCanvasAdapter(makeView({ nodes: [node] }));
    const next = { x: 500, y: 600, width: 100, height: 80 };
    expect(a.applyNodeGeometry("n1", next)).toBe("applied");
    expect({ x: node.x, y: node.y, width: node.width, height: node.height }).toEqual(next);
  });

  it("applyNodeGeometry returns 'unsupported' when the node lacks moveAndResize", () => {
    const node: FakeNode = { id: "n1", ...GEO };
    const view = makeView({ nodes: [node] });
    node.moveAndResize = undefined; // strip it after mounting (shape drift)
    const a = createCanvasAdapter(view);
    expect(a.applyNodeGeometry("n1", { x: 1, y: 2, width: 3, height: 4 })).toBe("unsupported");
  });

  it("never fights the user's active drag of the SAME node (interacting)", () => {
    const node: FakeNode = { id: "n1", ...GEO };
    const view = makeView({ nodes: [node], dragTargetId: "n1" });
    const a = createCanvasAdapter(view);
    a.isBusy(); // installs the dragging patch
    view.canvas.setDragging(true); // begins a drag on n1 (target set above)
    expect(a.isBusy()).toBe(true);
    expect(a.applyNodeGeometry("n1", { x: 9, y: 9, width: 9, height: 9 })).toBe("interacting");
    // A DIFFERENT node is still reconciled during the drag.
  });

  it("reloadCanvasData calls setData + requestFrame and reports success", () => {
    const setData = vi.fn();
    const requestFrame = vi.fn();
    const a = createCanvasAdapter(makeView({ nodes: [{ id: "n1", ...GEO }], setData, requestFrame }));
    const data = { nodes: [{ id: "n1", ...GEO }], edges: [] };
    expect(a.reloadCanvasData(data)).toBe(true);
    expect(setData).toHaveBeenCalledWith(data);
    expect(requestFrame).toHaveBeenCalledOnce();
  });

  it("reloadCanvasData returns false while the user is dragging", () => {
    const setData = vi.fn();
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], setData, dragTargetId: "n1" });
    const a = createCanvasAdapter(view);
    a.isBusy();
    view.canvas.setDragging(true);
    expect(a.reloadCanvasData({ nodes: [], edges: [] })).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });

  it("getNodeGeometry returns live coords for a known node, null otherwise", () => {
    const a = createCanvasAdapter(makeView({ nodes: [{ id: "n1", ...GEO }] }));
    expect(a.getNodeGeometry("n1")).toEqual(GEO);
    expect(a.getNodeGeometry("ghost")).toBeNull();
  });

  it("getNodeGeometry tracks the live node after a move (edge-reflow detection)", () => {
    // main.ts uses getNodeGeometry to decide whether a moved node is an edge
    // endpoint that needs a full setData reflow. It must report the CURRENT coords.
    const node: FakeNode = { id: "n1", ...GEO };
    const a = createCanvasAdapter(makeView({ nodes: [node] }));
    a.applyNodeGeometry("n1", { x: 500, y: 600, width: 100, height: 80 });
    expect(a.getNodeGeometry("n1")).toEqual({ x: 500, y: 600, width: 100, height: 80 });
  });
});

// ---- WP3: drag watchdog (US4 AC9-AC13) -------------------------------------
// `isDragging` is set only inside the setDragging patch and, at HEAD, has no timeout,
// while main.ts short-circuits the whole CRDT->view reconcile on isBusy(). These tests
// pin the INACTIVITY semantics: the flag may not survive a silent window.

describe("drag watchdog", () => {
  const GEO = { x: 10, y: 20, width: 100, height: 80 };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("US4 AC13: isBusy() releases a drag that produced no signal for the whole window", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], dragTargetId: "n1" });
    const logger = makeLoggerSpy();
    const a = createCanvasAdapter(view, { logger });
    a.isBusy(); // installs the dragging patch
    view.canvas.setDragging(true);
    expect(a.isBusy()).toBe(true);
    // No pointer / viewport signal at all, only time passing. Asserted against the
    // exported constant, never a literal.
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1000);
    expect(a.isBusy()).toBe(false);
    expect(linesWith(logger, "warn", "DRAG WATCHDOG:")).toHaveLength(1);
  });

  it("US4 AC9 / WP3 AC6: DRAG_WATCHDOG_MS is exported and defaults to 5000", () => {
    expect(DRAG_WATCHDOG_MS).toBe(5000);
  });

  it("US4 AC13: the window is not tripped one tick early", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], dragTargetId: "n1" });
    const logger = makeLoggerSpy();
    const a = createCanvasAdapter(view, { logger });
    a.isBusy();
    view.canvas.setDragging(true);
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS - 1);
    expect(a.isBusy()).toBe(true);
    expect(linesWith(logger, "warn", "DRAG WATCHDOG:")).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(a.isBusy()).toBe(false);
  });

  it("US6 AC5: DRAG WATCHDOG: is logged once per drag, not once per poll", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], dragTargetId: "n1" });
    const logger = makeLoggerSpy();
    const a = createCanvasAdapter(view, { logger });
    a.isBusy();
    view.canvas.setDragging(true);
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS * 3);
    for (let i = 0; i < 5; i++) expect(a.isBusy()).toBe(false);
    a.applyNodeGeometry("n1", { x: 1, y: 2, width: 3, height: 4 });
    a.reloadCanvasData({ nodes: [], edges: [] });
    expect(linesWith(logger, "warn", "DRAG WATCHDOG:")).toHaveLength(1);
    // The line carries the measured idle time, the limit and the retained target id
    // (ids/timings only — no node text, no file content).
    const line = linesWith(logger, "warn", "DRAG WATCHDOG:")[0];
    expect(line).toContain(`limit ${DRAG_WATCHDOG_MS}ms`);
    expect(line).toContain("dragTargetId=n1 retained");
  });

  it("US4 AC10: a long but ACTIVE drag never trips the watchdog (viewport signal)", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], dragTargetId: "n1" });
    const logger = makeLoggerSpy();
    const a = createCanvasAdapter(view, { logger });
    a.onViewportChange(() => {}); // installs the markViewportChanged patch
    a.isBusy();
    view.canvas.setDragging(true);
    // Three full windows of drag, refreshed every half window: 1.5x DRAG_WATCHDOG_MS
    // of total drag time, never DRAG_WATCHDOG_MS of silence.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(DRAG_WATCHDOG_MS / 2);
      view.canvas.markViewportChanged();
      expect(a.isBusy()).toBe(true);
    }
    expect(linesWith(logger, "warn", "DRAG WATCHDOG:")).toHaveLength(0);
    // ...and it still expires once the signals stop.
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS);
    expect(a.isBusy()).toBe(false);
    expect(linesWith(logger, "warn", "DRAG WATCHDOG:")).toHaveLength(1);
  });

  it("US4 AC10: pointermove refreshes the watchdog the same way", () => {
    const wrapperEl = makeWrapperEl();
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], dragTargetId: "n1", wrapperEl });
    const a = createCanvasAdapter(view);
    const seen: Array<{ x: number; y: number }> = [];
    a.onPointerMove((x, y) => seen.push({ x, y }));
    expect(wrapperEl.listenerCount("pointermove")).toBe(1);
    a.isBusy();
    view.canvas.setDragging(true);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(DRAG_WATCHDOG_MS / 2);
      wrapperEl.dispatch("pointermove", { clientX: 400 + i, clientY: 300 });
      expect(a.isBusy()).toBe(true);
    }
    expect(seen).toHaveLength(3); // the pointer callback still fires normally
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS);
    expect(a.isBusy()).toBe(false);
  });

  it("US4 AC11/AC12: on expiry the held card is still protected but the canvas reconciles", () => {
    const held: FakeNode = { id: "n1", ...GEO };
    const other: FakeNode = { id: "n2", ...GEO };
    const setData = vi.fn();
    const requestFrame = vi.fn();
    const view = makeView({
      nodes: [held, other],
      dragTargetId: "n1",
      setData,
      requestFrame,
    });
    const logger = makeLoggerSpy();
    const a = createCanvasAdapter(view, { logger });
    a.isBusy();
    view.canvas.setDragging(true);
    // While the drag is live NOTHING structural happens.
    expect(a.reloadCanvasData({ nodes: [], edges: [] })).toBe(false);
    expect(setData).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1);

    // dragTargetId is RETAINED: the card the user may still be holding is untouched.
    expect(a.applyNodeGeometry("n1", { x: 999, y: 999, width: 9, height: 9 })).toBe("interacting");
    expect({ x: held.x, y: held.y }).toEqual({ x: GEO.x, y: GEO.y });
    // Every OTHER node reconciles again...
    expect(a.applyNodeGeometry("n2", { x: 500, y: 600, width: 100, height: 80 })).toBe("applied");
    // ...and so does the structural path (it returns false at HEAD, forever).
    expect(a.reloadCanvasData({ nodes: [], edges: [] })).toBe(true);
    expect(setData).toHaveBeenCalledOnce();
    expect(linesWith(logger, "warn", "DRAG WATCHDOG:")).toHaveLength(1);
  });

  it("US4 AC11: a genuine setDragging(false) clears the retained target and re-arms", () => {
    const node: FakeNode = { id: "n1", ...GEO };
    const view = makeView({ nodes: [node], dragTargetId: "n1" });
    const logger = makeLoggerSpy();
    const a = createCanvasAdapter(view, { logger });
    a.isBusy();
    view.canvas.setDragging(true);
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1);
    expect(a.isBusy()).toBe(false);
    expect(a.applyNodeGeometry("n1", { x: 1, y: 1, width: 1, height: 1 })).toBe("interacting");

    view.canvas.setDragging(false); // the real drag end finally arrives
    expect(a.applyNodeGeometry("n1", { x: 1, y: 1, width: 1, height: 1 })).toBe("applied");

    // The next drag is watched from scratch and logs its own line.
    view.canvas.setDragging(true);
    expect(a.isBusy()).toBe(true);
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1);
    expect(a.isBusy()).toBe(false);
    expect(linesWith(logger, "warn", "DRAG WATCHDOG:")).toHaveLength(2);
  });

  it("US4 AC12: an expired drag no longer blocks reloadCanvasData for other reasons", () => {
    // Guard against a watchdog that only fixes isBusy(): reloadCanvasData must read
    // the same predicate, so the structural path recovers without an isBusy() poll.
    const setData = vi.fn();
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], setData, dragTargetId: "n1" });
    const a = createCanvasAdapter(view);
    a.isBusy(); // installs the patch, then never polled again
    view.canvas.setDragging(true);
    expect(a.reloadCanvasData({ nodes: [], edges: [] })).toBe(false);
    vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1);
    expect(a.reloadCanvasData({ nodes: [], edges: [] })).toBe(true);
    expect(setData).toHaveBeenCalledOnce();
  });
});

// ---- WP3: patch adoption (US4 AC14-AC17) -----------------------------------
// An adapter with no patches installed is invisible to every drag signal: its
// isDragging never updates, so it never defers a reconcile and never claims a lock.
// These tests make that state unreachable for the newest adapter over a canvas.

describe("patch adoption", () => {
  const GEO = { x: 10, y: 20, width: 100, height: 80 };

  it("US4 AC16: the SECOND adapter over one canvas still sees the drag", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], dragTargetId: "n1" });
    const first = createCanvasAdapter(view);
    const second = createCanvasAdapter(view);
    first.isBusy(); // first adapter installs the setDragging patch (lazy install)
    second.isBusy(); // second adapter must ADOPT it, not early-return patch-less
    view.canvas.setDragging(true);
    expect(second.isBusy()).toBe(true);
  });

  it("US4 AC14: adoption re-wraps __lsOriginal, so the canvas method runs exactly once", () => {
    const calls: boolean[] = [];
    const view = makeView({
      nodes: [{ id: "n1", ...GEO }],
      dragTargetId: "n1",
      onSetDragging: (d) => calls.push(d),
    });
    const first = createCanvasAdapter(view);
    const second = createCanvasAdapter(view);
    const third = createCanvasAdapter(view);
    first.isBusy();
    second.isBusy();
    third.isBusy();
    view.canvas.setDragging(true);
    // Stacking three wrappers would reach the pristine method three times.
    expect(calls).toEqual([true]);
    expect(third.isBusy()).toBe(true);
  });

  it("US4 AC15 / WP3 AC8: the displaced adapter's disposer is a no-op", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }], dragTargetId: "n1" });
    const first = createCanvasAdapter(view);
    first.isBusy();
    const firstWrapper = view.canvas.setDragging;
    const second = createCanvasAdapter(view);
    second.isBusy(); // adopts: `second` now owns the method
    const liveWrapper = view.canvas.setDragging;
    expect(liveWrapper).not.toBe(firstWrapper);

    first.destroy(); // guarded by `if (c[name] === wrapper)` — must not restore
    expect(view.canvas.setDragging).toBe(liveWrapper);
    // The live adapter still receives signals after the displaced one was destroyed.
    view.canvas.setDragging(true);
    expect(second.isBusy()).toBe(true);
  });

  it("WP3 AC8: destroy() restores every patch and resets patchState", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }] });
    const pristine = {
      setDragging: view.canvas.setDragging,
      updateSelection: view.canvas.updateSelection,
      markViewportChanged: view.canvas.markViewportChanged,
    };
    const a = createCanvasAdapter(view);
    a.onNodeInteractionStart(() => {}); // selection + dragging
    a.onViewportChange(() => {}); // viewport
    expect(view.canvas.setDragging).not.toBe(pristine.setDragging);
    expect(view.canvas.updateSelection).not.toBe(pristine.updateSelection);
    expect(view.canvas.markViewportChanged).not.toBe(pristine.markViewportChanged);

    a.destroy();
    expect(view.canvas.setDragging).toBe(pristine.setDragging);
    expect(view.canvas.updateSelection).toBe(pristine.updateSelection);
    expect(view.canvas.markViewportChanged).toBe(pristine.markViewportChanged);

    // patchState was reset, so the same adapter can patch again from scratch...
    a.isBusy();
    expect(view.canvas.setDragging).not.toBe(pristine.setDragging);
    // ...and a fresh adapter sees pristine methods for the two it did NOT re-patch.
    const logger = makeLoggerSpy();
    createCanvasAdapter(view, { logger });
    expect(linesWith(logger, "log", "ADAPTER PATCH:")).toEqual([
      "ADAPTER PATCH: updateSelection=installed setDragging=adopted markViewportChanged=installed",
    ]);
  });

  it("US4 AC17 / US6: one ADAPTER PATCH: line per construction, per-method outcome", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }] });
    const firstLog = makeLoggerSpy();
    const first = createCanvasAdapter(view, { logger: firstLog });
    // Nothing is patched yet at construction time, so a first mount is all-installed.
    expect(linesWith(firstLog, "log", "ADAPTER PATCH:")).toEqual([
      "ADAPTER PATCH: updateSelection=installed setDragging=installed markViewportChanged=installed",
    ]);
    first.onNodeInteractionStart(() => {}); // patches updateSelection + setDragging

    const secondLog = makeLoggerSpy();
    createCanvasAdapter(view, { logger: secondLog });
    // The duplicate mount is greppable, per method.
    expect(linesWith(secondLog, "log", "ADAPTER PATCH:")).toEqual([
      "ADAPTER PATCH: updateSelection=adopted setDragging=adopted markViewportChanged=installed",
    ]);
  });

  it("US4 AC17: a missing private member is reported as unavailable, not as a patch", () => {
    const view = makeView({ nodes: [{ id: "n1", ...GEO }] });
    (view.canvas as { setDragging?: unknown }).setDragging = undefined; // shape drift
    const logger = makeLoggerSpy();
    const a = createCanvasAdapter(view, { logger });
    expect(linesWith(logger, "log", "ADAPTER PATCH:")).toEqual([
      "ADAPTER PATCH: updateSelection=installed setDragging=unavailable markViewportChanged=installed",
    ]);
    // And the adapter still degrades gracefully rather than throwing.
    expect(a.isBusy()).toBe(false);
  });

  it("US4 AC14: a no-canvas view reports every method unavailable and never throws", () => {
    const logger = makeLoggerSpy();
    const a = createCanvasAdapter({}, { logger });
    expect(linesWith(logger, "log", "ADAPTER PATCH:")).toEqual([
      "ADAPTER PATCH: updateSelection=unavailable setDragging=unavailable markViewportChanged=unavailable",
    ]);
    expect(a.isAvailable()).toBe(false);
    expect(a.isBusy()).toBe(false);
    expect(a.reloadCanvasData({})).toBe(false);
  });
});
