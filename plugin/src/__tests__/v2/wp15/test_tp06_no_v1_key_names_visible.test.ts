// WP15 AC4 — no V1 key names remain as shadow field keys, verified
// DYNAMICALLY: drive the shadow through normal V2 usage (advanceRecord with
// composite registers, and planIntentDiff over a V2-shaped save) and then
// scan every field key the shadow actually stored, across every record, for
// membership in the eight V1 names. A hand-listed spot check ("assert 'x' is
// not a key on this one record") could not catch a stray V1-named field on a
// record nobody thought to check by hand; a full scan can.

import { describe, expect, it } from "vitest";

import {
  advanceRecord,
  createSurfaceShadow,
  getRecordFields,
  listPaths,
  planIntentDiff,
  type ParsedSave,
  type ShadowRecordKind,
  type SurfaceState,
  type TombstoneView,
} from "../../../canvas/canvas-shadow";
import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";

const V1_KEY_NAMES = ["x", "y", "width", "height", "fromNode", "fromSide", "toNode", "toSide"];

const PATH = "Vault/Sprint Board.canvas";
const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };
const KNOWN_IDS = ["task", "link"];

/** Every field key the shadow currently holds, across every known path/kind/id. */
function allStoredFieldKeys(shadow: ReturnType<typeof createSurfaceShadow>): string[] {
  const keys: string[] = [];
  for (const path of listPaths(shadow)) {
    for (const kind of ["node", "edge"] as ShadowRecordKind[]) {
      for (const id of KNOWN_IDS) {
        const fields = getRecordFields(shadow, path, kind, id);
        if (fields) keys.push(...Object.keys(fields));
      }
    }
  }
  return keys;
}

describe("WP15 AC4 — a dynamic scan finds zero V1 key names in the shadow", () => {
  it("advanceRecord with V2 composite fields stores only V2 field names", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "task", {
      pos: encodePos(100, 200) as any,
      size: encodeSize(260, 60) as any,
    });
    advanceRecord(shadow, PATH, "edge", "link", {
      from: encodeEndpoint("task", "right") as any,
      to: encodeEndpoint("task", "left") as any,
    });

    const keys = allStoredFieldKeys(shadow);
    expect(keys.length).toBeGreaterThan(0);
    for (const banned of V1_KEY_NAMES) {
      expect(keys).not.toContain(banned);
    }
    expect(new Set(keys)).toEqual(new Set(["pos", "size", "from", "to"]));
  });

  it("a planIntentDiff pass over a V2-shaped save advances no V1-named field into the shadow", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "task", { pos: encodePos(0, 0) as any });

    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "task", fields: { pos: encodePos(50, 50) as any, size: encodeSize(10, 10) as any } }],
      edges: [],
    };
    const surface: SurfaceState = {
      viewOpen: true,
      handedToView: { node: new Set(["task"]), edge: new Set() },
    };

    const plan = planIntentDiff(shadow, save, NO_TOMBSTONES, surface);
    const intentFieldNames = [...plan.upserts.map((u) => u.field), ...plan.discarded.map((d) => d.field)];

    for (const banned of V1_KEY_NAMES) {
      expect(intentFieldNames).not.toContain(banned);
    }
    expect(new Set(intentFieldNames)).toEqual(new Set(["pos", "size"]));
  });
});
