// WP15 AC3 — same guarantee as the visible test, third angle: several
// proven-missing records in one pass, an arbitrary mix of tombstoned and
// not, confirming the real predicate-backed view yields the same delete
// COUNT and membership as an equivalent boolean stub would -- the real
// seam changes nothing observable about rule 4's behaviour.

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

function buildTombstoneView(deleted: Array<[ShadowRecordKind, string]>): TombstoneView {
  const store = new Map<string, unknown>();
  const map: TombstoneMap = {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
      return value;
    },
  };
  const op: TombstoneEntry = { t: 3, by: "peer-q", on: true };
  for (const [kind, id] of deleted) applyTombstoneOp(map, `${kind}:${id}`, op);
  return {
    isDeleted: (kind, id) => isTombstoneSuppressed(readTombstoneEntry(map, `${kind}:${id}`)),
  };
}

describe("WP15 AC3 — a mixed batch of proven-missing records deletes correctly regardless of tombstone status", () => {
  it("four missing records, two already tombstoned, two not -> all four still produce delete intents", () => {
    const shadow = createSurfaceShadow();
    const ids = ["m1", "m2", "m3", "m4"];
    for (const id of ids) advanceField(shadow, PATH, "node", id, "pos", encodePos(1, 1) as any);

    const save: ParsedSave = { path: PATH, nodes: [], edges: [] };
    const surface: SurfaceState = {
      viewOpen: true,
      handedToView: { node: new Set(ids), edge: new Set() },
    };

    const plan = planIntentDiff(
      shadow,
      save,
      buildTombstoneView([
        ["node", "m1"],
        ["node", "m3"],
      ]),
      surface,
    );

    expect(plan.deletes).toHaveLength(4);
    for (const id of ids) {
      expect(plan.deletes).toContainEqual({ path: PATH, kind: "node", id });
    }
  });
});
