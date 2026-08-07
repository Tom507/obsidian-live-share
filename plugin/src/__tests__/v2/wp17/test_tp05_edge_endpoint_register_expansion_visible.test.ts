import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint } from "../../../canvas/canvas-registers";
import { buildCanvasData } from "../../../files/canvas-sync";
// WP64 — every `serializeCanvas` / `buildCanvasData` call in this file is 2-arg
// BY DESIGN, and none of them is a survival oracle. This is the WP17 canonical-
// serializer suite: each fixture builds the `nodes` / `edges` maps directly, no
// `deleted` map is ever created and no delete path runs, so suppression is a
// no-op here by construction. The subject is ORDER and BYTES, never whether a
// record is alive. Passing a third argument would add a container these tests
// deliberately do not have.

// ===========================================================================
// WP17 AC1 (part 2) — "... and the endpoint keys exactly as Obsidian
// expects."
//
// An edge record whose doc fields are the ATOMIC `from`/`to` registers
// (WP10) must serialise back to the flat, slot-prefixed file keys
// `fromNode`/`fromSide`/`fromEnd` and `toNode`/`toSide`/`toEnd` — via
// WP10's own `decodeEndpointToFile`, never a re-derived mapping. `toEnd` is
// omitted here because the `to` register carries no `end`, exercising the
// "only present when the register carries one" half of the codec. The
// current `buildCanvasData` has no endpoint decoding at all, so this fails
// today for the right reason (missing fromNode/fromSide/toNode/toSide).
// ===========================================================================

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

function setNode(nodes: Y.Map<Y.Map<unknown>>, id: string): void {
  const record = new Y.Map<unknown>();
  nodes.set(id, record);
  record.set("id", id);
  record.set("type", "text");
  record.set("x", 0);
  record.set("y", 0);
  record.set("width", 10);
  record.set("height", 10);
}

describe("WP17 AC1 — edge from/to registers expand into flat file endpoint keys", () => {
  it("a register-only edge record serialises fromNode/fromSide/fromEnd/toNode/toSide and drops from/to", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");

    const edge = new Y.Map<unknown>();
    edges.set("e1", edge);
    edge.set("id", "e1");
    edge.set("from", encodeEndpoint("n1", "right", "arrow"));
    edge.set("to", encodeEndpoint("n2", "left"));

    const data = buildCanvasData(nodes, edges);
    const out = data.edges[0] as Record<string, unknown>;

    expect(out).toMatchObject({
      id: "e1",
      fromNode: "n1",
      fromSide: "right",
      fromEnd: "arrow",
      toNode: "n2",
      toSide: "left",
    });
    expect(out).not.toHaveProperty("toEnd");
    expect(out).not.toHaveProperty("from");
    expect(out).not.toHaveProperty("to");
  });
});
