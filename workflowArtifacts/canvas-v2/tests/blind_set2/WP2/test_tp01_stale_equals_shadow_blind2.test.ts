// WP2 / AC1 — staleness under hostile keys, hostile values and repeated saves.
//
// Angle of attack: AC1 stands or falls on the comparison "save value equals
// shadow value". This file attacks the comparison itself rather than the
// scenario around it:
//   - field names that are also Object.prototype members (`__proto__`,
//     `constructor`, `toString`, `hasOwnProperty`) and the empty-string name —
//     a plain-object or `for...in` based comparison reports a phantom match or a
//     phantom difference for each of them;
//   - values where JavaScript's equality operators disagree: `0` vs `-0`
//     (`===` equal, `Object.is` not), `"1"` vs `1` (`==` equal, `===` not);
//   - the same save arriving twice in a row (Obsidian re-saves an untouched
//     canvas on focus loss) — the second pass must be pure staleness again.
//
// The parsed save is built with `JSON.parse` exactly as the production path
// builds it, so `__proto__` arrives as an own data property rather than a
// prototype assignment.

import { describe, expect, it } from "vitest";

import {
  type ParsedSave,
  type ShadowFieldValue,
  type SurfaceState,
  type TombstoneView,
  advanceField,
  createSurfaceShadow,
  planIntentDiff,
} from "../../../canvas/canvas-shadow";

const PATH = "a/b/c/deep.canvas";

const NO_TOMBSTONES: TombstoneView = { isDeleted: () => false };

const CLOSED: SurfaceState = {
  viewOpen: false,
  handedToView: { node: new Set(), edge: new Set() },
};

/** Field names that are also prototype members, plus the empty name. */
const HOSTILE_FIELDS: Array<[name: string, value: ShadowFieldValue]> = [
  ["__proto__", 1],
  ["constructor", "ctor"],
  ["toString", true],
  ["hasOwnProperty", null],
  ["", "empty-name"],
  ["valueOf", 0],
];

function hostileSave(): ParsedSave {
  const json = JSON.stringify(Object.fromEntries(HOSTILE_FIELDS));
  return {
    path: PATH,
    nodes: [{ id: "hostile", fields: JSON.parse(json) as Record<string, ShadowFieldValue> }],
    edges: [],
  };
}

describe("WP2 AC1 — the equality check itself", () => {
  it("prototype-named fields equal to the shadow are discards, not upserts", () => {
    const shadow = createSurfaceShadow();
    for (const [name, value] of HOSTILE_FIELDS) {
      advanceField(shadow, PATH, "node", "hostile", name, value);
    }

    const plan = planIntentDiff(shadow, hostileSave(), NO_TOMBSTONES, CLOSED);

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toHaveLength(HOSTILE_FIELDS.length);
    expect(plan.discarded.map((entry) => entry.field).sort()).toEqual(
      HOSTILE_FIELDS.map(([name]) => name).sort(),
    );
  });

  it("a prototype-named field the shadow never observed is still an upsert", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "hostile", "__proto__", 1);

    const plan = planIntentDiff(shadow, hostileSave(), NO_TOMBSTONES, CLOSED);

    // Only `__proto__` matches the shadow; the other five are new intent.
    expect(plan.discarded).toHaveLength(1);
    expect(plan.discarded[0].field).toBe("__proto__");
    expect(plan.upserts).toHaveLength(HOSTILE_FIELDS.length - 1);
  });

  it("`0` and `-0` are the same observed value — no phantom intent", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "zero", "x", 0);
    advanceField(shadow, PATH, "node", "zero", "y", -0);

    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [{ id: "zero", fields: { x: -0, y: 0 } }], edges: [] },
      NO_TOMBSTONES,
      CLOSED,
    );

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toHaveLength(2);
  });

  it("`\"1\"` and `1` are different observed values — loose equality is not the rule", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "loose", "a", 1);
    advanceField(shadow, PATH, "node", "loose", "b", "");
    advanceField(shadow, PATH, "node", "loose", "c", false);

    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [{ id: "loose", fields: { a: "1", b: 0, c: 0 } }], edges: [] },
      NO_TOMBSTONES,
      CLOSED,
    );

    expect(plan.discarded).toEqual([]);
    expect(plan.upserts).toHaveLength(3);
  });

  it("re-saving the same content twice stays staleness both times", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "n", "text", "unchanged");
    const save: ParsedSave = {
      path: PATH,
      nodes: [{ id: "n", fields: { text: "unchanged" } }],
      edges: [],
    };

    const first = planIntentDiff(shadow, save, NO_TOMBSTONES, CLOSED);
    const second = planIntentDiff(shadow, save, NO_TOMBSTONES, CLOSED);

    expect(first.discarded).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("discards scale with the fixture and never collapse per record", () => {
    const shadow = createSurfaceShadow();
    const nodes = Array.from({ length: 40 }, (_, index) => {
      const fields: Record<string, ShadowFieldValue> = {
        x: index * 10,
        y: index * -10,
        color: `${index % 6}`,
      };
      for (const [field, value] of Object.entries(fields)) {
        advanceField(shadow, PATH, "node", `n${index}`, field, value);
      }
      return { id: `n${index}`, fields };
    });

    const plan = planIntentDiff(shadow, { path: PATH, nodes, edges: [] }, NO_TOMBSTONES, CLOSED);

    expect(plan.upserts).toEqual([]);
    expect(plan.discarded).toHaveLength(120);
    expect(new Set(plan.discarded.map((entry) => entry.id)).size).toBe(40);
  });

  it("a field on a different path is not a match for this path's shadow", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, "OTHER.canvas", "node", "n", "x", 5);

    const plan = planIntentDiff(
      shadow,
      { path: PATH, nodes: [{ id: "n", fields: { x: 5 } }], edges: [] },
      NO_TOMBSTONES,
      CLOSED,
    );

    expect(plan.discarded).toEqual([]);
    expect(plan.upserts).toEqual([{ path: PATH, kind: "node", id: "n", field: "x", value: 5 }]);
  });
});
