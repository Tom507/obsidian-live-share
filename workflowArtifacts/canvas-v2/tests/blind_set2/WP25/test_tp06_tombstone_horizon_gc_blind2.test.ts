// WP25 / AC3 blind2 (horizon half) — collection viewed from the ONE SHARED
// SUPPRESSION PREDICATE, and from what a PEER sees afterwards.
//
// The visible test drives a scattered fixture; blind1 walks the boundary tick by
// tick. This one attacks the two things both of those take for granted:
//
//   1. THE COLLECTOR MUST ASK `isTombstoneSuppressed`, not `entry.on`.
//      `canvas-tombstone.ts` is the single authority on "is this record
//      deleted", and its own header names WP25's GC as the next case the rule
//      will gain. A collector with its own inline reading drifts the moment the
//      rule does — and the drift is silent, because both spellings agree today.
//      Pinned behaviourally: a MALFORMED entry (which the predicate reads as
//      "no tombstone", i.e. VISIBLE, rather than throwing) must never be
//      collected, and an inline `entry?.on === true` on a malformed object
//      answers differently.
//   2. THE COLLECTION MUST BE SAFE TO SEND. The removals are CRDT writes, so a
//      peer receives them. After merging, the peer must agree with the
//      collector about what is visible — otherwise the compaction has quietly
//      republished a deleted card to everyone else.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../../../plugin/src/canvas/canvas-tombstone";
import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  DELETED_MAP_NAME,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

const GUID = "72e0a95c1348bd6f0a25e91743cbf806";
const HORIZON = 8;

function memoryIO(): SidecarIO {
  const files = new Map<string, Uint8Array>();
  return {
    async ensureDir() {},
    async exists(p: string) {
      return files.has(p);
    },
    async read(p: string) {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(f);
    },
    async write(p: string, d: Uint8Array) {
      files.set(p, Uint8Array.from(d));
    },
    async append(p: string, d: Uint8Array) {
      const prev = files.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      files.set(p, out);
    },
    async truncate(p: string) {
      files.set(p, new Uint8Array(0));
    },
    async remove(p: string) {
      files.delete(p);
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function projection(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
}

function record(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, entry);
    for (const [k, v] of Object.entries({
      id,
      type: "text",
      x: 0,
      y: 0,
      width: 90,
      height: 40,
      text: id,
    })) {
      entry.set(k, v);
    }
  });
}

describe("WP25 AC3 blind2 — collection routes through the one suppression rule", () => {
  it("a MALFORMED tombstone is never collected, however old it looks", async () => {
    // `asTombstoneEntry` refuses a value that is not a well-formed entry and the
    // record stays VISIBLE — an unreadable tombstone must never take a user's
    // record away (I5). An inline `entry?.on === true` reads `on: "true"` and
    // `t: "1"` as a deletion and collects a live card.
    const doc = new Y.Doc();
    for (const id of ["n-string-on", "n-string-t", "n-no-by", "n-real"]) record(doc, id);
    doc.transact(() => {
      const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
      deleted.set("n-string-on", { t: 1, by: "peer-a", on: "true" });
      deleted.set("n-string-t", { t: "1", by: "peer-a", on: true });
      deleted.set("n-no-by", { t: 1, on: true });
      deleted.set("n-real", { t: 1, by: "peer-a", on: true });
      // the anchor that puts every t=1 entry beyond the horizon
      deleted.set("n-anchor", { t: 500, by: "peer-z", on: false });
    });

    const container = doc.getMap<unknown>(DELETED_MAP_NAME);
    expect(isTombstoneSuppressed(readTombstoneEntry(container, "n-string-on"))).toBe(false);
    expect(isTombstoneSuppressed(readTombstoneEntry(container, "n-real"))).toBe(true);

    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      horizonTicks: HORIZON,
    });
    lifecycle.attach(GUID, doc);
    await settle();
    const result = await lifecycle.compact(GUID, doc);
    await settle();

    expect(
      [...result.removedTombstoneIds].sort(),
      "a malformed tombstone was read as a deletion and its live record was collected",
    ).toEqual(["n-real"]);
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual([
      "n-no-by",
      "n-string-on",
      "n-string-t",
    ]);

    await lifecycle.destroy();
  });

  it("a peer that merges the compaction agrees about what is visible", async () => {
    // The removals go on the wire. A peer that has not compacted must reach the
    // same projection after merging them — otherwise the compaction has
    // republished a deleted card to the whole room.
    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      horizonTicks: HORIZON,
    });
    const mine = new Y.Doc();
    const peer = new Y.Doc();
    lifecycle.attach(GUID, mine);

    for (const id of ["n-old", "n-fresh", "n-live"]) record(mine, id);
    mine.transact(() => {
      const deleted = mine.getMap<unknown>(DELETED_MAP_NAME);
      deleted.set("n-old", { t: 1, by: "peer-a", on: true });
      deleted.set("n-fresh", { t: 100, by: "peer-a", on: true });
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine));
    await settle();

    expect(projection(peer)).toBe(projection(mine));

    const result = await lifecycle.compact(GUID, mine);
    await settle();
    expect(result.removedTombstoneIds).toEqual(["n-old"]);

    Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine, Y.encodeStateVector(peer)));

    expect(
      projection(peer),
      "the peer sees something different after merging the compaction",
    ).toBe(projection(mine));
    expect(JSON.parse(projection(peer)).nodes.map((n: { id: string }) => n.id)).toEqual([
      "n-live",
    ]);

    await lifecycle.destroy();
    peer.destroy();
  });

  it("a peer's concurrent UNDO of a collected id does not resurrect a husk", async () => {
    // The genuinely contested case, and the reason it is asserted for
    // CONVERGENCE and MEMBERSHIP rather than for a winner. Both replicas must
    // end up agreeing; which of the two writes Yjs happens to keep for a
    // contested key is decided by `clientID`, i.e. `random.uint32()`.
    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      horizonTicks: HORIZON,
    });
    const mine = new Y.Doc();
    const peer = new Y.Doc();
    lifecycle.attach(GUID, mine);
    for (const id of ["n-old", "n-live"]) record(mine, id);
    mine.transact(() => {
      const deleted = mine.getMap<unknown>(DELETED_MAP_NAME);
      deleted.set("n-old", { t: 1, by: "peer-a", on: true });
      deleted.set("n-live", { t: 200, by: "peer-b", on: false });
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine));
    await settle();

    // Concurrently: we compact, the peer undoes the ancient delete.
    const result = await lifecycle.compact(GUID, mine);
    peer.transact(() => {
      peer.getMap<unknown>(DELETED_MAP_NAME).set("n-old", { t: 300, by: "peer-c", on: false });
    });
    await settle();
    expect(result.removedTombstoneIds).toEqual(["n-old"]);

    // Exchange both ways, twice, so both replicas have seen everything.
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine, Y.encodeStateVector(peer)));
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(mine)));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine, Y.encodeStateVector(peer)));

    // CONVERGENCE, not identity: the two replicas must agree.
    expect(projection(mine), "the replicas diverged").toBe(projection(peer));
    // MEMBERSHIP: whatever they agreed, `n-live` is visible and the projection
    // never contains a record with no fields.
    const ids = JSON.parse(projection(mine)).nodes as Record<string, unknown>[];
    expect(ids.map((n) => n.id)).toContain("n-live");
    for (const node of ids) {
      expect(Object.keys(node).length, "a husk reached the projection").toBeGreaterThan(1);
    }

    await lifecycle.destroy();
    peer.destroy();
  });

  it("a tombstone whose record is already gone is still collected, and does not throw", async () => {
    // Two clients can compact the same board. The second one finds a tombstone
    // whose record another replica already removed; deleting an absent key must
    // be a no-op rather than a thrown compaction that stops the timer forever.
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap<unknown>(DELETED_MAP_NAME).set("n-ghost", { t: 1, by: "peer-a", on: true });
      doc.getMap<unknown>(DELETED_MAP_NAME).set("n-anchor", { t: 400, by: "peer-z", on: false });
    });

    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      horizonTicks: HORIZON,
    });
    lifecycle.attach(GUID, doc);
    await settle();

    const result = await lifecycle.compact(GUID, doc);
    await settle();

    expect(result.removedTombstoneIds).toEqual(["n-ghost"]);
    expect(result.removedRecordIds).toEqual([]);
    expect([...doc.getMap<unknown>(DELETED_MAP_NAME).keys()]).toEqual(["n-anchor"]);

    await lifecycle.destroy();
  });
});
