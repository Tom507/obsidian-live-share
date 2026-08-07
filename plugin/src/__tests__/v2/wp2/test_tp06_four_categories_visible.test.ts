// WP2 / Definition of Done — the four rules of Teil 5 are each observable as a
// distinct output category from a SINGLE pure call.
//
// DoD: "the four rules of Teil 5 are each observable as a distinct output
// category from a single pure call."
//
// The previous five files each isolate one rule. This one is the composition
// test: one realistic Obsidian save that triggers all four rules at once, and
// the assertion that they do not bleed into each other. A classifier that
// evaluates the rules in the wrong order — for instance testing "missing from
// the save" before the resurrect block, or reporting a blocked record as
// staleness — passes every isolated test and fails here.
//
// Rule → category mapping under test:
//   equal to shadow          → discarded (and nothing else)
//   differs from shadow      → upserts   (and nothing else)
//   missing + proven surface → deletes   (and nothing else)
//   tombstoned in the save   → no category at all

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Vault/Sprint Board.canvas";

/** The shadow: what provably reached the surface Obsidian saved from. */
function buildShadow() {
  const shadow = createSurfaceShadow();
  // rule 1 + rule 2 live on this record
  advanceRecord(shadow, PATH, "node", "task", { x: 100, y: 200, width: 260, height: 60 });
  // rule 3: still in the shadow, gone from the save, and it was handed over
  advanceRecord(shadow, PATH, "node", "removed", { x: 700, y: 700 });
  // rule 4: tombstoned, but Obsidian has not repainted the view yet
  advanceRecord(shadow, PATH, "node", "deleted-elsewhere", { x: 900, y: 900 });
  // untouched control record
  advanceRecord(shadow, PATH, "edge", "link", { fromNode: "task", toNode: "removed" });
  return shadow;
}

const SAVE: ParsedSave = {
  path: PATH,
  nodes: [
    // x is stale (equals shadow), y expresses a real move.
    { id: "task", fields: { x: 100, y: 340, width: 260, height: 60 } },
    // A peer deleted this one; our view still contains it.
    { id: "deleted-elsewhere", fields: { x: 900, y: 901 } },
    // "removed" is absent from the save entirely.
  ],
  edges: [{ id: "link", fields: { fromNode: "task", toNode: "removed" } }],
};

const TOMBSTONES: TombstoneView = {
  isDeleted: (kind, id) => kind === "node" && id === "deleted-elsewhere",
};

const SURFACE: SurfaceState = {
  viewOpen: true,
  handedToView: {
    node: new Set(["task", "removed", "deleted-elsewhere"]),
    edge: new Set(["link"]),
  },
};

describe("WP2 DoD — all four rules from one call", () => {
  // WP94 (C94 AC6) — THE FOURTH CATEGORY, and it is added for the same reason
  // `discarded` is a category rather than an absence.
  //
  // WP2's own comment on `DiscardedStaleness` says it: "The discard is a
  // first-class output, not an absence". A WITHHELD DELETE is the same kind of
  // fact one rule further down — "this record was a delete candidate and the
  // evidence did not license it" — and S78 survived a whole run of adversarial
  // review precisely because it was an absence: the delete set was computed
  // correctly, dropped for want of a licence, and reported as `-0 node(s)`, which
  // is byte-identical to "the user deleted nothing". The pin below is UPDATED,
  // not relaxed: it is still an exact key set, so a fifth category cannot appear
  // unnoticed either.
  it("returns exactly the four categories", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    expect(Object.keys(plan).sort()).toEqual(["deletes", "discarded", "upserts", "withheld"]);
    expect(Array.isArray(plan.upserts)).toBe(true);
    expect(Array.isArray(plan.deletes)).toBe(true);
    expect(Array.isArray(plan.discarded)).toBe(true);
    expect(Array.isArray(plan.withheld)).toBe(true);
  });

  it("rule 2 — the only real edit is the only upsert", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "task", field: "y", value: 340 },
    ]);
  });

  it("rule 3 — the vanished record is the only delete", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    expect(plan.deletes).toEqual([{ path: PATH, kind: "node", id: "removed" }]);
  });

  it("rule 1 — every unchanged field is an explicit discard", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    // task: x, width, height. link: fromNode, toNode. (deleted-elsewhere: blocked.)
    expect(plan.discarded).toHaveLength(5);
    expect(plan.discarded.map((entry) => `${entry.kind}:${entry.id}.${entry.field}`).sort()).toEqual([
      "edge:link.fromNode",
      "edge:link.toNode",
      "node:task.height",
      "node:task.width",
      "node:task.x",
    ]);
    expect(plan.discarded.every((entry) => entry.reason === "equals-shadow")).toBe(true);
  });

  it("rule 4 — the tombstoned record appears in no category", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    const mentions = [
      ...plan.upserts.map((intent) => intent.id),
      ...plan.deletes.map((intent) => intent.id),
      ...plan.discarded.map((entry) => entry.id),
    ];
    expect(mentions).not.toContain("deleted-elsewhere");
  });

  it("the categories are disjoint — no record is both upserted and deleted", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    const deleted = new Set(plan.deletes.map((intent) => `${intent.kind}:${intent.id}`));
    for (const intent of plan.upserts) {
      expect(deleted.has(`${intent.kind}:${intent.id}`)).toBe(false);
    }
    for (const entry of plan.discarded) {
      expect(deleted.has(`${entry.kind}:${entry.id}`)).toBe(false);
    }
    // A single (record, field) pair is never both an upsert and a discard.
    const upserted = new Set(plan.upserts.map((i) => `${i.kind}:${i.id}.${i.field}`));
    for (const entry of plan.discarded) {
      expect(upserted.has(`${entry.kind}:${entry.id}.${entry.field}`)).toBe(false);
    }
  });

  it("every field of every non-blocked save record lands in exactly one category", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    // task has 4 fields, link has 2; deleted-elsewhere's 2 are blocked entirely.
    const classifiableFields = 4 + 2;

    expect(plan.upserts.length + plan.discarded.length).toBe(classifiableFields);
  });

  it("all four rules fire in one call — no category is empty and the block is real", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, TOMBSTONES, SURFACE);

    expect(plan.upserts.length).toBeGreaterThan(0);
    expect(plan.deletes.length).toBeGreaterThan(0);
    expect(plan.discarded.length).toBeGreaterThan(0);

    // Discrimination: without the tombstone view the blocked record produces
    // intent, which proves the block above was doing the work.
    const unblocked = planIntentDiff(buildShadow(), SAVE, { isDeleted: () => false }, SURFACE);
    expect(unblocked.upserts).toContainEqual({
      path: PATH,
      kind: "node",
      id: "deleted-elsewhere",
      field: "y",
      value: 901,
    });
  });
});
