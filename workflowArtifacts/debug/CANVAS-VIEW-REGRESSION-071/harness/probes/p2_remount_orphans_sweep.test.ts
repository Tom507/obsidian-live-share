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

describe("CANVAS-VIEW-REGRESSION-071 P2", () => {
  it("a same-path adapter handover retains a restoring sweep for the visible card", () => {
    vi.useFakeTimers();
    const plugin = lifecycle();

    const oldSurface = renderView([BEFORE]);
    oldSurface.canvas.paintAll();
    const oldAdapter = createCanvasAdapter(oldSurface.view);
    plugin.canvasAdapters.set(PATH, oldAdapter);
    plugin.startCanvasRepaintSweep(PATH, oldAdapter);

    const currentSurface = renderView([BEFORE]);
    currentSurface.canvas.paintAll();
    const currentAdapter = createCanvasAdapter(currentSurface.view);
    plugin.canvasAdapters.set(PATH, currentAdapter);
    plugin.startCanvasRepaintSweep(PATH, currentAdapter);
    expect(
      plugin.canvasAdapters.get(PATH),
      "the replacement must be the active registry adapter, not a stale test instance",
    ).toBe(currentAdapter);
    const currentSweep = vi.spyOn(currentAdapter, "sweepRepaint");

    const node = currentSurface.canvas.nodes.get("n0")!;
    node.moveAndResize(DESIRED);
    expect(node.paintedAt()).toEqual({ x: 0, y: 0 });
    expect(currentAdapter.applyNodeGeometry("n0", DESIRED)).toBe("unchanged");

    vi.advanceTimersByTime(REPAINT_SWEEP_PERIOD_MS * N);

    const evidence = {
      activeIsReplacement: plugin.canvasAdapters.get(PATH) === currentAdapter,
      currentSweepDriven: currentSweep.mock.calls.length > 0,
      currentSweepCalls: currentSweep.mock.calls.length,
      paint: node.paintedAt(),
      model: { x: node.x, y: node.y },
    };
    expect(
      evidence,
      `PAINT_MODEL replacement failed after N=${N}: ${JSON.stringify(evidence)}`,
    ).toEqual({
      activeIsReplacement: true,
      currentSweepDriven: true,
      currentSweepCalls: expect.any(Number),
      paint: { x: node.x, y: node.y },
      model: { x: node.x, y: node.y },
    });
    plugin.stopCanvasRepaintSweep(PATH);
  });
});
