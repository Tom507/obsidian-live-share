// B72 — THE WIRING CENSUS. Derived from the product's own source, not from a
// list somebody maintained.
//
// WHY THIS FILE EXISTS AT ALL. `main.ts` has no test file of its own, and this
// project has now found the same gap FOUR times (WP117, WP121, WP122, and B70's
// `S190`, whose one-line receiver bug survived a whole measurement session):
// a wiring hunk can be deleted from a composition root with the whole suite,
// `tsc` and the build all staying green — the fix silently absent from the
// product with every gate reporting success. A logic test over `repaintNode`
// proves the repaint works; it proves nothing at all about whether anything
// calls it.
//
// It is also the answer to a specific hazard of THIS package. B71's finding:
// a hand-rolled fake plugin closes over its data lexically and cannot reproduce
// a lost receiver or a never-constructed element. So the wiring is asserted over
// the SOURCE — which is the one oracle a double cannot fake.
//
// THE SEAMS ARE DERIVED. The census does not hold a list of call sites; it finds
// every unit in the canvas-scoped tree that calls `applyNodeGeometry` and
// requires each one of them to repaint. A fourth apply seam added tomorrow joins
// the requirement automatically, which a filename list could never do.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseUnits, productionSources, stripComments } from "../wp87/surface-route-census";

const SRC = join(__dirname, "..", "..", "..");

function sourceOf(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** Canvas-scoped production units, comments stripped so prose cannot satisfy a check. */
function canvasUnits() {
  return productionSources(SRC)
    .filter((f) => f.file === "main.ts" || f.file.startsWith("canvas/"))
    .flatMap((f) => parseUnits(f.file, stripComments(f.src)));
}

describe("B72 — every remote-apply seam repaints the node it applied to", () => {
  it("T1 the derivation is not vacuous: it finds the apply seams that are known to exist", () => {
    // S53's recursive-vacuity trap, defended: an empty derived set would make
    // every assertion below pass while measuring nothing.
    const appliers = canvasUnits().filter((u) => /\.applyNodeGeometry\s*\(/.test(u.body));
    const ids = appliers.map((u) => u.id).sort();
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids).toContain("main.ts#reconcileLiveCanvas");
    expect(ids).toContain("main.ts#applyCanvasNodeRevert");
    expect(ids).toContain("canvas/canvas-model-bridge.ts#applyNodeUpsert");
  });

  it("T2 THE CRITERION: no unit applies remote geometry without also repainting that node", () => {
    const unrepaired = canvasUnits()
      .filter((u) => /\.applyNodeGeometry\s*\(/.test(u.body))
      // The adapter's own definition of `applyNodeGeometry` is not a caller of it.
      .filter((u) => u.file !== "canvas/canvas-adapter.ts")
      .filter((u) => !/\.repaintNode\s*\?\.\s*\(|\.repaintNode\s*\(/.test(u.body))
      .map((u) => u.id)
      .sort();
    expect(
      unrepaired,
      "a remote geometry apply with no repaint: the model advances and the card does not",
    ).toEqual([]);
  });

  it("T3 the repaint is conditioned on the apply having LANDED, on every seam", () => {
    // A repaint fired for an `"interacting"` or `"missing"` outcome would repaint
    // a card the user is holding, which is the regression WP2 is not allowed to
    // introduce. Every call site must sit behind the `"applied"` test.
    const matching = canvasUnits().filter(
      (o) => /\.repaintNode\s*\?\.\s*\(/.test(o.body) && /\.applyNodeGeometry\s*\(/.test(o.body),
    );
    // WP87's structural rule, reused: a unit whose body ENCLOSES another matching
    // unit is the factory that defines it, not a second call site
    // (`createCanvasModelBridge` contains `applyNodeUpsert`). Counting it would
    // double-count the same seam and make the set look bigger than the tree is.
    const applySeams = matching.filter(
      (u) => !matching.some((o) => o.id !== u.id && u.body.includes(o.body)),
    );
    expect(
      applySeams.map((u) => u.id).sort(),
      "the apply seams vanished from the derivation",
    ).toEqual([
      "canvas/canvas-model-bridge.ts#applyNodeUpsert",
      "main.ts#applyCanvasNodeRevert",
      "main.ts#reconcileLiveCanvas",
    ]);
    for (const u of applySeams) {
      expect(u.body, `${u.id} repaints without checking the apply landed`).toMatch(
        /"applied"|=== "applied"/,
      );
    }
  });

  it("T4 the sweep is STARTED at mount and STOPPED on every path that drops an adapter", () => {
    const main = stripComments(sourceOf("main.ts"));
    // Started where the adapter is registered…
    expect(main).toMatch(/canvasAdapters\.set\([\s\S]{0,80}?\);\s*this\.startCanvasRepaintSweep\(/);
    // …and stopped wherever one is dropped. Both are counted rather than
    // eyeballed: `delete` (a single view closing) and `clear` (teardown).
    const stops = [...main.matchAll(/stopCanvasRepaintSweep\(/g)].length;
    // one definition + one call beside the per-view `delete` + one in teardown
    expect(stops).toBeGreaterThanOrEqual(3);
    expect(main).toMatch(
      /canvasAdapters\.delete\([\s\S]{0,40}?\);\s*this\.stopCanvasRepaintSweep\(/,
    );
    expect(main).toMatch(/stopCanvasRepaintSweep\(path\)[\s\S]{0,120}canvasAdapters\.clear\(\)/);
  });

  it("T5 exactly one interval drives the sweep, and it lives in main.ts and nowhere else", () => {
    const main = stripComments(sourceOf("main.ts"));
    expect([...main.matchAll(/setInterval\(/g)]).toHaveLength(1);
    expect([...main.matchAll(/clearInterval\(/g)]).toHaveLength(1);
    // The adapter owns no clock for the sweep: `sweepRepaint()` is caller-driven,
    // which is why every coverage row above is a real test and not a sleep.
    const adapter = stripComments(sourceOf("canvas/canvas-adapter.ts"));
    const intervals = [...adapter.matchAll(/setInterval\(/g)].length;
    expect(intervals, "the adapter's only interval is WP37's editing poll").toBe(1);
    expect(adapter).toMatch(/editingPoll = setInterval\(/);
  });

  it("T6 the repaint consults the ONE busy/editing definer, not a second predicate", () => {
    const adapter = stripComments(sourceOf("canvas/canvas-adapter.ts"));
    const unit = parseUnits("canvas/canvas-adapter.ts", adapter).find(
      (u) => u.name === "repaintNode",
    );
    expect(unit, "repaintNode is not parseable as a unit").toBeTruthy();
    expect(unit?.body).toMatch(/classifyBusyGate\(/);
    expect(unit?.body).toMatch(/getEditingNodeId/);
    // …and it acts on the answer rather than merely asking (`S94`: a scope claim
    // is only as good as the predicate that implements it).
    expect(unit?.body).toMatch(/"defer-drag"/);
    expect(unit?.body).toMatch(/"editing"/);
    expect(unit?.body).toMatch(/return .*"interacting"/);
  });

  it("T7 the diagnostic can read the counters, and it CANNOT drive the sweep it measures", () => {
    const diag = stripComments(sourceOf("testing/e2e-control.ts"));
    expect(diag).toMatch(/describeRepaintSweep/);
    // R2 — the read-only instrument must not be able to call the thing it is
    // measuring, or a dump would change the number it is reporting.
    expect(diag).not.toMatch(/\bsweepRepaint\b/);
    expect(diag).not.toMatch(/\brepaintNode\b/);
  });
});
