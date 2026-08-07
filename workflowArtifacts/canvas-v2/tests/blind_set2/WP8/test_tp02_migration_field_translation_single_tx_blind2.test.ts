// WP8 AC2 — boundary-value angle: zero-sized geometry, an endpoint with
// `end` present on BOTH sides, and negative coordinates straddling the
// origin. Also re-asserts the single-transaction property so this file does
// not silently degrade into a pure translation check.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { decodeEndpoint, decodePos, decodeSize, V2_FIELD } from "../../../canvas/canvas-registers";
import { migrateV1ToV2 } from "../../../canvas/canvas-schema";

function v1Node(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  nodes.set(id, record);
}

function v1Edge(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  edges.set(id, record);
}

describe("WP8 AC2 — translation holds at boundary values (zero size, dual-end endpoint)", () => {
  it("a zero-size node and a fully-dual-end edge migrate correctly in one transaction", () => {
    const doc = new Y.Doc();
    v1Node(doc, "point", { id: "point", type: "text", x: -1, y: 1, width: 0, height: 0, text: "" });
    v1Edge(doc, "loop", {
      id: "loop",
      fromNode: "point",
      fromSide: "top",
      fromEnd: "arrow",
      toNode: "point",
      toSide: "bottom",
      toEnd: "arrow",
    });

    let transactionCount = 0;
    const onAfterTx = () => {
      transactionCount++;
    };
    doc.on("afterTransaction", onAfterTx);
    migrateV1ToV2(doc);
    doc.off("afterTransaction", onAfterTx);

    expect(transactionCount).toBe(1);

    const node = doc.getMap<Y.Map<unknown>>("nodes").get("point");
    expect(node).toBeDefined();
    if (!node) throw new Error("unreachable");
    expect(decodePos(node.get(V2_FIELD.pos) as never)).toEqual({ x: -1, y: 1 });
    expect(decodeSize(node.get(V2_FIELD.size) as never)).toEqual({ width: 0, height: 0 });
    // An empty string is a real value, not "absent" — must survive verbatim.
    expect(node.get(V2_FIELD.text)).toBe("");

    const edge = doc.getMap<Y.Map<unknown>>("edges").get("loop");
    expect(edge).toBeDefined();
    if (!edge) throw new Error("unreachable");
    expect(decodeEndpoint(edge.get(V2_FIELD.from) as never)).toEqual({
      node: "point",
      side: "top",
      end: "arrow",
    });
    expect(decodeEndpoint(edge.get(V2_FIELD.to) as never)).toEqual({
      node: "point",
      side: "bottom",
      end: "arrow",
    });

    doc.destroy();
  });
});
