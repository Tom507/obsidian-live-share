// WP15 AC1 — same guarantee as the visible test, attacked from a different
// angle: a single advanceRecord() call carrying MULTIPLE composite fields at
// once (rather than one advanceField() call per field), on an edge record,
// with negative coordinates. Different ids and values from the visible test.

import { describe, expect, it } from "vitest";

import { advanceRecord, createSurfaceShadow, getField, getRecordFields } from "../../../canvas/canvas-shadow";
import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";

const PATH = "Boards/Retro.canvas";

describe("WP15 AC1 — composite fields survive a batched advanceRecord as single keys", () => {
  it("a node advanced with pos AND size in one call stores exactly two keys, each atomic", () => {
    const shadow = createSurfaceShadow();

    advanceRecord(shadow, PATH, "node", "sticky-9", {
      pos: encodePos(-5.4, -0.2) as any,
      size: encodeSize(120, 80) as any,
    });

    const fields = getRecordFields(shadow, PATH, "node", "sticky-9") as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(["pos", "size"]);
    expect(getField(shadow, PATH, "node", "sticky-9", "pos")).toEqual([-5, 0]);
    expect(getField(shadow, PATH, "node", "sticky-9", "size")).toEqual([120, 80]);
  });

  it("an edge advanced with from AND to in one call stores exactly two keys, each atomic", () => {
    const shadow = createSurfaceShadow();

    advanceRecord(shadow, PATH, "edge", "arrow-3", {
      from: encodeEndpoint("sticky-9", "bottom", "arrow") as any,
      to: encodeEndpoint("sticky-2", "top") as any,
    });

    const fields = getRecordFields(shadow, PATH, "edge", "arrow-3") as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(["from", "to"]);
    expect(getField(shadow, PATH, "edge", "arrow-3", "from")).toEqual({
      node: "sticky-9",
      side: "bottom",
      end: "arrow",
    });
    expect(getField(shadow, PATH, "edge", "arrow-3", "to")).toEqual({ node: "sticky-2", side: "top" });
    // No split component key ("fromNode", "toSide", ...) ever appears.
    for (const banned of ["fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd"]) {
      expect(Object.prototype.hasOwnProperty.call(fields, banned)).toBe(false);
    }
  });
});
