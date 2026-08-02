import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../../../plugin/src/canvas/canvas-registers";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC1 blind1 — same claim as the visible test (pos/size registers
// expand to flat x/y/width/height), different angle: negative coordinates,
// a zero coordinate, and a "file" type node (not "text"), plus a second
// record whose registers must independently expand without cross-talk.

function makeDoc() {
  const doc = new Y.Doc();
  return {
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
  };
}

describe("WP17 AC1 blind1 — geometry registers expand for negative/zero coordinates, per record", () => {
  it("two register-only nodes each expand independently, including negative and zero values", () => {
    const { nodes, edges } = makeDoc();

    const a = new Y.Map<unknown>();
    nodes.set("n-file", a);
    a.set("id", "n-file");
    a.set("type", "file");
    a.set("pos", encodePos(-500, 0));
    a.set("size", encodeSize(400, 400));
    a.set("file", "Notes/A.md");

    const b = new Y.Map<unknown>();
    nodes.set("n-group", b);
    b.set("id", "n-group");
    b.set("type", "group");
    b.set("pos", encodePos(0, -80));
    b.set("size", encodeSize(900, 700));
    b.set("label", "Group 1");

    const data = buildCanvasData(nodes, edges);
    const out = data.nodes.map((n) => n as Record<string, unknown>);
    const fileNode = out.find((n) => n.id === "n-file");
    const groupNode = out.find((n) => n.id === "n-group");

    expect(fileNode).toMatchObject({ x: -500, y: 0, width: 400, height: 400, file: "Notes/A.md" });
    expect(groupNode).toMatchObject({ x: 0, y: -80, width: 900, height: 700, label: "Group 1" });
    expect(fileNode).not.toHaveProperty("pos");
    expect(fileNode).not.toHaveProperty("size");
    expect(groupNode).not.toHaveProperty("pos");
    expect(groupNode).not.toHaveProperty("size");
  });
});
