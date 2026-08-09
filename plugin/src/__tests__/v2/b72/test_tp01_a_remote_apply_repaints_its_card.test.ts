// B72 / WP2 — AFTER A REMOTE CHANGE IS APPLIED TO A NODE, THAT NODE IS REPAINTED.
//
// THE DECISIVE ROW IS T2 AND IT IS A BEFORE/AFTER, NOT AN ASSERTION. The same
// board, the same remote change, the same off-screen card:
//
//   ├── WITHOUT the repaint (`applyNodeGeometry` alone, which is HEAD's
//   │   behaviour) the card's model advances and its ELEMENT is never written —
//   │   `paintedAt()` still reads the pre-drag position, or nothing at all;
//   └── WITH it, the same card's element carries the new position.
//
// Both arms are measured off the DOM element, never asserted from the model —
// the model is right in both arms and that is exactly why `view`/`doc`/`file`
// could not see this (`S192`).
//
// The outcomes come out of the REAL `createCanvasAdapter`, over a double whose
// `moveAndResize`/`render`/`attach`/frame loop reproduce Obsidian's own lines
// (see `obsidian-render-double.ts`, which quotes them and states its limits).

import { describe, expect, it } from "vitest";

import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import { renderView } from "./obsidian-render-double";

const BOARD = [
  { id: "n1", x: 0, y: 0, width: 200, height: 100 },
  { id: "n2", x: 300, y: 0, width: 200, height: 100 },
  { id: "n3", x: 600, y: 0, width: 200, height: 100 },
];

function rig(visible?: string[]) {
  const { view, canvas } = renderView(BOARD.map((r) => ({ ...r })));
  if (visible) canvas.visible = new Set(visible);
  const adapter = createCanvasAdapter(view);
  canvas.paintAll(); // a freshly mounted board is painted from the model
  return { canvas, adapter };
}

describe("B72 WP2 — a remote apply repaints the card it applied to", () => {
  it("T1 the fixture is honest: HEAD's apply alone leaves an ON-SCREEN card repainted only by a frame", () => {
    const { canvas, adapter } = rig();
    const n = canvas.nodes.get("n1");
    if (!n) throw new Error("fixture lost n1");
    expect(n.paintedAt()).toEqual({ x: 0, y: 0 });

    // The apply Obsidian gives us, and nothing else.
    expect(adapter.applyNodeGeometry("n1", { x: 111, y: 222, width: 200, height: 100 })).toBe(
      "applied",
    );
    // The MODEL moved…
    expect({ x: n.x, y: n.y }).toEqual({ x: 111, y: 222 });
    // …and the PIXELS did not, because `moveAndResize` never touches `nodeEl`.
    expect(n.paintedAt()).toEqual({ x: 0, y: 0 });
    // A frame is owed and would catch this one up — the on-screen case is the
    // benign one, and saying so is what makes T2 a real finding rather than a
    // restatement of the same thing.
    expect(canvas.runFrame()).toBe(true);
    expect(n.paintedAt()).toEqual({ x: 111, y: 222 });
  });

  it("T2 THE DEMONSTRATION — NO FRAME RUNS (an occluded window): without the repaint the card stays unpainted, with it it does not", () => {
    // GATE 1 of `S193`, expressed as a test. `requestAnimationFrame` is suspended
    // for a hidden or occluded window, and `requestFrame()` is guarded by
    // `if (this.frame)` so nothing re-schedules while one is pending. Three
    // Obsidian windows share one screen; while the owner drags in A, B and C are
    // occluded. Neither arm below is allowed to run a frame, and that is the
    // whole experiment: `framesRun` is asserted to be 0 in both.
    const a = rig();
    const a2 = a.canvas.nodes.get("n2");
    if (!a2) throw new Error("fixture lost n2");
    const framesBeforeA = a.canvas.framesRun;
    expect(a2.paintedAt()).toEqual({ x: 300, y: 0 });

    // ---- arm A: the fix DISABLED (apply only, i.e. unmodified HEAD) ---------
    expect(a.adapter.applyNodeGeometry("n2", { x: 900, y: 900, width: 200, height: 100 })).toBe(
      "applied",
    );
    expect(a2.x).toBe(900); // the MODEL advanced…
    expect(a2.paintedAt()).toEqual({ x: 300, y: 0 }); // …and the PIXELS did not
    expect(a.canvas.framesRun).toBe(framesBeforeA); // no frame ran, by construction
    expect(a.canvas.framesOwed).toBe(1); // one is owed, and may never arrive

    // ---- arm B: the fix ENABLED (the same apply, plus `repaintNode`) --------
    const b = rig();
    const b2 = b.canvas.nodes.get("n2");
    if (!b2) throw new Error("fixture lost n2");
    const framesBeforeB = b.canvas.framesRun;
    expect(b.adapter.applyNodeGeometry("n2", { x: 900, y: 900, width: 200, height: 100 })).toBe(
      "applied",
    );
    // WP2's call, exactly as `main.ts#reconcileLiveCanvas` makes it.
    expect(b.adapter.repaintNode?.("n2")).toBe("repaired");
    expect(b2.paintedAt()).toEqual({ x: 900, y: 900 });
    // …and it did NOT get there by running a frame arm A was denied.
    expect(b.canvas.framesRun).toBe(framesBeforeB);

    // The two arms differ in exactly one call. Same board, same apply, same
    // number of frames (zero).
    expect(a2.paintedAt()).not.toEqual(b2.paintedAt());
  });

  it("T2b an OFF-SCREEN card is not rendered on the spot — it is enqueued, PRIORITISED, and correct the moment it returns", () => {
    const { canvas, adapter } = rig(["n1"]); // n2 and n3 are outside the viewport
    canvas.runFrame(); // virtualize() detaches n2/n3
    const n2 = canvas.nodes.get("n2");
    if (!n2) throw new Error("fixture lost n2");
    expect(n2.isAttached).toBe(false);

    expect(adapter.applyNodeGeometry("n2", { x: 900, y: 900, width: 200, height: 100 })).toBe(
      "applied",
    );
    expect(adapter.repaintNode?.("n2")).toBe("deferred");
    // Nothing was rendered for a card nobody can see — that is the cost this
    // outcome exists to avoid, and it is asserted rather than described.
    expect(n2.renderCount).toBe(0);
    // It is remembered, so it does not have to wait for its turn in the
    // round-robin once it comes back.
    expect(adapter.describeRepaintSweep?.().pendingCount).toBe(1);

    canvas.setVisible(["n1", "n2"]);
    canvas.runFrame(); // the card is attached again
    expect(n2.isAttached).toBe(true);
    const tick = adapter.sweepRepaint?.();
    expect(tick?.visited[0]).toBe("n2"); // FIRST, ahead of the round-robin
    expect(n2.paintedAt()).toEqual({ x: 900, y: 900 });
    // n2 has left the queue. n3 has JOINED it — the same tick swept it, found it
    // still off screen, and deferred it. The queue is the set of cards the sweep
    // could not paint yet, not a leak: it is bounded by the node count and every
    // entry leaves it the moment the card is painted.
    expect(adapter.describeRepaintSweep?.().pendingCount).toBe(1);
    canvas.setVisible(["n1", "n2", "n3"]);
    canvas.runFrame();
    expect(adapter.sweepRepaint?.().visited[0]).toBe("n3");
    expect(adapter.describeRepaintSweep?.().pendingCount).toBe(0);
  });

  it("T3 an ATTACHED card whose element is stale is REPAIRED, and says so", () => {
    const { canvas, adapter } = rig();
    const n = canvas.nodes.get("n3");
    if (!n) throw new Error("fixture lost n3");
    // Advance the model behind the pixels' back — exactly what `moveAndResize`
    // and `setData` both do, and what the frame loop is supposed to catch up.
    n.x = 1234;
    n.y = 4321;
    expect(n.paintedAt()).toEqual({ x: 600, y: 0 });

    expect(adapter.repaintNode?.("n3")).toBe("repaired");
    expect(n.paintedAt()).toEqual({ x: 1234, y: 4321 });
    expect(adapter.describeRepaintSweep?.().repaired).toBe(1);
  });

  it("T4 an attached card that already agrees is repainted but NOT counted as a repair", () => {
    const { canvas, adapter } = rig();
    const n = canvas.nodes.get("n1");
    if (!n) throw new Error("fixture lost n1");
    expect(adapter.repaintNode?.("n1")).toBe("repainted");
    expect(adapter.describeRepaintSweep?.().repaired).toBe(0);
    expect(adapter.describeRepaintSweep?.().repainted).toBe(1);
  });

  it("T5 a repaint of a node that is not there REFUSES; it never invents one", () => {
    const { adapter } = rig();
    expect(adapter.repaintNode?.("no-such-node")).toBe("missing");
    expect(adapter.describeRepaintSweep?.().missing).toBe(1);
    expect(adapter.describeRepaintSweep?.().repaired).toBe(0);
  });

  it("T6 a private shape with no `render` is ENQUEUED, never silently dropped", () => {
    const { canvas, adapter } = rig();
    const n = canvas.nodes.get("n1") as unknown as { render?: unknown };
    n.render = undefined; // a build whose CanvasNode shape drifted
    const before = canvas.moved.size;
    expect(adapter.repaintNode?.("n1")).toBe("requested");
    expect(canvas.moved.size).toBe(before + 1);
  });
});
