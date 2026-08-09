// B72 / WP3 — THE SAFETY-NET SWEEP: BOUNDED COVERAGE, AND A COUNTER THAT MAKES
// IT IMPOSSIBLE FOR IT TO HIDE THE DEFECT.
//
// The owner's design: *"randomly selecting a couple of nodes each frame and
// redrawing them, that would continuously repair the damage."* The rate and the
// shape are this package's to argue, and the one thing the implementation does
// NOT do is sample randomly — see T1. Uniform random has coupon-collector
// coverage (`n ln n` draws for one full pass IN EXPECTATION) and no bound at all
// on how long one particular card can stay broken. A round-robin has a hard
// bound, and a hard bound is what "restoring force" has to mean if it is going
// to be checkable.
//
// THE HAZARD THIS FILE IS MOSTLY ABOUT. A sweep that silently repaired
// everything would be worse than no sweep: the board would look correct, the
// paint plane would find nothing, and the ability to measure the CAUSE would be
// gone. `describeRepaintSweep().repaired` is what keeps the damage rate visible
// even when the damage is not — T4 and T5 are that property.

import { describe, expect, it } from "vitest";

import {
  REPAINT_SWEEP_MAX_BATCH,
  REPAINT_SWEEP_MIN_BATCH,
  REPAINT_SWEEP_TARGET_TICKS,
  createCanvasAdapter,
  parseTranslatePx,
  planRepaintSweep,
  repaintBatchSize,
} from "../../../canvas/canvas-adapter";
import { renderView } from "./obsidian-render-double";

function board(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${String(i).padStart(3, "0")}`,
    x: i * 10,
    y: 0,
    width: 200,
    height: 100,
  }));
}

function rig(n: number) {
  const { view, canvas } = renderView(board(n));
  const adapter = createCanvasAdapter(view);
  canvas.paintAll();
  return { canvas, adapter };
}

describe("B72 WP3 — the plan is pure, and its coverage is BOUNDED not expected", () => {
  it("T1 every card is visited within ceil(n/batch) ticks — for every board size, not one", () => {
    for (const n of [1, 3, 7, 11, 50, 137, 500, 1000]) {
      const ids = board(n).map((r) => r.id);
      const batch = repaintBatchSize(n);
      const bound = Math.ceil(n / batch);
      const seen = new Set<string>();
      let cursor = 0;
      for (let tick = 0; tick < bound; tick++) {
        const plan = planRepaintSweep({ ids, cursor, batchSize: batch });
        cursor = plan.cursor;
        for (const id of plan.ids) seen.add(id);
      }
      expect(seen.size, `board of ${n} covered in ${bound} ticks`).toBe(n);
    }
  });

  it("T2 the batch size is bounded at both ends, and a big board is capped", () => {
    expect(repaintBatchSize(0)).toBe(0);
    expect(repaintBatchSize(1)).toBe(REPAINT_SWEEP_MIN_BATCH);
    expect(repaintBatchSize(11)).toBe(REPAINT_SWEEP_MIN_BATCH);
    // The target is one full pass per REPAINT_SWEEP_TARGET_TICKS ticks…
    expect(repaintBatchSize(200)).toBe(200 / REPAINT_SWEEP_TARGET_TICKS);
    // …until the cap takes over, which is what keeps a huge board invisible.
    expect(repaintBatchSize(100_000)).toBe(REPAINT_SWEEP_MAX_BATCH);
  });

  it("T3 no card is visited twice in one tick, even when the batch is the whole board", () => {
    const ids = board(4).map((r) => r.id);
    const plan = planRepaintSweep({ ids, cursor: 2, batchSize: 10, priority: ["n001", "n003"] });
    expect(new Set(plan.ids).size).toBe(plan.ids.length);
    expect(plan.ids.length).toBe(4);
    // Priority first, then the round-robin from the cursor.
    expect(plan.ids.slice(0, 2)).toEqual(["n001", "n003"]);
  });

  it("T3b a priority id that is not live is dropped, never carried and never invented", () => {
    const ids = board(3).map((r) => r.id);
    const plan = planRepaintSweep({ ids, cursor: 0, batchSize: 2, priority: ["ghost"] });
    expect(plan.ids).not.toContain("ghost");
    expect(plan.ids.length).toBe(2);
  });

  it("T3c the transform parser answers null for 'no transform' and never (0,0)", () => {
    // A card at the origin is a real answer and must not be manufactured out of
    // "there was nothing to read" — the same R7 rule the paint plane runs on.
    expect(parseTranslatePx("")).toBe(null);
    expect(parseTranslatePx("none")).toBe(null);
    expect(parseTranslatePx(undefined)).toBe(null);
    expect(parseTranslatePx("matrix(1, 0, 0, 1, 5, 6)")).toBe(null);
    expect(parseTranslatePx("translate(0px, 0px)")).toEqual({ x: 0, y: 0 });
    expect(parseTranslatePx("translate(-12.5px, 7px)")).toEqual({ x: -12.5, y: 7 });
  });
});

describe("B72 WP3 — the sweep over the real adapter", () => {
  it("T4 it REPAIRS damage nothing else knew about, and it says how much", () => {
    const { canvas, adapter } = rig(11);
    // Damage from a cause this fix has NOT identified: three cards' models
    // advanced and their elements were never rewritten. Nothing in the plugin
    // did this; that is the point of a safety net.
    for (const id of ["n002", "n005", "n009"]) {
      const node = canvas.nodes.get(id);
      if (!node) throw new Error(`fixture lost ${id}`);
      node.x += 500;
    }
    // One tick is a full pass on an 11-node board (batch 3 → 4 ticks).
    for (let i = 0; i < 4; i++) adapter.sweepRepaint?.();

    for (const id of ["n002", "n005", "n009"]) {
      const node = canvas.nodes.get(id);
      if (!node) throw new Error(`fixture lost ${id}`);
      expect(node.paintedAt()).toEqual({ x: node.x, y: node.y });
    }
    const report = adapter.describeRepaintSweep?.();
    expect(report?.repaired).toBe(3); // exactly the damage, not more
    expect(report?.ticks).toBe(4);
    expect(report?.visited).toBe(12); // 4 ticks × batch 3, wrapping once
  });

  it("T5 THE NEGATIVE CONTROL — on an undamaged board it repairs NOTHING and says zero", () => {
    // The counter has to be able to report success as well as damage, or a
    // non-zero reading would mean nothing. This is the row that makes T4's `3`
    // a measurement instead of a constant.
    const { adapter } = rig(11);
    for (let i = 0; i < 4; i++) adapter.sweepRepaint?.();
    const report = adapter.describeRepaintSweep?.();
    expect(report?.repaired).toBe(0);
    expect(report?.repainted).toBe(12); // it DID run — 12 visits, 0 repairs
    expect(report?.ticks).toBe(4);
  });

  it("T6 an empty board is a stated skip, not a silent success", () => {
    const { adapter } = rig(0);
    const tick = adapter.sweepRepaint?.();
    expect(tick?.skipped).toBe("no-nodes");
    expect(adapter.describeRepaintSweep?.().skippedEmpty).toBe(1);
    expect(adapter.describeRepaintSweep?.().repaired).toBe(0);
  });

  it("T7 the cost is bounded and observable: one tick renders at most `batch` cards", () => {
    const { canvas, adapter } = rig(500);
    const before = [...canvas.nodes.values()].reduce((a, n) => a + n.renderCount, 0);
    adapter.sweepRepaint?.();
    const after = [...canvas.nodes.values()].reduce((a, n) => a + n.renderCount, 0);
    expect(after - before).toBe(REPAINT_SWEEP_MAX_BATCH);
    expect(adapter.describeRepaintSweep?.().lastBatchSize).toBe(REPAINT_SWEEP_MAX_BATCH);
    expect(adapter.describeRepaintSweep?.().lastNodeCount).toBe(500);
  });

  it("T8 an adapter over a shape with no private canvas REFUSES the tick and names it", () => {
    const adapter = createCanvasAdapter({});
    const tick = adapter.sweepRepaint?.();
    expect(tick?.skipped).toBe("unavailable");
    expect(adapter.describeRepaintSweep?.().repaired).toBe(0);
    expect(adapter.describeRepaintSweep?.().ticks).toBe(1); // it was ASKED, and refused
  });
});
