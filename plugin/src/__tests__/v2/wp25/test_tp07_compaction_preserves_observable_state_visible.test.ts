// WP25 / AC3 (the discriminating half) — "a compaction never changes the doc's
// observable state".
//
// THIS IS THE ASSERTION MOST LIKELY TO BE WRITTEN SO IT CANNOT FAIL, and there
// are two ways to write it that way:
//
//   ├── COMPACT A TRIVIAL DOC. A board with two clean cards and no tombstones
//   │   has nothing to collect and nothing to garbage collect, so "state
//   │   unchanged" is true of every implementation including one that does
//   │   nothing at all. Every scenario below therefore contains REAL GC-able
//   │   garbage and REAL `on:true` tombstones beyond the horizon.
//   └── ASSERT ONLY "UNCHANGED". A compaction that is a no-op passes that
//       trivially. So each scenario asserts BOTH halves in the same test: the
//       tombstones WERE physically removed, AND the observable state is
//       identical. Neither half alone is the claim; together they are.
//
// "OBSERVABLE STATE" IS THE PROJECTION, NOT THE ENCODING. Asserting that
// `encodeStateAsUpdate` is unchanged would be unsatisfiable by every correct
// implementation — compacting is precisely a change to the encoding — and this
// project has already shipped that mistake once (a "state vector unchanged"
// oracle over an operation the AC required to write). What must not move is what
// the `.canvas` file, a peer and the open view can see: `serializeCanvas`
// output, `meta`, and the visible id sets. That is `observableState`.
//
// PRODUCTION LINE ↔ ASSERTION: reddened by removing a tombstone WITHOUT its
// record (the record resurrects → `canvas` grows), by removing a record WITHOUT
// its tombstone (`deleted` keeps an entry for an id that no longer exists), and
// by collecting an `on:false` entry (a restored card disappears).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { GUID_KEY, META_MAP_NAME, PATH_KEY } from "../../../canvas/canvas-schema";
import { createSidecarStore } from "../../../files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../files/canvas-sidecar-lifecycle";
import { DELETED_MAP_NAME } from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  FIXED_GUID,
  createSidecarIO,
  createTrace,
  observableState,
  seedRecord,
  writeTombstone,
} from "./harness";

const HORIZON = 10;

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/**
 * A board that genuinely has something to compact:
 *
 *   ├── two ANCIENT `on:true` tombstones (t=1, t=3) over records that carry
 *   │   real content — the GC-able garbage,
 *   ├── one RECENT `on:true` tombstone (t=90) that must survive,
 *   ├── one `on:false` tombstone (t=4) over a visible record,
 *   ├── an edge whose endpoint is one of the ancient, suppressed nodes — it is
 *   │   already invisible through the cascade and must STAY invisible after the
 *   │   node record itself is gone, and
 *   └── `meta`, so a compaction that rebuilt the doc through a fresh replica
 *       would show up as identity loss rather than as nothing at all.
 */
function loadedBoard(): Y.Doc {
  const doc = new Y.Doc();
  const node = (id: string, text: string): Record<string, unknown> => ({
    id,
    type: "text",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    text,
  });
  seedRecord(doc, "nodes", node("n-ancient-1", "ancient one, with a long body of text"));
  seedRecord(doc, "nodes", node("n-ancient-2", "ancient two, with a long body of text"));
  seedRecord(doc, "nodes", node("n-recent", "recently deleted"));
  seedRecord(doc, "nodes", node("n-restored", "deleted and put back"));
  seedRecord(doc, "nodes", node("n-live", "never touched"));
  seedRecord(doc, "edges", { id: "e-live", fromNode: "n-live", toNode: "n-restored" });
  seedRecord(doc, "edges", { id: "e-dangling", fromNode: "n-live", toNode: "n-ancient-1" });

  writeTombstone(doc, "n-ancient-1", { t: 1, by: "peer-a", on: true });
  writeTombstone(doc, "n-ancient-2", { t: 3, by: "peer-a", on: true });
  writeTombstone(doc, "n-restored", { t: 4, by: "peer-b", on: false });
  writeTombstone(doc, "n-recent", { t: 90, by: "peer-b", on: true });

  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, FIXED_GUID);
    meta.set(PATH_KEY, CANVAS_PATH);
  });
  return doc;
}

describe("WP25 AC3 — a compaction never changes the doc's observable state", () => {
  it("the fixture actually HAS something to compact (premise)", () => {
    // Without this, every assertion in the file is about a trivial doc and
    // proves nothing.
    const doc = loadedBoard();
    const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
    expect([...deleted.keys()].length).toBe(4);
    const before = observableState(doc);
    // Two ancient records are suppressed and therefore already invisible.
    expect(before.nodeIds).toEqual(["n-live", "n-restored"]);
    expect(before.edgeIds).toEqual(["e-live"]);
    doc.destroy();
  });

  it("the projection is byte-identical across a compaction that DID collect", async () => {
    const io = createSidecarIO(createTrace());
    const doc = loadedBoard();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    const before = observableState(doc);
    const result = await lifecycle.compact(FIXED_GUID, doc);
    await settle();
    const after = observableState(doc);

    // HALF ONE — something really was removed. Without this the equality below
    // is satisfied by a compaction that does nothing.
    expect(
      [...result.removedTombstoneIds].sort(),
      "no tombstone was collected — the equality below proves nothing",
    ).toEqual(["n-ancient-1", "n-ancient-2"]);
    expect([...result.removedRecordIds].sort()).toEqual(["n-ancient-1", "n-ancient-2"]);
    expect([...doc.getMap<unknown>(DELETED_MAP_NAME).keys()].sort()).toEqual([
      "n-recent",
      "n-restored",
    ]);
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual([
      "n-live",
      "n-recent",
      "n-restored",
    ]);

    // HALF TWO — and nothing anybody can see moved.
    expect(after.canvas, "the serialized canvas changed across a compaction").toBe(before.canvas);
    expect(after.nodeIds).toEqual(before.nodeIds);
    expect(after.edgeIds).toEqual(before.edgeIds);
    expect(after.meta).toEqual(before.meta);

    await lifecycle.destroy();
  });

  it("the dangling edge stays invisible after its endpoint record is gone", async () => {
    // `e-dangling` points at a node that was suppressed and has now been
    // physically removed. `buildCanvasData` prunes an edge whose endpoint is not
    // in `visibleNodeIds`, and an absent key is not visible — so the edge stays
    // pruned. An implementation that "helpfully" cleaned up dangling edges, or
    // one that removed the node's tombstone only, changes this.
    const io = createSidecarIO(createTrace());
    const doc = loadedBoard();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(observableState(doc).edgeIds).toEqual(["e-live"]);
    // The edge RECORD is still there — the compaction collects tombstoned
    // records, not everything that has become unreachable.
    expect([...doc.getMap<Y.Map<unknown>>("edges").keys()].sort()).toEqual([
      "e-dangling",
      "e-live",
    ]);

    await lifecycle.destroy();
  });

  it("a replica rebuilt from the compacted sidecar sees the same thing", async () => {
    // The property that makes the compaction safe to run at all: what the NEXT
    // session reconstructs is what this session was looking at. A compaction can
    // leave the live doc perfect and still write a checkpoint taken before its
    // own removals — the ordering error nothing else here would catch.
    const io = createSidecarIO(createTrace());
    const store = createSidecarStore(io);
    const doc = loadedBoard();
    const lifecycle = createSidecarLifecycle(store, { horizonTicks: HORIZON });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    const before = observableState(doc);
    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    const replica = new Y.Doc();
    const load = await store.load(FIXED_GUID, replica);
    expect(load.degradation).toBe("none");

    const rebuilt = observableState(replica);
    expect(rebuilt.canvas, "the reloaded replica does not match what was compacted").toBe(
      before.canvas,
    );
    expect(rebuilt.meta).toEqual(before.meta);
    // And the checkpoint carries the POST-removal state, not the pre-removal one.
    expect([...replica.getMap<unknown>(DELETED_MAP_NAME).keys()].sort()).toEqual([
      "n-recent",
      "n-restored",
    ]);

    await lifecycle.destroy();
  });

  it("compacting twice is a no-op the second time, and still changes nothing", async () => {
    // Idempotence. A second compaction has nothing beyond the horizon left to
    // collect (the newest stamp did not move), so it must collect nothing and
    // must still not disturb the projection.
    const io = createSidecarIO(createTrace());
    const doc = loadedBoard();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();
    const afterFirst = observableState(doc);

    const second = await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(second.removedTombstoneIds).toEqual([]);
    expect(second.removedRecordIds).toEqual([]);
    expect(observableState(doc)).toEqual(afterFirst);

    await lifecycle.destroy();
  });

  it("the removals land in ONE transaction, before the checkpoint is written", async () => {
    // Two claims at once, both structural:
    //   ├── one transaction — N transactions means N deltas on the wire and N
    //   │   intermediate states a peer can observe, one of which has a record
    //   │   with no tombstone (i.e. RESURRECTED) if the order inside is wrong;
    //   └── removals BEFORE the checkpoint — otherwise the checkpoint preserves
    //       exactly the tombstones the compaction just collected and the next
    //       load brings them all back.
    const io = createSidecarIO(createTrace());
    const doc = loadedBoard();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    const transactions: string[][] = [];
    const observed: string[] = [];
    doc.on("afterTransaction", () => {
      transactions.push([...doc.getMap<unknown>(DELETED_MAP_NAME).keys()].sort());
      observed.push("transaction");
    });
    const ioMarks: string[] = [];
    const originalWrite = io.write;
    io.write = async (path: string, data: Uint8Array) => {
      ioMarks.push("write");
      observed.push("write");
      return originalWrite(path, data);
    };

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(transactions.length, "the removals were not one atomic transaction").toBe(1);
    expect(observed.indexOf("transaction")).toBeLessThan(observed.indexOf("write"));
    expect(ioMarks.length).toBeGreaterThanOrEqual(1);

    await lifecycle.destroy();
  });
});
