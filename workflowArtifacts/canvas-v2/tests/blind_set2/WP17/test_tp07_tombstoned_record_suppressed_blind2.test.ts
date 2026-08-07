import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyTombstoneOp,
  type TombstoneMap,
} from "../../../../../plugin/src/canvas/canvas-tombstone";
import { buildCanvasData, serializeCanvas } from "../../../../../plugin/src/files/canvas-sync";

// WP17 AC2 blind2 — same claim as the visible test (a tombstoned record is
// not emitted), different angle: asserted at the SERIALIZED TEXT level (the
// id must not appear anywhere in the written bytes) rather than only on the
// returned array, and the doc has every record suppressed but one.

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

describe("WP17 AC2 blind2 — a suppressed id never appears in the emitted bytes", () => {
  it("with three of four nodes tombstoned, only the survivor's id reaches the file", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "gone-1");
    setNode(nodes, "gone-2");
    setNode(nodes, "gone-3");
    setNode(nodes, "keep-me");

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "gone-1", { t: 1, by: "peer-a", on: true });
    applyTombstoneOp(deleted, "gone-2", { t: 2, by: "peer-a", on: true });
    applyTombstoneOp(deleted, "gone-3", { t: 3, by: "peer-a", on: true });

    const data = buildCanvasData(nodes, edges, deleted);
    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual(["keep-me"]);

    const text = serializeCanvas(nodes, edges, deleted);
    expect(text).not.toContain("gone-1");
    expect(text).not.toContain("gone-2");
    expect(text).not.toContain("gone-3");
    expect(text).toContain("keep-me");
  });
});
