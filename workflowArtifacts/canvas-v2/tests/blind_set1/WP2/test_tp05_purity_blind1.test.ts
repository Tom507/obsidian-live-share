// WP2 / AC5 — purity as invariance, measured over a generated population.
//
// Angle of attack: "same inputs → same output" is usually tested by calling twice
// with the identical object graph, which a memoising or clock-reading
// implementation can still pass if the two calls happen in the same millisecond
// or hit the same cache entry. This file instead asserts the stronger, structural
// form of the property:
//
//   - INVARIANCE UNDER CONSTRUCTION ORDER: the same logical state built by
//     advancing the shadow in a different order, and by listing the save records
//     in a different order, must yield the same plan as a multiset.
//   - STABILITY OVER MANY ITERATIONS: 60 independent runs over a seeded
//     generator, all compared against the first.
//   - NO INPUT MUTATION: the shadow is read back through the WP1 API after the
//     call and must be unchanged, including the records the plan wanted to delete.
//
// The generator is a 32-bit LCG with a fixed seed — deterministic, no clock, no
// `Math.random`, no wall-clock sleep.

import { describe, expect, it } from "vitest";

import {
  type IntentPlan,
  type ParsedSave,
  type ParsedSaveRecord,
  type SurfaceShadow,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  getRecordFields,
  getRecordState,
  listPaths,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Generated/Fuzz.canvas";

/** Deterministic 32-bit LCG (Numerical Recipes constants). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

const IDS = Array.from({ length: 12 }, (_, index) => `r${index}`);

/** The shadow, advanced in the order given by `order`. */
function buildShadow(order: readonly string[]): SurfaceShadow {
  const shadow = createSurfaceShadow();
  for (const id of order) {
    const index = IDS.indexOf(id);
    advanceRecord(shadow, PATH, "node", id, { x: index * 3, y: index * 5, label: `L${index}` });
    advanceRecord(shadow, PATH, "edge", id, { fromNode: `r${index}`, weight: index });
  }
  return shadow;
}

/** The save, listing records in the order given by `order`. */
function buildSave(order: readonly string[]): ParsedSave {
  const nodes: ParsedSaveRecord[] = [];
  const edges: ParsedSaveRecord[] = [];
  for (const id of order) {
    const index = IDS.indexOf(id);
    // Every third record moved; the eleventh is missing from the save entirely.
    if (id === "r11") continue;
    nodes.push({
      id,
      fields: { x: index % 3 === 0 ? index * 3 + 1 : index * 3, y: index * 5, label: `L${index}` },
    });
    edges.push({ id, fields: { fromNode: `r${index}`, weight: index } });
  }
  return { path: PATH, nodes, edges };
}

const SURFACE: SurfaceState = {
  viewOpen: true,
  handedToView: { node: new Set(IDS), edge: new Set(IDS) },
};

const TOMBSTONES: TombstoneView = { isDeleted: (kind, id) => kind === "node" && id === "r7" };

/** Order-independent fingerprint of a plan. */
function fingerprint(plan: IntentPlan): string {
  const upserts = plan.upserts
    .map((intent) => `U ${intent.path} ${intent.kind} ${intent.id} ${intent.field} ${JSON.stringify(intent.value)}`)
    .sort();
  const deletes = plan.deletes.map((intent) => `D ${intent.path} ${intent.kind} ${intent.id}`).sort();
  const discarded = plan.discarded
    .map((entry) => `S ${entry.path} ${entry.kind} ${entry.id} ${entry.field} ${JSON.stringify(entry.value)} ${entry.reason}`)
    .sort();
  return [...upserts, ...deletes, ...discarded].join("\n");
}

/** A deterministic shuffle of `IDS` for the given seed. */
function shuffled(seed: number): string[] {
  const next = lcg(seed);
  const items = [...IDS];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const pick = next() % (index + 1);
    const swap = items[index];
    items[index] = items[pick];
    items[pick] = swap;
  }
  return items;
}

describe("WP2 AC5 — the plan is a function of the state, not of the traversal", () => {
  it("is invariant under the order the shadow was advanced in", () => {
    const reference = fingerprint(
      planIntentDiff(buildShadow(IDS), buildSave(IDS), TOMBSTONES, SURFACE),
    );

    for (const seed of [1, 7, 99, 4242]) {
      const plan = planIntentDiff(buildShadow(shuffled(seed)), buildSave(IDS), TOMBSTONES, SURFACE);
      expect(fingerprint(plan)).toBe(reference);
    }
  });

  it("is invariant under the order the save lists its records in", () => {
    const reference = fingerprint(
      planIntentDiff(buildShadow(IDS), buildSave(IDS), TOMBSTONES, SURFACE),
    );

    for (const seed of [2, 13, 555, 90210]) {
      const plan = planIntentDiff(buildShadow(IDS), buildSave(shuffled(seed)), TOMBSTONES, SURFACE);
      expect(fingerprint(plan)).toBe(reference);
    }
  });

  it("is stable over 60 independent runs", () => {
    const reference = fingerprint(
      planIntentDiff(buildShadow(IDS), buildSave(IDS), TOMBSTONES, SURFACE),
    );

    for (let run = 0; run < 60; run += 1) {
      expect(fingerprint(planIntentDiff(buildShadow(IDS), buildSave(IDS), TOMBSTONES, SURFACE))).toBe(
        reference,
      );
    }
  });

  it("produces a non-trivial plan — the invariance above is not vacuous", () => {
    const plan = planIntentDiff(buildShadow(IDS), buildSave(IDS), TOMBSTONES, SURFACE);

    expect(plan.upserts.length).toBeGreaterThan(0);
    expect(plan.deletes.length).toBeGreaterThan(0);
    expect(plan.discarded.length).toBeGreaterThan(0);
  });

  it("leaves the shadow untouched, including the records it planned to delete", () => {
    const shadow = buildShadow(IDS);
    const before = IDS.flatMap((id) =>
      (["node", "edge"] as const).map(
        (kind) =>
          `${kind}:${id}=${getRecordState(shadow, PATH, kind, id)}:${JSON.stringify(
            getRecordFields(shadow, PATH, kind, id),
          )}`,
      ),
    );

    planIntentDiff(shadow, buildSave(IDS), TOMBSTONES, SURFACE);

    const after = IDS.flatMap((id) =>
      (["node", "edge"] as const).map(
        (kind) =>
          `${kind}:${id}=${getRecordState(shadow, PATH, kind, id)}:${JSON.stringify(
            getRecordFields(shadow, PATH, kind, id),
          )}`,
      ),
    );

    expect(after).toEqual(before);
    expect(listPaths(shadow)).toEqual([PATH]);
  });

  it("an interleaved unrelated call leaves the result unchanged", () => {
    const shadow = buildShadow(IDS);
    const save = buildSave(IDS);
    const first = fingerprint(planIntentDiff(shadow, save, TOMBSTONES, SURFACE));

    planIntentDiff(buildShadow(shuffled(3)), buildSave(shuffled(4)), { isDeleted: () => true }, {
      viewOpen: false,
      handedToView: { node: new Set(), edge: new Set() },
    });

    expect(fingerprint(planIntentDiff(shadow, save, TOMBSTONES, SURFACE))).toBe(first);
  });
});
