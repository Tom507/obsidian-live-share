// WP15 AC2 — same guarantee as the visible test, third angle: the exact
// half-integer boundary (JS Math.round rounds .5 UP, including for negative
// numbers close to zero) and a rounding-only restatement combined with a
// tombstoned neighbour in the same pass, to prove the equality fix and the
// resurrect block do not interact badly.

import { describe, expect, it } from "vitest";

import {
  advanceRecord,
  createSurfaceShadow,
  planIntentDiff,
  type ParsedSave,
  type ShadowRecordKind,
  type SurfaceState,
  type TombstoneView,
} from "../../../canvas/canvas-shadow";
import { encodePos } from "../../../canvas/canvas-registers";

const PATH = "Vault/Kanban.canvas";

function tombstones(...keys: string[]): TombstoneView {
  const on = new Set(keys);
  return { isDeleted: (kind: ShadowRecordKind, id: string) => on.has(`${kind}:${id}`) };
}

describe("WP15 AC2 — rounding at the exact half-integer boundary produces no intent", () => {
  it("2.5 rounds up to 3, and a save restating 2.5 against a shadow already at 3 is pure staleness", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { pos: encodePos(2.5, 2.5) as any }); // stored as [3, 3]

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "n1", fields: { pos: encodePos(2.5, 2.5) as any } }], // re-encoded, new array, still [3, 3]
      edges: [],
    };
    const surface: SurfaceState = { viewOpen: true, handedToView: { node: new Set(["n1"]), edge: new Set() } };

    const plan = planIntentDiff(shadow, save, tombstones(), surface);

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([
      { path: PATH, kind: "node", id: "n1", field: "pos", value: [3, 3], reason: "equals-shadow" },
    ]);
  });

  it("a rounding-only restatement alongside a tombstoned neighbour: the live record is still correctly discarded", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "live", { pos: encodePos(10, 10) as any });
    advanceRecord(shadow, PATH, "node", "gone", { pos: encodePos(0, 0) as any });

    const save: ParsedSave = {
      path: PATH,
      nodes: [
        { id: "live", fields: { pos: encodePos(10.4, 9.6) as any } }, // rounds to [10, 10] -- stale
        { id: "gone", fields: { pos: encodePos(999, 999) as any } }, // tombstoned -- blocked entirely
      ],
      edges: [],
    };
    const surface: SurfaceState = {
      viewOpen: true,
      handedToView: { node: new Set(["live", "gone"]), edge: new Set() },
    };

    const plan = planIntentDiff(shadow, save, tombstones("node:gone"), surface);

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([
      { path: PATH, kind: "node", id: "live", field: "pos", value: [10, 10], reason: "equals-shadow" },
    ]);
  });
});
