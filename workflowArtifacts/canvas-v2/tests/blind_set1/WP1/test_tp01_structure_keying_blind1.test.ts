// WP1 / AC1 — key hierarchy under hostile key material.
//
// Same behaviour as the structure test, attacked from the key side: paths that
// contain spaces, non-ASCII characters and a `.canvas` substring in the middle,
// ids reused across both kinds and across both paths, and field values of every
// permitted primitive type including `null`.
//
// If the module flattened the hierarchy into a composite string key (e.g.
// `${path}|${kind}|${id}|${field}`) most of this file would still pass — except
// the separator-collision cases, which is exactly why they are here.

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  type SurfaceShadow,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  listPaths,
} from "../../../canvas/canvas-shadow";

const PATH_UNICODE = "Zettelkasten/Übersicht — Plan.canvas";
const PATH_NESTED = "Zettelkasten/Übersicht — Plan.canvas.archive/old.canvas";

function walk(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
): Map<string, unknown> | undefined {
  return shadow.paths.get(path)?.[kind].get(id)?.fields;
}

describe("WP1 AC1 — hierarchy holds for adversarial keys", () => {
  it("stores separator-like characters inside keys without collapsing levels", () => {
    const shadow = createSurfaceShadow();

    advanceField(shadow, PATH_UNICODE, "node", "id|with|pipes", "a|b", 1);
    advanceField(shadow, PATH_UNICODE, "node", "id", "with|pipes:a|b", 2);
    advanceField(shadow, PATH_NESTED, "node", "id|with|pipes", "a|b", 3);

    expect(getField(shadow, PATH_UNICODE, "node", "id|with|pipes", "a|b")).toBe(1);
    expect(getField(shadow, PATH_UNICODE, "node", "id", "with|pipes:a|b")).toBe(2);
    expect(getField(shadow, PATH_NESTED, "node", "id|with|pipes", "a|b")).toBe(3);
    expect(listPaths(shadow).sort()).toEqual([PATH_NESTED, PATH_UNICODE].sort());
  });

  it("carries every permitted primitive value type through the structure unchanged", () => {
    const shadow = createSurfaceShadow();

    advanceRecord(shadow, PATH_UNICODE, "node", "mixed", {
      x: -12,
      y: 0,
      ratio: 0.5,
      label: "",
      pinned: false,
      collapsed: true,
      color: null,
    });

    const fields = walk(shadow, PATH_UNICODE, "node", "mixed");
    expect(fields).toBeDefined();
    if (!fields) throw new Error("unreachable");

    expect(fields.get("x")).toBe(-12);
    expect(fields.get("y")).toBe(0);
    expect(fields.get("ratio")).toBe(0.5);
    expect(fields.get("label")).toBe("");
    expect(fields.get("pinned")).toBe(false);
    expect(fields.get("collapsed")).toBe(true);
    expect(fields.get("color")).toBeNull();

    // `null` is a KNOWN value, `undefined` is "never observed" — the two must not
    // be conflated, or WP2 would read a cleared colour as staleness.
    expect(getField(shadow, PATH_UNICODE, "node", "mixed", "color")).toBeNull();
    expect(getField(shadow, PATH_UNICODE, "node", "mixed", "nothing")).toBeUndefined();
    expect(getRecordFields(shadow, PATH_UNICODE, "node", "mixed")).toEqual({
      x: -12,
      y: 0,
      ratio: 0.5,
      label: "",
      pinned: false,
      collapsed: true,
      color: null,
    });
  });

  it("treats the same id under node and edge, and under two paths, as four records", () => {
    const shadow = createSurfaceShadow();
    const id = "1a2b3c";

    advanceField(shadow, PATH_UNICODE, "node", id, "tag", "u-node");
    advanceField(shadow, PATH_UNICODE, "edge", id, "tag", "u-edge");
    advanceField(shadow, PATH_NESTED, "node", id, "tag", "n-node");
    advanceField(shadow, PATH_NESTED, "edge", id, "tag", "n-edge");

    expect(getField(shadow, PATH_UNICODE, "node", id, "tag")).toBe("u-node");
    expect(getField(shadow, PATH_UNICODE, "edge", id, "tag")).toBe("u-edge");
    expect(getField(shadow, PATH_NESTED, "node", id, "tag")).toBe("n-node");
    expect(getField(shadow, PATH_NESTED, "edge", id, "tag")).toBe("n-edge");

    for (const path of [PATH_UNICODE, PATH_NESTED]) {
      for (const kind of ["node", "edge"] as const) {
        expect(getRecordState(shadow, path, kind, id)).toBe("present");
      }
    }
  });

  it("does not leak field data between two shadows built from the same key material", () => {
    const first = createSurfaceShadow();
    const second = createSurfaceShadow();

    advanceField(first, PATH_UNICODE, "edge", "e9", "label", "only in first");

    expect(getField(second, PATH_UNICODE, "edge", "e9", "label")).toBeUndefined();
    expect(getRecordState(second, PATH_UNICODE, "edge", "e9")).toBe("unknown");
    expect(listPaths(second)).toEqual([]);
  });
});
