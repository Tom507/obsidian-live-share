import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyTombstoneOp,
  type TombstoneMap,
} from "../../../../../plugin/src/canvas/canvas-tombstone";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC2 blind2 — same claim as the visible test (quarantine suppresses
// exactly like delete), different angle: the quarantined record is an EDGE
// (visible test quarantined a node), and a RELEASED quarantine (on:false,
// stale q left over) is asserted to be VISIBLE again — proving the
// predicate reads current `on`, not the mere historical presence of `q`.

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

describe("WP17 AC2 blind2 — quarantine suppresses an edge; a released quarantine is visible again", () => {
  it("a quarantined edge is dropped; the same edge un-quarantined (on:false) reappears", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");
    setEdge(edges, "e-q", "n1", "n2");

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "e-q", { t: 1, by: "peer-a", on: true, q: true });

    const suppressed = buildCanvasData(nodes, edges, deleted);
    expect(suppressed.edges).toHaveLength(0);

    // Release: a later op with on:false wins the LWW merge (higher t).
    applyTombstoneOp(deleted, "e-q", { t: 2, by: "peer-a", on: false });

    const released = buildCanvasData(nodes, edges, deleted);
    expect(released.edges.map((e) => (e as Record<string, unknown>).id)).toEqual(["e-q"]);
  });
});
