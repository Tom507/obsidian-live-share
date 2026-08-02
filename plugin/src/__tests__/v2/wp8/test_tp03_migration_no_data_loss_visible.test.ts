// WP8 / AC2 — "no record loses a value in the process."
//
// This is the highest-value assertion in this WP (per the P1 test-design
// rules) and is tested as a COMPLETENESS property, not a spot-check: every
// value present on the V1 fixture — geometry, type, text, file, color,
// label, every endpoint component, AND an unknown/forward-compat key this
// migration has never heard of — must be reachable after migration. An
// implementation that silently drops one unrecognised key would pass every
// other test in this WP and still be the exact data-loss bug this AC exists
// to prevent.
//
// The fixture deliberately spans all three Obsidian node types that carry
// distinct optional fields (text / file / group+label) plus one edge, so no
// single record shape can hide a dropped key.

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

describe("WP8 AC2 — migration loses no value, including an unknown forward-compat key", () => {
  it("every input value across text/file/group nodes and a fully-populated edge is reachable after migration", () => {
    const doc = new Y.Doc();

    v1Node(doc, "text-node", {
      id: "text-node",
      type: "text",
      x: 10,
      y: 20,
      width: 250,
      height: 120,
      text: "a note with content",
      color: "4",
      __futureThing__: "keep-me",
    });
    v1Node(doc, "file-node", {
      id: "file-node",
      type: "file",
      x: 400,
      y: 20,
      width: 250,
      height: 120,
      file: "attachments/photo.png",
      color: "#ff8800",
    });
    v1Node(doc, "group-node", {
      id: "group-node",
      type: "group",
      x: -300,
      y: -300,
      width: 900,
      height: 900,
      label: "Sprint backlog",
    });
    v1Edge(doc, "full-edge", {
      id: "full-edge",
      fromNode: "text-node",
      fromSide: "right",
      fromEnd: "none",
      toNode: "file-node",
      toSide: "left",
      toEnd: "arrow",
      color: "6",
      label: "feeds into",
      __edgeFutureThing__: 12345,
    });

    migrateV1ToV2(doc);

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    // -- text node: geometry via the register codec, everything else verbatim.
    const textNode = nodes.get("text-node");
    expect(textNode).toBeDefined();
    if (!textNode) throw new Error("unreachable");
    expect(decodePos(textNode.get(V2_FIELD.pos) as never)).toEqual({ x: 10, y: 20 });
    expect(decodeSize(textNode.get(V2_FIELD.size) as never)).toEqual({ width: 250, height: 120 });
    expect(textNode.get(V2_FIELD.type)).toBe("text");
    expect(textNode.get(V2_FIELD.text)).toBe("a note with content");
    expect(textNode.get(V2_FIELD.color)).toBe("4");
    expect(textNode.get("__futureThing__"), "unknown key must survive verbatim").toBe("keep-me");

    // -- file node.
    const fileNode = nodes.get("file-node");
    expect(fileNode).toBeDefined();
    if (!fileNode) throw new Error("unreachable");
    expect(decodePos(fileNode.get(V2_FIELD.pos) as never)).toEqual({ x: 400, y: 20 });
    expect(decodeSize(fileNode.get(V2_FIELD.size) as never)).toEqual({ width: 250, height: 120 });
    expect(fileNode.get(V2_FIELD.type)).toBe("file");
    expect(fileNode.get(V2_FIELD.file)).toBe("attachments/photo.png");
    expect(fileNode.get(V2_FIELD.color)).toBe("#ff8800");

    // -- group node (label lives on nodes too, not only on edges).
    const groupNode = nodes.get("group-node");
    expect(groupNode).toBeDefined();
    if (!groupNode) throw new Error("unreachable");
    expect(decodePos(groupNode.get(V2_FIELD.pos) as never)).toEqual({ x: -300, y: -300 });
    expect(decodeSize(groupNode.get(V2_FIELD.size) as never)).toEqual({ width: 900, height: 900 });
    expect(groupNode.get(V2_FIELD.type)).toBe("group");
    expect(groupNode.get(V2_FIELD.label)).toBe("Sprint backlog");

    // -- edge: both endpoints, color, label, and an unrelated unknown key.
    const edge = edges.get("full-edge");
    expect(edge).toBeDefined();
    if (!edge) throw new Error("unreachable");
    expect(decodeEndpoint(edge.get(V2_FIELD.from) as never)).toEqual({
      node: "text-node",
      side: "right",
      end: "none",
    });
    expect(decodeEndpoint(edge.get(V2_FIELD.to) as never)).toEqual({
      node: "file-node",
      side: "left",
      end: "arrow",
    });
    expect(edge.get(V2_FIELD.color)).toBe("6");
    expect(edge.get(V2_FIELD.label)).toBe("feeds into");
    expect(edge.get("__edgeFutureThing__"), "unknown edge key must survive verbatim").toBe(12345);

    // Every record additionally received an ord (part of the same AC).
    for (const record of [textNode, fileNode, groupNode, edge]) {
      expect(typeof record.get(V2_FIELD.ord)).toBe("string");
    }

    doc.destroy();
  });
});
