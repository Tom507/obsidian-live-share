import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  encodeEndpoint,
  encodePos,
  encodeSize,
} from "../../../../../plugin/src/canvas/canvas-registers";
import { buildCanvasData, serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC5 part 2 blind1 — no serialisation path may emit `null` or `""` for an
// optional endpoint or geometry key, INCLUDING via the verbatim flat-key pass: a
// junk value already sitting in the doc under a flat key is dropped, not carried
// to disk, and must not override a register that still holds the real answer.
// Angle: the junk is planted under BOTH the four geometry keys and the six
// endpoint keys, in both flavours (`null` and `""`), both alongside a valid
// register and standing alone with no register at all; and the verdict is taken
// from the RAW SERIALIZED TEXT (`not.toContain("null")`) as well as the object
// oracle, because a key that survives as `null` is invisible to `toMatchObject`.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC5 part 2 blind1 — junk under a flat key is dropped and never reaches the bytes", () => {
  it("junk geometry does not override the pos/size registers and does not reach disk", () => {
    const { nodes, edges } = makeDoc();

    const node = new Y.Map<unknown>();
    nodes.set("n1", node);
    node.set("id", "n1");
    node.set("type", "text");
    // The registers hold the REAL answer.
    node.set("pos", encodePos(120, 240));
    node.set("size", encodeSize(300, 150));
    // ...and all four flat geometry keys are junk, two of each flavour.
    node.set("x", null);
    node.set("y", "");
    node.set("width", null);
    node.set("height", "");

    const out = buildCanvasData(nodes, edges).nodes[0] as Record<string, unknown>;

    expect(out).toMatchObject({
      id: "n1",
      type: "text",
      x: 120,
      y: 240,
      width: 300,
      height: 150,
    });
    // Explicit: the junk did not win by being "the flat vocabulary".
    expect(out.x).not.toBeNull();
    expect(out.y).not.toBe("");
    expect(out.width).not.toBeNull();
    expect(out.height).not.toBe("");
    // The registers themselves are doc-only and never file keys.
    expect(out).not.toHaveProperty("pos");
    expect(out).not.toHaveProperty("size");

    const text = serializeCanvas(nodes, edges);
    expect(text).not.toContain("null");
    expect(text).not.toContain('""');
    expect(text).toContain('"x": 120');
    expect(text).toContain('"height": 150');
  });

  it("junk endpoint components do not override the from/to registers and do not reach disk", () => {
    const { nodes, edges } = makeDoc();

    for (const [id, x] of [
      ["n1", 0],
      ["n2", 400],
    ] as const) {
      const node = new Y.Map<unknown>();
      nodes.set(id, node);
      node.set("id", id);
      node.set("type", "text");
      node.set("x", x);
      node.set("y", 0);
      node.set("width", 200);
      node.set("height", 100);
    }

    const edge = new Y.Map<unknown>();
    edges.set("e1", edge);
    edge.set("id", "e1");
    edge.set("from", encodeEndpoint("n1", "right", "none"));
    edge.set("to", encodeEndpoint("n2", "left", "arrow"));
    // All six flat endpoint keys planted as junk, both flavours.
    edge.set("fromNode", null);
    edge.set("fromSide", "");
    edge.set("fromEnd", null);
    edge.set("toNode", "");
    edge.set("toSide", null);
    edge.set("toEnd", "");

    const out = buildCanvasData(nodes, edges).edges[0] as Record<string, unknown>;

    expect(out).toMatchObject({
      id: "e1",
      fromNode: "n1",
      fromSide: "right",
      fromEnd: "none",
      toNode: "n2",
      toSide: "left",
      toEnd: "arrow",
    });
    expect(Object.keys(out)).toEqual([
      "id",
      "fromNode",
      "fromSide",
      "fromEnd",
      "toNode",
      "toSide",
      "toEnd",
    ]);
    expect(out).not.toHaveProperty("from");
    expect(out).not.toHaveProperty("to");

    const text = serializeCanvas(nodes, edges);
    expect(text).not.toContain("null");
    expect(text).not.toContain('""');
  });

  it("junk under an optional endpoint key with NO register at all is dropped rather than emitted", () => {
    const { nodes, edges } = makeDoc();

    for (const id of ["n1", "n2"]) {
      const node = new Y.Map<unknown>();
      nodes.set(id, node);
      node.set("id", id);
      node.set("type", "text");
      node.set("x", 0);
      node.set("y", 0);
      node.set("width", 200);
      node.set("height", 100);
    }

    // A purely FLAT record — nothing here to fall back on, so if the drop did not
    // happen the junk would be the only thing available and would reach disk.
    const edge = new Y.Map<unknown>();
    edges.set("e1", edge);
    edge.set("id", "e1");
    edge.set("fromNode", "n1");
    edge.set("fromSide", null);
    edge.set("fromEnd", "");
    edge.set("toNode", "n2");
    edge.set("toSide", "");
    edge.set("toEnd", null);

    const out = buildCanvasData(nodes, edges).edges[0] as Record<string, unknown>;

    expect(out).toMatchObject({ id: "e1", fromNode: "n1", toNode: "n2" });
    expect(out).not.toHaveProperty("fromSide");
    expect(out).not.toHaveProperty("fromEnd");
    expect(out).not.toHaveProperty("toSide");
    expect(out).not.toHaveProperty("toEnd");
    expect(Object.keys(out)).toEqual(["id", "fromNode", "toNode"]);

    const text = serializeCanvas(nodes, edges);
    expect(text).not.toContain("null");
    expect(text).not.toContain('""');
    expect(text).not.toContain("Side");
    expect(text).not.toContain("End");
  });
});
