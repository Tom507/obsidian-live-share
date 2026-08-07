import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyTombstoneOp,
  type TombstoneMap,
} from "../../../../../plugin/src/canvas/canvas-tombstone";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC2 blind2 — same claim as the visible test (a suppressed endpoint
// cascades to the edge), different angle: BOTH endpoints of one edge are
// suppressed at once, and a second edge has only ONE suppressed endpoint —
// both must be dropped, proving the cascade is not an "exactly one
// suppressed endpoint" special case.

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

describe("WP17 AC2 blind2 — both a doubly-suppressed edge and a singly-suppressed edge are dropped", () => {
  it("e-both (both endpoints tombstoned) and e-one (one endpoint tombstoned) both vanish", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "dead-a");
    setNode(nodes, "dead-b");
    setNode(nodes, "alive-c");
    setEdge(edges, "e-both", "dead-a", "dead-b");
    setEdge(edges, "e-one", "alive-c", "dead-a");
    setEdge(edges, "e-safe", "alive-c", "alive-c"); // self-loop among survivors, control

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "dead-a", { t: 1, by: "peer-a", on: true });
    applyTombstoneOp(deleted, "dead-b", { t: 1, by: "peer-a", on: true });

    const data = buildCanvasData(nodes, edges, deleted);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual(["alive-c"]);
    expect(data.edges.map((e) => (e as Record<string, unknown>).id)).toEqual(["e-safe"]);
  });
});
