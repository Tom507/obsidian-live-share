import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyTombstoneOp,
  type TombstoneMap,
} from "../../../../../plugin/src/canvas/canvas-tombstone";
import { buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC2 blind1 — same claim as the visible test (quarantine suppresses
// exactly like delete), different angle: a MIX of one plain delete and one
// quarantine in the same doc, proving both suppression flavours are honoured
// simultaneously through the one predicate.

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

describe("WP17 AC2 blind1 — a plain delete and a quarantine both suppress in the same doc", () => {
  it("n1 (plain delete) and n2 (quarantine) are both dropped; n3 survives", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");
    setNode(nodes, "n3");

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "n1", { t: 1, by: "peer-a", on: true });
    applyTombstoneOp(deleted, "n2", { t: 2, by: "peer-a", on: true, q: true });

    const data = buildCanvasData(nodes, edges, deleted);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual(["n3"]);
  });
});
