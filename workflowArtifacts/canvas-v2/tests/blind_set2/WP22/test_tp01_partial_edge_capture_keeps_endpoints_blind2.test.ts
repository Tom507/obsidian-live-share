// WP22 AC1 blind2 — exhaustive rather than exemplary.
//
// "Capturing `{id}` leaves the endpoints intact" is one point in a space. The
// real property is universal: for EVERY subset of a record's keys, a capture
// reporting exactly that subset leaves the record whole. A fix that special-cased
// the id-only shape — or that kept a sweep for some key class such as geometry —
// satisfies the single example and fails the space.
//
// So this enumerates all 2^5 = 32 subsets of a five-key edge (32 independent
// captures against 32 independently seeded docs, so no test depends on another's
// leftovers) and requires the doc to be unchanged every time. The values in the
// reports are the doc's OWN values, so every write is a no-op by content and the
// only thing that can move the record is a sweep.
//
// A second, adversarial angle: the reports are then given DIFFERENT values, so
// the sweep and the upsert cannot be confused with one another — every reported
// key must move, and every unreported key must not.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../../../canvas/canvas-binding";

const WIRE: CanvasRecord = {
  id: "w-42",
  fromNode: "left-hub",
  toNode: "right-hub",
  fromSide: "right",
  toSide: "left",
};
const WIRE_KEYS = Object.keys(WIRE);

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

/** A fresh doc holding exactly `WIRE`, plus its binding. */
function freshWire(): { doc: Y.Doc; binding: CanvasBinding } {
  const doc = new Y.Doc();
  doc.transact(() => {
    const ymap = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(WIRE)) ymap.set(k, v);
    doc.getMap<Y.Map<unknown>>("edges").set("w-42", ymap);
  });
  return { doc, binding: new CanvasBinding(doc, new Bridge()) };
}

function wireJson(doc: Y.Doc): unknown {
  return doc.getMap<Y.Map<unknown>>("edges").get("w-42")?.toJSON();
}

/** All 2^n subsets of `keys`, as index masks. */
function subsets(keys: string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    out.push(keys.filter((_, i) => (mask & (1 << i)) !== 0));
  }
  return out;
}

describe("WP22 AC1 blind2 — every subset of a record is a safe observation", () => {
  it("all 32 subsets of a five-key edge leave the record byte-identical", () => {
    const damaged: string[] = [];
    for (const subset of subsets(WIRE_KEYS)) {
      const { doc, binding } = freshWire();
      const record: CanvasRecord = {};
      for (const key of subset) record[key] = WIRE[key];

      binding.captureLocal({ kind: "edge", id: "w-42", record });
      const after = wireJson(doc);
      if (JSON.stringify(after) !== JSON.stringify(WIRE)) {
        damaged.push(`[${subset.join(",") || "<empty>"}] -> ${JSON.stringify(after)}`);
      }
      binding.destroy();
    }
    expect(
      damaged,
      "these observed subsets destroyed part of the record — absence is still read as intent",
    ).toEqual([]);
  });

  it("with changed values, exactly the reported keys move and no other key is lost", () => {
    const CHANGED: Record<string, unknown> = {
      fromNode: "left-hub-2",
      toNode: "right-hub-2",
      fromSide: "top",
      toSide: "bottom",
    };
    const mutable = Object.keys(CHANGED);

    for (const subset of subsets(mutable)) {
      const { doc, binding } = freshWire();
      const record: CanvasRecord = { id: "w-42" };
      for (const key of subset) record[key] = CHANGED[key];

      binding.captureLocal({ kind: "edge", id: "w-42", record });

      const expected: Record<string, unknown> = { ...WIRE };
      for (const key of subset) expected[key] = CHANGED[key];
      expect(
        wireJson(doc),
        `reporting [${subset.join(",") || "<id only>"}] did not produce exactly that upsert`,
      ).toEqual(expected);

      binding.destroy();
    }
  });

  it("the empty observation is completely inert — no keys lost and no update emitted", () => {
    const { doc, binding } = freshWire();
    let updates = 0;
    doc.on("update", () => {
      updates++;
    });

    binding.captureLocal({ kind: "edge", id: "w-42", record: {} });

    expect(wireJson(doc), "an observation of nothing emptied the record").toEqual(WIRE);
    expect(updates, "an observation of nothing still wrote to the CRDT").toBe(0);

    binding.destroy();
  });
});
