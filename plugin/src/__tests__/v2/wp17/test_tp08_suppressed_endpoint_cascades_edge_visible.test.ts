import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { applyTombstoneOp, type TombstoneMap } from "../../../canvas/canvas-tombstone";
import { buildCanvasData } from "../../../files/canvas-sync";

// ===========================================================================
// WP17 AC2 (part 2) — "... and an edge whose endpoint record is suppressed
// is not emitted either."
//
// This is the cascade half, and the easy one to miss: the endpoint NODE is
// not deleted from `nodesMap` (its key still exists — the existing GAP-5
// dangling-edge guard, which keys off `nodeIds.has(...)`, would NOT catch
// this), it is merely tombstone-suppressed. The edge itself carries no
// tombstone entry of its own. A control edge between two unsuppressed nodes
// proves the suppression is scoped to the affected edge only.
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

function setEdge(
  edges: Y.Map<Y.Map<unknown>>,
  id: string,
  fromNode: string,
  toNode: string,
): void {
  const record = new Y.Map<unknown>();
  edges.set(id, record);
  record.set("id", id);
  record.set("fromNode", fromNode);
  record.set("fromSide", "right");
  record.set("toNode", toNode);
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

describe("WP17 AC2 — an edge whose endpoint is suppressed is dropped even without its own tombstone", () => {
  it("edge e1 (n1 -> n2) vanishes when n1 is tombstoned; the node key itself still exists", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");
    setNode(nodes, "n3");
    setEdge(edges, "e1", "n1", "n2"); // must be dropped: n1 is suppressed
    setEdge(edges, "e2", "n2", "n3"); // control: must survive

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "n1", { t: 1, by: "peer-a", on: true });

    const data = buildCanvasData(nodes, edges, deleted);

    // n1's key is still present in nodesMap — this is NOT the old
    // dangling-edge (missing id) case.
    expect([...nodes.keys()]).toContain("n1");
    expect(data.nodes.map((n) => (n as Record<string, unknown>).id).sort()).toEqual(["n2", "n3"]);
    expect(data.edges.map((e) => (e as Record<string, unknown>).id)).toEqual(["e2"]);
  });
});
