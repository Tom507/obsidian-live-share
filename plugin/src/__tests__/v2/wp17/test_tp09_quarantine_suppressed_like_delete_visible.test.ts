import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyTombstoneOp,
  isTombstoneQuarantined,
  readTombstoneEntry,
  type TombstoneMap,
} from "../../../canvas/canvas-tombstone";
import { buildCanvasData } from "../../../files/canvas-sync";

// ===========================================================================
// WP17 AC2 — "Records suppressed by the tombstone predicate (deleted OR
// QUARANTINED) are not emitted ..."
//
// `isTombstoneSuppressed` is deliberately q-agnostic: a quarantine
// suppresses exactly as hard as a user delete (canvas-tombstone.ts PART E).
// A consumer that only checked `on === true && q !== true`, or that had a
// second "is quarantined" branch with its own suppression logic, would be
// exactly the "three copies" C12 AC2 exists to prevent. This test proves
// WP17 suppresses a quarantined record via the SAME predicate path as an
// ordinary delete, not via a second rule.
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

describe("WP17 AC2 — a quarantined record is suppressed exactly like a deleted one", () => {
  it("on:true, q:true drops the node from the output, same as a plain delete", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "n1", { t: 1, by: "peer-a", on: true, q: true });

    // Sanity: this really is a quarantine, not a plain delete.
    expect(isTombstoneQuarantined(readTombstoneEntry(deleted, "n1"))).toBe(true);

    const data = buildCanvasData(nodes, edges, deleted);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id)).toEqual(["n2"]);
  });
});
