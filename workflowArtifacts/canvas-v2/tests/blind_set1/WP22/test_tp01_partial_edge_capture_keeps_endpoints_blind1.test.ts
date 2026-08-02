// WP22 AC1 blind1 — the same property reached through the SUBSCRIPTION, and
// judged by the key SET rather than by four named keys.
//
// The visible test calls `captureLocal` directly and names `fromNode`/`toNode`.
// Both choices are assumptions: that the method is the live entry point, and
// that the tester remembered every key worth naming. This one closes both.
//
//   ├── Entry point: the change is delivered the way production delivers it —
//   │      the model emits on `onLocalChange`, the binding's own handler routes
//   │      it. A fix applied to `captureLocal`'s caller rather than to the write
//   │      helper would pass the visible test and fail here.
//   └── Oracle: the doc's key SET before vs. after, compared wholesale. Nothing
//          is named, so a key nobody thought to list is protected too, and a
//          "fix" that preserved the endpoints while dropping `label` is caught.
//
// The fixture is a labelled, coloured edge on a group→group connection — five
// keys the visible test never uses, plus two the JSON Canvas spec makes optional
// and which are therefore the easiest to lose.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../../../canvas/canvas-binding";

const LINK: CanvasRecord = {
  id: "link-7",
  fromNode: "cluster-a",
  fromSide: "top",
  toNode: "cluster-b",
  toSide: "bottom",
  label: "depends on",
  color: "6",
};

class EmittingBridge implements CanvasModelBridge {
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

  /** What the live canvas model does when the user touches something. */
  reportLocalEdge(id: string, record: CanvasRecord | null): void {
    for (const cb of [...this.subscribers]) cb({ kind: "edge", id, record });
  }
}

function seedEdges(doc: Y.Doc, records: CanvasRecord[]): void {
  doc.transact(() => {
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    for (const record of records) {
      const ymap = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(record)) ymap.set(k, v);
      edges.set(String(record.id), ymap);
    }
  });
}

function keySet(doc: Y.Doc, id: string): string[] {
  const ymap = doc.getMap<Y.Map<unknown>>("edges").get(id);
  if (!ymap) throw new Error(`edge ${id} vanished from the doc entirely`);
  return [...ymap.keys()].sort();
}

describe("WP22 AC1 blind1 — a subscribed partial report never shrinks a record's key set", () => {
  it("an `{id}`-only report delivered through onLocalChange leaves the key set unchanged", () => {
    const doc = new Y.Doc();
    seedEdges(doc, [LINK]);
    const bridge = new EmittingBridge();
    const binding = new CanvasBinding(doc, bridge);

    const before = keySet(doc, "link-7");
    bridge.reportLocalEdge("link-7", { id: "link-7" });

    expect(
      keySet(doc, "link-7"),
      "the subscription path still sweeps keys the report did not mention",
    ).toEqual(before);
    expect(
      doc.getMap<Y.Map<unknown>>("edges").get("link-7")?.toJSON(),
      "the values behind the surviving keys changed",
    ).toEqual(LINK);

    binding.destroy();
  });

  it("the key set is monotonic across a run of ever-smaller reports", () => {
    const doc = new Y.Doc();
    seedEdges(doc, [LINK]);
    const bridge = new EmittingBridge();
    const binding = new CanvasBinding(doc, bridge);

    const reports: CanvasRecord[] = [
      { id: "link-7", label: "depends on", color: "6", fromNode: "cluster-a" },
      { id: "link-7", color: "6" },
      { id: "link-7" },
    ];
    let previous = keySet(doc, "link-7");
    for (const report of reports) {
      bridge.reportLocalEdge("link-7", report);
      const now = keySet(doc, "link-7");
      expect(
        now,
        `report ${JSON.stringify(report)} shrank the record's key set from ${previous.join(",")}`,
      ).toEqual(previous);
      previous = now;
    }

    binding.destroy();
  });

  it("a sibling edge the report never names is untouched, and a changed value still lands", () => {
    const doc = new Y.Doc();
    const sibling: CanvasRecord = {
      id: "link-8",
      fromNode: "cluster-b",
      fromSide: "left",
      toNode: "cluster-c",
      toSide: "right",
    };
    seedEdges(doc, [LINK, sibling]);
    const bridge = new EmittingBridge();
    const binding = new CanvasBinding(doc, bridge);

    bridge.reportLocalEdge("link-7", { id: "link-7", label: "blocks" });

    expect(
      doc.getMap<Y.Map<unknown>>("edges").get("link-7")?.toJSON(),
      "the one reported field did not land, or the rest did not survive",
    ).toEqual({ ...LINK, label: "blocks" });
    expect(
      doc.getMap<Y.Map<unknown>>("edges").get("link-8")?.toJSON(),
      "a report about one edge disturbed another",
    ).toEqual(sibling);

    binding.destroy();
  });
});
