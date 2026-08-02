// WP8 AC3 — third angle: a two-replica scenario. Peer A migrates a V1 doc
// and pushes the result to peer B (a one-way replication, exactly as the
// relay would deliver it — sequential, single-authored, NOT a concurrent
// same-key write, so this is safe from the CRDT-tiebreak trap the shared
// ownership contract warns about). Peer B then calls migrateV1ToV2 on the
// ALREADY-migrated doc it just received. B's own call must produce zero
// delta, and the two peers must stay byte-identical afterwards.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { migrateV1ToV2 } from "../../../canvas/canvas-schema";

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function v1Node(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  nodes.set(id, record);
}

describe("WP8 AC3 — a peer that receives an already-migrated doc re-migrates to zero delta", () => {
  it("peer B's own migrateV1ToV2 call after receiving A's migration produces no delta, and both peers converge", () => {
    const peerA = new Y.Doc();
    v1Node(peerA, "n1", {
      id: "n1",
      type: "text",
      x: 3,
      y: 4,
      width: 50,
      height: 60,
      text: "shared",
    });
    migrateV1ToV2(peerA);

    const peerB = new Y.Doc();
    push(peerA, peerB);

    const stateVectorBeforeBsCall = Y.encodeStateVector(peerB);

    let updateCount = 0;
    const onUpdate = () => {
      updateCount++;
    };
    peerB.on("update", onUpdate);
    migrateV1ToV2(peerB);
    peerB.off("update", onUpdate);

    const deltaFromBsCall = Y.encodeStateAsUpdate(peerB, stateVectorBeforeBsCall);

    const emptyReferenceDoc = new Y.Doc();
    const emptyReferenceUpdate = Y.encodeStateAsUpdate(
      emptyReferenceDoc,
      Y.encodeStateVector(emptyReferenceDoc),
    );

    expect(
      Array.from(deltaFromBsCall),
      "B re-migrating what A already migrated must produce zero delta",
    ).toEqual(Array.from(emptyReferenceUpdate));
    expect(updateCount).toBe(0);

    // Full convergence: A and B agree on schemaVersion and the migrated node.
    expect(peerB.getMap<unknown>("meta").get("schemaVersion")).toEqual(
      peerA.getMap<unknown>("meta").get("schemaVersion"),
    );
    expect(Array.from(Y.encodeStateVector(peerA))).toEqual(
      Array.from(Y.encodeStateVector(peerB)),
    );

    emptyReferenceDoc.destroy();
    peerA.destroy();
    peerB.destroy();
  });
});
