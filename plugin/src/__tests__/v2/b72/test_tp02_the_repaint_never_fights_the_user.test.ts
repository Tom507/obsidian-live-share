// B72 / WP2+WP3 — A FIX THAT MAKES DRAGGING FEEL WORSE IS A REGRESSION EVEN IF
// THE BOARD CONVERGES.
//
// `render()` re-seats a card from the model. On a card the local user is
// dragging that yanks it out from under their cursor; on a card whose inline
// editor is open, WP37 MEASURED that re-seating destroys the unflushed text. So
// both entry points refuse — and refusing means RETURNING, not acting
// differently, which is what the rows below assert on the DOM rather than on the
// outcome string alone (`renderCount` is the pixel-side witness; an outcome of
// `"interacting"` with a render that happened anyway would pass a string check).
//
// Rule 10: the predicate is `classifyBusyGate` — the SAME definer
// `main.ts#reconcileLiveCanvas` and `main.ts#applyCanvasNodeRevert` execute — fed
// from the same two measured facts. Not a second lookalike that can drift.

import { describe, expect, it, vi } from "vitest";

import { DRAG_WATCHDOG_MS, createCanvasAdapter } from "../../../canvas/canvas-adapter";
import { renderView } from "./obsidian-render-double";

const BOARD = [
  { id: "n1", x: 0, y: 0, width: 200, height: 100 },
  { id: "n2", x: 300, y: 0, width: 200, height: 100 },
  { id: "n3", x: 600, y: 0, width: 200, height: 100 },
];

function rig() {
  const { view, canvas } = renderView(BOARD.map((r) => ({ ...r })));
  const adapter = createCanvasAdapter(view);
  canvas.paintAll();
  // Consulting the busy seam is also what installs the dragging patch, so the
  // driver's signals reach the adapter — the same line every existing WP5/WP37
  // rig uses.
  adapter.isBusy();
  return { canvas, adapter };
}

/** Start a drag through the private-API bracket the adapter actually hooks. */
function beginDrag(canvas: ReturnType<typeof rig>["canvas"], id: string): void {
  canvas.nodeInteractionLayer.target = { id };
  canvas.setDragging(true);
}

describe("B72 — the repaint refuses while the user is interacting", () => {
  it("T1 mid-DRAG: the dragged card is not repainted, and no render() runs", () => {
    const { canvas, adapter } = rig();
    const n = canvas.nodes.get("n1");
    if (!n) throw new Error("fixture lost n1");
    beginDrag(canvas, "n1");
    // The user has moved the card; the model is ahead of the paint by their own hand.
    n.x = 55;
    const rendersBefore = n.renderCount;

    expect(adapter.repaintNode?.("n1")).toBe("interacting");
    expect(n.renderCount).toBe(rendersBefore); // the DOM witness, not the string
    expect(adapter.describeRepaintSweep?.().interacting).toBe(1);
    expect(adapter.describeRepaintSweep?.().repaired).toBe(0);
  });

  it("T2 mid-DRAG: the SWEEP does not run at all — it never repaints a neighbour either", () => {
    const { canvas, adapter } = rig();
    beginDrag(canvas, "n1");
    const before = [...canvas.nodes.values()].map((n) => n.renderCount);

    const tick = adapter.sweepRepaint?.();
    expect(tick?.skipped).toBe("busy");
    expect(tick?.visited).toEqual([]);
    expect([...canvas.nodes.values()].map((n) => n.renderCount)).toEqual(before);
    expect(adapter.describeRepaintSweep?.().skippedBusy).toBe(1);
  });

  it("T3 an OPEN INLINE EDITOR blocks the repaint of every card, not just the edited one", () => {
    const { canvas, adapter } = rig();
    // Obsidian's OWN flag, which is what the adapter's primary probe measures on
    // every consultation. `noteEditingFocus` alone would be overruled by that
    // measurement — correctly, since the surface would be saying nothing is
    // being edited (WP37's "the flag is a measurement, not a memory").
    const edited = canvas.nodes.get("n2");
    if (!edited) throw new Error("fixture lost n2");
    edited.isEditing = true;
    expect(adapter.getEditingNodeId?.()).toBe("n2");
    const before = [...canvas.nodes.values()].map((n) => n.renderCount);

    expect(adapter.repaintNode?.("n2")).toBe("interacting");
    // …and its neighbour too: `classifyBusyGate` answers `"editing"` for the
    // BOARD, and a repaint that re-seated a neighbour while an editor is open
    // would be the exact route WP87 calls a destruction class.
    expect(adapter.repaintNode?.("n1")).toBe("interacting");
    expect(adapter.sweepRepaint?.().skipped).toBe("busy");
    expect([...canvas.nodes.values()].map((n) => n.renderCount)).toEqual(before);
  });

  it("T4 THE NEGATIVE CONTROL — once the interaction ENDS the very same calls repaint", () => {
    // Without this row every assertion above would be satisfied by a repaint
    // that never works at all. A guard that cannot be released is not a guard.
    const { canvas, adapter } = rig();
    const n = canvas.nodes.get("n1");
    if (!n) throw new Error("fixture lost n1");
    beginDrag(canvas, "n1");
    n.x = 55;
    expect(adapter.repaintNode?.("n1")).toBe("interacting");

    canvas.setDragging(false);
    canvas.nodeInteractionLayer.target = null;
    expect(adapter.isBusy()).toBe(false);

    expect(adapter.repaintNode?.("n1")).toBe("repaired");
    expect(n.paintedAt()).toEqual({ x: 55, y: 0 });
    const tick = adapter.sweepRepaint?.();
    expect(tick?.skipped).toBe(null);
    expect(tick?.visited.length).toBeGreaterThan(0);
  });

  it("T5 after the drag WATCHDOG releases, the retained card is STILL protected and the rest of the board is not", () => {
    // `dragTargetId` outlives a watchdog release on purpose (US4 AC11): the user
    // may still be holding that card even though the board-wide flag was let go.
    // This is the state a `setDragging(true)` whose closing call never arrived
    // leaves behind, and it is why `repaintNode` keeps the per-card arm on top of
    // the board-wide one instead of trusting `classifyBusyGate` alone.
    vi.useFakeTimers();
    try {
      const { canvas, adapter } = rig();
      beginDrag(canvas, "n2");
      expect(adapter.isBusy()).toBe(true);
      // No drag signal for longer than the inactivity budget.
      vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1000);
      expect(adapter.isBusy()).toBe(false); // the board-wide flag is released…

      const n2 = canvas.nodes.get("n2");
      const n3 = canvas.nodes.get("n3");
      if (!n2 || !n3) throw new Error("fixture lost nodes");
      n2.x = 777;
      n3.x = 888;

      // …and the one card the user may still be holding is not.
      expect(adapter.repaintNode?.("n2")).toBe("interacting");
      expect(n2.paintedAt()).toEqual({ x: 300, y: 0 });
      // The rest of the board is free again — a watchdog that switched repainting
      // off for the lifetime of the view would be the worse defect.
      expect(adapter.repaintNode?.("n3")).toBe("repaired");
      expect(n3.paintedAt()).toEqual({ x: 888, y: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
