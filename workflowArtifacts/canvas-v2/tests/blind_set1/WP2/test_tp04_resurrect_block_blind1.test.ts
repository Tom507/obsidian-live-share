// WP2 / AC4 — the resurrect block over a mixed population, and per call.
//
// Angle of attack: AC4 is usually tested with one dead record among live ones.
// The interesting failures are population-level:
//   - the block leaking to neighbours (an early `return` in the record loop
//     rather than a `continue`), which this file catches by tombstoning records
//     in the MIDDLE of both id spaces and asserting the survivors exactly;
//   - the tombstone verdict being cached across calls, which this file catches
//     with a view whose answer flips between two otherwise identical calls — the
//     tombstone map is a live CRDT container, so a delete arriving between two
//     saves must take effect on the second one;
//   - quarantine (`q:true`, which also carries `on:true`) being treated as a
//     different case; it is not — the classifier sees only `on`.
//
// Fixture: nine records with German ids, tombstones on positions 2, 5 and 8, and
// the block asserted through the surviving set rather than through the blocked one.

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "Archiv/Zettelkasten.canvas";

const NODE_IDS = ["eins", "zwei", "drei", "vier", "fünf"] as const;
const EDGE_IDS = ["alpha", "beta", "gamma", "delta"] as const;

const SURFACE: SurfaceState = {
  viewOpen: true,
  handedToView: { node: new Set(NODE_IDS), edge: new Set(EDGE_IDS) },
};

function buildShadow() {
  const shadow = createSurfaceShadow();
  NODE_IDS.forEach((id, index) => advanceRecord(shadow, PATH, "node", id, { x: index, y: index }));
  EDGE_IDS.forEach((id, index) => advanceRecord(shadow, PATH, "edge", id, { fromNode: `${index}` }));
  return shadow;
}

/** Every record moved, so an unblocked record always produces visible intent. */
const SAVE: ParsedSave = {
  path: PATH,
  nodes: NODE_IDS.map((id, index) => ({ id, fields: { x: index + 1000, y: index } })),
  edges: EDGE_IDS.map((id, index) => ({ id, fields: { fromNode: `${index + 1000}` } })),
};

function tombstoneView(...keys: string[]): TombstoneView {
  const on = new Set(keys);
  return { isDeleted: (kind, id) => on.has(`${kind}:${id}`) };
}

describe("WP2 AC4 — the block is per record and is re-evaluated per call", () => {
  it("blocks records in the middle of both id spaces without touching the rest", () => {
    const plan = planIntentDiff(
      buildShadow(),
      SAVE,
      tombstoneView("node:zwei", "node:fünf", "edge:beta"),
      SURFACE,
    );

    expect(plan.upserts.map((intent) => `${intent.kind}:${intent.id}`).sort()).toEqual([
      "edge:alpha",
      "edge:delta",
      "edge:gamma",
      "node:drei",
      "node:eins",
      "node:vier",
    ]);
    expect(plan.discarded.map((entry) => `${entry.kind}:${entry.id}`).sort()).toEqual([
      "node:drei",
      "node:eins",
      "node:vier",
    ]);
  });

  it("blocking every record yields a completely empty plan", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, { isDeleted: () => true }, SURFACE);

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("blocking nothing yields intent for every moved field", () => {
    const plan = planIntentDiff(buildShadow(), SAVE, { isDeleted: () => false }, SURFACE);

    expect(plan.upserts).toHaveLength(NODE_IDS.length + EDGE_IDS.length);
    expect(plan.discarded).toHaveLength(NODE_IDS.length);
  });

  it("the verdict is re-read on every call — a delete between two saves takes effect", () => {
    const shadow = buildShadow();
    const flipping: string[] = [];
    const live: TombstoneView = {
      isDeleted: (kind, id) => {
        // First pass: nothing is deleted. Second pass: "drei" is.
        const answer = flipping.includes(`${kind}:${id}`);
        return answer;
      },
    };

    const before = planIntentDiff(shadow, SAVE, live, SURFACE);
    flipping.push("node:drei");
    const after = planIntentDiff(shadow, SAVE, live, SURFACE);

    expect(before.upserts.some((intent) => intent.id === "drei")).toBe(true);
    expect(after.upserts.some((intent) => intent.id === "drei")).toBe(false);
    expect(after.upserts).toHaveLength(before.upserts.length - 1);
  });

  it("quarantine is indistinguishable from a user delete for this classifier", () => {
    // A quarantined record carries `on:true` plus `q:true`; the view reports `on`.
    const quarantined = tombstoneView("node:vier");
    const userDeleted = tombstoneView("node:vier");

    const a = planIntentDiff(buildShadow(), SAVE, quarantined, SURFACE);
    const b = planIntentDiff(buildShadow(), SAVE, userDeleted, SURFACE);

    expect(a).toEqual(b);
    expect(a.upserts.some((intent) => intent.id === "vier")).toBe(false);
  });

  it("a blocked record contributes nothing even when all of its fields are stale", () => {
    const shadow = buildShadow();
    const staleSave: ParsedSave = {
      path: PATH,
      nodes: [{ id: "eins", fields: { x: 0, y: 0 } }],
      edges: [],
    };

    const blocked = planIntentDiff(shadow, staleSave, tombstoneView("node:eins"), SURFACE);
    const unblocked = planIntentDiff(shadow, staleSave, tombstoneView(), SURFACE);

    expect(blocked.discarded).toEqual([]);
    expect(unblocked.discarded).toHaveLength(2);
  });
});
