// WP11 AC1 — same guarantee, attacked from the replication angle: the
// record's ORIGINAL type arrived from a remote peer via a CRDT update, not
// from a local guardTypeWrite call on this replica. The guard must still
// recognise it as "already written" and reject a differing local attempt —
// proving the decision reads the record's actual current state, not some
// local bookkeeping flag that only guardTypeWrite itself would set. This is
// a sequential (not concurrent) replication, so no clientID-based tie-break
// is involved and nothing here reasons about a concurrent-write winner.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { V2_FIELD } from "../../../canvas/canvas-registers";
import { guardTypeWrite } from "../../../canvas/canvas-type-guard";

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

describe("WP11 AC1 — rejects a differing local write on a record whose type arrived via replication", () => {
  it("treats a remotely-written type as already-written for the guard's own local write", () => {
    const peerA = new Y.Doc();
    const nodesA = peerA.getMap<Y.Map<unknown>>("nodes");
    const recordA = new Y.Map<unknown>();
    nodesA.set("shared-1", recordA);
    recordA.set(V2_FIELD.type, "link");

    const peerB = new Y.Doc();
    push(peerA, peerB);
    const recordB = peerB.getMap<Y.Map<unknown>>("nodes").get("shared-1") as Y.Map<unknown>;
    expect(recordB.get(V2_FIELD.type)).toBe("link");

    const verdict = guardTypeWrite(recordB, "shared-1", "file");

    expect(verdict.kind).toBe("rejected");
    expect(recordB.get(V2_FIELD.type)).toBe("link");
    if (verdict.kind !== "rejected") throw new Error("unreachable");
    expect(verdict.signature).toContain("shared-1");
    expect(verdict.signature).toContain("file");

    peerA.destroy();
    peerB.destroy();
  });
});
