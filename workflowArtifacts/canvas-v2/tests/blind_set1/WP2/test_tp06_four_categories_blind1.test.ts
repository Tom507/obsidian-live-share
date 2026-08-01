// WP2 / DoD — the four rules as a partition, plus a seam-by-seam discrimination
// matrix.
//
// Angle of attack: the DoD says the four rules are each observable as a distinct
// output category from one call. "Distinct" has two testable halves that a
// single scenario assertion misses:
//
//   PARTITION — over a generated population, the counts have to add up. Every
//   field of every non-blocked save record must appear exactly once, as an
//   upsert or as a discard, and every shadow record missing from the save must be
//   either a delete or nothing. Counting is done from the fixture's own
//   construction, not by re-implementing the classifier.
//
//   DISCRIMINATION — each of the two injected seams governs exactly one category.
//   Flipping `surfaceState.viewOpen` may change `deletes` and nothing else;
//   flipping the tombstone view may empty a record out of `upserts`/`discarded`
//   and must not invent a delete. The matrix below asserts that separation
//   directly, which no single-scenario test can.
//
// The population is built by kind-alternating construction so that nodes and
// edges are interleaved rather than grouped.

import { describe, expect, it } from "vitest";

import {
  type IntentPlan,
  type ParsedSave,
  type ParsedSaveRecord,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Wissen/Netz.canvas";

/** 4 stale, 3 moved, 2 vanished, 2 tombstoned — per id space. */
const STALE = ["s0", "s1", "s2", "s3"];
const MOVED = ["m0", "m1", "m2"];
const VANISHED = ["v0", "v1"];
const BLOCKED = ["b0", "b1"];
const ALL = [...STALE, ...MOVED, ...VANISHED, ...BLOCKED];

const FIELDS_PER_RECORD = 3;

function fieldsFor(id: string, moved: boolean): Record<string, string | number> {
  return { a: `${id}-a`, b: moved ? 999 : 1, c: `${id}-c` };
}

function buildShadow() {
  const shadow = createSurfaceShadow();
  for (const id of ALL) {
    advanceRecord(shadow, PATH, "node", id, fieldsFor(id, false));
    advanceRecord(shadow, PATH, "edge", id, fieldsFor(id, false));
  }
  return shadow;
}

function saveRecords(): ParsedSaveRecord[] {
  return [...STALE, ...MOVED, ...BLOCKED].map((id) => ({
    id,
    fields: fieldsFor(id, MOVED.includes(id)),
  }));
}

const SAVE: ParsedSave = { path: PATH, nodes: saveRecords(), edges: saveRecords() };

const TOMBSTONES: TombstoneView = { isDeleted: (_kind, id) => BLOCKED.includes(id) };

function surface(viewOpen: boolean): SurfaceState {
  return { viewOpen, handedToView: { node: new Set(ALL), edge: new Set(ALL) } };
}

function counts(plan: IntentPlan) {
  return {
    upserts: plan.upserts.length,
    deletes: plan.deletes.length,
    discarded: plan.discarded.length,
  };
}

describe("WP2 DoD — the four rules partition the save", () => {
  it("classifies every field of every unblocked record exactly once", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, surface(true));

    const kinds = 2;
    const unblockedRecords = (STALE.length + MOVED.length) * kinds;
    // Each moved record has exactly one changed field ("b").
    expect(counts(plan).upserts).toBe(MOVED.length * kinds);
    expect(counts(plan).discarded).toBe(
      unblockedRecords * FIELDS_PER_RECORD - MOVED.length * kinds,
    );
    expect(counts(plan).deletes).toBe(VANISHED.length * kinds);

    const classified = plan.upserts.length + plan.discarded.length;
    expect(classified).toBe(unblockedRecords * FIELDS_PER_RECORD);
  });

  it("no record appears in two categories", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, surface(true));

    const upsertKeys = new Set(plan.upserts.map((i) => `${i.kind}:${i.id}`));
    const deleteKeys = new Set(plan.deletes.map((i) => `${i.kind}:${i.id}`));
    const discardKeys = new Set(plan.discarded.map((e) => `${e.kind}:${e.id}`));

    for (const key of deleteKeys) {
      expect(upsertKeys.has(key)).toBe(false);
      expect(discardKeys.has(key)).toBe(false);
    }
    for (const id of BLOCKED) {
      expect([...upsertKeys, ...deleteKeys, ...discardKeys].some((key) => key.endsWith(`:${id}`))).toBe(
        false,
      );
    }
  });

  it("closing the view changes the delete category and nothing else", () => {
    const open = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, surface(true));
    const closed = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, surface(false));

    expect(closed.deletes).toEqual([]);
    expect(open.deletes.length).toBe(VANISHED.length * 2);
    expect(closed.upserts).toEqual(open.upserts);
    expect(closed.discarded).toEqual(open.discarded);
  });

  it("lifting the tombstones changes the upsert and discard categories, never the deletes", () => {
    const blocked = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, surface(true));
    const lifted = planIntentDiff(buildShadow(), SAVE, { isDeleted: () => false }, surface(true));

    expect(lifted.deletes).toEqual(blocked.deletes);
    // The two blocked records per kind were fully stale, so they arrive as discards.
    expect(lifted.discarded.length).toBe(blocked.discarded.length + BLOCKED.length * 2 * FIELDS_PER_RECORD);
    expect(lifted.upserts.length).toBe(blocked.upserts.length);
  });

  it("all three categories are populated by the one call", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, surface(true));

    expect(plan.upserts.length).toBeGreaterThan(0);
    expect(plan.deletes.length).toBeGreaterThan(0);
    expect(plan.discarded.length).toBeGreaterThan(0);
    expect(Object.keys(plan).sort()).toEqual(["deletes", "discarded", "upserts"]);
  });

  it("the plan names only the path the save came from", () => {
    const shadow = buildShadow();
    advanceRecord(shadow, "Wissen/Anderes.canvas", "node", "fremd", { a: "x" });

    const plan = planIntentDiff(shadow, SAVE, TOMBSTONES, surface(true));

    for (const entry of [...plan.upserts, ...plan.deletes, ...plan.discarded]) {
      expect(entry.path).toBe(PATH);
    }
  });
});
