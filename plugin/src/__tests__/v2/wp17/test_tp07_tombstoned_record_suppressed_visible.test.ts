import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { applyTombstoneOp, type TombstoneMap } from "../../../canvas/canvas-tombstone";
import { buildCanvasData } from "../../../files/canvas-sync";

// ===========================================================================
// WP17 AC2 (part 1) — "Records suppressed by the tombstone predicate
// (deleted or quarantined) are not emitted ..."
//
// The predicate consumed MUST be WP12's real `isTombstoneSuppressed`
// (imported, never re-derived as a local `entry?.on` check) — this test
// exercises it through the real `applyTombstoneOp` write path, exactly as
// production would populate the `deleted` container. `buildCanvasData`'s
// signature must accept this tombstone view as a third argument (the
// TaskCharter's own Interfaces section: "Input: the doc's V2 record state
// plus the tombstone view"). Today the function ignores any third argument
// and never suppresses anything, so this fails for the right reason.
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

describe("WP17 AC2 — a tombstoned record is not emitted", () => {
  it("a node with an active tombstone is dropped; its unsuppressed siblings survive", () => {
    const { nodes, edges } = makeDoc();
    setNode(nodes, "n1");
    setNode(nodes, "n2");
    setNode(nodes, "n3");

    const deleted = makeTombstoneMap();
    applyTombstoneOp(deleted, "n1", { t: 1, by: "peer-a", on: true });

    const data = buildCanvasData(nodes, edges, deleted);

    expect(data.nodes.map((n) => (n as Record<string, unknown>).id).sort()).toEqual(["n2", "n3"]);
  });
});
