// WP15 AC3 — same guarantee as the visible test, attacked from a different
// angle: EDGE records (not nodes), and the tombstone view's kind-scoping is
// exercised at the same time -- a node and an edge share the same id string,
// only the edge is tombstoned, and both are proven missing from the save.

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
import { encodeEndpoint, encodePos } from "../../../canvas/canvas-registers";
import {
  applyTombstoneOp,
  isTombstoneSuppressed,
  readTombstoneEntry,
  type TombstoneEntry,
  type TombstoneMap,
} from "../../../canvas/canvas-tombstone";

const PATH = "Boards/Retro.canvas";

function buildTombstoneView(deleted: Array<[ShadowRecordKind, string]>): TombstoneView {
  const store = new Map<string, unknown>();
  const map: TombstoneMap = {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
      return value;
    },
  };
  const op: TombstoneEntry = { t: 7, by: "peer-z", on: true };
  for (const [kind, id] of deleted) applyTombstoneOp(map, `${kind}:${id}`, op);
  return {
    isDeleted: (kind, id) => isTombstoneSuppressed(readTombstoneEntry(map, `${kind}:${id}`)),
  };
}

describe("WP15 AC3 — the delete rule stays correct for a tombstoned EDGE under the real view, kind-scoped", () => {
  it("a proven-missing edge already tombstoned, and a proven-missing node with the SAME id not tombstoned, both delete correctly", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "edge", "shared-id", "from", encodeEndpoint("x", "left") as any);
    advanceField(shadow, PATH, "node", "shared-id", "pos", encodePos(1, 1) as any);

    const save: ParsedSave = { path: PATH, nodes: [], edges: [] };
    const surface: SurfaceState = {
      viewOpen: true,
      handedToView: { node: new Set(["shared-id"]), edge: new Set(["shared-id"]) },
    };

    // Only the EDGE half is tombstoned; the node half has no entry at all.
    const plan = planIntentDiff(shadow, save, buildTombstoneView([["edge", "shared-id"]]), surface);

    expect(plan.deletes).toHaveLength(2);
    expect(plan.deletes).toContainEqual({ path: PATH, kind: "edge", id: "shared-id" });
    expect(plan.deletes).toContainEqual({ path: PATH, kind: "node", id: "shared-id" });
  });
});
