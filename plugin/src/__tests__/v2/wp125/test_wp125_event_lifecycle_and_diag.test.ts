import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

import LiveSharePlugin from "../../../main";
import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import { renderView } from "../b72/obsidian-render-double";

type Harness = {
  canvasAdapters: Map<string, { sweepRepaint?: () => unknown }>;
  canvasRepaintSweeps: Map<string, unknown>;
  logger: { debug: ReturnType<typeof vi.fn> };
  startCanvasRepaintSweep(path: string, adapter: unknown): void;
  requestCanvasRepaintSweep(path: string): void;
  stopCanvasRepaintSweep(path: string): void;
  describeCanvasRepaintTrigger(path: string): Record<string, unknown> | null;
};

function harness() {
  const plugin = Object.create(LiveSharePlugin.prototype) as Harness;
  plugin.canvasAdapters = new Map();
  plugin.canvasRepaintSweeps = new Map();
  plugin.logger = { debug: vi.fn() };
  const sweepRepaint = vi.fn();
  const adapter = { sweepRepaint };
  plugin.canvasAdapters.set("board.canvas", adapter);
  plugin.startCanvasRepaintSweep("board.canvas", adapter);
  return { plugin, sweepRepaint };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WP125 A4 - the real plugin lifecycle owner", () => {
  it("BK6 source census pins both event doors and the periodic fallback", () => {
    const adapter = readFileSync(resolve(process.cwd(), "src/canvas/canvas-adapter.ts"), "utf8");
    const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(adapter).toMatch(/if \(source !== "sweep"\) requestRepaintSweep\?\.\(\)/);
    expect(adapter).toMatch(/for \(const id of changed\)[\s\S]{0,160}requestRepaintSweep\?\.\(\)/);
    expect(main).toMatch(/live\.sweepRepaint\?\.\(\)/);
  });

  it("BK7 a burst coalesces to one queued callback", async () => {
    vi.useFakeTimers();
    const { plugin, sweepRepaint } = harness();
    plugin.requestCanvasRepaintSweep("board.canvas");
    plugin.requestCanvasRepaintSweep("board.canvas");
    plugin.requestCanvasRepaintSweep("board.canvas");
    expect(plugin.describeCanvasRepaintTrigger("board.canvas")).toMatchObject({
      eventRequests: 3, coalescedRequests: 2, eventRuns: 0, pending: true,
    });
    await vi.runAllTicks();
    expect(sweepRepaint).toHaveBeenCalledTimes(1);
    expect(plugin.describeCanvasRepaintTrigger("board.canvas")).toMatchObject({ eventRuns: 1, pending: false });
    plugin.stopCanvasRepaintSweep("board.canvas");
  });

  it("a request during a run schedules exactly one follow-up", async () => {
    vi.useFakeTimers();
    const { plugin, sweepRepaint } = harness();
    sweepRepaint.mockImplementationOnce(() => {
      plugin.requestCanvasRepaintSweep("board.canvas");
      plugin.requestCanvasRepaintSweep("board.canvas");
    });
    plugin.requestCanvasRepaintSweep("board.canvas");
    await vi.runAllTicks();
    await vi.runAllTicks();
    expect(sweepRepaint).toHaveBeenCalledTimes(2);
    expect(plugin.describeCanvasRepaintTrigger("board.canvas")).toMatchObject({ eventRuns: 2 });
    plugin.stopCanvasRepaintSweep("board.canvas");
  });

  it("BK8 teardown makes an already queued callback a no-op", async () => {
    vi.useFakeTimers();
    const { plugin, sweepRepaint } = harness();
    plugin.requestCanvasRepaintSweep("board.canvas");
    plugin.stopCanvasRepaintSweep("board.canvas");
    await vi.runAllTicks();
    expect(sweepRepaint).not.toHaveBeenCalled();
    expect(plugin.describeCanvasRepaintTrigger("board.canvas")).toBe(null);
  });

  it("mounted structural reload composes into one event sweep without a periodic tick", async () => {
    vi.useFakeTimers();
    const plugin = Object.create(LiveSharePlugin.prototype) as Harness;
    plugin.canvasAdapters = new Map();
    plugin.canvasRepaintSweeps = new Map();
    plugin.logger = { debug: vi.fn() };
    const { view, canvas } = renderView([
      { id: "n0", x: 0, y: 0, width: 100, height: 50 },
      { id: "n1", x: 1, y: 0, width: 100, height: 50 },
    ]);
    canvas.paintAll();
    const adapter = createCanvasAdapter(view, {
      requestRepaintSweep: () => plugin.requestCanvasRepaintSweep("board.canvas"),
      getRepaintTriggerReport: () => plugin.describeCanvasRepaintTrigger("board.canvas"),
    });
    const sweep = vi.spyOn(adapter, "sweepRepaint");
    plugin.canvasAdapters.set("board.canvas", adapter);
    plugin.startCanvasRepaintSweep("board.canvas", adapter);

    expect(
      adapter.reloadCanvasData({
        nodes: [
          { id: "n0", x: 12, y: 0, width: 100, height: 50 },
          { id: "n1", x: 1, y: 0, width: 100, height: 50 },
        ],
        edges: [],
      }),
    ).toBe(true);
    expect(canvas.nodes.get("n0")?.paintedAt()).toEqual({ x: 12, y: 0 });
    expect(plugin.describeCanvasRepaintTrigger("board.canvas")).toMatchObject({
      eventRequests: 1,
      eventRuns: 0,
      periodicRuns: 0,
      pending: true,
    });

    await vi.runAllTicks();
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(plugin.describeCanvasRepaintTrigger("board.canvas")).toMatchObject({
      eventRuns: 1,
      periodicRuns: 0,
      lastTriggerKind: "event",
      pending: false,
    });
    plugin.stopCanvasRepaintSweep("board.canvas");
  });
});

describe("WP125 A6 - Python renderer compatibility", () => {
  it("BK10 prints unavailable for pre-WP125 and real split values for WP125", () => {
    const script = resolve(process.cwd(), "../tools/e2e/canvas_diag.py");
    const code = [
      "import importlib.util",
      `s=importlib.util.spec_from_file_location('d',r'${script.replace(/\\/g, "\\\\")}')`,
      "m=importlib.util.module_from_spec(s);s.loader.exec_module(m)",
      "p=lambda c:{'name':'A','result':{'diagProto':3,'census':{'repaint':{'available':True,'counters':c}}}}",
      "base={'repaired':0,'ticks':1,'visited':3,'cursor':2,'pendingCount':1}",
      "m.print_repaint_sweep([p(base)])",
      "full=dict(base,sources={'perNodeSeam':{'repairs':2},'structuralSeam':{'repairs':1},'sweep':{'repairs':0}},structuralChangedIds=1,trigger={'lastTriggerKind':'event','eventRequests':2,'coalescedRequests':1,'eventRuns':1,'periodicRuns':0,'lastRunAgeMs':7})",
      "m.print_repaint_sweep([p(full)])",
    ].join(";");
    const out = execFileSync("python", ["-c", code], { encoding: "utf8" });
    expect(out).toContain("WP125 SPLIT METRICS UNAVAILABLE");
    expect(out).not.toContain("perNodeSeam={'attempts': 0");
    expect(out).not.toContain("healthy");
    expect(out).toContain("perNodeSeam={'repairs': 2}");
    expect(out).toContain("cursor=2 pending(off-screen)=1");
    expect(out).toContain("trigger=event");
    expect(out).toContain("lastRunAgeMs=7");
  });
});
