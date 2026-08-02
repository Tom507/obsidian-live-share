// WP8 / AC3 — "Migration is idempotent: running it on an already-migrated
// doc changes nothing and produces no delta."
//
// A deep-equal on the JSON view would pass even if the second run rewrote
// every field to an identical value — Yjs still produces an update for a
// same-value LWW `set` (verified empirically: re-setting an unchanged value
// inside a transaction still yields a non-empty encoded update), and that
// update WOULD echo to every peer. The real oracle is a Yjs update-delta
// check: snapshot the state vector right after the first (real) migration,
// run migrateV1ToV2 again, and assert the encoded update against that
// snapshot is empty. Zero `update` events on the second call is the second
// half of the same guarantee — `update` (unlike `afterTransaction`, which
// fires even for a transaction that touched nothing) only fires when a
// transaction actually produced content.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { migrateV1ToV2 } from "../../../canvas/canvas-schema";

function v1Node(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  nodes.set(id, record);
}

function v1Edge(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  edges.set(id, record);
}

describe("WP8 AC3 — re-running migration on an already-migrated doc produces zero delta", () => {
  it("the second call's encoded update against the post-first-migration state vector is empty, and fires no update event", () => {
    const doc = new Y.Doc();
    v1Node(doc, "n1", { id: "n1", type: "text", x: 1, y: 2, width: 10, height: 20, text: "x" });
    v1Edge(doc, "e1", { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n1", toSide: "left" });

    migrateV1ToV2(doc);
    const stateVectorAfterFirstMigration = Y.encodeStateVector(doc);

    let updateCount = 0;
    const onUpdate = () => {
      updateCount++;
    };
    doc.on("update", onUpdate);
    migrateV1ToV2(doc);
    doc.off("update", onUpdate);

    const deltaSinceFirstMigration = Y.encodeStateAsUpdate(doc, stateVectorAfterFirstMigration);

    // An empty Yjs update encodes to a fixed, tiny "nothing changed" byte
    // sequence (no struct blocks, no delete set entries). Comparing lengths
    // against a doc that genuinely has zero further changes is the
    // update-delta oracle: this is what "produces no delta" means for a CRDT.
    const emptyReferenceDoc = new Y.Doc();
    const emptyReferenceUpdate = Y.encodeStateAsUpdate(
      emptyReferenceDoc,
      Y.encodeStateVector(emptyReferenceDoc),
    );
    expect(
      Array.from(deltaSinceFirstMigration),
      "a second migration call must produce zero further CRDT delta",
    ).toEqual(Array.from(emptyReferenceUpdate));
    expect(updateCount, "the idempotent re-run must fire zero update events").toBe(0);

    emptyReferenceDoc.destroy();
    doc.destroy();
  });
});
