// WP1 / AC2 (second half) — isolation across the KIND axis and across many peers.
//
// Angle of attack: the visible risk is a shared record object. Here the ids are
// deliberately made to collide on every axis that is not the one being advanced —
// one id used simultaneously as a node id and an edge id in the same path, and
// the same id used across five paths — and an advance is fired at exactly one of
// them while all the others are compared against a snapshot taken beforehand.
//
// A second angle: a record is advanced through the multi-field API with a field
// set that is a superset of a sibling's, which is where an implementation that
// shares one field container between records collapses.

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  type SurfaceShadow,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordFields,
} from "../../../canvas/canvas-shadow";

const SHARED_ID = "collide";
const PATHS = [0, 1, 2, 3, 4].map((index) => `Boards/${index}.canvas`);

function fingerprint(shadow: SurfaceShadow, path: string, kind: ShadowRecordKind, id: string) {
  return JSON.stringify(getRecordFields(shadow, path, kind, id));
}

describe("WP1 AC2 — collisions on every non-advanced axis stay separate", () => {
  it("a node and an edge sharing one id in one path are two records", () => {
    const shadow = createSurfaceShadow();
    const path = PATHS[0];

    advanceRecord(shadow, path, "node", SHARED_ID, { x: 1, y: 2, text: "node side" });
    advanceRecord(shadow, path, "edge", SHARED_ID, { fromNode: "a", toNode: "b", label: "edge side" });

    const edgeBefore = fingerprint(shadow, path, "edge", SHARED_ID);
    advanceField(shadow, path, "node", SHARED_ID, "text", "node side v2");

    expect(getField(shadow, path, "node", SHARED_ID, "text")).toBe("node side v2");
    expect(fingerprint(shadow, path, "edge", SHARED_ID)).toBe(edgeBefore);
    expect(getField(shadow, path, "edge", SHARED_ID, "label")).toBe("edge side");
    expect(getField(shadow, path, "edge", SHARED_ID, "x")).toBeUndefined();
    expect(getField(shadow, path, "node", SHARED_ID, "label")).toBeUndefined();
  });

  it("the same id across five paths: advancing the middle one moves nothing else", () => {
    const shadow = createSurfaceShadow();
    for (const [index, path] of PATHS.entries()) {
      advanceRecord(shadow, path, "node", SHARED_ID, { x: index, y: index * 2, text: `p${index}` });
    }

    const before = PATHS.map((path) => fingerprint(shadow, path, "node", SHARED_ID));

    advanceField(shadow, PATHS[2], "node", SHARED_ID, "x", 500);

    for (const [index, path] of PATHS.entries()) {
      if (index === 2) {
        expect(getRecordFields(shadow, path, "node", SHARED_ID)).toEqual({
          x: 500,
          y: 4,
          text: "p2",
        });
      } else {
        expect(fingerprint(shadow, path, "node", SHARED_ID)).toBe(before[index]);
      }
    }
  });

  it("a superset advance on one record does not add the extra fields to a sibling", () => {
    const shadow = createSurfaceShadow();
    const path = PATHS[1];

    advanceRecord(shadow, path, "node", "small", { x: 0, y: 0 });
    advanceRecord(shadow, path, "node", "big", {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      color: "2",
      text: "big",
    });

    advanceRecord(shadow, path, "node", "big", { width: 11, background: "b.png" });

    expect(getRecordFields(shadow, path, "node", "small")).toEqual({ x: 0, y: 0 });
    expect(getField(shadow, path, "node", "small", "background")).toBeUndefined();
    expect(getField(shadow, path, "node", "big", "background")).toBe("b.png");
    expect(getField(shadow, path, "node", "big", "width")).toBe(11);
  });

  it("advancing 50 sibling records leaves each with exactly its own value", () => {
    const shadow = createSurfaceShadow();
    const path = PATHS[3];

    for (let index = 0; index < 50; index += 1) {
      advanceRecord(shadow, path, "node", `n${index}`, { x: index, text: `t${index}` });
    }
    for (let index = 0; index < 50; index += 2) {
      advanceField(shadow, path, "node", `n${index}`, "x", index + 1000);
    }

    for (let index = 0; index < 50; index += 1) {
      expect(getRecordFields(shadow, path, "node", `n${index}`)).toEqual({
        x: index % 2 === 0 ? index + 1000 : index,
        text: `t${index}`,
      });
    }
  });
});
