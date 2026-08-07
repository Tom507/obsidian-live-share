import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

// WP3 DoD — the same doc state on different clients produces identical bytes.
// Angle: THREE replicas (the spec forbids reasoning from two), each of which
// created a different subset of the records locally and received the rest as
// remote deltas — so every replica's Y.Map integration order is genuinely
// different rather than merely permuted by the test.

type Rec = Record<string, unknown>;

const RECORDS: Record<string, Rec> = {
  "aa-node": { id: "aa-node", type: "text", x: 40, y: 40, width: 250, height: 60, text: "aa" },
  "mm-node": { id: "mm-node", type: "file", x: -300, y: 12, width: 400, height: 400, file: "M.md" },
  "zz-node": { id: "zz-node", type: "text", x: 900, y: -70, width: 250, height: 60, text: "zz" },
};

function put(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    for (const [key, value] of Object.entries(RECORDS[id])) record.set(key, value);
  });
}

function sync(docs: Y.Doc[]): void {
  for (const source of docs) {
    const update = Y.encodeStateAsUpdate(source);
    for (const target of docs) {
      if (target !== source) Y.applyUpdate(target, update);
    }
  }
}

function maps(doc: Y.Doc): [Y.Map<Y.Map<unknown>>, Y.Map<Y.Map<unknown>>] {
  return [doc.getMap<Y.Map<unknown>>("nodes"), doc.getMap<Y.Map<unknown>>("edges")];
}

describe("three converged replicas write identical bytes", () => {
  it("serialises the same state identically after real Yjs update exchange", () => {
    const peers = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    put(peers[0], "zz-node");
    put(peers[1], "aa-node");
    put(peers[2], "mm-node");
    sync(peers);

    const outputs = peers.map((doc) => serializeCanvas(...maps(doc)));

    // Premise: the replicas really did integrate the records in different
    // orders, so the raw CRDT iteration order cannot be the serialisation order.
    const iteration = peers.map((doc) => [...maps(doc)[0].keys()].join("|"));
    expect(new Set(iteration).size).toBeGreaterThan(1);

    expect(outputs[1]).toBe(outputs[0]);
    expect(outputs[2]).toBe(outputs[0]);
    expect(new Set(outputs).size).toBe(1);
  });

  it("gives every replica the same id order and the same key order", () => {
    const peers = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    put(peers[0], "mm-node");
    put(peers[1], "zz-node");
    put(peers[2], "aa-node");
    sync(peers);

    for (const doc of peers) {
      const data = buildCanvasData(...maps(doc));
      expect(data.nodes.map((n) => (n as Rec).id)).toEqual(["aa-node", "mm-node", "zz-node"]);
      expect(Object.keys(data.nodes[1] as Rec)).toEqual([
        "id",
        "type",
        "x",
        "y",
        "width",
        "height",
        "file",
      ]);
    }
  });

  it("survives a late joiner receiving the whole state in one update", () => {
    const early = [new Y.Doc(), new Y.Doc()];
    put(early[0], "aa-node");
    put(early[1], "zz-node");
    sync(early);
    put(early[0], "mm-node");
    sync(early);

    const late = new Y.Doc();
    Y.applyUpdate(late, Y.encodeStateAsUpdate(early[1]));

    expect(serializeCanvas(...maps(late))).toBe(serializeCanvas(...maps(early[0])));
  });
});
