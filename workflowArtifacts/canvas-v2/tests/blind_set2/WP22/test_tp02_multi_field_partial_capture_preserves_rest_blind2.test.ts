// WP22 AC1 blind2 (multi-field) — the property under INTERLEAVING with remote
// deltas, which is where a half-fix survives longest.
//
// The visible multi-field test runs captures in isolation. Production never does:
// a partial capture lands between two integrated remote deltas, and the binding
// re-projects the doc into the model in between. A sweep that only fires when the
// doc has more keys than the model's record — or a "fix" that quietly restores the
// swept keys from the model on the next apply — would look correct in isolation
// and lose data here, because the model is itself downstream of the doc.
//
// Fixture: a `link` card (url/subpath), a kind the visible tests do not touch,
// with a partner peer that writes a DIFFERENT key. Every register has exactly one
// author, and the two peers' writes are ordered by explicit update exchange, so
// nothing here is decided by Yjs's clientID tiebreak.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../../../canvas/canvas-binding";

const LINK_CARD: CanvasRecord = {
  id: "src",
  type: "link",
  url: "https://example.invalid/paper",
  x: 12,
  y: 34,
  width: 420,
  height: 280,
  color: "2",
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

function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

function cardOf(doc: Y.Doc): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get("src")?.toJSON();
}

describe("WP22 AC1 blind2 — partial captures survive interleaving with remote deltas", () => {
  it("capture → remote delta → capture keeps every key that nobody wrote", () => {
    const local = new Y.Doc();
    seedNode(local, LINK_CARD);
    const remote = new Y.Doc();
    sync(local, remote);

    const binding = new CanvasBinding(local, new Bridge());

    // 1. Local partial capture: geometry only.
    binding.captureLocal({ kind: "node", id: "src", record: { id: "src", x: 100 } });
    sync(local, remote);

    // 2. A remote peer edits a DIFFERENT register, then it is delivered here.
    //    Ordered exchange, one author per register — no concurrent same-key write.
    remote.transact(() => {
      (remote.getMap<Y.Map<unknown>>("nodes").get("src") as Y.Map<unknown>).set("color", "5");
    });
    sync(remote, local);

    // 3. Local partial capture again, this time content only.
    binding.captureLocal({
      kind: "node",
      id: "src",
      record: { id: "src", url: "https://example.invalid/paper#v2" },
    });
    sync(local, remote);

    const expected = {
      ...LINK_CARD,
      x: 100,
      color: "5",
      url: "https://example.invalid/paper#v2",
    };
    expect(cardOf(local), "the local doc lost a key across the interleaving").toEqual(expected);
    expect(cardOf(remote), "the remote doc lost a key across the interleaving").toEqual(expected);
  });

  it("the model projection after the interleaving is the whole card, not the reported subset", () => {
    const local = new Y.Doc();
    seedNode(local, LINK_CARD);
    const remote = new Y.Doc();
    sync(local, remote);

    const model = new Bridge();
    const binding = new CanvasBinding(local, model);

    binding.captureLocal({ kind: "node", id: "src", record: { id: "src", height: 300 } });
    remote.transact(() => {
      (remote.getMap<Y.Map<unknown>>("nodes").get("src") as Y.Map<unknown>).set("y", 90);
    });
    sync(remote, local); // the binding's observer re-projects into the model

    expect(
      model.getNode("src"),
      "the model was handed a stripped card after a partial capture + remote delta",
    ).toEqual({ ...LINK_CARD, height: 300, y: 90 });

    binding.destroy();
  });

  it("a partial capture on one card never reaches its neighbour", () => {
    const doc = new Y.Doc();
    seedNode(doc, LINK_CARD);
    const neighbour: CanvasRecord = { id: "note", type: "text", text: "aside", x: 900, y: 0 };
    seedNode(doc, neighbour);
    const binding = new CanvasBinding(doc, new Bridge());

    binding.captureLocal({ kind: "node", id: "src", record: { width: 1 } });

    expect(cardOf(doc), "the reported field did not land or the rest was swept").toEqual({
      ...LINK_CARD,
      width: 1,
    });
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").get("note")?.toJSON(),
      "a capture aimed at one record altered another",
    ).toEqual(neighbour);

    binding.destroy();
  });
});
