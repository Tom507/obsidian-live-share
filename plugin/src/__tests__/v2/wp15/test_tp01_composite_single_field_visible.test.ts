// WP15 AC1 — the shadow stores pos, size, from and to as SINGLE fields.
//
// V1 tracked a card's geometry as four independent shadow fields ("x", "y",
// "width", "height") and an edge's endpoints as up to six ("fromNode",
// "fromSide", "fromEnd", "to*"). V2 replaces each composite with ONE atomic
// register value (BUILD_SPEC §4.3, WP9/WP10's `pos`/`size`/`from`/`to`), and
// the shadow must store that register as a single Map entry keyed by the
// register's own name — never split back into its components. This is the
// storage half of AC1; test_tp02 covers the staleness-diff half (a change to
// one component marks the WHOLE register as intent).

import { describe, expect, it } from "vitest";

import { advanceField, createSurfaceShadow, getField, getRecordFields } from "../../../canvas/canvas-shadow";
import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";

const PATH = "Vault/Board.canvas";

describe("WP15 AC1 — pos/size/from/to are stored as single composite fields", () => {
  it("pos: one advanceField('pos', ...) call produces exactly one field key holding the whole [x, y] pair", () => {
    const shadow = createSurfaceShadow();
    const pos = encodePos(12.4, 40.6); // capture-side rounding already applied

    advanceField(shadow, PATH, "node", "card-1", "pos", pos as any);

    const fields = getRecordFields(shadow, PATH, "node", "card-1");
    expect(fields).not.toBeNull();
    expect(Object.keys(fields as object)).toEqual(["pos"]);
    expect(getField(shadow, PATH, "node", "card-1", "pos")).toEqual([12, 41]);
  });

  it("size: one field key holds the whole [width, height] pair", () => {
    const shadow = createSurfaceShadow();
    const size = encodeSize(260, 60);

    advanceField(shadow, PATH, "node", "card-2", "size", size as any);

    const fields = getRecordFields(shadow, PATH, "node", "card-2");
    expect(Object.keys(fields as object)).toEqual(["size"]);
    expect(getField(shadow, PATH, "node", "card-2", "size")).toEqual([260, 60]);
  });

  it("from / to: each endpoint is one field key holding the whole {node, side} object", () => {
    const shadow = createSurfaceShadow();
    const from = encodeEndpoint("card-1", "right");
    const to = encodeEndpoint("card-2", "left");

    advanceField(shadow, PATH, "edge", "e1", "from", from as any);
    advanceField(shadow, PATH, "edge", "e1", "to", to as any);

    const fields = getRecordFields(shadow, PATH, "edge", "e1");
    expect(Object.keys(fields as object).sort()).toEqual(["from", "to"]);
    expect(getField(shadow, PATH, "edge", "e1", "from")).toEqual({ node: "card-1", side: "right" });
    expect(getField(shadow, PATH, "edge", "e1", "to")).toEqual({ node: "card-2", side: "left" });
  });

  it("no split component keys ever appear alongside the composite field", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH, "node", "card-3", "pos", encodePos(5, 5) as any);
    advanceField(shadow, PATH, "node", "card-3", "size", encodeSize(30, 30) as any);

    const fields = getRecordFields(shadow, PATH, "node", "card-3") as Record<string, unknown>;
    for (const banned of ["x", "y", "width", "height"]) {
      expect(Object.prototype.hasOwnProperty.call(fields, banned)).toBe(false);
    }
    expect(Object.keys(fields).sort()).toEqual(["pos", "size"]);
  });
});
