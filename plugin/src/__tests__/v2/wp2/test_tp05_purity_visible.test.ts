// WP2 / AC5 — the intent diff is a pure function.
//
// AC5: "The function is pure: same inputs → same output, no I/O, no clock, no
// randomness."
//
// Purity is not cosmetic here. The whole V2 design rests on the capture decision
// being a total function of three observable states (D1/D12), which is what makes
// it headless-testable and what lets WP23's fuzzer replay a decision across
// replicas and get the same verdict. A hidden clock, a cached previous plan or an
// in-place shadow advance would each break that replayability.
//
// Two oracles, following the WP1 precedent (`wp1/test_tp02_headless_purity_visible`):
//   - the module SOURCE, because under Vitest's node environment a runtime probe
//     for DOM/host globals passes vacuously;
//   - runtime behaviour: repeated calls, interleaved calls, and untouched inputs.
//
// The input-mutation half is specific to WP2: this WP returns a plan, it does not
// apply it. Advancing the shadow is WP4's job, so `planIntentDiff` must leave the
// shadow byte-identical — the inputs here are deep-frozen so any write throws.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  type IntentPlan,
  type ParsedSave,
  type ShadowFieldValue,
  type SurfaceShadow,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  getRecordFields,
  getRecordState,
  listPaths,
  markRecordAbsent,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const SOURCE_URL = new URL("../../../canvas/canvas-shadow.ts", import.meta.url);
const RAW = readFileSync(SOURCE_URL, "utf8");

/** Comments may legitimately NAME the forbidden things; code may not use them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(RAW);

const PATH = "Vault/Purity.canvas";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

/** A readable, comparable snapshot of the whole shadow, via the WP1 API only. */
function snapshotShadow(shadow: SurfaceShadow): string {
  const paths = listPaths(shadow).sort();
  const dump = paths.map((path) => {
    const kinds = (["node", "edge"] as const).map((kind) => {
      // Only ids this test could ever have created are probed — that is enough to
      // detect any advance, absence-mark or removal the call might have performed.
      const ids = ["n1", "n2", "n3", "gone", "e1", "e2"];
      const records = ids.map((id) => {
        const state = getRecordState(shadow, path, kind, id);
        const fields = getRecordFields(shadow, path, kind, id);
        return `${id}=${state}:${JSON.stringify(fields)}`;
      });
      return `${kind}[${records.join(",")}]`;
    });
    return `${path}{${kinds.join("|")}}`;
  });
  return dump.join(";");
}

function deepFreezeSave(save: ParsedSave): ParsedSave {
  for (const record of [...save.nodes, ...save.edges]) {
    Object.freeze(record.fields);
    Object.freeze(record);
  }
  Object.freeze(save.nodes);
  Object.freeze(save.edges);
  return Object.freeze(save);
}

/** The same fixture, built fresh — structural equality, not shared identity. */
function buildShadow(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH, "node", "n1", { x: 10, y: 20, width: 400 });
  advanceRecord(shadow, PATH, "node", "n2", { x: 30, y: 40 });
  advanceRecord(shadow, PATH, "node", "gone", { x: 50 });
  advanceRecord(shadow, PATH, "edge", "e1", { fromNode: "n1", toNode: "n2" });
  markRecordAbsent(shadow, PATH, "node", "n3");
  return shadow;
}

function buildSave(): ParsedSave {
  return deepFreezeSave({
    path: PATH,
    // A save that hits all four rules at once, so purity is asserted over the
    // full decision surface rather than a trivial one.
    nodes: [
      { id: "n1", fields: { x: 10, y: 99, width: 400 } as Record<string, ShadowFieldValue> },
      { id: "n2", fields: { x: 30, y: 40 } as Record<string, ShadowFieldValue> },
      { id: "blocked", fields: { x: 1 } as Record<string, ShadowFieldValue> },
    ],
    edges: [{ id: "e1", fields: { fromNode: "n1", toNode: "n2" } as Record<string, ShadowFieldValue> }],
  });
}

function buildSurface(): SurfaceState {
  return Object.freeze({
    viewOpen: true,
    handedToView: { node: new Set(["n1", "n2", "gone"]), edge: new Set(["e1"]) },
  });
}

const BLOCKED: TombstoneView = { isDeleted: (_kind, id) => id === "blocked" };

function runOnce(): IntentPlan {
  return planIntentDiff(buildShadow(), buildSave(), BLOCKED, buildSurface());
}

describe("WP2 AC5 — planIntentDiff is pure", () => {
  it("same inputs → same output, over repeated calls on one shadow", () => {
    const shadow = buildShadow();
    const save = buildSave();
    const surface = buildSurface();

    const first = planIntentDiff(shadow, save, BLOCKED, surface);
    const second = planIntentDiff(shadow, save, BLOCKED, surface);
    const third = planIntentDiff(shadow, save, BLOCKED, surface);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // …and each call builds a fresh plan rather than handing back a cached one.
    expect(second).not.toBe(first);
    expect(second.upserts).not.toBe(first.upserts);
  });

  it("same inputs → same output across independently built, structurally equal inputs", () => {
    expect(runOnce()).toEqual(runOnce());
  });

  it("holds no state between calls — an interleaved different call changes nothing", () => {
    const shadow = buildShadow();
    const save = buildSave();
    const surface = buildSurface();

    const before = planIntentDiff(shadow, save, BLOCKED, surface);
    // A completely different call in between.
    planIntentDiff(
      createSurfaceShadow(),
      { path: "Elsewhere.canvas", nodes: [{ id: "z", fields: { x: 7 } }], edges: [] },
      NO_TOMBSTONES,
      { viewOpen: false, handedToView: { node: new Set(), edge: new Set() } },
    );
    const after = planIntentDiff(shadow, save, BLOCKED, surface);

    expect(after).toEqual(before);
  });

  it("does not mutate the shadow — this WP plans, WP4 applies", () => {
    const shadow = buildShadow();
    const before = snapshotShadow(shadow);

    planIntentDiff(shadow, buildSave(), BLOCKED, buildSurface());

    expect(snapshotShadow(shadow)).toBe(before);
    expect(listPaths(shadow)).toEqual([PATH]);
  });

  it("does not mutate the parsed save or the surface state", () => {
    const save = buildSave();
    const surface = buildSurface();

    // Deep-frozen inputs: any write would throw a TypeError in module strict mode.
    expect(() => planIntentDiff(buildShadow(), save, BLOCKED, surface)).not.toThrow();

    expect(save.nodes).toHaveLength(3);
    expect(save.nodes[0].fields).toEqual({ x: 10, y: 99, width: 400 });
    expect(surface.handedToView.node.size).toBe(3);
    expect(surface.handedToView.edge.size).toBe(1);
  });

  it("mutating a returned plan cannot affect the next call", () => {
    const shadow = buildShadow();
    const save = buildSave();
    const surface = buildSurface();

    const first = planIntentDiff(shadow, save, BLOCKED, surface);
    const expected = first.upserts.length;
    first.upserts.length = 0;
    first.deletes.length = 0;
    first.discarded.length = 0;

    const second = planIntentDiff(shadow, save, BLOCKED, surface);
    expect(second.upserts).toHaveLength(expected);
  });

  it("reads no clock, no entropy and no timer", () => {
    expect(CODE).not.toMatch(/\bDate\s*\.\s*now\b/);
    expect(CODE).not.toMatch(/\bnew\s+Date\b/);
    expect(CODE).not.toMatch(/\bperformance\s*\.\s*now\b/);
    expect(CODE).not.toMatch(/\bMath\s*\.\s*random\b|\bcrypto\s*\.\s*random/);
    expect(CODE).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\bqueueMicrotask\b/);
  });

  it("performs no I/O and imports no package", () => {
    expect(CODE).not.toMatch(/["'](?:node:)?fs(?:\/promises)?["']/);
    expect(CODE).not.toMatch(/\breadFileSync\b|\bwriteFileSync\b|\bfetch\s*\(/);
    expect(CODE).not.toMatch(/["']obsidian["']/);
    for (const match of CODE.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
      expect(match[1].startsWith("./") || match[1].startsWith("../")).toBe(true);
    }
  });

  it("holds no module-level mutable state", () => {
    // A module-scope `let`/`var` is the shape a memoised plan would take.
    expect(CODE).not.toMatch(/^(?:export\s+)?(?:let|var)\s+/m);
  });
});
