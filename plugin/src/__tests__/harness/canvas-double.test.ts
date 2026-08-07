import { describe, expect, it } from "vitest";

import { createCanvasAdapter } from "../../canvas/canvas-adapter";
import { CanvasDouble } from "./canvas-double";
import { InteractionDriver } from "./interaction-driver";

// WP1 self-test. Proves US1 AC1/AC2/AC3/AC4/AC5/AC6 by building a REAL
// createCanvasAdapter over the CanvasDouble and observing that interaction
// callbacks fire from driver-issued signals (not from direct mutator calls).

const N1 = { id: "n1", x: 0, y: 0, width: 100, height: 60 };
const N2 = { id: "n2", x: 500, y: 500, width: 100, height: 60 };

describe("CanvasDouble — adapter contract (US1 AC1/AC2)", () => {
  it("AC1: a real adapter over the double reports isAvailable() === true", () => {
    const double = new CanvasDouble({ nodes: [N1] });
    const adapter = createCanvasAdapter(double.view);
    expect(adapter.isAvailable()).toBe(true);
  });

  it("AC1: exposes the gated shape — nodes Map, edges Map, numeric zoom/x/y, patch points", () => {
    const double = new CanvasDouble({ nodes: [N1], edges: [{ id: "e1", fromNode: "n1", toNode: "n1" }] });
    const c = double.canvas;
    expect(c.nodes instanceof Map).toBe(true);
    expect(c.edges instanceof Map).toBe(true);
    expect(typeof c.zoom).toBe("number");
    expect(typeof c.x).toBe("number");
    expect(typeof c.y).toBe("number");
    expect(typeof c.updateSelection).toBe("function");
    expect(typeof c.setDragging).toBe("function");
    expect(typeof c.markViewportChanged).toBe("function");
    expect(typeof c.setData).toBe("function");
    expect(typeof c.requestFrame).toBe("function");
    expect(c.nodeInteractionLayer).toHaveProperty("target");
    const node = c.nodes.get("n1");
    expect(typeof node?.moveAndResize).toBe("function");
  });

  it("AC2: preserves the FakeNode behaviors — moveAndResize mutates geometry", () => {
    const double = new CanvasDouble({ nodes: [N1] });
    double.getNode("n1")?.moveAndResize({ x: 5, y: 6, width: 7, height: 8 });
    expect(double.getNode("n1")).toMatchObject({ x: 5, y: 6, width: 7, height: 8 });
  });

  it("AC2: setData/requestFrame are observable via the adapter's reload surface", () => {
    const double = new CanvasDouble({ nodes: [N1] });
    const adapter = createCanvasAdapter(double.view);
    const ok = adapter.reloadCanvasData({ nodes: [N1, N2], edges: [] });
    expect(ok).toBe(true);
    expect(double.setDataCount).toBe(1);
    expect(double.requestFrameCount).toBe(1);
    expect([...adapter.getLiveNodeIds()].sort()).toEqual(["n1", "n2"]);
  });
});

describe("InteractionDriver — signal-injection fidelity (US1 AC3/AC4)", () => {
  it("AC3/AC4: driveDrag fires real onNodeInteractionStart/End and geometry converges", () => {
    const double = new CanvasDouble({ nodes: [{ ...N1 }] });
    const adapter = createCanvasAdapter(double.view);
    const starts: string[] = [];
    const ends: string[] = [];
    adapter.onNodeInteractionStart((id) => starts.push(id));
    adapter.onNodeInteractionEnd((id) => ends.push(id));

    const driver = new InteractionDriver(double);
    driver.driveDrag("n1", { x: 300, y: 200 });

    // Callbacks fired from the driver's real setDragging signal (capture path).
    expect(starts).toContain("n1");
    expect(ends).toContain("n1");
    // getNodeGeometry reflects the post-drag geometry.
    expect(adapter.getNodeGeometry("n1")).toEqual({ x: 300, y: 200, width: 100, height: 60 });
  });

  it("AC3: driveResize brackets the size change with the real drag signal", () => {
    const double = new CanvasDouble({ nodes: [{ ...N1 }] });
    const adapter = createCanvasAdapter(double.view);
    const starts: string[] = [];
    adapter.onNodeInteractionStart((id) => starts.push(id));

    new InteractionDriver(double).driveResize("n1", { width: 240, height: 160 });

    expect(starts).toContain("n1");
    expect(adapter.getNodeGeometry("n1")).toEqual({ x: 0, y: 0, width: 240, height: 160 });
  });

  it("AC3: a direct moveAndResize (no signal) does NOT fire capture — proves fidelity", () => {
    const double = new CanvasDouble({ nodes: [{ ...N1 }] });
    const adapter = createCanvasAdapter(double.view);
    const starts: string[] = [];
    adapter.onNodeInteractionStart((id) => starts.push(id));

    // Bypassing the driver / signal path must NOT be captured as an interaction.
    double.getNode("n1")?.moveAndResize({ x: 9, y: 9, width: 9, height: 9 });

    expect(starts).toEqual([]);
  });
});

describe("InteractionDriver — mid-drag busy state (US1 AC5)", () => {
  it("AC5: isBusy() true mid-drag, applyNodeGeometry returns 'interacting' for dragged node", () => {
    const double = new CanvasDouble({ nodes: [{ ...N1 }, { ...N2 }] });
    const adapter = createCanvasAdapter(double.view);
    adapter.isBusy(); // install the dragging patch before the driver fires signals

    let busyMid = false;
    let draggedOutcome = "";
    let otherOutcome = "";
    new InteractionDriver(double).driveDrag(
      "n1",
      { x: 300, y: 200 },
      {
        during: () => {
          busyMid = adapter.isBusy();
          draggedOutcome = adapter.applyNodeGeometry("n1", { x: 1, y: 2, width: 3, height: 4 });
          // A DIFFERENT node is still reconcilable mid-drag.
          otherOutcome = adapter.applyNodeGeometry("n2", { x: 700, y: 700, width: 100, height: 60 });
        },
      },
    );

    expect(busyMid).toBe(true);
    expect(draggedOutcome).toBe("interacting");
    expect(otherOutcome).toBe("applied");
    // Drag released → no longer busy.
    expect(adapter.isBusy()).toBe(false);
  });
});

describe("CanvasDouble.getData (US1 AC6) + structural driver ops", () => {
  it("AC6: getData returns current {nodes, edges} records", () => {
    const double = new CanvasDouble({
      nodes: [N1],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n1" }],
    });
    const data = double.getData();
    expect(data.nodes).toEqual([N1]);
    expect(data.edges).toEqual([{ id: "e1", fromNode: "n1", toNode: "n1" }]);
  });

  it("driveAddNode + driveEdge grow the model and fire selection signals", () => {
    const double = new CanvasDouble({ nodes: [N1] });
    const adapter = createCanvasAdapter(double.view);
    const starts: string[] = [];
    adapter.onNodeInteractionStart((id) => starts.push(id));

    const driver = new InteractionDriver(double);
    driver.driveAddNode({ id: "n2", x: 400, y: 400, width: 120, height: 80 });
    driver.driveEdge({ id: "e1", fromNode: "n1", toNode: "n2" });

    expect([...adapter.getLiveNodeIds()].sort()).toEqual(["n1", "n2"]);
    expect([...adapter.getLiveEdgeIds()]).toEqual(["e1"]);
    expect(starts).toContain("n2"); // new node selected via updateSelection
    expect(starts).toContain("e1"); // new edge selected via updateSelection
  });

  it("driveDeleteNode prunes incident edges and reports them", () => {
    const double = new CanvasDouble({
      nodes: [N1, N2],
      edges: [
        { id: "e1", fromNode: "n1", toNode: "n2" },
        { id: "e2", fromNode: "n2", toNode: "n1" },
      ],
    });
    const { removedEdges } = new InteractionDriver(double).driveDeleteNode("n1");
    expect(removedEdges.sort()).toEqual(["e1", "e2"]);
    expect(double.getData().nodes.map((n) => n.id)).toEqual(["n2"]);
    expect(double.getData().edges).toEqual([]);
  });

  it("driveTextEdit updates the file-node text and round-trips through getData", () => {
    const double = new CanvasDouble({
      nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 60, type: "text", text: "old" }],
    });
    new InteractionDriver(double).driveTextEdit("n1", "new");
    expect(double.getData().nodes[0]).toMatchObject({ id: "n1", type: "text", text: "new" });
  });
});
