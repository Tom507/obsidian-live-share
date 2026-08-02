import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC5 (part 3) — THE NAMED REGRESSION TEST.
//
// "The flat-vs-register precedence is an explicit, phase-scoped rule, never an
// artefact of `Y.Map` insertion order."
//
// WHAT THIS PROTECTS: a P1 doc legitimately holds BOTH spellings of the same
// fact — `migrateV1ToV2` is deliberately additive (it ADDS `pos`/`size`/
// `from`/`to` and KEEPS the flat V1 keys), while the capture path and every
// peer on this build still author the FLAT keys. A single-pass expansion
// resolved that collision by `Y.Map` INSERTION ORDER: whichever spelling
// happened to be written first silently decided the file, so **a moved card
// snapped back to its pre-move coordinate on disk**.
//
// WHY THE ASSERTION IS ABOUT INSERTION ORDER AND NOT ABOUT THE VALUE: asserting
// only "the serialised value is the fresh one" passes even WITH the bug, on any
// doc whose insertion order happens to favour the flat key. And this defect
// class is invisible to cross-replica byte equality (AC3) by construction —
// both replicas converge on the SAME wrong value, so their bytes agree
// perfectly. The property that actually rules the bug out is that the outcome
// does not depend on the order the two keys entered the `Y.Map`.
//
// THE RULE, phase-scoped: in P1 the FLAT key WINS. It is the vocabulary every
// live writer authors in; a register is only ever a translation of it. A record
// carrying ONLY the register (anything the V2 cold-open seed wrote) is
// unaffected — there is no flat key to override it. When the write boundaries
// move to the registers (WP22/WP39) the flat keys stop being written and the
// precedence becomes MOOT rather than inverted; that transition belongs to the
// WP that causes it and must never be assumed to have already happened.
// ===========================================================================

/** The stale answer the register holds — the pre-move coordinate / routing. */
const STALE = { x: 10, y: 20, width: 30, height: 40, fromSide: "top", toSide: "bottom" } as const;

/** The fresh answer the flat keys hold — what the user actually did last. */
const FRESH = { x: 500, y: 600, width: 700, height: 800, fromSide: "left", toSide: "right" } as const;

type InsertionOrder = "register-first" | "flat-first";

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

/**
 * The SAME logical record twice, differing only in the order the two spellings
 * were inserted into the `Y.Map`. Nothing else about the two docs differs.
 */
function buildCollidingDoc(order: InsertionOrder) {
  const { nodes, edges } = makeDoc();

  const writeRegisters = (node: Y.Map<unknown>, edge: Y.Map<unknown>): void => {
    node.set("pos", encodePos(STALE.x, STALE.y));
    node.set("size", encodeSize(STALE.width, STALE.height));
    edge.set("from", encodeEndpoint("n1", STALE.fromSide));
    edge.set("to", encodeEndpoint("n2", STALE.toSide));
  };
  const writeFlat = (node: Y.Map<unknown>, edge: Y.Map<unknown>): void => {
    node.set("x", FRESH.x);
    node.set("y", FRESH.y);
    node.set("width", FRESH.width);
    node.set("height", FRESH.height);
    edge.set("fromNode", "n1");
    edge.set("fromSide", FRESH.fromSide);
    edge.set("toNode", "n2");
    edge.set("toSide", FRESH.toSide);
  };

  const n1 = new Y.Map<unknown>();
  nodes.set("n1", n1);
  n1.set("id", "n1");
  n1.set("type", "text");

  const n2 = new Y.Map<unknown>();
  nodes.set("n2", n2);
  n2.set("id", "n2");
  n2.set("type", "text");
  n2.set("x", 0);
  n2.set("y", 0);
  n2.set("width", 10);
  n2.set("height", 10);

  const e1 = new Y.Map<unknown>();
  edges.set("e1", e1);
  e1.set("id", "e1");

  if (order === "register-first") {
    writeRegisters(n1, e1);
    writeFlat(n1, e1);
  } else {
    writeFlat(n1, e1);
    writeRegisters(n1, e1);
  }

  return { nodes, edges };
}

function movedCard(order: InsertionOrder): Record<string, unknown> {
  const { nodes, edges } = buildCollidingDoc(order);
  return buildCanvasData(nodes, edges).nodes.find((node) => node.id === "n1") as Record<
    string,
    unknown
  >;
}

function reroutedEdge(order: InsertionOrder): Record<string, unknown> {
  const { nodes, edges } = buildCollidingDoc(order);
  return buildCanvasData(nodes, edges).edges.find((edge) => edge.id === "e1") as Record<
    string,
    unknown
  >;
}

describe("WP17 AC5 — flat-vs-register precedence is INSERTION-ORDER INDEPENDENT (a moved card never snaps back)", () => {
  it("register inserted first: the fresh FLAT geometry wins", () => {
    expect(movedCard("register-first")).toEqual({
      id: "n1",
      type: "text",
      x: FRESH.x,
      y: FRESH.y,
      width: FRESH.width,
      height: FRESH.height,
    });
  });

  it("flat inserted first: the SAME outcome — the order the keys entered the Y.Map decides nothing", () => {
    expect(movedCard("flat-first")).toEqual(movedCard("register-first"));
  });

  it("the stale register coordinate never reaches the file in either insertion order", () => {
    for (const order of ["register-first", "flat-first"] as const) {
      const { nodes, edges } = buildCollidingDoc(order);
      const text = serializeCanvas(nodes, edges);
      expect(text).not.toMatch(/"x"\s*:\s*10\b/);
      expect(text).not.toMatch(/"y"\s*:\s*20\b/);
      expect(text).toContain(`"x": ${FRESH.x}`);
    }
  });

  it("register inserted first: the fresh FLAT endpoint routing wins", () => {
    expect(reroutedEdge("register-first")).toEqual({
      id: "e1",
      fromNode: "n1",
      fromSide: FRESH.fromSide,
      toNode: "n2",
      toSide: FRESH.toSide,
    });
  });

  it("flat inserted first: the SAME endpoint outcome", () => {
    expect(reroutedEdge("flat-first")).toEqual(reroutedEdge("register-first"));
  });

  it("the two insertion orders serialise to BYTE-IDENTICAL files", () => {
    const a = buildCollidingDoc("register-first");
    const b = buildCollidingDoc("flat-first");

    const textA = serializeCanvas(a.nodes, a.edges);
    const textB = serializeCanvas(b.nodes, b.edges);

    expect(textA).toBe(textB);
    // Guard against a vacuous pass: the file really does carry the fresh values.
    expect(textA).toContain(`"fromSide": "${FRESH.fromSide}"`);
    expect(textA).not.toContain(`"fromSide": "${STALE.fromSide}"`);
  });

  it("a register-ONLY record is untouched by the rule — there is no flat key to override it", () => {
    const { nodes, edges } = makeDoc();

    const n1 = new Y.Map<unknown>();
    nodes.set("n1", n1);
    n1.set("id", "n1");
    n1.set("type", "text");
    n1.set("pos", encodePos(STALE.x, STALE.y));
    n1.set("size", encodeSize(STALE.width, STALE.height));

    expect(buildCanvasData(nodes, edges).nodes[0]).toEqual({
      id: "n1",
      type: "text",
      x: STALE.x,
      y: STALE.y,
      width: STALE.width,
      height: STALE.height,
    });
  });
});
