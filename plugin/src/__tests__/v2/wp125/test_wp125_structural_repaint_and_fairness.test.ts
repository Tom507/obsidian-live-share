import { describe, expect, it, vi } from "vitest";

import { createCanvasAdapter, planRepaintSweep } from "../../../canvas/canvas-adapter";
import { renderView } from "../b72/obsidian-render-double";

const records = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, x: i, y: 0, width: 100, height: 50 }));

function beginDrag(canvas: ReturnType<typeof renderView>["canvas"], id: string): void {
  canvas.nodeInteractionLayer.target = { id };
  canvas.setDragging(true);
}

function repairCounts(
  report: ReturnType<NonNullable<ReturnType<typeof createCanvasAdapter>["describeRepaintSweep"]>> | undefined,
) {
  if (!report) throw new Error("adapter omitted repaint diagnostics");
  return {
    perNodeSeam: report.sources.perNodeSeam.repairs,
    structuralSeam: report.sources.structuralSeam.repairs,
    sweep: report.sources.sweep.repairs,
  };
}

describe("WP125 A1/A2/A5 - structural apply owns changed paint", () => {
  it("renders exactly changed existing attached nodes after setData", () => {
    const { view, canvas } = renderView(records(3));
    canvas.paintAll();
    const adapter = createCanvasAdapter(view);
    const order: string[] = [];
    const original = canvas.setData.bind(canvas);
    canvas.setData = (data: unknown) => { order.push("setData"); original(data); };
    for (const node of canvas.nodes.values()) {
      const render = node.render.bind(node);
      node.render = () => { order.push(`render:${node.id}`); render(); };
    }
    expect(adapter.reloadCanvasData({ nodes: [records(3)[0], { ...records(3)[1], x: 99 }, { ...records(3)[2], y: 88 }], edges: [] })).toBe(true);
    expect(order).toEqual(["setData", "render:n1", "render:n2"]);
    const report = adapter.describeRepaintSweep?.();
    expect(report?.structuralChangedIds).toBe(2);
    expect(report?.sources.structuralSeam.attempts).toBe(2);
    expect(report?.sources.perNodeSeam.attempts).toBe(0);
    expect(report?.sources.sweep.attempts).toBe(0);
  });

  it("does not repaint when setData throws", () => {
    const { view, canvas } = renderView(records(2));
    canvas.paintAll();
    const adapter = createCanvasAdapter(view);
    const renders = [...canvas.nodes.values()].map((n) => vi.spyOn(n, "render"));
    canvas.setData = () => { throw new Error("plant"); };
    expect(adapter.reloadCanvasData({ nodes: [{ ...records(2)[0], x: 9 }, records(2)[1]], edges: [] })).toBe(false);
    expect(renders.every((s) => s.mock.calls.length === 0)).toBe(true);
    expect(adapter.describeRepaintSweep?.().structuralChangedIds).toBe(0);
  });

  it("defers a detached changed node and requests event recovery", () => {
    const { view, canvas } = renderView(records(2));
    canvas.paintAll();
    canvas.nodes.get("n1")?.detach();
    const request = vi.fn();
    const adapter = createCanvasAdapter(view, { requestRepaintSweep: request });
    adapter.reloadCanvasData({ nodes: [records(2)[0], { ...records(2)[1], x: 44 }], edges: [] });
    const report = adapter.describeRepaintSweep?.();
    expect(report?.sources.structuralSeam.deferred).toBe(1);
    expect(report?.sources.structuralSeam.repairs).toBe(0);
    expect(report?.pendingCount).toBe(1);
    expect(request).toHaveBeenCalled();
  });

  it("A2 keeps an editing node under interaction ownership, then recovers it fairly", () => {
    const { view, canvas } = renderView(records(2));
    canvas.paintAll();
    const request = vi.fn();
    const adapter = createCanvasAdapter(view, { requestRepaintSweep: request });
    const edited = canvas.nodes.get("n1");
    if (!edited) throw new Error("fixture lost n1");
    const render = vi.spyOn(edited, "render");
    const requestSave = vi.spyOn(canvas, "requestSave");

    edited.isEditing = true;
    expect(adapter.getEditingNodeId?.()).toBe("n1");
    expect(
      adapter.reloadCanvasData({
        nodes: [records(2)[0], { ...records(2)[1], x: 44 }],
        edges: [],
      }),
    ).toBe(true);

    expect(render, "structural reload must not force paint through an open editor").not.toHaveBeenCalled();
    expect(edited.paintedAt()).toEqual({ x: 1, y: 0 });
    expect(adapter.describeRepaintSweep?.()).toMatchObject({
      pendingCount: 0,
      sources: { structuralSeam: { attempts: 1, repairs: 0, interacting: 1 } },
    });
    expect(request, "the refused structural paint remains eligible for an event sweep").toHaveBeenCalled();
    expect(requestSave, "paint-only recovery must not ask the canvas/vault to persist").not.toHaveBeenCalled();

    edited.isEditing = false;
    expect(adapter.getEditingNodeId?.()).toBeNull();
    expect(adapter.sweepRepaint?.()?.visited).toContain("n1");
    expect(edited.paintedAt()).toEqual({ x: 44, y: 0 });
    expect(adapter.describeRepaintSweep?.().sources.sweep.repairs).toBe(1);
    expect(requestSave).not.toHaveBeenCalled();
  });

  it("A2 refuses a structural reload during an active drag, then accepts the same reload after release", () => {
    const { view, canvas } = renderView(records(2));
    canvas.paintAll();
    const request = vi.fn();
    const adapter = createCanvasAdapter(view, { requestRepaintSweep: request });
    adapter.onNodeInteractionStart(() => undefined);
    const dragged = canvas.nodes.get("n1");
    if (!dragged) throw new Error("fixture lost n1");
    const render = vi.spyOn(dragged, "render");
    const requestSave = vi.spyOn(canvas, "requestSave");
    const changed = { nodes: [records(2)[0], { ...records(2)[1], x: 55 }], edges: [] };

    beginDrag(canvas, "n1");
    expect(adapter.isBusy()).toBe(true);
    expect(adapter.reloadCanvasData(changed), "false is the named structural drag refusal").toBe(false);
    expect(render).not.toHaveBeenCalled();
    expect(dragged.x).toBe(1);
    expect(adapter.describeRepaintSweep?.()).toMatchObject({
      structuralChangedIds: 0,
      sources: { structuralSeam: { attempts: 0, repairs: 0, interacting: 0 } },
    });
    expect(request).not.toHaveBeenCalled();
    expect(requestSave).not.toHaveBeenCalled();

    canvas.setDragging(false);
    canvas.nodeInteractionLayer.target = null;
    expect(adapter.isBusy()).toBe(false);
    expect(adapter.reloadCanvasData(changed), "the refused work remains eligible after drag release").toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(dragged.paintedAt()).toEqual({ x: 55, y: 0 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(requestSave).not.toHaveBeenCalled();
  });

  it("A5 attributes a mixed repair sequence exactly and never calls refusals repairs", () => {
    const { view, canvas } = renderView(records(3));
    canvas.paintAll();
    const adapter = createCanvasAdapter(view);
    const n0 = canvas.nodes.get("n0");
    const n1 = canvas.nodes.get("n1");
    const n2 = canvas.nodes.get("n2");
    if (!n0 || !n1 || !n2) throw new Error("fixture lost mixed-source nodes");

    n0.x = 10;
    expect(adapter.repaintNode?.("n0")).toBe("repaired");
    expect(repairCounts(adapter.describeRepaintSweep?.())).toEqual({
      perNodeSeam: 1,
      structuralSeam: 0,
      sweep: 0,
    });

    expect(
      adapter.reloadCanvasData({
        nodes: [{ ...records(3)[0], x: 10 }, { ...records(3)[1], x: 20 }, records(3)[2]],
        edges: [],
      }),
    ).toBe(true);
    expect(repairCounts(adapter.describeRepaintSweep?.())).toEqual({
      perNodeSeam: 1,
      structuralSeam: 1,
      sweep: 0,
    });

    n2.x = 30;
    expect(adapter.sweepRepaint?.()?.outcomes.repaired).toBe(1);
    let report = adapter.describeRepaintSweep?.();
    if (!report) throw new Error("adapter omitted mixed-source diagnostics");
    expect(repairCounts(report)).toEqual({ perNodeSeam: 1, structuralSeam: 1, sweep: 1 });
    expect(report.repaired).toBe(
      report.sources.perNodeSeam.repairs +
        report.sources.structuralSeam.repairs +
        report.sources.sweep.repairs,
    );

    expect(adapter.repaintNode?.("n0"), "already-correct paint is a no-op repair").toBe("repainted");
    n1.isEditing = true;
    expect(adapter.getEditingNodeId?.()).toBe("n1");
    expect(adapter.repaintNode?.("n1"), "editing refusal has its own outcome").toBe("interacting");
    n1.isEditing = false;
    expect(adapter.getEditingNodeId?.()).toBeNull();
    n2.detach();
    expect(adapter.repaintNode?.("n2"), "detached paint is deferred, not repaired").toBe("deferred");

    report = adapter.describeRepaintSweep?.();
    if (!report) throw new Error("adapter omitted post-control diagnostics");
    expect(repairCounts(report)).toEqual({ perNodeSeam: 1, structuralSeam: 1, sweep: 1 });
    expect(report.repaired).toBe(3);
  });
});

describe("WP125 A3 - priority cannot starve round-robin", () => {
  it.each([[11, 3, 3], [200, 10, 10]])("covers %i ids with batch %i despite %i permanent priorities", (n, batch, priorityCount) => {
    const ids = records(n).map((r) => r.id);
    const priority = ids.slice(0, priorityCount);
    const seen = new Set<string>();
    let cursor = 0;
    const bound = Math.ceil(n / Math.max(1, batch - Math.min(priorityCount, batch - 1)));
    for (let tick = 0; tick < bound; tick++) {
      const before = cursor;
      const plan = planRepaintSweep({ ids, cursor, batchSize: batch, priority });
      cursor = plan.cursor;
      expect(cursor).not.toBe(before);
      expect(new Set(plan.ids).size).toBe(plan.ids.length);
      for (const id of plan.ids) seen.add(id);
    }
    expect(seen.size).toBe(n);
  });

  it.each([
    { n: 0, batch: 3, priorityCount: 0 },
    { n: 1, batch: 3, priorityCount: 0 },
    { n: 1, batch: 3, priorityCount: 1 },
    { n: 11, batch: 3, priorityCount: 0 },
    { n: 11, batch: 3, priorityCount: 2 },
    { n: 11, batch: 3, priorityCount: 3 },
    { n: 11, batch: 3, priorityCount: 6 },
    { n: 200, batch: 10, priorityCount: 0 },
    { n: 200, batch: 10, priorityCount: 9 },
    { n: 200, batch: 10, priorityCount: 10 },
    { n: 200, batch: 10, priorityCount: 15 },
  ])("covers the n=$n batch=$batch priority=$priorityCount planner row", ({ n, batch, priorityCount }) => {
    const ids = records(n).map((r) => r.id);
    const priority = [...ids.slice(0, priorityCount), ...ids.slice(0, 2), "deleted", "deleted"];
    const livePriority = new Set(priority.filter((id) => ids.includes(id))).size;
    const rrSlots = n <= 1 ? Math.min(batch, n) : Math.max(1, Math.min(batch, n) - Math.min(livePriority, Math.min(batch, n) - 1));
    const bound = n === 0 ? 1 : Math.ceil(n / Math.max(1, rrSlots));
    const seen = new Set<string>();
    let cursor = n + 7;

    for (let tick = 0; tick < bound; tick++) {
      const plan = planRepaintSweep({ ids, cursor, batchSize: batch, priority });
      expect(new Set(plan.ids).size, "one id may appear at most once per batch").toBe(plan.ids.length);
      expect(plan.ids.every((id) => ids.includes(id))).toBe(true);
      expect(plan.cursor).toBeGreaterThanOrEqual(0);
      expect(plan.cursor).toBeLessThan(Math.max(1, n));
      cursor = plan.cursor;
      for (const id of plan.ids) seen.add(id);
    }
    expect(seen).toEqual(new Set(ids));
  });

  it("keeps every survivor bounded across id reorder and deletion", () => {
    const original = records(11).map((r) => r.id);
    let live = [...original];
    let cursor = 0;
    const priority = ["n0", "n1", "n2", "n2", "deleted"];

    for (let tick = 0; tick < 3; tick++) {
      const reordered = tick % 2 === 0 ? [...live].reverse() : [...live.slice(4), ...live.slice(0, 4)];
      const plan = planRepaintSweep({ ids: reordered, cursor, batchSize: 3, priority });
      expect(new Set(plan.ids).size).toBe(plan.ids.length);
      cursor = plan.cursor;
    }

    live = live.filter((id) => id !== "n3" && id !== "n7");
    const survivorsSeen = new Set<string>();
    for (let tick = 0; tick < live.length; tick++) {
      const reordered = tick % 2 === 0 ? [...live].reverse() : [...live.slice(2), ...live.slice(0, 2)];
      const plan = planRepaintSweep({ ids: reordered, cursor, batchSize: 3, priority });
      expect(new Set(plan.ids).size).toBe(plan.ids.length);
      expect(plan.ids.every((id) => live.includes(id))).toBe(true);
      expect(plan.cursor).toBeGreaterThanOrEqual(0);
      expect(plan.cursor).toBeLessThan(live.length);
      cursor = plan.cursor;
      for (const id of plan.ids) survivorsSeen.add(id);
    }
    expect(survivorsSeen).toEqual(new Set(live));
  });
});
