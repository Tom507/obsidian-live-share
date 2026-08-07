// WP22 / AC2 — "Deletion is possible only through an explicit delete trigger
// that writes a tombstone."
//
// Two claims, and they are separate:
//
//   ONLY  — no capture, however small, can take a key away. Absence in the
//           incoming record is not a signal at all any more, so the extreme
//           shape (a capture reporting nothing whatsoever) must be as inert as
//           the one-key shape.
//   TOMBSTONE — the surviving trigger is `record: null`, and what it produces is
//           a real CRDT deletion, not local forgetting. The test for that is
//           re-delivery: replaying the record's own creation update after the
//           delete must NOT resurrect it, and a replica that still holds the
//           record must lose it when it integrates the delete.
//
// AC2's trigger is RECORD-level by charter (§4 amendment note). Removing a single
// optional field explicitly is S14 / WP39 AC5 and is deliberately NOT exercised
// here; what IS exercised is that its absence costs nothing at record scope.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../../../canvas/canvas-binding";

const WIDGET: CanvasRecord = {
  id: "w",
  type: "file",
  file: "Notes/Deep.md",
  x: 0,
  y: 0,
  width: 260,
  height: 80,
};

class FakeBridge implements CanvasModelBridge {
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

function seedNode(doc: Y.Doc, id: string, record: CanvasRecord): void {
  doc.transact(() => {
    const ymap = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(record)) ymap.set(k, v);
    doc.getMap<Y.Map<unknown>>("nodes").set(id, ymap);
  });
}

function nodes(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("nodes");
}

describe("WP22 AC2 — the record-level delete trigger is the only way to remove anything", () => {
  it("no partial capture removes a key, down to a capture that reports nothing at all", () => {
    const doc = new Y.Doc();
    seedNode(doc, "w", WIDGET);

    const binding = new CanvasBinding(doc, new FakeBridge());

    // Progressively emptier observations of the same record.
    for (const record of [
      { id: "w", type: "file", file: "Notes/Deep.md", x: 0, y: 0, width: 260, height: 80 },
      { id: "w", x: 0, y: 0 },
      { id: "w" },
      {}, // the extreme shape: an observation that mentions nothing
    ] as CanvasRecord[]) {
      binding.captureLocal({ kind: "node", id: "w", record });
      expect(
        nodes(doc).get("w")?.toJSON(),
        `a capture of ${JSON.stringify(record)} removed a key from the record`,
      ).toEqual(WIDGET);
    }

    binding.destroy();
  });

  it("`record: null` deletes the whole record and the deletion is a tombstone, not forgetting", () => {
    const author = new Y.Doc();
    seedNode(author, "w", WIDGET);
    seedNode(author, "neighbour", { id: "neighbour", x: 900, y: 900 });

    // The creation update, kept so it can be replayed AFTER the delete.
    const creation = Y.encodeStateAsUpdate(author);
    const replica = new Y.Doc();
    Y.applyUpdate(replica, creation);
    expect(nodes(replica).has("w"), "the replica never received the record").toBe(true);

    const binding = new CanvasBinding(author, new FakeBridge());
    binding.captureLocal({ kind: "node", id: "w", record: null });

    expect(nodes(author).has("w"), "the explicit delete trigger did not remove the record").toBe(
      false,
    );
    expect(
      nodes(author).has("neighbour"),
      "a record-level delete took a neighbouring record with it",
    ).toBe(true);

    // Tombstone, claim 1: re-delivering the record's own creation does not resurrect it.
    Y.applyUpdate(author, creation);
    expect(
      nodes(author).has("w"),
      "replaying the creation update resurrected the record — the delete left no tombstone",
    ).toBe(false);

    // Tombstone, claim 2: a replica that still holds the record loses it on integration.
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(author));
    expect(
      nodes(replica).has("w"),
      "the delete did not propagate — the replica still shows a deleted record",
    ).toBe(false);
    expect(nodes(replica).has("neighbour"), "the replica lost an untouched neighbour").toBe(true);

    binding.destroy();
  });

  it("a capture for a record that does not exist creates it — never a silent delete", () => {
    const doc = new Y.Doc();
    const binding = new CanvasBinding(doc, new FakeBridge());

    binding.captureLocal({ kind: "edge", id: "fresh", record: { id: "fresh", fromNode: "a" } });

    const edges = doc.getMap<Y.Map<unknown>>("edges");
    expect(edges.has("fresh"), "a partial capture of an unknown id created nothing").toBe(true);
    expect(edges.get("fresh")?.toJSON()).toEqual({ id: "fresh", fromNode: "a" });

    binding.destroy();
  });
});
