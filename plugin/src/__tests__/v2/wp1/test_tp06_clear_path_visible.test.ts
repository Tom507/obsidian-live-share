// WP1 / AC4 — clearing one path wipes exactly that path.
//
// AC4: "Clearing a path removes all of its shadow state and leaves other paths
// intact."
//
// `clearPath` is what runs on unsubscribe / teardown. A leak in either direction
// is a real defect: leftover state makes the next subscription judge a fresh
// surface against a dead one (SHADOW STALE), and over-clearing silently disarms
// the staleness detection for every other open canvas.

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  type SurfaceShadow,
  advanceRecord,
  clearPath,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  listPaths,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const PATH_A = "Vault/A.canvas";
const PATH_B = "Vault/B.canvas";
const PATH_C = "Vault/Sub/C.canvas";

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
  for (const path of [PATH_A, PATH_B, PATH_C]) {
    advanceRecord(shadow, path, "node", "n1", { x: 1, y: 2, text: path });
    advanceRecord(shadow, path, "node", "n2", { x: 3, y: 4 });
    advanceRecord(shadow, path, "edge", "e1", { fromNode: "n1", toNode: "n2" });
    markRecordAbsent(shadow, path, "node", "gone");
  }
  return shadow;
}

describe("WP1 AC4 — clearPath", () => {
  it("removes every record of the cleared path, both kinds and both states", () => {
    const shadow = seeded();

    clearPath(shadow, PATH_B);

    for (const [kind, id] of [
      ["node", "n1"],
      ["node", "n2"],
      ["node", "gone"],
      ["edge", "e1"],
    ] as const) {
      expect(getRecordState(shadow, PATH_B, kind, id)).toBe("unknown");
      expect(getRecordFields(shadow, PATH_B, kind, id)).toBeNull();
      expect(getField(shadow, PATH_B, kind, id, "x")).toBeUndefined();
    }
    expect(shadow.paths.get(PATH_B)).toBeUndefined();
    expect(listPaths(shadow).sort()).toEqual([PATH_A, PATH_C].sort());
  });

  it("leaves the other paths byte-identical", () => {
    const shadow = seeded();
    const aBefore = dumpPath(shadow, PATH_A);
    const cBefore = dumpPath(shadow, PATH_C);

    clearPath(shadow, PATH_B);

    expect(dumpPath(shadow, PATH_A)).toEqual(aBefore);
    expect(dumpPath(shadow, PATH_C)).toEqual(cBefore);
    expect(getRecordState(shadow, PATH_A, "node", "gone")).toBe("absent");
    expect(getRecordFields(shadow, PATH_C, "node", "n1")).toEqual({ x: 1, y: 2, text: PATH_C });
  });

  it("clearing an unknown path is a no-op and creates no entry", () => {
    const shadow = seeded();
    const before = listPaths(shadow).sort();

    clearPath(shadow, "Vault/NeverSubscribed.canvas");

    expect(listPaths(shadow).sort()).toEqual(before);
    expect(shadow.paths.has("Vault/NeverSubscribed.canvas")).toBe(false);
  });

  it("a cleared path can be re-populated from scratch", () => {
    const shadow = seeded();

    clearPath(shadow, PATH_A);
    advanceRecord(shadow, PATH_A, "node", "n1", { x: 99 });

    expect(getRecordFields(shadow, PATH_A, "node", "n1")).toEqual({ x: 99 });
    expect(getRecordState(shadow, PATH_A, "node", "n2")).toBe("unknown");
    expect(getRecordState(shadow, PATH_A, "node", "gone")).toBe("unknown");
  });

  it("clearing every path in turn empties the shadow without touching the rest early", () => {
    const shadow = seeded();

    clearPath(shadow, PATH_A);
    expect(listPaths(shadow).sort()).toEqual([PATH_B, PATH_C].sort());
    clearPath(shadow, PATH_C);
    expect(listPaths(shadow)).toEqual([PATH_B]);
    clearPath(shadow, PATH_B);
    expect(listPaths(shadow)).toEqual([]);
    expect(shadow.paths.size).toBe(0);
  });
});
