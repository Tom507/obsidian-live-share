// WP22 AC2 blind1 — "only through an explicit delete trigger", asked as a
// CENSUS of removals rather than as a pair of examples.
//
// The visible test shows that one shrinking sequence of captures removes nothing
// and that one `record: null` removes everything. This one instead runs a mixed
// workload — creates, partial reports, whole-record reports, one deliberate
// delete — through a single binding while an independent observer counts every
// `Y.Map` DELETE the doc actually emits, keyed by which map it happened on.
//
// The claim then becomes checkable in one number: across the whole workload the
// doc must record exactly ONE key-level removal event, and it must be the entry
// removed by the explicit trigger — never a key inside a record.
//
// The tombstone half is asked on EDGES (the visible test uses nodes) and against
// three replicas, one of which is offline for the delete and integrates it late.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../../../canvas/canvas-binding";

class Bridge implements CanvasModelBridge {
  readonly nodes = new Map<string, CanvasRecord>();
  readonly edges = new Map<string, CanvasRecord>();
  private readonly subscribers = new Set<(change: LocalChange) => void>();

  getNodeIds(): Iterable<string> {
    return [...this.nodes.keys()];
  }
  getEdgeIds(): Iterable<string> {
    return [...this.edges.keys()];
  }
  getNode(id: string): CanvasRecord | null {
    const r = this.nodes.get(id);
    return r ? { ...r } : null;
  }
  getEdge(id: string): CanvasRecord | null {
    const r = this.edges.get(id);
    return r ? { ...r } : null;
  }
  applyNodeUpsert(id: string, record: CanvasRecord): void {
    this.nodes.set(id, { ...record });
  }
  applyNodeRemove(id: string): void {
    this.nodes.delete(id);
  }
  applyEdgeUpsert(id: string, record: CanvasRecord): void {
    this.edges.set(id, { ...record });
  }
  applyEdgeRemove(id: string): void {
    this.edges.delete(id);
  }
  onLocalChange(cb: (change: LocalChange) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }
}

const ROUTE: CanvasRecord = {
  id: "route",
  fromNode: "gate",
  fromSide: "right",
  toNode: "yard",
  toSide: "left",
  label: "spur",
};

/** Every `delete` action the doc emits, as `"<map>/<key>"`. */
function collectDeletes(doc: Y.Doc): string[] {
  const removals: string[] = [];
  const watch = (name: "nodes" | "edges") => {
    const map = doc.getMap<Y.Map<unknown>>(name);
    map.observeDeep((events) => {
      for (const event of events) {
        for (const [key, change] of event.changes.keys) {
          if (change.action === "delete") {
            const path = event.path.length === 0 ? name : `${name}:${event.path.join(".")}`;
            removals.push(`${path}/${key}`);
          }
        }
      }
    });
  };
  watch("nodes");
  watch("edges");
  return removals;
}

describe("WP22 AC2 blind1 — the doc records exactly one removal, and it is the explicit one", () => {
  it("a mixed workload of captures emits removals only where a delete was asked for", () => {
    const doc = new Y.Doc();
    const binding = new CanvasBinding(doc, new Bridge());
    const removals = collectDeletes(doc);

    // Create two edges and a node through captures.
    binding.captureLocal({ kind: "edge", id: "route", record: ROUTE });
    binding.captureLocal({
      kind: "edge",
      id: "siding",
      record: { id: "siding", fromNode: "yard", toNode: "shed" },
    });
    binding.captureLocal({ kind: "node", id: "gate", record: { id: "gate", x: 0, y: 0 } });

    // Partial reports of every shape, including one that mentions nothing.
    binding.captureLocal({ kind: "edge", id: "route", record: { id: "route" } });
    binding.captureLocal({ kind: "edge", id: "route", record: { label: "main spur" } });
    binding.captureLocal({ kind: "edge", id: "siding", record: {} });
    binding.captureLocal({ kind: "node", id: "gate", record: { x: 60 } });

    expect(
      removals,
      "a partial capture removed something — absence in a report is still being read as intent",
    ).toEqual([]);

    // The one explicit trigger in the whole workload.
    binding.captureLocal({ kind: "edge", id: "siding", record: null });

    expect(removals, "the explicit delete removed the wrong thing, or removed nothing").toEqual([
      "edges/siding",
    ]);
    expect(
      doc.getMap<Y.Map<unknown>>("edges").get("route")?.toJSON(),
      "the surviving edge lost fields along the way",
    ).toEqual({ ...ROUTE, label: "main spur" });
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").get("gate")?.toJSON(),
      "the node lost fields along the way",
    ).toEqual({ id: "gate", x: 60, y: 0 });

    binding.destroy();
  });

  it("the explicit edge delete tombstones on a replica that integrates it late", () => {
    const author = new Y.Doc();
    const binding = new CanvasBinding(author, new Bridge());
    binding.captureLocal({ kind: "edge", id: "route", record: ROUTE });

    const beforeDelete = Y.encodeStateAsUpdate(author);
    const online = new Y.Doc();
    const late = new Y.Doc();
    Y.applyUpdate(online, beforeDelete);
    Y.applyUpdate(late, beforeDelete);

    binding.captureLocal({ kind: "edge", id: "route", record: null });
    const afterDelete = Y.encodeStateAsUpdate(author);
    Y.applyUpdate(online, afterDelete);

    // The late replica first re-receives the creation (a duplicate delivery it
    // already has), then finally the delete. Neither ordering may resurrect.
    Y.applyUpdate(late, beforeDelete);
    expect(
      late.getMap<Y.Map<unknown>>("edges").has("route"),
      "the late replica had already lost the edge before it saw the delete",
    ).toBe(true);
    Y.applyUpdate(late, afterDelete);

    for (const [name, replica] of [
      ["author", author],
      ["online", online],
      ["late", late],
    ] as const) {
      expect(
        replica.getMap<Y.Map<unknown>>("edges").has("route"),
        `${name} still shows a record the explicit trigger deleted`,
      ).toBe(false);
    }

    binding.destroy();
  });
});
