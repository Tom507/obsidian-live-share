import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint } from "../../../../../plugin/src/canvas/canvas-registers";
import {
  applyToYMap,
  buildCanvasData,
  decodeCanvasDataToFlat,
  parseCanvas,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC5 part 1 blind1 — an endpoint register with no `side`/`end` OMITS the
// `*Side`/`*End` key entirely (never `null`, never `""`), so a `.canvas` file
// holding side-less edges survives parse → doc → serialize byte-identically.
// Angle: absence is asserted as KEY ABSENCE (`not.toHaveProperty`, `Object.keys`,
// and the raw text not mentioning the key at all) rather than as `=== undefined`,
// which a key present with an undefined value would also satisfy; and the round
// trip is measured against a HAND-WRITTEN canonical literal, never against a
// serialisation of the fixture, so the byte claim cannot be tautological.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC5 part 1 blind1 — side-less endpoints omit the key, and such a file does not churn", () => {
  it("an edge whose both endpoints carry only a node emits neither *Side nor *End as a key", () => {
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
    edge.set("from", encodeEndpoint("n1"));
    edge.set("to", encodeEndpoint("n2"));

    const out = buildCanvasData(nodes, edges).edges[0] as Record<string, unknown>;

    expect(out).toMatchObject({ id: "e1", fromNode: "n1", toNode: "n2" });
    // Key ABSENCE, four different ways — none of which a `null`, an `""` or a
    // present-but-undefined key would pass.
    expect(out).not.toHaveProperty("fromSide");
    expect(out).not.toHaveProperty("fromEnd");
    expect(out).not.toHaveProperty("toSide");
    expect(out).not.toHaveProperty("toEnd");
    expect(Object.keys(out)).toEqual(["id", "fromNode", "toNode"]);
    expect(Object.prototype.hasOwnProperty.call(out, "fromSide")).toBe(false);
    expect("toSide" in out).toBe(false);

    // And nothing leaks into the bytes either.
    const text = serializeCanvas(nodes, edges);
    expect(text).not.toContain("fromSide");
    expect(text).not.toContain("toSide");
    expect(text).not.toContain("fromEnd");
    expect(text).not.toContain("toEnd");
    expect(text).not.toContain("null");
    expect(text).not.toContain('""');
  });

  it("a half-decorated edge keeps the components it has and omits only the absent ones", () => {
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

    const edge = new Y.Map<unknown>();
    edges.set("e1", edge);
    edge.set("id", "e1");
    // `from` has a side but no end; `to` has an end but no side. Every one of the
    // four optional keys is therefore exercised in both states within one record.
    edge.set("from", encodeEndpoint("n1", "right"));
    edge.set("to", encodeEndpoint("n2", undefined, "arrow"));

    const out = buildCanvasData(nodes, edges).edges[0] as Record<string, unknown>;

    expect(out).toMatchObject({
      id: "e1",
      fromNode: "n1",
      fromSide: "right",
      toNode: "n2",
      toEnd: "arrow",
    });
    expect(out).not.toHaveProperty("fromEnd");
    expect(out).not.toHaveProperty("toSide");
    // The present keys must be exactly these, in canonical order — an extra
    // `"toSide": null` slot would show up here as well as in `not.toHaveProperty`.
    expect(Object.keys(out)).toEqual(["id", "fromNode", "fromSide", "toNode", "toEnd"]);
  });

  it("a .canvas file containing side-less edges round-trips file → doc → file byte-identically", () => {
    // Hand-written canonical form: tab-indented, `nodes` before `edges`, records
    // id-ascending (nothing carries an `ord`, so the sort falls back to id), keys
    // in the schema order, no trailing newline. Written out by hand ON PURPOSE —
    // deriving it from `serializeCanvas` would assert only that the serializer
    // agrees with itself.
    const TEXT = [
      "{",
      '\t"nodes": [',
      "\t\t{",
      '\t\t\t"id": "n1",',
      '\t\t\t"type": "text",',
      '\t\t\t"x": 0,',
      '\t\t\t"y": 0,',
      '\t\t\t"width": 200,',
      '\t\t\t"height": 100,',
      '\t\t\t"text": "alpha"',
      "\t\t},",
      "\t\t{",
      '\t\t\t"id": "n2",',
      '\t\t\t"type": "text",',
      '\t\t\t"x": 400,',
      '\t\t\t"y": 0,',
      '\t\t\t"width": 200,',
      '\t\t\t"height": 100,',
      '\t\t\t"text": "beta"',
      "\t\t}",
      "\t],",
      '\t"edges": [',
      "\t\t{",
      '\t\t\t"id": "e1",',
      '\t\t\t"fromNode": "n1",',
      '\t\t\t"toNode": "n2"',
      "\t\t},",
      "\t\t{",
      '\t\t\t"id": "e2",',
      '\t\t\t"fromNode": "n2",',
      '\t\t\t"fromSide": "left",',
      '\t\t\t"toNode": "n1",',
      '\t\t\t"toEnd": "arrow"',
      "\t\t}",
      "\t]",
      "}",
    ].join("\n");

    // Sanity: the literal really is side-less where it claims to be, so a typo
    // cannot turn this into a round trip of a fully-decorated file.
    expect(TEXT).not.toContain("toSide");
    expect(TEXT).not.toContain("fromEnd");

    const { nodes, edges } = makeDoc();
    const flat = decodeCanvasDataToFlat(parseCanvas(TEXT));

    for (const [id, record] of Object.entries(flat.nodes)) {
      const held = new Y.Map<unknown>();
      nodes.set(id, held);
      applyToYMap(held, record);
    }
    for (const [id, record] of Object.entries(flat.edges)) {
      const held = new Y.Map<unknown>();
      edges.set(id, held);
      applyToYMap(held, record);
    }

    // The whole point: the first write after a read of this file must be a no-op
    // at the byte level, so the file does not churn.
    expect(serializeCanvas(nodes, edges)).toBe(TEXT);
  });
});
