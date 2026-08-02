import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodePos } from "../../../canvas/canvas-registers";
import { buildCanvasData, parseCanvas, serializeCanvas } from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC4 — "Round-trip stability: parse(serialize(state)) yields the same
// records and the same relative order."
//
// WP16 changed `parseCanvas` to return V2 registers plus an explicit `order`
// observation (`data.order.nodes`) instead of relying on `Record` key
// iteration order — this test uses that observation as the oracle, per the
// TaskCharter's instruction. ids are picked with `ord` order the reverse of
// `id` order (as in TP1/TP10/TP11), so the round trip genuinely exercises
// order preservation through a real reorder rather than coincidentally
// matching id order.
// ===========================================================================

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC4 — parse(serialize(state)) preserves records and relative order", () => {
  it("round-trips the same ids, in the same ord-derived order, with the same geometry", () => {
    const { nodes, edges } = makeDoc();

    const n1 = new Y.Map<unknown>();
    nodes.set("n-zzz", n1);
    n1.set("id", "n-zzz");
    n1.set("type", "text");
    n1.set("x", 10);
    n1.set("y", 20);
    n1.set("width", 30);
    n1.set("height", 40);
    n1.set("ord", "B");

    const n2 = new Y.Map<unknown>();
    nodes.set("n-mmm", n2);
    n2.set("id", "n-mmm");
    n2.set("type", "text");
    n2.set("x", 50);
    n2.set("y", 60);
    n2.set("width", 70);
    n2.set("height", 80);
    n2.set("ord", "M");

    const n3 = new Y.Map<unknown>();
    nodes.set("n-aaa", n3);
    n3.set("id", "n-aaa");
    n3.set("type", "text");
    n3.set("x", 90);
    n3.set("y", 100);
    n3.set("width", 110);
    n3.set("height", 120);
    n3.set("ord", "T");

    const built = buildCanvasData(nodes, edges);
    const expectedOrder = built.nodes.map((n) => (n as Record<string, unknown>).id);
    expect(expectedOrder).toEqual(["n-zzz", "n-mmm", "n-aaa"]); // sanity: genuinely reordered vs id

    const text = serializeCanvas(nodes, edges);
    const parsed = parseCanvas(text);

    expect(parsed.order.nodes).toEqual(expectedOrder);
    expect(Object.keys(parsed.nodes).sort()).toEqual(["n-aaa", "n-mmm", "n-zzz"]);
    expect(parsed.nodes["n-zzz"].pos).toEqual(encodePos(10, 20));
    expect(parsed.nodes["n-aaa"].pos).toEqual(encodePos(90, 100));
  });
});
