// WP24 / AC2 (first half) — "loading reconstructs a doc from checkpoint +
// history such that its state equals the state before unload".
//
// The oracle is a real `Y.Doc` on both sides: state vector plus observable
// content (see `docSnapshot` for why raw `encodeStateAsUpdate` bytes are not a
// safe equality oracle across two docs). Content alone would pass for a store
// that dropped the deletion history and left the reloaded replica unable to
// converge with a peer that still remembers it; the state vector alone would
// pass for a store that applied the right number of updates with the wrong
// payloads. Both together are what "equals the state before unload" means for
// a CRDT replica.
//
// A convergence leg is included as well: the reloaded replica and a peer that
// stayed online must still agree after exchanging state. That is the property
// the fuzzer's "replica restart" op will lean on (charter §2).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  SIDECAR_LOAD_ORIGIN,
  createSidecarStore,
} from "../../../files/canvas-sidecar";
import { createFakeIO, docSnapshot, recordUpdates } from "./harness";

const GUID = "guid-reconstruct";

/** A doc with creates, edits and a delete — a delete is where naive stores lose. */
function buildLivedInDoc(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates = recordUpdates(doc);
  const nodes = doc.getMap("nodes");
  nodes.set("n1", { x: 0, y: 0, width: 200, height: 60 });
  nodes.set("n2", { x: 240, y: 0, width: 200, height: 60 });
  nodes.set("n3", { x: 480, y: 0, width: 200, height: 60 });
  nodes.set("n2", { x: 240, y: 120, width: 200, height: 60 });
  nodes.delete("n3");
  doc.getMap("edges").set("e1", { from: "n1", to: "n2" });
  return { doc, updates };
}

describe("WP24 AC2 — load reconstructs the pre-unload state", () => {
  it("history only (never checkpointed) rebuilds an identical replica", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = buildLivedInDoc();
    expect(updates.length).toBeGreaterThanOrEqual(6);
    for (const update of updates) await store.append(GUID, update);

    const revived = new Y.Doc();
    const result = await store.load(GUID, revived);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(updates.length);
    expect(docSnapshot(revived)).toEqual(docSnapshot(doc));
    expect(revived.getMap("nodes").has("n3")).toBe(false);
  });

  it("checkpoint plus tail history rebuilds an identical replica", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = buildLivedInDoc();
    for (const update of updates.splice(0)) await store.append(GUID, update);
    await store.checkpoint(GUID, doc);

    doc.getMap("nodes").set("n4", { x: 0, y: 200, width: 120, height: 40 });
    doc.getMap("nodes").delete("n1");
    for (const update of updates.splice(0)) await store.append(GUID, update);

    const revived = new Y.Doc();
    const result = await store.load(GUID, revived);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.checkpointApplied).toBe(true);
    expect(result.historyEntriesApplied).toBe(2);
    expect(docSnapshot(revived)).toEqual(docSnapshot(doc));
  });

  it("the reloaded replica still converges with a peer that stayed online", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = buildLivedInDoc();
    for (const update of updates) await store.append(GUID, update);

    // A peer that saw the same history live, and then edited on.
    const peer = new Y.Doc();
    for (const update of updates) Y.applyUpdate(peer, update);
    peer.getMap("nodes").set("n5", { x: 700, y: 0, width: 100, height: 40 });

    const revived = new Y.Doc();
    await store.load(GUID, revived);
    Y.applyUpdate(revived, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(revived)));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(revived, Y.encodeStateVector(peer)));

    expect(docSnapshot(revived)).toEqual(docSnapshot(peer));
    expect(revived.getMap("nodes").has("n5")).toBe(true);
    expect(revived.getMap("nodes").has("n3")).toBe(false);
  });

  it("applies the reconstruction as ONE transaction stamped with SIDECAR_LOAD_ORIGIN", async () => {
    // WP25 has to be able to tell "this update came off my own disk" from "this
    // update came from a peer", otherwise it re-appends its own load to the
    // history. The origin stamp is the seam that makes that possible, and one
    // transaction is what makes the load atomic from an observer's point of view.
    const io = createFakeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = buildLivedInDoc();
    for (const update of updates) await store.append(GUID, update);

    const revived = new Y.Doc();
    const origins: unknown[] = [];
    revived.on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));

    await store.load(GUID, revived);

    expect(origins).toHaveLength(1);
    expect(origins[0]).toBe(SIDECAR_LOAD_ORIGIN);
  });
});
