// WP15 AC3 — same guarantee as the visible test (resurrect block reads the
// real WP12 predicate), attacked from a different angle: an EDGE record
// (not a node) whose "from"/"to" endpoint registers change while tombstoned,
// among several records where only the target is tombstoned.

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

describe("WP15 AC3 — the resurrect block blocks a tombstoned EDGE's endpoint registers, and only that edge", () => {
  it("a tombstoned edge's changed from/to registers produce nothing, a live sibling is unaffected", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "edge", "dead-arrow", "from", encodeEndpoint("a", "left") as any);
    advanceField(shadow, PATH, "edge", "dead-arrow", "to", encodeEndpoint("b", "right") as any);
    advanceField(shadow, PATH, "node", "a", "pos", encodePos(1, 1) as any);

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "a", fields: { pos: encodePos(9, 9) as any } }],
      edges: [
        {
          id: "dead-arrow",
          fields: { from: encodeEndpoint("c", "top") as any, to: encodeEndpoint("d", "bottom") as any },
        },
      ],
    };
    const surface: SurfaceState = {
      viewOpen: true,
      handedToView: { node: new Set(["a"]), edge: new Set(["dead-arrow"]) },
    };

    const plan = planIntentDiff(shadow, save, buildTombstoneView([["edge", "dead-arrow"]]), surface);

    // The tombstoned edge contributes nothing at all...
    expect(plan.upserts.some((u) => u.id === "dead-arrow")).toBe(false);
    expect(plan.discarded.some((d) => d.id === "dead-arrow")).toBe(false);
    // ...but the live node still produces its intent normally.
    expect(plan.upserts).toContainEqual({ path: PATH, kind: "node", id: "a", field: "pos", value: [9, 9] });
  });
});
