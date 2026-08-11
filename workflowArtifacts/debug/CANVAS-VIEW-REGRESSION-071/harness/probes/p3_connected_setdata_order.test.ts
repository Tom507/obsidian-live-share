import { describe, expect, it, vi } from "vitest";

import { createCanvasAdapter } from "../../../../../plugin/src/canvas/canvas-adapter";
import { renderView } from "../../../../../plugin/src/__tests__/v2/b72/obsidian-render-double";

const BEFORE = [
  { id: "n0", x: 0, y: 0, width: 100, height: 50 },
  { id: "n1", x: 200, y: 0, width: 100, height: 50 },
];
const DESIRED = { id: "n0", x: 45, y: 0, width: 100, height: 50 };

describe("CANVAS-VIEW-REGRESSION-071 P3", () => {
  it("geometry paint followed by connected-node setData keeps pixels on the model", () => {
    const requestRepaintSweep = vi.fn();
    const { view, canvas } = renderView(BEFORE);
    canvas.paintAll();
    const adapter = createCanvasAdapter(view, { requestRepaintSweep });

    expect(adapter.applyNodeGeometry("n0", DESIRED)).toBe("applied");
    expect(adapter.repaintNode?.("n0")).toMatch(/repainted|repaired/);
    expect(canvas.nodes.get("n0")?.paintedAt()).toEqual({ x: 45, y: 0 });

    expect(
      adapter.reloadCanvasData({
        nodes: [DESIRED, BEFORE[1]],
        edges: [{ id: "e0", fromNode: "n0", toNode: "n1" }],
      }),
    ).toBe(true);

    const node = canvas.nodes.get("n0")!;
    expect(
      node.paintedAt(),
      `PAINT_MODEL setData order diverged: paint=${JSON.stringify(node.paintedAt())} model=${JSON.stringify({ x: node.x, y: node.y })}`,
    ).toEqual({ x: node.x, y: node.y });
    expect(requestRepaintSweep).toHaveBeenCalledTimes(1);
  });
});
