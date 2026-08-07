// WP8 AC2 — same guarantee, attacked with MULTIPLE records: three nodes and
// two edges. The single-transaction requirement is the sharpest edge here —
// a naive per-record implementation (`records.forEach(r => doc.transact(...))`)
// would still pass a one-record test but fails the moment there is more than
// one record to migrate.

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

describe("WP8 AC2 — a multi-record migration is still exactly one transaction", () => {
  it("three nodes and two edges all translate correctly inside a single Yjs transaction", () => {
    const doc = new Y.Doc();
    v1Node(doc, "n1", { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "a" });
    v1Node(doc, "n2", { id: "n2", type: "text", x: 500, y: 500, width: 100, height: 50, text: "b" });
    v1Node(doc, "n3", { id: "n3", type: "group", x: -100, y: -100, width: 400, height: 400, label: "group" });
    v1Edge(doc, "e1", {
      id: "e1",
      fromNode: "n1",
      fromSide: "bottom",
      toNode: "n2",
      toSide: "top",
    });
    v1Edge(doc, "e2", {
      id: "e2",
      fromNode: "n2",
      fromSide: "left",
      fromEnd: "none",
      toNode: "n3",
      toSide: "right",
      toEnd: "arrow",
    });

    let transactionCount = 0;
    const onAfterTx = () => {
      transactionCount++;
    };
    doc.on("afterTransaction", onAfterTx);
    migrateV1ToV2(doc);
    doc.off("afterTransaction", onAfterTx);

    expect(
      transactionCount,
      "five records must still migrate inside exactly one transaction",
    ).toBe(1);

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    expect(decodePos(nodes.get("n1")?.get(V2_FIELD.pos) as never)).toEqual({ x: 0, y: 0 });
    expect(decodeSize(nodes.get("n1")?.get(V2_FIELD.size) as never)).toEqual({
      width: 100,
      height: 50,
    });
    expect(decodePos(nodes.get("n2")?.get(V2_FIELD.pos) as never)).toEqual({ x: 500, y: 500 });
    expect(decodePos(nodes.get("n3")?.get(V2_FIELD.pos) as never)).toEqual({ x: -100, y: -100 });
    expect(decodeSize(nodes.get("n3")?.get(V2_FIELD.size) as never)).toEqual({
      width: 400,
      height: 400,
    });

    expect(decodeEndpoint(edges.get("e1")?.get(V2_FIELD.from) as never)).toEqual({
      node: "n1",
      side: "bottom",
    });
    expect(decodeEndpoint(edges.get("e1")?.get(V2_FIELD.to) as never)).toEqual({
      node: "n2",
      side: "top",
    });
    expect(decodeEndpoint(edges.get("e2")?.get(V2_FIELD.from) as never)).toEqual({
      node: "n2",
      side: "left",
      end: "none",
    });
    expect(decodeEndpoint(edges.get("e2")?.get(V2_FIELD.to) as never)).toEqual({
      node: "n3",
      side: "right",
      end: "arrow",
    });

    for (const id of ["n1", "n2", "n3"]) {
      const ord = nodes.get(id)?.get(V2_FIELD.ord);
      expect(typeof ord, `node ${id} must have an ord`).toBe("string");
      expect((ord as string).length).toBeGreaterThan(0);
    }
    for (const id of ["e1", "e2"]) {
      const ord = edges.get(id)?.get(V2_FIELD.ord);
      expect(typeof ord, `edge ${id} must have an ord`).toBe("string");
      expect((ord as string).length).toBeGreaterThan(0);
    }

    doc.destroy();
  });
});
