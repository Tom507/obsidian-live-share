// WP22 AC1 blind1 (multi-field) — the same property judged by ROUND-TRIP through
// the CRDT, on a node kind the visible test never uses.
//
// The visible multi-field test uses a `text` card and compares the doc's JSON.
// This one uses a `file` card with an embedded subpath — a shape where several
// keys are optional and are therefore the ones a sweep silently eats — and asks
// the question from the apply side: after a partial capture, what does the
// binding's own `applyRemote` hand back to a *follower's* model?
//
// That angle matters because the doc is only half the contract. A record that
// keeps its keys in the doc but is projected to the model as a stripped record
// is still a disconnection on screen. So the oracle here is the FOLLOWER MODEL,
// reconstructed by a second binding over a replica doc, with the author writing
// alone (single author per register ⇒ the value is causally determined, not a
// coin flip).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../../../canvas/canvas-binding";

const FILE_CARD: CanvasRecord = {
  id: "ref",
  type: "file",
  file: "Research/Sources.md",
  subpath: "#findings",
  x: -320,
  y: 44,
  width: 480,
  height: 640,
  color: "3",
};

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

function seedNode(doc: Y.Doc, record: CanvasRecord): void {
  doc.transact(() => {
    const ymap = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(record)) ymap.set(k, v);
    doc.getMap<Y.Map<unknown>>("nodes").set(String(record.id), ymap);
  });
}

describe("WP22 AC1 blind1 — a partial capture round-trips to the follower's model intact", () => {
  it("a resize that reports only width and height reaches the follower as a whole card", () => {
    const author = new Y.Doc();
    seedNode(author, FILE_CARD);
    const authorBinding = new CanvasBinding(author, new Bridge());

    authorBinding.captureLocal({
      kind: "node",
      id: "ref",
      record: { id: "ref", width: 500, height: 700 },
    });

    // A follower that has never written: it only integrates and projects.
    const follower = new Y.Doc();
    Y.applyUpdate(follower, Y.encodeStateAsUpdate(author));
    const followerModel = new Bridge();
    const followerBinding = new CanvasBinding(follower, followerModel);

    expect(
      followerModel.getNode("ref"),
      "the follower's model received a stripped card — the capture swept keys it never reported",
    ).toEqual({ ...FILE_CARD, width: 500, height: 700 });

    followerBinding.destroy();
    authorBinding.destroy();
  });

  it("nine successive one-field captures leave every one of the original keys in place", () => {
    const doc = new Y.Doc();
    seedNode(doc, FILE_CARD);
    const binding = new CanvasBinding(doc, new Bridge());

    const originalKeys = Object.keys(FILE_CARD).sort();
    for (const key of originalKeys) {
      // Report exactly one field, and never the id together with it except when
      // the id IS the field: the record is deliberately not self-describing.
      binding.captureLocal({ kind: "node", id: "ref", record: { [key]: FILE_CARD[key] } });
      expect(
        [...(doc.getMap<Y.Map<unknown>>("nodes").get("ref") as Y.Map<unknown>).keys()].sort(),
        `reporting only \`${key}\` removed the other keys`,
      ).toEqual(originalKeys);
    }
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").get("ref")?.toJSON(),
      "the values drifted although every report restated the doc's own value",
    ).toEqual(FILE_CARD);

    binding.destroy();
  });

  it("an unknown key arriving in a partial capture is added, not treated as a delete signal", () => {
    const doc = new Y.Doc();
    seedNode(doc, FILE_CARD);
    const binding = new CanvasBinding(doc, new Bridge());

    binding.captureLocal({ kind: "node", id: "ref", record: { subpath: "#appendix", zIndex: 4 } });

    expect(doc.getMap<Y.Map<unknown>>("nodes").get("ref")?.toJSON()).toEqual({
      ...FILE_CARD,
      subpath: "#appendix",
      zIndex: 4,
    });

    binding.destroy();
  });
});
