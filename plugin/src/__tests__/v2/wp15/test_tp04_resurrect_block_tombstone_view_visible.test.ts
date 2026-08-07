// WP15 AC3 — the resurrect block operates against the tombstone VIEW (WP12's
// isTombstoneSuppressed predicate over a real TombstoneEntry), not a
// hand-rolled "is this id in some set" check, and it holds for V2-composite
// register fields exactly as it held for V1 primitive fields (WP2 AC4).
//
// Per the Shared Ownership Contract (WP12 row): WP15 is a "tombstone view"
// consumer. This test builds the TombstoneView test double entirely out of
// canvas-tombstone.ts's own applyTombstoneOp + isTombstoneSuppressed --
// never a local boolean re-implementation of "is this deleted" (C12 AC2:
// one shared predicate, not three copies).

import { describe, expect, it } from "vitest";

import {
  advanceField,
  createSurfaceShadow,
  planIntentDiff,
  type ParsedSave,
  type ShadowRecordKind,
  type SurfaceState,
  type TombstoneView,
} from "../../../canvas/canvas-shadow";
import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import {
  applyTombstoneOp,
  isTombstoneSuppressed,
  readTombstoneEntry,
  type TombstoneEntry,
  type TombstoneMap,
} from "../../../canvas/canvas-tombstone";

const PATH = "Vault/Board.canvas";

/** A real WP12 tombstone store, keyed "kind:id", queried through THE shared predicate. */
function buildTombstoneView(deleted: Array<[ShadowRecordKind, string]>): TombstoneView {
  const store = new Map<string, unknown>();
  const map: TombstoneMap = {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
      return value;
    },
  };
  const op: TombstoneEntry = { t: 1, by: "peer-a", on: true };
  for (const [kind, id] of deleted) applyTombstoneOp(map, `${kind}:${id}`, op);

  return {
    isDeleted: (kind, id) => isTombstoneSuppressed(readTombstoneEntry(map, `${kind}:${id}`)),
  };
}

function openSurface(nodeIds: string[]): SurfaceState {
  return { viewOpen: true, handedToView: { node: new Set(nodeIds), edge: new Set() } };
}

describe("WP15 AC3 — the resurrect block reads the real tombstone predicate, for V2 registers", () => {
  it("a tombstoned record's changed pos/size registers produce no intent at all", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "dead", "pos", encodePos(10, 20) as any);
    advanceField(shadow, PATH, "node", "dead", "size", encodeSize(50, 50) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [
        { id: "dead", fields: { pos: encodePos(999, 888) as any, size: encodeSize(10, 10) as any } },
      ],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, buildTombstoneView([["node", "dead"]]), openSurface(["dead"]));

    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });

  it("the block discriminates: the identical save without the tombstone yields real intent", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "dead", "pos", encodePos(10, 20) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "dead", fields: { pos: encodePos(999, 888) as any } }],
      edges: [],
    };

    const blocked = planIntentDiff(shadow, save, buildTombstoneView([["node", "dead"]]), openSurface(["dead"]));
    const allowed = planIntentDiff(shadow, save, buildTombstoneView([]), openSurface(["dead"]));

    expect(blocked.upserts).toEqual([]);
    expect(allowed.upserts).toEqual([
      { path: PATH, kind: "node", id: "dead", field: "pos", value: [999, 888] },
    ]);
  });
});
