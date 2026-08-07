// WP1 / AC1 — key hierarchy at scale and against prototype-shaped keys.
//
// Angle of attack: a deterministic generator builds a wide shadow (6 paths ×
// 2 kinds × 4 records × 3 fields = 144 leaf values) and every single leaf is then
// read back through both the structure and the reader API. A hierarchy that
// silently overwrote one level with another would show up as a value mismatch,
// not as a missing key.
//
// Second angle: field names and record ids that are `Object.prototype` members
// (`constructor`, `toString`, `__proto__`, `hasOwnProperty`). A plain-object
// implementation of any level would report these as "already present" before
// anything was ever advanced.

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  advanceField,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  listPaths,
} from "../../../canvas/canvas-shadow";

const KINDS: readonly ShadowRecordKind[] = ["node", "edge"];
const FIELDS = ["x", "y", "text"] as const;

const pathOf = (p: number) => `Notes/${p}/board-${p}.canvas`;
const idOf = (kind: ShadowRecordKind, r: number) => `${kind}-${r}`;
/** Deterministic, collision-free leaf value — no randomness, no clock. */
const valueOf = (p: number, kind: ShadowRecordKind, r: number, field: string) =>
  `${p}:${kind}:${r}:${field}`;

describe("WP1 AC1 — hierarchy is exact across a wide, generated shadow", () => {
  it("round-trips all 144 leaves through both the structure and the readers", () => {
    const shadow = createSurfaceShadow();

    for (let p = 0; p < 6; p += 1) {
      for (const kind of KINDS) {
        for (let r = 0; r < 4; r += 1) {
          for (const field of FIELDS) {
            advanceField(shadow, pathOf(p), kind, idOf(kind, r), field, valueOf(p, kind, r, field));
          }
        }
      }
    }

    expect(listPaths(shadow)).toHaveLength(6);
    expect(shadow.paths.size).toBe(6);

    let leaves = 0;
    for (let p = 0; p < 6; p += 1) {
      const pathState = shadow.paths.get(pathOf(p));
      expect(pathState).toBeDefined();
      if (!pathState) throw new Error("unreachable");

      for (const kind of KINDS) {
        expect(pathState[kind].size).toBe(4);
        for (let r = 0; r < 4; r += 1) {
          const record = pathState[kind].get(idOf(kind, r));
          expect(record).toBeDefined();
          if (!record) throw new Error("unreachable");
          expect(record.fields.size).toBe(3);

          for (const field of FIELDS) {
            const expected = valueOf(p, kind, r, field);
            expect(record.fields.get(field)).toBe(expected);
            expect(getField(shadow, pathOf(p), kind, idOf(kind, r), field)).toBe(expected);
            leaves += 1;
          }
        }
      }
    }
    expect(leaves).toBe(144);
  });

  it("does not mistake an id or a path for an inherited Object property", () => {
    const shadow = createSurfaceShadow();

    for (const hostile of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(getRecordState(shadow, "Notes/board.canvas", "node", hostile)).toBe("unknown");
      expect(getRecordState(shadow, hostile, "edge", "n1")).toBe("unknown");
      expect(getField(shadow, hostile, "node", hostile, hostile)).toBeUndefined();
    }

    expect(listPaths(shadow)).toEqual([]);
  });

  it("stores prototype-shaped field names as ordinary fields", () => {
    const shadow = createSurfaceShadow();
    const path = "Notes/proto.canvas";

    advanceField(shadow, path, "node", "__proto__", "constructor", "c");
    advanceField(shadow, path, "node", "__proto__", "toString", "t");
    advanceField(shadow, path, "node", "__proto__", "x", 4);

    expect(getRecordFields(shadow, path, "node", "__proto__")).toEqual({
      constructor: "c",
      toString: "t",
      x: 4,
    });
    expect(getField(shadow, path, "node", "__proto__", "constructor")).toBe("c");
    // A sibling record must not inherit any of it.
    expect(getRecordState(shadow, path, "node", "other")).toBe("unknown");
    expect(getField(shadow, path, "node", "other", "toString")).toBeUndefined();
  });
});
