// WP22 / AC1 (multi-field half) — the same property on a record with many keys.
//
// The headline case is an edge and one key. The realistic case is a text card
// with geometry, styling and content, where a capture reports the two coordinates
// a drag moved and nothing else. Under the removed behaviour that drag deleted
// `type`, `text`, `color` and `width`/`height` — the card survived as a naked
// `{id, x, y}`. So the property has to hold for an arbitrary subset, not just for
// the singleton `{id}`.
//
// Three angles, all on doc STATE:
//   ├── a two-field capture upserts exactly those two and leaves the other six,
//   ├── the write is still MINIMAL — the counter seam sees exactly one
//   │      origin-stamped update for the whole capture, and none at all for a
//   │      capture that repeats what the doc already holds, and
//   └── upsert is genuinely upSERT: a key the doc has never seen is added by a
//          partial capture rather than being confused with a deletion.

import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasBinding,
  type CanvasBindingCounter,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
  setCanvasBindingInstrument,
} from "../../../canvas/canvas-binding";

/** A fully-specified text card: geometry + styling + content. */
const CARD: CanvasRecord = {
  id: "card",
  type: "text",
  x: 100,
  y: 200,
  width: 400,
  height: 300,
  color: "5",
  text: "the sentence the user typed",
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

function nodeRecord(doc: Y.Doc, id: string): Record<string, unknown> {
  const ymap = doc.getMap<Y.Map<unknown>>("nodes").get(id);
  if (!ymap) throw new Error(`node ${id} is not in the doc at all`);
  return ymap.toJSON();
}

describe("WP22 AC1 — a multi-field partial capture touches only what it mentions", () => {
  afterEach(() => {
    setCanvasBindingInstrument(null);
  });

  it("a drag that reports only x and y leaves type, text, colour and size untouched", () => {
    const doc = new Y.Doc();
    seedNode(doc, "card", CARD);

    const binding = new CanvasBinding(doc, new FakeBridge());
    binding.captureLocal({ kind: "node", id: "card", record: { id: "card", x: 140, y: 260 } });

    const after = nodeRecord(doc, "card");
    expect(after, "a two-field capture rewrote the whole record").toEqual({
      ...CARD,
      x: 140,
      y: 260,
    });
    // Named individually so a failure says which key the sweep took.
    for (const key of ["type", "text", "color", "width", "height"] as const) {
      expect(
        Object.keys(after),
        `\`${key}\` was deleted by a capture that only reported geometry`,
      ).toContain(key);
    }

    binding.destroy();
  });

  it("the write stays minimal: one origin update for a real change, none for a repeat", () => {
    const doc = new Y.Doc();
    seedNode(doc, "card", CARD);

    const seen: CanvasBindingCounter[] = [];
    setCanvasBindingInstrument((counter) => seen.push(counter));

    const binding = new CanvasBinding(doc, new FakeBridge());
    seen.length = 0; // discard the constructor's seeding applyRemote

    binding.captureLocal({ kind: "node", id: "card", record: { id: "card", x: 140, y: 260 } });
    expect(
      seen.filter((c) => c === "originUpdate"),
      "a two-field move did not produce exactly one origin-stamped update",
    ).toHaveLength(1);

    seen.length = 0;
    // Same partial shape, values the doc already holds after the move above.
    binding.captureLocal({ kind: "node", id: "card", record: { id: "card", x: 140, y: 260 } });
    expect(
      seen.filter((c) => c === "originUpdate"),
      "a capture that repeats the doc's own values still wrote to the CRDT (I3)",
    ).toHaveLength(0);

    binding.destroy();
  });

  it("a partial capture still ADDS a key the doc has never held", () => {
    const doc = new Y.Doc();
    seedNode(doc, "card", { id: "card", x: 1, y: 2 });

    const binding = new CanvasBinding(doc, new FakeBridge());
    binding.captureLocal({
      kind: "node",
      id: "card",
      record: { id: "card", color: "2", text: "typed later" },
    });

    expect(
      nodeRecord(doc, "card"),
      "upsert-only became write-nothing — new keys must still land",
    ).toEqual({ id: "card", x: 1, y: 2, color: "2", text: "typed later" });

    binding.destroy();
  });
});
