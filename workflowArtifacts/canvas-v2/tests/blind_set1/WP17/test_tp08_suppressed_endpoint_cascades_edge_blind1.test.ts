import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyTombstoneOp,
  type TombstoneMap,
} from "../../../../../plugin/src/canvas/canvas-tombstone";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC2 blind1 — same claim as the visible test (a suppressed endpoint
// cascades to the edge), different angle: the SUPPRESSED endpoint is the
// `to` side this time (visible test used `from`), proving the cascade is
// symmetric across both endpoint slots.

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

describe("WP17 AC2 blind1 — cascade also fires when the suppressed endpoint is the `to` side", () => {
  it("edge e1 (n1 -> n2) vanishes when n2 (the `to` endpoint) is tombstoned", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");
    setNode(nodes, "n3");
    setEdge(edges, "e1", "n1", "n2"); // must be dropped: n2 (`to`) is suppressed
    setEdge(edges, "e2", "n3", "n1"); // control: must survive

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "n2", { t: 5, by: "peer-b", on: true });

    const data = buildCanvasData(nodes, edges, deleted);

    expect([...nodes.keys()]).toContain("n2");
    expect(data.edges.map((e) => (e as Record<string, unknown>).id)).toEqual(["e2"]);
  });
});
