// WP15 AC4 — same guarantee as the visible test, third angle: a
// programmatically generated batch of many records (stress scale rather than
// a hand-picked few), scanned in bulk, to make the falsifiability property
// concrete -- this would catch a single stray V1-named field on any one of
// many records, not just the ones a human happened to eyeball.

import { describe, expect, it } from "vitest";

import {
  advanceField,
  createSurfaceShadow,
  getRecordFields,
  listPaths,
  type ShadowRecordKind,
} from "../../../canvas/canvas-shadow";
import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";

const V1_KEY_NAMES = ["x", "y", "width", "height", "fromNode", "fromSide", "toNode", "toSide"];
const PATH = "Vault/Bulk.canvas";

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

describe("WP15 AC4 — a bulk dynamic scan across many programmatically-generated records finds zero V1 names", () => {
  it("20 nodes with pos+size and 10 edges with from+to -- no V1 name anywhere in the shadow", () => {
    const shadow = createSurfaceShadow();
    const nodeIds = Array.from({ length: 20 }, (_, i) => `node-${i}`);
    const edgeIds = Array.from({ length: 10 }, (_, i) => `edge-${i}`);

    nodeIds.forEach((id, i) => {
      advanceField(shadow, PATH, "node", id, "pos", encodePos(i, i * 2) as any);
      advanceField(shadow, PATH, "node", id, "size", encodeSize(10 + i, 20 + i) as any);
    });
    edgeIds.forEach((id, i) => {
      advanceField(shadow, PATH, "edge", id, "from", encodeEndpoint(`node-${i}`, "left") as any);
      advanceField(shadow, PATH, "edge", id, "to", encodeEndpoint(`node-${i + 1}`, "right") as any);
    });

    const keys = allStoredFieldKeys(shadow, [...nodeIds, ...edgeIds]);
    expect(keys.length).toBe(20 * 2 + 10 * 2);
    for (const banned of V1_KEY_NAMES) {
      expect(keys.filter((k) => k === banned)).toEqual([]);
    }
    expect(new Set(keys)).toEqual(new Set(["pos", "size", "from", "to"]));
  });
});
