// WP22 AC2 blind2 — the delete trigger tested by its LIFECYCLE, not by one call.
//
// The visible test proves that `record: null` removes the record and leaves a
// tombstone. That is only half of "deletion is possible only through an explicit
// trigger": the other half is that the trigger stays a *trigger* — it must not
// become sticky. A tombstone that refuses a later, genuinely new creation of the
// same id turns "delete a card" into "ban that id forever", which is the mirror
// image of the bug this WP removes.
//
// So the sequence here is create → partial reports → delete → RE-CREATE → partial
// reports again, on both collections, with a replica integrating the whole
// history in one batch at the end. The oracle is the final state on both docs.
//
// Deliberately NOT tested here: removing a single optional field explicitly. By
// the charter's §4 amendment note that capability does not exist in P0-P4 (S14,
// owned by WP39 AC5), so asserting it would be asserting a spec the tree does not
// have. What IS asserted is the consequence: field-level removal is unavailable
// through every entry point the binding offers.

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

const PIN: CanvasRecord = { id: "pin", type: "text", text: "todo", x: 5, y: 5 };
const SPAN: CanvasRecord = { id: "span", fromNode: "pin", toNode: "post", toSide: "left" };

function json(doc: Y.Doc, collection: "nodes" | "edges", id: string): unknown {
  return doc.getMap<Y.Map<unknown>>(collection).get(id)?.toJSON();
}

describe("WP22 AC2 blind2 — the explicit trigger deletes once, and does not become a ban", () => {
  it("create → partial reports → delete → re-create → partial reports converges everywhere", () => {
    const author = new Y.Doc();
    const binding = new CanvasBinding(author, new Bridge());

    binding.captureLocal({ kind: "node", id: "pin", record: PIN });
    binding.captureLocal({ kind: "edge", id: "span", record: SPAN });

    // Partial reports remove nothing.
    binding.captureLocal({ kind: "node", id: "pin", record: { id: "pin" } });
    binding.captureLocal({ kind: "edge", id: "span", record: {} });
    expect(json(author, "nodes", "pin"), "a partial report emptied the node").toEqual(PIN);
    expect(json(author, "edges", "span"), "an empty report emptied the edge").toEqual(SPAN);

    // The explicit trigger, on both collections.
    binding.captureLocal({ kind: "node", id: "pin", record: null });
    binding.captureLocal({ kind: "edge", id: "span", record: null });
    expect(author.getMap<Y.Map<unknown>>("nodes").has("pin")).toBe(false);
    expect(author.getMap<Y.Map<unknown>>("edges").has("span")).toBe(false);

    // The user pastes both back. The tombstone must not veto a new creation.
    const RE_PIN: CanvasRecord = { id: "pin", type: "text", text: "todo again", x: 7, y: 9 };
    binding.captureLocal({ kind: "node", id: "pin", record: RE_PIN });
    binding.captureLocal({ kind: "edge", id: "span", record: SPAN });
    expect(
      json(author, "nodes", "pin"),
      "a re-created record did not come back — the delete became permanent",
    ).toEqual(RE_PIN);

    // …and partial reports are still inert on the re-created records.
    binding.captureLocal({ kind: "node", id: "pin", record: { x: 8 } });
    binding.captureLocal({ kind: "edge", id: "span", record: { id: "span" } });
    expect(json(author, "nodes", "pin")).toEqual({ ...RE_PIN, x: 8 });
    expect(json(author, "edges", "span"), "the re-created edge lost its endpoints").toEqual(SPAN);

    // A replica joining at the end sees exactly the surviving state.
    const joiner = new Y.Doc();
    Y.applyUpdate(joiner, Y.encodeStateAsUpdate(author));
    expect(json(joiner, "nodes", "pin"), "the joiner disagrees about the node").toEqual({
      ...RE_PIN,
      x: 8,
    });
    expect(json(joiner, "edges", "span"), "the joiner disagrees about the edge").toEqual(SPAN);

    binding.destroy();
  });

  it("no entry point on the binding removes a single field", () => {
    const doc = new Y.Doc();
    const binding = new CanvasBinding(doc, new Bridge());
    binding.captureLocal({ kind: "node", id: "pin", record: PIN });

    // Every shape a caller could hope means "drop `text`". None of them may.
    const attempts: CanvasRecord[] = [
      { id: "pin", type: "text", x: 5, y: 5 }, // omit it
      { id: "pin" }, // omit everything
      {}, // report nothing
    ];
    for (const record of attempts) {
      binding.captureLocal({ kind: "node", id: "pin", record });
      expect(
        json(doc, "nodes", "pin"),
        `\`${JSON.stringify(record)}\` removed a field — field-level deletion leaked back in`,
      ).toEqual(PIN);
    }

    // The only removal available is the whole record.
    binding.captureLocal({ kind: "node", id: "pin", record: null });
    expect(doc.getMap<Y.Map<unknown>>("nodes").has("pin")).toBe(false);

    binding.destroy();
  });
});
