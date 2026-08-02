// WP15 AC1 — same guarantee as the visible test, third angle: field values
// planted via a planIntentDiff upsert-and-advance round-trip rather than a
// direct advanceField/advanceRecord call, proving the "one composite field"
// property holds along the intent-diff path too, not just the raw storage
// API. Different ids/values again.

import { describe, expect, it } from "vitest";

import {
  advanceField,
  createSurfaceShadow,
  getRecordFields,
  planIntentDiff,
  type ParsedSave,
  type SurfaceState,
  type TombstoneView,
} from "../../../canvas/canvas-shadow";
import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";

const PATH = "Vault/Kanban.canvas";
const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

describe("WP15 AC1 — an upsert's own value is a single, whole composite register", () => {
  it("a fresh pos upsert (no prior shadow entry) reports one field carrying both components", () => {
    const shadow = createSurfaceShadow();
    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "note-1", fields: { pos: encodePos(77, 88) as any, size: encodeSize(30, 30) as any } }],
      edges: [],
    };
    const surface: SurfaceState = { viewOpen: true, handedToView: { node: new Set(), edge: new Set() } };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, surface);

    expect(plan.upserts).toHaveLength(2);
    const posIntent = plan.upserts.find((u) => u.field === "pos");
    const sizeIntent = plan.upserts.find((u) => u.field === "size");
    expect(posIntent?.value).toEqual([77, 88]);
    expect(sizeIntent?.value).toEqual([30, 30]);
    // Simulate WP4 advancing the shadow from these upserts, one field call each.
    for (const u of plan.upserts) advanceField(shadow, PATH, u.kind, u.id, u.field, u.value as any);
    const fields = getRecordFields(shadow, PATH, "node", "note-1") as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(["pos", "size"]);
  });

  it("an edge's from/to upserts each carry the whole endpoint object as one field", () => {
    const shadow = createSurfaceShadow();
    const save: ParsedSave = {
      path: PATH,
      edges: [
        {
          id: "e-1",
          fields: { from: encodeEndpoint("note-1", "top", "arrow") as any, to: encodeEndpoint("note-2", "bottom") as any },
        },
      ],
      nodes: [],
    };
    const surface: SurfaceState = { viewOpen: true, handedToView: { node: new Set(), edge: new Set() } };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, surface);

    expect(plan.upserts.map((u) => u.field).sort()).toEqual(["from", "to"]);
    const fromIntent = plan.upserts.find((u) => u.field === "from");
    expect(fromIntent?.value).toEqual({ node: "note-1", side: "top", end: "arrow" });
  });
});
