import { describe, expect, it } from "vitest";

import { canonicalizeRecord, serializeCanonicalCanvas } from "../../../canvas/canvas-canonical";

// AC2 (no field gains or loses a value) — angle: the falsy/absent boundary.
// A canonicaliser that uses `if (record[key])` or `?? undefined` instead of a
// presence test silently deletes `0`, `false`, `""` and `null` — all of which
// are legal `.canvas` values — while `undefined` (not a JSON value) must go.

type Rec = Record<string, unknown>;

describe("canonicalisation neither adds nor removes values (AC2)", () => {
  it("keeps every falsy-but-real value on a node", () => {
    const input: Rec = {
      id: "n0",
      type: "text",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: "",
      text: "",
      collapsed: false,
      parent: null,
    };

    const out = canonicalizeRecord(input, "node");

    expect(Object.keys(out).length).toBe(Object.keys(input).length);
    expect(out.x).toBe(0);
    expect(out.color).toBe("");
    expect(out.collapsed).toBe(false);
    expect(out.parent).toBeNull();
    expect("parent" in out).toBe(true);
  });

  it("drops an undefined value on an edge but keeps a null one", () => {
    const out = canonicalizeRecord(
      { id: "e", fromNode: "a", toNode: "b", label: undefined, color: null },
      "edge",
    );

    expect("label" in out).toBe(false);
    expect("color" in out).toBe(true);
    expect(out.color).toBeNull();
  });

  it("survives own properties that shadow Object.prototype names", () => {
    const input: Rec = {
      id: "n1",
      type: "text",
      x: 1,
      y: 1,
      width: 1,
      height: 1,
      toString: "not a function",
      constructor: 7,
      hasOwnProperty: "mine",
    };

    // Read through Object.entries so the assertions see the OWN properties and
    // never Object.prototype's members.
    const seen = new Map(Object.entries(canonicalizeRecord(input, "node")));

    expect(seen.get("toString")).toBe("not a function");
    expect(seen.get("constructor")).toBe(7);
    expect(seen.get("hasOwnProperty")).toBe("mine");
    expect(seen.size).toBe(Object.keys(input).length);
  });

  it("carries an unknown nested structure through serialisation unchanged", () => {
    const nodes: Rec[] = [
      {
        id: "n1",
        type: "text",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        text: "t",
        pluginState: { revision: 4, tags: ["a", "b"], nested: { ok: true } },
      },
    ];

    const parsed = JSON.parse(serializeCanonicalCanvas({ nodes, edges: [] })) as { nodes: Rec[] };

    expect(parsed.nodes[0].pluginState).toEqual({
      revision: 4,
      tags: ["a", "b"],
      nested: { ok: true },
    });
  });

  it("never invents a canonical key that the input did not have", () => {
    const out = canonicalizeRecord({ id: "e1", fromNode: "a", toNode: "b" }, "edge");

    expect(Object.keys(out)).toEqual(["id", "fromNode", "toNode"]);
    expect("fromSide" in out).toBe(false);
    expect("color" in out).toBe(false);
  });
});
