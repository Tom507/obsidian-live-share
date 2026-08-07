// WP1 / AC4 — clearing checked against an independently built reference shadow.
//
// Angle of attack: a whole-shadow serialiser reduces the state to one sorted
// string. A shadow that was populated with 8 paths and then had 3 of them cleared
// must serialise IDENTICALLY to a shadow that was only ever populated with the
// remaining 5. That is a stronger statement than "the cleared path is gone and the
// others look right", because it also catches state that clearing *added*
// somewhere else (an empty leftover container, a resurrected absent mark, a path
// key that lingers with zero records).
//
// All records share the same ids across all paths, so any id-keyed shortcut in the
// implementation shows up immediately.

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  type SurfaceShadow,
  advanceField,
  advanceRecord,
  clearPath,
  createSurfaceShadow,
  getRecordState,
  listPaths,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const ALL_PATHS = [
  "w/0.canvas",
  "w/1.canvas",
  "w/2.canvas",
  "w/3.canvas",
  "w/4.canvas",
  "w/5.canvas",
  "w/6.canvas",
  "w/7.canvas",
];
const CLEARED = ["w/1.canvas", "w/4.canvas", "w/7.canvas"];
const SURVIVORS = ALL_PATHS.filter((path) => !CLEARED.includes(path));

/** Whole-shadow serialisation — the differential oracle. */
function serialise(shadow: SurfaceShadow): string {
  const lines: string[] = [];
  for (const path of [...shadow.paths.keys()].sort()) {
    const pathState = shadow.paths.get(path);
    if (!pathState) continue;
    for (const kind of ["node", "edge"] as ShadowRecordKind[]) {
      for (const id of [...pathState[kind].keys()].sort()) {
        const record = pathState[kind].get(id);
        if (!record) continue;
        const fields = [...record.fields.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([field, value]) => `${field}=${JSON.stringify(value)}`)
          .join(",");
        lines.push(`${path}|${kind}|${id}|${record.state}|${fields}`);
      }
    }
  }
  return lines.join("\n");
}

/** Identical record population for one path — same ids everywhere on purpose. */
function populate(shadow: SurfaceShadow, path: string, salt: number): void {
  advanceRecord(shadow, path, "node", "alpha", { x: salt, y: salt * 2, text: "a" });
  advanceRecord(shadow, path, "node", "beta", { x: salt + 1, color: null });
  advanceRecord(shadow, path, "edge", "alpha", { fromNode: "alpha", toNode: "beta" });
  advanceField(shadow, path, "edge", "alpha", "label", `l${salt}`);
  markRecordAbsent(shadow, path, "node", "ghost");
  markRecordAbsent(shadow, path, "edge", "ghost");
}

describe("WP1 AC4 — clearing three of eight paths equals never having had them", () => {
  it("serialises identically to a reference shadow built from the survivors only", () => {
    const full = createSurfaceShadow();
    ALL_PATHS.forEach((path, index) => populate(full, path, index));

    const reference = createSurfaceShadow();
    ALL_PATHS.forEach((path, index) => {
      if (!CLEARED.includes(path)) populate(reference, path, index);
    });

    for (const path of CLEARED) clearPath(full, path);

    expect(serialise(full)).toBe(serialise(reference));
    expect(listPaths(full).sort()).toEqual([...SURVIVORS].sort());
    expect(full.paths.size).toBe(SURVIVORS.length);
  });

  it("leaves no empty container behind for a cleared path", () => {
    const shadow = createSurfaceShadow();
    populate(shadow, ALL_PATHS[0], 0);
    populate(shadow, ALL_PATHS[1], 1);

    clearPath(shadow, ALL_PATHS[0]);

    expect(shadow.paths.has(ALL_PATHS[0])).toBe(false);
    expect(listPaths(shadow)).toEqual([ALL_PATHS[1]]);
    for (const kind of ["node", "edge"] as ShadowRecordKind[]) {
      for (const id of ["alpha", "beta", "ghost"]) {
        expect(getRecordState(shadow, ALL_PATHS[0], kind, id)).toBe("unknown");
      }
    }
  });

  it("clearing on an empty shadow changes nothing", () => {
    const shadow = createSurfaceShadow();

    clearPath(shadow, "w/0.canvas");
    clearPath(shadow, "");

    expect(serialise(shadow)).toBe("");
    expect(listPaths(shadow)).toEqual([]);
    expect(shadow.paths.size).toBe(0);
  });

  it("clearing all eight paths leaves a shadow equal to a brand-new one", () => {
    const shadow = createSurfaceShadow();
    ALL_PATHS.forEach((path, index) => populate(shadow, path, index));

    for (const path of ALL_PATHS) clearPath(shadow, path);

    expect(serialise(shadow)).toBe(serialise(createSurfaceShadow()));
    expect(listPaths(shadow)).toEqual([]);
  });
});
