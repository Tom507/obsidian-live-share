// WP2 / AC5 — purity as the absence of every ambient channel.
//
// Angle of attack: rather than repeating a call and comparing, this file closes
// the doors one by one and checks that nothing leaks through them:
//
//   - AMBIENT INPUT: the module may not read `process`, `globalThis`, the
//     environment, a locale or a collator. A locale-sensitive comparison would
//     make the verdict host-dependent, which is the exact class of defect the
//     canonical-ordering rule was written for.
//   - AMBIENT OUTPUT: after classifying a field literally named `__proto__`, the
//     global `Object.prototype` must be untouched.
//   - ALIASING: the returned plan must not hand back the caller's own field
//     objects, or a later mutation by the consumer would rewrite the save.
//   - ASYNCHRONY: a pure classifier is synchronous; a promise anywhere in the
//     module is a channel for I/O.
//   - SHAPE: the function takes exactly the four documented parameters, so there
//     is no fifth "options" or "now" argument to smuggle state through.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type ShadowFieldValue,
  type SurfaceState,
  type TombstoneView,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordState,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const SOURCE = readFileSync(new URL("../../../canvas/canvas-shadow.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const PATH = "vault/one two three.canvas";

const NONE: TombstoneView = { isDeleted: () => false };

function frozenSurface(): SurfaceState {
  return Object.freeze({
    viewOpen: true,
    handedToView: Object.freeze({
      node: new Set(["a", "b", "vanished"]),
      edge: new Set(["e"]),
    }),
  });
}

function scenario() {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH, "node", "a", { x: 1, y: 2, text: "same" });
  advanceRecord(shadow, PATH, "node", "vanished", { x: 3 });
  advanceRecord(shadow, PATH, "edge", "e", { fromNode: "a", toNode: "b" });

  const fields: Record<string, ShadowFieldValue> = { x: 1, y: 20, text: "same" };
  const save: ParsedSave = {
    path: PATH,
    nodes: [
      { id: "a", fields },
      { id: "b", fields: { x: 9 } },
    ],
    edges: [{ id: "e", fields: { fromNode: "a", toNode: "b" } }],
  };
  return { shadow, save, fields };
}

describe("WP2 AC5 — no ambient input, no ambient output", () => {
  it("reads no environment, no host global and no locale", () => {
    expect(SOURCE).not.toMatch(/\bprocess\s*\./);
    expect(SOURCE).not.toMatch(/\bglobalThis\b/);
    expect(SOURCE).not.toMatch(/\bIntl\b|\blocaleCompare\b|\btoLocale[A-Z]/);
    expect(SOURCE).not.toMatch(/\bnavigator\b|\bwindow\b|\bdocument\b/);
    expect(SOURCE).not.toMatch(/\brequire\s*\(/);
  });

  it("is synchronous — no promise, no async, no await", () => {
    expect(SOURCE).not.toMatch(/\basync\b/);
    expect(SOURCE).not.toMatch(/\bawait\b/);
    expect(SOURCE).not.toMatch(/\bPromise\b/);
  });

  it("takes exactly four parameters", () => {
    expect(typeof planIntentDiff).toBe("function");
    expect(planIntentDiff.length).toBe(4);
  });

  it("classifying a `__proto__` field does not pollute Object.prototype", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "n", "__proto__", "shadow-value");

    const fields = JSON.parse('{"__proto__":{"polluted":true},"x":1}') as Record<
      string,
      ShadowFieldValue
    >;
    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [{ id: "n", fields }], edges: [] },
      NONE,
      { viewOpen: false, handedToView: { node: new Set(), edge: new Set() } },
    );

    expect(plan.upserts.length).toBeGreaterThan(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("does not hand back the caller's own field objects", () => {
    const { shadow, save, fields } = scenario();

    const plan = planIntentDiff(shadow, save, NONE, frozenSurface());
    for (const intent of plan.upserts) {
      expect(intent).not.toBe(fields);
      expect(Object.values(intent)).not.toContain(fields);
    }

    // Mutating the plan cannot reach back into the save.
    for (const intent of plan.upserts) intent.value = "clobbered";
    expect(fields.y).toBe(20);
    expect(save.nodes[1].fields.x).toBe(9);
  });

  it("frozen inputs are accepted — nothing is written back", () => {
    const { shadow, save } = scenario();
    Object.freeze(save);
    Object.freeze(save.nodes);
    Object.freeze(save.edges);
    for (const record of [...save.nodes, ...save.edges]) {
      Object.freeze(record);
      Object.freeze(record.fields);
    }

    expect(() => planIntentDiff(shadow, save, NONE, frozenSurface())).not.toThrow();

    // The shadow still says what it said before the call.
    expect(getField(shadow, PATH, "node", "a", "y")).toBe(2);
    expect(getRecordState(shadow, PATH, "node", "vanished")).toBe("present");
    expect(getRecordState(shadow, PATH, "node", "b")).toBe("unknown");
  });

  it("equal-but-distinct input graphs give equal plans", () => {
    const first = scenario();
    const second = scenario();

    expect(planIntentDiff(first.shadow, first.save, NONE, frozenSurface())).toEqual(
      planIntentDiff(second.shadow, second.save, NONE, frozenSurface()),
    );
  });

  it("the tombstone seam is the only place the classifier may ask about deletion", () => {
    // Two views that disagree must be the only reason two otherwise identical
    // calls disagree — nothing about deletion may be inferred from the shadow.
    const { shadow, save } = scenario();
    const open = planIntentDiff(shadow, save, NONE, frozenSurface());
    const shut = planIntentDiff(shadow, save, { isDeleted: () => true }, frozenSurface());

    expect(open.upserts.length).toBeGreaterThan(0);
    expect(shut.upserts).toEqual([]);
    expect(shut.discarded).toEqual([]);
    // "vanished" is still missing from the save, and rule 3 is unaffected by it.
    expect(shut.deletes).toEqual(open.deletes);
  });
});
