import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyTombstoneOp,
  type TombstoneMap,
} from "../../../../../plugin/src/canvas/canvas-tombstone";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC2 blind1 — same claim as the visible test (a tombstoned record is
// not emitted), different angle: TWO records suppressed at once (not one),
// and the record kind is an EDGE this time, proving suppression is not
// hard-coded to nodes.

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

function setEdge(edges: Y.Map<Y.Map<unknown>>, id: string, from: string, to: string): void {
  const record = new Y.Map<unknown>();
  edges.set(id, record);
  record.set("id", id);
  record.set("fromNode", from);
  record.set("fromSide", "right");
  record.set("toNode", to);
  record.set("toSide", "left");
}

function makeTombstoneMap(): TombstoneMap {
  const store = new Map<string, unknown>();
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
      return value;
    },
  };
}

describe("WP17 AC2 blind1 — a directly-tombstoned edge is not emitted", () => {
  it("an edge with its own active tombstone is dropped even though both endpoints exist", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");
    setEdge(edges, "e-live", "n1", "n2");
    setEdge(edges, "e-dead", "n1", "n2");

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "e-dead", { t: 1, by: "peer-a", on: true });

    const data = buildCanvasData(nodes, edges, deleted);

    expect(data.edges.map((e) => (e as Record<string, unknown>).id)).toEqual(["e-live"]);
    expect(data.nodes.map((n) => (n as Record<string, unknown>).id).sort()).toEqual(["n1", "n2"]);
  });
});
