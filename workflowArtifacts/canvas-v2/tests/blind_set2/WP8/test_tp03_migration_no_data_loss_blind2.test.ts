// WP8 AC2 completeness — third angle: MULTIPLE unknown/forward-compat keys
// on the SAME record (a future client stamped several fields this client
// has never heard of), plus a minimal-required-fields-only node to pin that
// absent optional fields are never fabricated. Distinct data from both the
// visible test and blind_set1.

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

describe("WP8 AC2 — several unrecognised keys on one record all survive together", () => {
  it("a node with three future keys and a minimal node keep exactly what they had, nothing more", () => {
    const doc = new Y.Doc();

    v1Node(doc, "future-heavy", {
      id: "future-heavy",
      type: "text",
      x: 5,
      y: 5,
      width: 300,
      height: 200,
      text: "content",
      p4NestedTextFlag: true,
      authorHint: "peer-42",
      quarantineReason: null,
    });

    // Minimal node: only the required core, nothing optional.
    v1Node(doc, "minimal", {
      id: "minimal",
      type: "text",
      x: 700,
      y: 700,
      width: 100,
      height: 60,
      text: "",
    });

    v1Edge(doc, "e-min", {
      id: "e-min",
      fromNode: "future-heavy",
      fromSide: "right",
      toNode: "minimal",
      toSide: "left",
    });

    migrateV1ToV2(doc);

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const futureHeavy = nodes.get("future-heavy");
    expect(futureHeavy).toBeDefined();
    if (!futureHeavy) throw new Error("unreachable");
    expect(decodePos(futureHeavy.get(V2_FIELD.pos) as never)).toEqual({ x: 5, y: 5 });
    expect(decodeSize(futureHeavy.get(V2_FIELD.size) as never)).toEqual({
      width: 300,
      height: 200,
    });
    expect(futureHeavy.get(V2_FIELD.text)).toBe("content");
    expect(futureHeavy.get("p4NestedTextFlag")).toBe(true);
    expect(futureHeavy.get("authorHint")).toBe("peer-42");
    expect(futureHeavy.get("quarantineReason")).toBeNull();

    const minimal = nodes.get("minimal");
    expect(minimal).toBeDefined();
    if (!minimal) throw new Error("unreachable");
    expect(decodePos(minimal.get(V2_FIELD.pos) as never)).toEqual({ x: 700, y: 700 });
    expect(minimal.get(V2_FIELD.text)).toBe("");
    expect(minimal.get(V2_FIELD.color)).toBeUndefined();
    expect(minimal.get(V2_FIELD.file)).toBeUndefined();

    const edge = doc.getMap<Y.Map<unknown>>("edges").get("e-min");
    expect(edge).toBeDefined();
    if (!edge) throw new Error("unreachable");
    expect(decodeEndpoint(edge.get(V2_FIELD.from) as never)).toEqual({
      node: "future-heavy",
      side: "right",
    });
    expect(decodeEndpoint(edge.get(V2_FIELD.to) as never)).toEqual({
      node: "minimal",
      side: "left",
    });

    doc.destroy();
  });
});
