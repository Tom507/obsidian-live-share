// WP19 AC4 blind2 — TWO delete/undo cycles with a peer editing in between.
//
// One cycle can be survived by accident: whatever cached the record on the way
// down hands it back on the way up. Two cycles, with a peer writing into the
// record while it is suppressed, cannot be:
//
//   ├── the peer's write only exists at all if the container survived the FIRST
//   │      delete, so it is a witness that nothing was recreated, and
//   └── it did not exist when the record was first captured, so it cannot come
//          from any snapshot the delete path might have squirrelled away. After
//          the second cycle the record must carry the original fields AND the
//          peer's, which no "restore from what I remember" implementation can
//          produce.
//
// The final assertion is against the union of both authors' fields, key by key,
// on all three replicas. Every op is ordered and every tombstone stamp is chosen
// by this test, so nothing depends on a Yjs `clientID` tie-break: delete t=1,
// undo t=2, delete t=3, undo t=4, all by the same author, each strictly after
// its predecessor.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyTombstoneOp,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { buildCanvasData } from "../../../files/canvas-sync";

const ORIGINAL: Record<string, unknown> = {
  id: "dossier",
  type: "file",
  x: 120,
  y: -60,
  width: 420,
  height: 300,
  file: "cases/dossier-7.md",
  color: "#0b7285",
};

function seedRecord(
  container: Y.Map<Y.Map<unknown>>,
  fields: Record<string, unknown>,
): void {
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  container.set(String(fields.id), record);
}

function replicate(from: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(from), "peer");
  return copy;
}

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function tombstones(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>("deleted");
}

function record(doc: Y.Doc, id: string): Record<string, unknown> {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.toJSON() ?? {};
}

function visibleIds(doc: Y.Doc): string[] {
  return buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    tombstones(doc),
  ).nodes.map((node) => String(node.id));
}

describe("WP19 AC4 blind2 — two delete/undo cycles keep the union of both authors' fields", () => {
  it("after delete, peer edit, undo, delete, undo the record carries every original field and the peer's", () => {
    const doc1 = new Y.Doc();
    doc1.transact(() => {
      seedRecord(doc1.getMap<Y.Map<unknown>>("nodes"), ORIGINAL);
      seedRecord(doc1.getMap<Y.Map<unknown>>("nodes"), {
        id: "sibling",
        type: "text",
        x: 0,
        y: 600,
        width: 200,
        height: 100,
        text: "sibling",
      });
    });
    const doc2 = replicate(doc1);
    const doc3 = replicate(doc1);

    const before = record(doc1, "dossier");
    expect(Object.keys(before).length, "the fixture record is too thin to prove anything").toBe(
      Object.keys(ORIGINAL).length,
    );

    // Cycle 1 — delete at t=1, delivered to the room.
    doc1.transact(() => {
      applyTombstoneOp(tombstones(doc1), "dossier", { t: 1, by: "author", on: true });
    });
    push(doc1, doc2);
    push(doc1, doc3);
    expect(visibleIds(doc1), "the first delete did not suppress the record").toEqual(["sibling"]);

    // A peer annotates the SUPPRESSED record. Only possible if it still exists.
    const onPeer = doc2.getMap<Y.Map<unknown>>("nodes").get("dossier");
    expect(
      onPeer,
      "the delete propagated as a key removal: the peer has no record left to annotate",
    ).toBeDefined();
    doc2.transact(() => {
      onPeer?.set("label", "reviewed while deleted");
    });
    push(doc2, doc1);
    push(doc2, doc3);

    // Undo at t=2 — the same op with `on:false`, strictly after the delete.
    doc1.transact(() => {
      applyTombstoneOp(tombstones(doc1), "dossier", { t: 2, by: "author", on: false });
    });
    push(doc1, doc2);
    push(doc1, doc3);
    expect(
      isTombstoneSuppressed(readTombstoneEntry(tombstones(doc1), "dossier")),
      "the first undo did not lift the suppression",
    ).toBe(false);

    // Cycle 2 — delete at t=3, undo at t=4.
    doc1.transact(() => {
      applyTombstoneOp(tombstones(doc1), "dossier", { t: 3, by: "author", on: true });
    });
    push(doc1, doc2);
    push(doc1, doc3);
    expect(visibleIds(doc1), "the second delete did not suppress the record").toEqual(["sibling"]);

    doc1.transact(() => {
      applyTombstoneOp(tombstones(doc1), "dossier", { t: 4, by: "author", on: false });
    });
    push(doc1, doc2);
    push(doc1, doc3);
    push(doc2, doc3);
    push(doc3, doc2);

    const expected = { ...before, label: "reviewed while deleted" };
    for (const doc of [doc1, doc2, doc3]) {
      expect(
        isTombstoneSuppressed(readTombstoneEntry(tombstones(doc), "dossier")),
        "a replica still holds the record suppressed after the final undo",
      ).toBe(false);
      const after = record(doc, "dossier");
      for (const [key, value] of Object.entries(expected)) {
        expect(after[key], `field \`${key}\` did not survive two delete/undo cycles`).toEqual(value);
      }
      expect(
        Object.keys(after).sort(),
        "the restored record gained or lost keys across the two cycles",
      ).toEqual(Object.keys(expected).sort());
      expect(visibleIds(doc).sort(), "the restored record is not back in the view").toEqual([
        "dossier",
        "sibling",
      ]);
    }

    doc1.destroy();
    doc2.destroy();
    doc3.destroy();
  });
});
