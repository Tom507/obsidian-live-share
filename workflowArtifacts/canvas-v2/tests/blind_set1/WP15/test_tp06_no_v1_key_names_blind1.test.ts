// WP15 AC4 — same guarantee as the visible test, attacked from a different
// angle: TWO separate canvas paths scanned independently, and a record that
// goes present -> absent -> present again (re-observed from empty), to make
// sure no V1-named key ever sneaks back in across a record's lifecycle.

import { describe, expect, it } from "vitest";

import {
  advanceField,
  createSurfaceShadow,
  getRecordFields,
  listPaths,
  markRecordAbsent,
  type ShadowRecordKind,
} from "../../../canvas/canvas-shadow";
import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";

const V1_KEY_NAMES = ["x", "y", "width", "height", "fromNode", "fromSide", "toNode", "toSide"];

function allStoredFieldKeys(
  shadow: ReturnType<typeof createSurfaceShadow>,
  ids: readonly string[],
): string[] {
  const keys: string[] = [];
  for (const path of listPaths(shadow)) {
    for (const kind of ["node", "edge"] as ShadowRecordKind[]) {
      for (const id of ids) {
        const fields = getRecordFields(shadow, path, kind, id);
        if (fields) keys.push(...Object.keys(fields));
      }
    }
  }
  return keys;
}

describe("WP15 AC4 — a dynamic scan across multiple paths and a re-observe cycle finds zero V1 names", () => {
  it("two independent canvas paths, scanned together, carry only V2 names", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, "Boards/A.canvas", "node", "n1", "pos", encodePos(1, 1) as any);
    advanceField(shadow, "Boards/B.canvas", "edge", "e1", "from", encodeEndpoint("n1", "left") as any);

    const keys = allStoredFieldKeys(shadow, ["n1", "e1"]);
    for (const banned of V1_KEY_NAMES) expect(keys).not.toContain(banned);
    expect(new Set(keys)).toEqual(new Set(["pos", "from"]));
  });

  it("a record re-observed after going absent stores only V2 names on its new incarnation", () => {
    const shadow = createSurfaceShadow();
    const path = "Boards/A.canvas";
    advanceField(shadow, path, "node", "n1", "size", encodeSize(10, 10) as any);
    markRecordAbsent(shadow, path, "node", "n1");
    // Re-observed with a different composite field this time.
    advanceField(shadow, path, "node", "n1", "pos", encodePos(3, 3) as any);

    const keys = allStoredFieldKeys(shadow, ["n1"]);
    for (const banned of V1_KEY_NAMES) expect(keys).not.toContain(banned);
    // The re-observed incarnation starts from an empty field map (WP1 AC),
    // so only "pos" is present -- "size" from the earlier incarnation is gone.
    expect(keys).toEqual(["pos"]);
  });
});
