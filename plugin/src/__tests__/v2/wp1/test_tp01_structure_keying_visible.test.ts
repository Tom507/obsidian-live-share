// WP1 / AC1 — the Surface-Shadow key hierarchy.
//
// AC1: "The module exports a shadow structure keyed by canonical path, then
// record kind (`node`/`edge`), then record id, then field name."
//
// The structure IS the contract here: WP2 (intent diff) and WP4/WP5 (capture and
// apply receipt) all navigate it. So this test walks the raw four-level nesting by
// hand and cross-checks every reader function against that walk — a reader that
// agreed with itself but not with the structure would still be a defect.
//
// Pure data test: no Obsidian, no adapter, no clock.

import { describe, expect, it } from "vitest";

import {
  type ShadowFieldValue,
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

const PATH_A = "Vault/Boards/Alpha.canvas";
const PATH_B = "Vault/Boards/Beta.canvas";

/** Read a field by walking the raw structure — path → kind → id → field. */
function fieldViaStructure(
  shadow: SurfaceShadow,
  path: string,
  kind: ShadowRecordKind,
  id: string,
  field: string,
): ShadowFieldValue | undefined {
  const pathState = shadow.paths.get(path);
  if (!pathState) return undefined;
  const record = pathState[kind].get(id);
  if (!record) return undefined;
  return record.fields.get(field);
}

function populated(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, PATH_A, "node", "n1", { x: 10, y: 20, text: "alpha" });
  advanceRecord(shadow, PATH_A, "edge", "e1", { fromNode: "n1", toNode: "n2", label: "flows" });
  advanceRecord(shadow, PATH_B, "node", "n1", { x: 900, y: 900, text: "beta" });
  return shadow;
}

describe("WP1 AC1 — shadow structure keyed by path → kind → id → field", () => {
  it("nests exactly four levels and keys each level with the value it was given", () => {
    const shadow = populated();

    expect([...shadow.paths.keys()].sort()).toEqual([PATH_A, PATH_B].sort());

    const alpha = shadow.paths.get(PATH_A);
    expect(alpha).toBeDefined();
    if (!alpha) throw new Error("unreachable");

    expect([...alpha.node.keys()]).toEqual(["n1"]);
    expect([...alpha.edge.keys()]).toEqual(["e1"]);

    const node = alpha.node.get("n1");
    expect(node).toBeDefined();
    if (!node) throw new Error("unreachable");
    expect(node.state).toBe("present");
    expect([...node.fields.keys()].sort()).toEqual(["text", "x", "y"]);
    expect(node.fields.get("x")).toBe(10);
    expect(node.fields.get("text")).toBe("alpha");

    const edge = alpha.edge.get("e1");
    expect(edge).toBeDefined();
    if (!edge) throw new Error("unreachable");
    expect(edge.fields.get("label")).toBe("flows");
  });

  it("keeps `node` and `edge` as separate id spaces under the same path", () => {
    const shadow = createSurfaceShadow();
    advanceField(shadow, PATH_A, "node", "shared-id", "x", 1);
    advanceField(shadow, PATH_A, "edge", "shared-id", "x", 2);

    expect(fieldViaStructure(shadow, PATH_A, "node", "shared-id", "x")).toBe(1);
    expect(fieldViaStructure(shadow, PATH_A, "edge", "shared-id", "x")).toBe(2);
    expect(getField(shadow, PATH_A, "node", "shared-id", "x")).toBe(1);
    expect(getField(shadow, PATH_A, "edge", "shared-id", "x")).toBe(2);
  });

  it("readers agree with the raw structure walk for every level", () => {
    const shadow = populated();

    for (const [path, kind, id, field, expected] of [
      [PATH_A, "node", "n1", "x", 10],
      [PATH_A, "edge", "e1", "toNode", "n2"],
      [PATH_B, "node", "n1", "text", "beta"],
    ] as const) {
      expect(getField(shadow, path, kind, id, field)).toBe(expected);
      expect(fieldViaStructure(shadow, path, kind, id, field)).toBe(expected);
    }

    expect(getRecordState(shadow, PATH_A, "node", "n1")).toBe("present");
    expect(getRecordFields(shadow, PATH_B, "node", "n1")).toEqual({
      x: 900,
      y: 900,
      text: "beta",
    });
    expect(listPaths(shadow).sort()).toEqual([PATH_A, PATH_B].sort());
  });

  it("getRecordFields hands back a detached snapshot, not the live field store", () => {
    const shadow = populated();

    const fields = getRecordFields(shadow, PATH_A, "node", "n1");
    expect(fields).not.toBeNull();
    if (!fields) throw new Error("unreachable");

    fields.x = 999;
    delete fields.text;

    expect(getField(shadow, PATH_A, "node", "n1", "x")).toBe(10);
    expect(getField(shadow, PATH_A, "node", "n1", "text")).toBe("alpha");
  });

  it("reports undefined / unknown for a path, id or field never observed", () => {
    const shadow = populated();

    expect(getField(shadow, "Vault/Nope.canvas", "node", "n1", "x")).toBeUndefined();
    expect(getField(shadow, PATH_A, "node", "ghost", "x")).toBeUndefined();
    expect(getField(shadow, PATH_A, "node", "n1", "color")).toBeUndefined();
    expect(getRecordState(shadow, "Vault/Nope.canvas", "node", "n1")).toBe("unknown");
    expect(getRecordFields(shadow, PATH_A, "node", "ghost")).toBeNull();
  });
});
