import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Plugin: class {},
  FuzzySuggestModal: class {},
  Modal: class {},
  ItemView: class {},
  PluginSettingTab: class {},
  Setting: class {},
  AbstractInputSuggest: class {},
  Menu: class {},
  Notice: class {},
  normalizePath: (value: string) => value,
}));

import LiveSharePlugin from "../../../../../plugin/src/main";
import {
  REPAINT_SWEEP_PERIOD_MS,
  createCanvasAdapter,
} from "../../../../../plugin/src/canvas/canvas-adapter";
import { renderView } from "../../../../../plugin/src/__tests__/v2/b72/obsidian-render-double";

const N = Number(process.env.CANVAS_HUNT_N ?? "3");
const PATH = "_liveshare-test/SyncTesting.canvas";
const BEFORE = { id: "n0", x: 0, y: 0, width: 100, height: 50 };
const DESIRED = { x: 45, y: 0, width: 100, height: 50 };

function lifecycle() {
  const plugin = Object.create(LiveSharePlugin.prototype) as any;
  plugin.canvasAdapters = new Map();
  plugin.canvasRepaintSweeps = new Map();
  plugin.logger = { debug: vi.fn() };
  return plugin;
}

afterEach(() => vi.useRealTimers());

describe("CANVAS-VIEW-REGRESSION-071 P1", () => {
  it("an owned sweep repairs the stale transform after an unchanged lock revert", () => {
    vi.useFakeTimers();
    const plugin = lifecycle();
    const { view, canvas } = renderView([BEFORE]);
    canvas.paintAll();
    const adapter = createCanvasAdapter(view);
    plugin.canvasAdapters.set(PATH, adapter);
    plugin.startCanvasRepaintSweep(PATH, adapter);

    const node = canvas.nodes.get("n0")!;
    node.moveAndResize(DESIRED);
    expect(node.paintedAt()).toEqual({ x: 0, y: 0 });
    expect(adapter.applyNodeGeometry("n0", DESIRED)).toBe("unchanged");

    vi.advanceTimersByTime(REPAINT_SWEEP_PERIOD_MS * N);

    expect(
      node.paintedAt(),
      `PAINT_MODEL owned sweep failed after N=${N}: paint=${JSON.stringify(node.paintedAt())} model=${JSON.stringify({ x: node.x, y: node.y })}`,
    ).toEqual({ x: node.x, y: node.y });
    plugin.stopCanvasRepaintSweep(PATH);
  });
});
