// WP1 / AC2 (second half) — advancing one record leaves the other records alone.
//
// AC2: "...and advancing a field of one record leaves other records untouched."
//
// The shadow is advanced from three sources (confirmed view apply, captured local
// edit, closed-view persistence write), each of which reports about ONE record at
// a time. If an advance had any reach beyond its own record — or beyond its own
// path — the "interacting skip" rule of WP5 AC2 could never hold.

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  type SurfaceShadow,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getRecordFields,
  getRecordState,
  listPaths,
} from "../../../canvas/canvas-shadow";

const PATH_A = "Vault/A.canvas";
const PATH_B = "Vault/B.canvas";

/** Stable, comparable dump of one path's whole shadow state. */
function dumpPath(shadow: SurfaceShadow, path: string): unknown {
  const pathState = shadow.paths.get(path);
  if (!pathState) return null;
  const dump = (kind: ShadowRecordKind) =>
    [...pathState[kind].entries()]
      .map(([id, record]) => ({
        id,
        state: record.state,
        fields: [...record.fields.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  return { node: dump("node"), edge: dump("edge") };
}

function seeded(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH_A, "node", "n1", { x: 0, y: 0, text: "one" });
  advanceRecord(shadow, PATH_A, "node", "n2", { x: 50, y: 50, text: "two" });
  advanceRecord(shadow, PATH_A, "edge", "e1", { fromNode: "n1", toNode: "n2" });
  advanceRecord(shadow, PATH_B, "node", "n1", { x: 999, y: 999, text: "elsewhere" });
  return shadow;
}

describe("WP1 AC2 — record and path isolation", () => {
  it("advancing n1 leaves n2 and the edge byte-identical", () => {
    const shadow = seeded();
    const n2Before = getRecordFields(shadow, PATH_A, "node", "n2");
    const edgeBefore = getRecordFields(shadow, PATH_A, "edge", "e1");

    advanceField(shadow, PATH_A, "node", "n1", "x", 42);

    expect(getRecordFields(shadow, PATH_A, "node", "n1")).toEqual({ x: 42, y: 0, text: "one" });
    expect(getRecordFields(shadow, PATH_A, "node", "n2")).toEqual(n2Before);
    expect(getRecordFields(shadow, PATH_A, "edge", "e1")).toEqual(edgeBefore);
  });

  it("advancing a record on path A leaves path B untouched", () => {
    const shadow = seeded();
    const bBefore = dumpPath(shadow, PATH_B);

    advanceField(shadow, PATH_A, "node", "n1", "text", "changed");
    advanceRecord(shadow, PATH_A, "node", "n3", { x: 1, y: 1 });

    expect(dumpPath(shadow, PATH_B)).toEqual(bBefore);
    expect(getRecordFields(shadow, PATH_B, "node", "n1")).toEqual({
      x: 999,
      y: 999,
      text: "elsewhere",
    });
  });

  it("the same record id on two paths is two independent records", () => {
    const shadow = seeded();

    advanceField(shadow, PATH_A, "node", "n1", "x", 7);
    advanceField(shadow, PATH_B, "node", "n1", "x", 8);

    expect(getRecordFields(shadow, PATH_A, "node", "n1")).toEqual({ x: 7, y: 0, text: "one" });
    expect(getRecordFields(shadow, PATH_B, "node", "n1")).toEqual({
      x: 8,
      y: 999,
      text: "elsewhere",
    });
  });

  it("creating a new record does not touch the existing ones or other paths", () => {
    const shadow = seeded();
    const aBefore = dumpPath(shadow, PATH_A);

    advanceRecord(shadow, "Vault/C.canvas", "node", "n1", { x: 5 });

    expect(dumpPath(shadow, PATH_A)).toEqual(aBefore);
    expect(listPaths(shadow).sort()).toEqual([PATH_A, PATH_B, "Vault/C.canvas"].sort());
    expect(getRecordState(shadow, "Vault/C.canvas", "node", "n1")).toBe("present");
  });
});
