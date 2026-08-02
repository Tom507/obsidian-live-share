import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  encodeEndpoint,
  encodePos,
  encodeSize,
} from "../../../../../plugin/src/canvas/canvas-registers";
import { buildCanvasData, serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC5 part 3 blind1 — the flat-vs-register precedence is an explicit,
// phase-scoped rule (in P1 the FLAT key wins), never an artefact of `Y.Map`
// insertion order. Angle: the same logical record is built TWICE in two separate
// docs, with the stale register and the fresh flat key inserted in OPPOSITE
// orders, and the two serialisations are required to be byte-identical to each
// other as well as to carry the flat value. Asserting only the value would pass
// against the insertion-order bug for whichever order happened to be tried, and
// cross-replica byte equality provably cannot see this class at all, because
// both replicas converge on the SAME wrong value. Every fixture here is
// single-author construction, so no assertion depends on a `clientID` tiebreak.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC5 part 3 blind1 — flat wins over a stale register, whichever order the two were written in", () => {
  it("a stale pos/size register loses to the fresh flat geometry, identically in both insertion orders", () => {
    // Doc A — REGISTER FIRST, then the flat keys.
    const a = makeDoc();
    const nodeA = new Y.Map<unknown>();
    a.nodes.set("n1", nodeA);
    nodeA.set("id", "n1");
    nodeA.set("type", "text");
    nodeA.set("pos", encodePos(10, 20)); // stale: where the card used to be
    nodeA.set("size", encodeSize(200, 100)); // stale
    nodeA.set("x", 777); // fresh: where the user just dragged it
    nodeA.set("y", 888);
    nodeA.set("width", 640);
    nodeA.set("height", 360);

    // Doc B — the SAME logical record, FLAT KEYS FIRST, then the registers.
    const b = makeDoc();
    const nodeB = new Y.Map<unknown>();
    b.nodes.set("n1", nodeB);
    nodeB.set("id", "n1");
    nodeB.set("type", "text");
    nodeB.set("x", 777);
    nodeB.set("y", 888);
    nodeB.set("width", 640);
    nodeB.set("height", 360);
    nodeB.set("pos", encodePos(10, 20));
    nodeB.set("size", encodeSize(200, 100));

    const textA = serializeCanvas(a.nodes, a.edges);
    const textB = serializeCanvas(b.nodes, b.edges);

    // THE property: the outcome does not depend on which spelling was written
    // first. This is what a value-only assertion would let straight back in.
    expect(textA).toBe(textB);

    // ...and the outcome is the FLAT value, not the register's stale one.
    const outA = buildCanvasData(a.nodes, a.edges).nodes[0] as Record<string, unknown>;
    const outB = buildCanvasData(b.nodes, b.edges).nodes[0] as Record<string, unknown>;
    for (const out of [outA, outB]) {
      expect(out).toMatchObject({ id: "n1", x: 777, y: 888, width: 640, height: 360 });
      expect(out.x).not.toBe(10);
      expect(out.y).not.toBe(20);
      expect(out.width).not.toBe(200);
      expect(out.height).not.toBe(100);
      expect(out).not.toHaveProperty("pos");
      expect(out).not.toHaveProperty("size");
    }
    expect(outA).toEqual(outB);
    expect(textA).toContain('"x": 777');
    expect(textA).not.toContain("10");
  });

  it("a stale from/to endpoint register loses to the fresh flat side, identically in both insertion orders", () => {
    function seedNodes(nodes: Y.Map<Y.Map<unknown>>): void {
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
    }

    // Doc A — REGISTER FIRST, then the flat endpoint keys.
    const a = makeDoc();
    seedNodes(a.nodes);
    const edgeA = new Y.Map<unknown>();
    a.edges.set("e1", edgeA);
    edgeA.set("id", "e1");
    edgeA.set("from", encodeEndpoint("n1", "top", "none")); // stale decoration
    edgeA.set("to", encodeEndpoint("n2", "bottom", "none")); // stale decoration
    edgeA.set("fromNode", "n1"); // fresh: the user re-anchored the arrow
    edgeA.set("fromSide", "right");
    edgeA.set("fromEnd", "arrow");
    edgeA.set("toNode", "n2");
    edgeA.set("toSide", "left");
    edgeA.set("toEnd", "arrow");

    // Doc B — the SAME logical record, FLAT KEYS FIRST, then the registers.
    const b = makeDoc();
    seedNodes(b.nodes);
    const edgeB = new Y.Map<unknown>();
    b.edges.set("e1", edgeB);
    edgeB.set("id", "e1");
    edgeB.set("fromNode", "n1");
    edgeB.set("fromSide", "right");
    edgeB.set("fromEnd", "arrow");
    edgeB.set("toNode", "n2");
    edgeB.set("toSide", "left");
    edgeB.set("toEnd", "arrow");
    edgeB.set("from", encodeEndpoint("n1", "top", "none"));
    edgeB.set("to", encodeEndpoint("n2", "bottom", "none"));

    const textA = serializeCanvas(a.nodes, a.edges);
    const textB = serializeCanvas(b.nodes, b.edges);

    expect(textA).toBe(textB);

    const outA = buildCanvasData(a.nodes, a.edges).edges[0] as Record<string, unknown>;
    const outB = buildCanvasData(b.nodes, b.edges).edges[0] as Record<string, unknown>;
    for (const out of [outA, outB]) {
      expect(out).toMatchObject({
        id: "e1",
        fromNode: "n1",
        fromSide: "right",
        fromEnd: "arrow",
        toNode: "n2",
        toSide: "left",
        toEnd: "arrow",
      });
      expect(out.fromSide).not.toBe("top");
      expect(out.toSide).not.toBe("bottom");
      expect(out.fromEnd).not.toBe("none");
      expect(out).not.toHaveProperty("from");
      expect(out).not.toHaveProperty("to");
    }
    expect(outA).toEqual(outB);
    expect(textA).not.toContain("none");
    expect(textA).not.toContain('"top"');
    expect(textA).not.toContain('"bottom"');
  });

  it("a record carrying ONLY the register is unaffected — there is no flat key to override it", () => {
    const { nodes, edges } = makeDoc();

    const node = new Y.Map<unknown>();
    nodes.set("n1", node);
    node.set("id", "n1");
    node.set("type", "text");
    node.set("pos", encodePos(42, 43));
    node.set("size", encodeSize(44, 45));

    const edge = new Y.Map<unknown>();
    edges.set("e1", edge);
    edge.set("id", "e1");
    edge.set("from", encodeEndpoint("n1", "top"));

    const data = buildCanvasData(nodes, edges);
    expect(data.nodes[0]).toMatchObject({ id: "n1", x: 42, y: 43, width: 44, height: 45 });
    expect(data.edges[0]).toMatchObject({ id: "e1", fromNode: "n1", fromSide: "top" });
  });
});
