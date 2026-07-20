import { describe, expect, it, vi } from "vitest";

import {
  type CanvasViewport,
  canvasToScreenRel,
  clientToCanvasManual,
  createCanvasAdapter,
} from "../canvas/canvas-adapter";

// The DOM/patch layer of the adapter (monkey-patching updateSelection/setDragging/
// markViewportChanged, pointer listeners) is inherently NOT unit-testable in a
// node environment — it requires a live Obsidian canvas instance. These tests
// cover the pure canvas <-> screen transform math, which is the version-fragile
// part most likely to regress silently.

const VP: CanvasViewport = { x: 100, y: 50, zoom: 2 };
const SIZE = { width: 800, height: 600 };
const RECT = { left: 0, top: 0, width: 800, height: 600 };

describe("canvas <-> screen transforms", () => {
  it("canvasToScreenRel places the viewport origin at the wrapper center", () => {
    const s = canvasToScreenRel(VP.x, VP.y, VP, SIZE);
    expect(s).toEqual({ x: SIZE.width / 2, y: SIZE.height / 2 });
  });

  it("canvasToScreenRel scales by live zoom", () => {
    // A point 10 canvas-units right of origin lands zoom*10 px right of center.
    const s = canvasToScreenRel(VP.x + 10, VP.y + 5, VP, SIZE);
    expect(s).toEqual({ x: SIZE.width / 2 + 20, y: SIZE.height / 2 + 10 });
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

  it("clientToCanvasManual returns null on zero zoom (no divide-by-zero)", () => {
    expect(clientToCanvasManual(0, 0, { x: 0, y: 0, zoom: 0 }, RECT)).toBeNull();
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
    zoom: 1,
    x: 0,
    y: 0,
    setDragging(_dragging: boolean) {},
    updateSelection(_fn: unknown) {},
    markViewportChanged() {},
    setData: opts.setData,
    requestFrame: opts.requestFrame,
    nodeInteractionLayer: { target: opts.dragTargetId ? { id: opts.dragTargetId } : null },
  };
  return { canvas };
}

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
