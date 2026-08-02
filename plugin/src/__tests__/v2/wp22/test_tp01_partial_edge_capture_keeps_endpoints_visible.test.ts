// WP22 / AC1 (headline) — "`writeRecordMinimal` no longer deletes doc keys that
// are absent from the incoming record; capturing `{id}` over an existing edge
// leaves its endpoints intact."
//
// This is the R1 mechanism itself, stated at its smallest. An edge in the doc
// carries five keys; the model reports a capture that mentions only `id`. Under
// the removed behaviour the four unmentioned keys were deleted, which is exactly
// how a `{id}`-shaped edge signal disconnected a live edge on every replica.
//
// The oracle is STATE — the doc's own key set — never a log line. Three things
// are checked, and each one fails for a different reason if the removal is
// partial:
//
//   ├── the four endpoint keys survive the partial capture (the AC verbatim),
//   ├── the capture that changes nothing emits NO Yjs update at all (I3 is not
//   │      collateral damage of the fix: "no delete" must not become "always
//   │      write"), and
//   └── a partial capture that DOES carry a new value still upserts it, and the
//          resulting record — endpoints and all — is what other replicas
//          integrate. Every write here has a single author and the replicas only
//          integrate, so the values are causally determined, not tie-broken.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../../../canvas/canvas-binding";

/** The five keys a connected JSON Canvas edge actually carries. */
const EDGE: CanvasRecord = {
  id: "e1",
  fromNode: "alpha",
  fromSide: "right",
  toNode: "omega",
  toSide: "left",
};

/** Minimal in-memory `CanvasModelBridge`. Local intent is injected by the test. */
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
    const record = this.nodes.get(id);
    return record ? { ...record } : null;
  }
  getEdge(id: string): CanvasRecord | null {
    const record = this.edges.get(id);
    return record ? { ...record } : null;
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

/** Seed `doc.edges[id]` directly, without going through the binding. */
function seedEdge(doc: Y.Doc, id: string, record: CanvasRecord): void {
  doc.transact(() => {
    const ymap = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(record)) ymap.set(k, v);
    doc.getMap<Y.Map<unknown>>("edges").set(id, ymap);
  });
}

function edgeRecord(doc: Y.Doc, id: string): Record<string, unknown> {
  const ymap = doc.getMap<Y.Map<unknown>>("edges").get(id);
  if (!ymap) throw new Error(`edge ${id} is not in the doc at all`);
  return ymap.toJSON();
}

describe("WP22 AC1 — a partial edge capture cannot remove the endpoints", () => {
  it("capturing `{id}` over a connected edge leaves all four endpoint keys intact", () => {
    const doc = new Y.Doc();
    seedEdge(doc, "e1", EDGE);

    const binding = new CanvasBinding(doc, new FakeBridge());
    binding.captureLocal({ kind: "edge", id: "e1", record: { id: "e1" } });

    const after = edgeRecord(doc, "e1");
    expect(
      after.fromNode,
      "`fromNode` was deleted by a capture that never mentioned it — R1 is still live",
    ).toBe("alpha");
    expect(
      after.toNode,
      "`toNode` was deleted by a capture that never mentioned it — R1 is still live",
    ).toBe("omega");
    expect(after.fromSide, "`fromSide` was deleted by an absent-key sweep").toBe("right");
    expect(after.toSide, "`toSide` was deleted by an absent-key sweep").toBe("left");

    // Stated once more as the whole record, so a partial survival cannot pass.
    expect(after, "the edge is no longer byte-for-byte what it was before the capture").toEqual(
      EDGE,
    );

    binding.destroy();
  });

  it("that same capture is still an EMPTY diff — no delete must not become always-write", () => {
    const doc = new Y.Doc();
    seedEdge(doc, "e1", EDGE);

    const binding = new CanvasBinding(doc, new FakeBridge());
    let updates = 0;
    doc.on("update", () => {
      updates++;
    });

    binding.captureLocal({ kind: "edge", id: "e1", record: { id: "e1" } });

    expect(
      updates,
      "a capture whose every mentioned value already matches the doc produced a Yjs update (I3)",
    ).toBe(0);

    binding.destroy();
  });

  it("a partial capture that carries a new value upserts it and every replica keeps the endpoints", () => {
    const author = new Y.Doc();
    seedEdge(author, "e1", EDGE);

    // Two integrating replicas, both started from the author's pre-capture state.
    // Single author, no concurrent write on this register: the value is causally
    // determined on every replica, so asserting it is legitimate.
    const seedUpdate = Y.encodeStateAsUpdate(author);
    const replicaB = new Y.Doc();
    const replicaC = new Y.Doc();
    Y.applyUpdate(replicaB, seedUpdate);
    Y.applyUpdate(replicaC, seedUpdate);

    const binding = new CanvasBinding(author, new FakeBridge());
    binding.captureLocal({ kind: "edge", id: "e1", record: { id: "e1", color: "3" } });

    const afterUpdate = Y.encodeStateAsUpdate(author);
    Y.applyUpdate(replicaB, afterUpdate);
    Y.applyUpdate(replicaC, afterUpdate);

    const expected = { ...EDGE, color: "3" };
    expect(edgeRecord(author, "e1"), "the author lost keys the capture never mentioned").toEqual(
      expected,
    );
    expect(edgeRecord(replicaB, "e1"), "replica B integrated a disconnection").toEqual(expected);
    expect(edgeRecord(replicaC, "e1"), "replica C integrated a disconnection").toEqual(expected);

    binding.destroy();
  });
});
