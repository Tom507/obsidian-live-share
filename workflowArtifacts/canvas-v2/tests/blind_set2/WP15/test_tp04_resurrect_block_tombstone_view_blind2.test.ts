// WP15 AC3 — same guarantee as the visible test, third angle: the tombstone
// is first applied, then UNDONE (on:false via a fresher applyTombstoneOp),
// proving the resurrect block reads the CURRENT state of the real predicate
// rather than "was ever tombstoned" -- an undone record with a V2 composite
// field change must process normally again.

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
import { encodePos } from "../../../canvas/canvas-registers";
import {
  applyTombstoneOp,
  isTombstoneSuppressed,
  readTombstoneEntry,
  type TombstoneEntry,
  type TombstoneMap,
} from "../../../canvas/canvas-tombstone";

const PATH = "Vault/Kanban.canvas";

function buildTombstoneView(map: TombstoneMap): TombstoneView {
  return {
    isDeleted: (kind: ShadowRecordKind, id: string) => isTombstoneSuppressed(readTombstoneEntry(map, `${kind}:${id}`)),
  };
}

function makeMap(): TombstoneMap {
  const store = new Map<string, unknown>();
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
      return value;
    },
  };
}

function openSurface(nodeIds: string[]): SurfaceState {
  return { viewOpen: true, handedToView: { node: new Set(nodeIds), edge: new Set() } };
}

describe("WP15 AC3 — an undone tombstone (on:false, fresher t) lets pos-register changes through again", () => {
  it("delete at t=1 then undo at t=2 -> the record's changed pos register produces a real upsert", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "revived", "pos", encodePos(5, 5) as any);

    const map = makeMap();
    const deleteOp: TombstoneEntry = { t: 1, by: "peer-a", on: true };
    const undoOp: TombstoneEntry = { t: 2, by: "peer-a", on: false };
    applyTombstoneOp(map, "node:revived", deleteOp);
    applyTombstoneOp(map, "node:revived", undoOp);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "revived", fields: { pos: encodePos(42, 42) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, buildTombstoneView(map), openSurface(["revived"]));

    expect(plan.upserts).toEqual([
      { path: PATH, kind: "node", id: "revived", field: "pos", value: [42, 42] },
    ]);
  });

  it("a STALE undo (lower t than the delete) leaves the record blocked", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "still-dead", "pos", encodePos(5, 5) as any);

    const map = makeMap();
    // Undo arrives first with a LOWER t, then a fresher delete supersedes it.
    applyTombstoneOp(map, "node:still-dead", { t: 1, by: "peer-a", on: false });
    applyTombstoneOp(map, "node:still-dead", { t: 5, by: "peer-b", on: true });

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "still-dead", fields: { pos: encodePos(42, 42) as any } }],
      edges: [],
    };

    const plan = planIntentDiff(shadow, save, buildTombstoneView(map), openSurface(["still-dead"]));

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toEqual([]);
  });
});
