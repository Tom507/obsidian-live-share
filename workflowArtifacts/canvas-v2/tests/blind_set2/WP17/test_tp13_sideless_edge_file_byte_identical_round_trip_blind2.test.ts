// WP17 AC5 part 1 blind2 — an absent `side`/`end` is an OMITTED KEY, never `null`
// and never `""`, so a `.canvas` carrying side-less edges survives
// parse -> doc -> serialize byte-identically and does not churn on its first (or
// second) write. Angle: assert against the SERIALIZED ARTEFACT and its key
// STRUCTURE — `Object.keys` equality and the `in` operator — rather than against
// object matchers, and drive every claim from one module-level fixture table that
// carries all four decoration states at once.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyToYMap,
  decodeCanvasDataToFlat,
  parseCanvas,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

// ---------------------------------------------------------------------------
// THE FILE. Hand-written in exact canonical form — tab-indented, `nodes` before
// `edges`, records id-ascending (no record carries an `ord`, so the sort falls
// back to id), keys in the canonical schema order, no trailing newline.
//
// Deliberately NOT produced by calling `serializeCanvas` first: a fixture built
// from the thing under test can only ever agree with itself.
// ---------------------------------------------------------------------------
const CANVAS_TEXT: string = [
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
  '\t\t\t"fromNode": "n1",',
  '\t\t\t"fromSide": "right",',
  '\t\t\t"toNode": "n2",',
  '\t\t\t"toSide": "left"',
  "\t\t},",
  "\t\t{",
  '\t\t\t"id": "e3",',
  '\t\t\t"fromNode": "n1",',
  '\t\t\t"fromEnd": "none",',
  '\t\t\t"toNode": "n2",',
  '\t\t\t"toEnd": "arrow"',
  "\t\t},",
  "\t\t{",
  '\t\t\t"id": "e4",',
  '\t\t\t"fromNode": "n1",',
  '\t\t\t"fromSide": "bottom",',
  '\t\t\t"fromEnd": "none",',
  '\t\t\t"toNode": "n2",',
  '\t\t\t"toSide": "top",',
  '\t\t\t"toEnd": "arrow",',
  '\t\t\t"color": "3",',
  '\t\t\t"label": "gamma"',
  "\t\t}",
  "\t]",
  "}",
].join("\n");

/** The four optional endpoint decoration keys, in canonical order. */
const OPTIONAL_ENDPOINT_KEYS: readonly string[] = ["fromSide", "fromEnd", "toSide", "toEnd"];

/**
 * The fixture table. One row per decoration state, so all four optional keys are
 * exercised BOTH present and absent within a single serialized artefact.
 */
const EDGE_SHAPES: readonly {
  readonly id: string;
  readonly state: string;
  readonly keys: readonly string[];
}[] = [
  { id: "e1", state: "fully side-less and end-less", keys: ["id", "fromNode", "toNode"] },
  {
    id: "e2",
    state: "sides but no ends",
    keys: ["id", "fromNode", "fromSide", "toNode", "toSide"],
  },
  {
    id: "e3",
    state: "ends but no sides",
    keys: ["id", "fromNode", "fromEnd", "toNode", "toEnd"],
  },
  {
    id: "e4",
    state: "fully decorated",
    keys: [
      "id",
      "fromNode",
      "fromSide",
      "fromEnd",
      "toNode",
      "toSide",
      "toEnd",
      "color",
      "label",
    ],
  },
];

const NODE_SHAPES: readonly { readonly id: string; readonly keys: readonly string[] }[] = [
  { id: "n1", keys: ["id", "type", "x", "y", "width", "height", "text"] },
  { id: "n2", keys: ["id", "type", "x", "y", "width", "height", "text"] },
];

interface Containers {
  readonly nodes: Y.Map<Y.Map<unknown>>;
  readonly edges: Y.Map<Y.Map<unknown>>;
}

/**
 * The honest file -> doc path, parameterized by the file text: parse to the V2
 * registers, bridge back to the flat vocabulary the write boundaries speak, and
 * upsert each record into its own freshly attached `Y.Map`.
 */
function fileToDoc(text: string): Containers {
  const parsed = parseCanvas(text);
  const flat = decodeCanvasDataToFlat(parsed);
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
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
  return { nodes, edges };
}

/** file -> doc -> file, in one step. */
function rewrite(text: string): string {
  const { nodes, edges } = fileToDoc(text);
  return serializeCanvas(nodes, edges);
}

function recordsOf(text: string, space: "nodes" | "edges"): Record<string, unknown>[] {
  return (JSON.parse(text) as Record<string, Record<string, unknown>[]>)[space];
}

function recordById(text: string, space: "nodes" | "edges", id: string): Record<string, unknown> {
  const found = recordsOf(text, space).find((record) => record.id === id);
  if (found === undefined) throw new Error(`no ${space} record ${id} in the serialized text`);
  return found;
}

describe("WP17 AC5 part 1 (blind2): the serialized artefact OMITS an absent side/end key, and a side-less .canvas round-trips byte-identically", () => {
  it("the hand-written fixture itself carries no null and no empty-string optional key", () => {
    // Guards the fixture, not the implementation: if the literal below ever grew
    // a `null`, the round-trip claim would be vacuous.
    expect(CANVAS_TEXT).not.toContain("null");
    for (const key of OPTIONAL_ENDPOINT_KEYS) {
      expect(CANVAS_TEXT).not.toContain(`"${key}": ""`);
      expect(CANVAS_TEXT).not.toContain(`"${key}": null`);
    }
    expect(CANVAS_TEXT.endsWith("\n")).toBe(false);
  });

  it("parse -> doc -> serialize reproduces the file byte-identically", () => {
    expect(rewrite(CANVAS_TEXT)).toBe(CANVAS_TEXT);
  });

  it("the doc built from that file does not churn on a second serialization", () => {
    const { nodes, edges } = fileToDoc(CANVAS_TEXT);
    const first = serializeCanvas(nodes, edges);
    const second = serializeCanvas(nodes, edges);
    expect(second).toBe(first);
  });

  it("the round trip is a FIXPOINT: re-reading the written file and writing it again changes nothing", () => {
    const once = rewrite(CANVAS_TEXT);
    const twice = rewrite(once);
    expect(twice).toBe(once);
    expect(twice).toBe(CANVAS_TEXT);
  });

  it("no null and no empty string reaches the serialized text at all", () => {
    const written = rewrite(CANVAS_TEXT);
    expect(written).not.toContain("null");
    expect(written).not.toContain('": ""');
  });

  for (const shape of EDGE_SHAPES) {
    it(`edge ${shape.id} (${shape.state}) serializes exactly its present keys, in canonical order`, () => {
      const record = recordById(rewrite(CANVAS_TEXT), "edges", shape.id);
      expect(Object.keys(record)).toEqual([...shape.keys]);
    });

    it(`edge ${shape.id} (${shape.state}) OMITS every optional key it does not carry — absence, not undefined`, () => {
      const record = recordById(rewrite(CANVAS_TEXT), "edges", shape.id);
      const absent = OPTIONAL_ENDPOINT_KEYS.filter((key) => !shape.keys.includes(key));
      for (const key of absent) {
        // Key ABSENCE, asserted structurally. `record[key] === undefined` would
        // also be true for `{fromSide: undefined}`, which is a different fact.
        expect(key in record).toBe(false);
        expect(Object.keys(record)).not.toContain(key);
        expect(Object.prototype.hasOwnProperty.call(record, key)).toBe(false);
      }
      for (const key of OPTIONAL_ENDPOINT_KEYS.filter((k) => shape.keys.includes(k))) {
        expect(key in record).toBe(true);
        expect(typeof record[key]).toBe("string");
        expect(record[key]).not.toBe("");
      }
    });
  }

  for (const shape of NODE_SHAPES) {
    it(`node ${shape.id} survives the register round trip with its canonical key list intact`, () => {
      const record = recordById(rewrite(CANVAS_TEXT), "nodes", shape.id);
      expect(Object.keys(record)).toEqual([...shape.keys]);
    });
  }

  it("every fixture record survives — the side-less edges are not pruned", () => {
    const written = rewrite(CANVAS_TEXT);
    expect(recordsOf(written, "nodes")).toHaveLength(NODE_SHAPES.length);
    expect(recordsOf(written, "edges")).toHaveLength(EDGE_SHAPES.length);
    expect(recordsOf(written, "edges").map((record) => record.id)).toEqual(
      EDGE_SHAPES.map((shape) => shape.id),
    );
  });
});
