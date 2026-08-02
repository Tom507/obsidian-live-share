// WP25 / AC3 (horizon half) — "physically removes tombstones with `on:true`
// older than the compaction horizon".
//
// THE HORIZON IS IN LAMPORT TICKS, AND THAT IS NOT A DETAIL. `TombstoneEntry.t`
// is a Lamport counter produced by `nextTombstoneTime(deletedMap)` — "one above
// the highest stamp in the container" — and WP12's own header says in as many
// words that it "never reads a clock", because two hosts' wall clocks disagree
// and a merge that leaned on them would converge differently per machine. A
// horizon expressed in milliseconds would be comparing a Lamport stamp to a
// duration: it would type-check, it would look reasonable, and it would garbage
// collect a different set of tombstones on every peer. Hence the tunable's name
// carries its unit: `SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS`.
//
// THE RULE, PINNED EXACTLY (this is what the coder implements and what these
// assertions read):
//
//     newest := max(entry.t) over the container, or 0 when it is empty
//     an entry is BEYOND THE HORIZON  iff  entry.on === true
//                                     and  entry.t + horizonTicks <= newest
//
// and a beyond-the-horizon entry is removed TOGETHER WITH the record it
// suppresses. Removing the tombstone alone RESURRECTS the record — the tombstone
// is the only thing suppressing it — which is the single most likely wrong
// implementation of this AC and the reason the record's absence is asserted
// beside the tombstone's.
//
// PRODUCTION LINE ↔ ASSERTION: reddened by the `deletedMap.delete(id)` +
// `nodesMap.delete(id)` pair in the compaction's transaction (drop either one,
// or drop the `entry.on === true` conjunct, or drop the horizon comparison).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { createSidecarStore } from "../../../files/canvas-sidecar";
import {
  SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS,
  createSidecarLifecycle,
} from "../../../files/canvas-sidecar-lifecycle";
import { DELETED_MAP_NAME, nextTombstoneTime } from "../../../files/canvas-sync";
import {
  FIXED_GUID,
  createSidecarIO,
  createTrace,
  seedRecord,
  writeTombstone,
} from "./harness";

const HORIZON = 10;

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/**
 * A board with four ids whose tombstone ages straddle the horizon:
 *
 *   n-ancient  on:true   t=1    → beyond the horizon  → removed
 *   n-recent   on:true   t=100  → inside the horizon  → kept
 *   n-undone   on:false  t=2    → old but NOT deleted → kept, and still visible
 *   n-live     (none)           → no tombstone at all → untouched
 *
 * `newest` is 100, so with `horizonTicks: 10` the boundary sits at t <= 90.
 */
function board(horizonTicks = HORIZON): { doc: Y.Doc; horizonTicks: number } {
  const doc = new Y.Doc();
  for (const id of ["n-ancient", "n-recent", "n-undone", "n-live"]) {
    seedRecord(doc, "nodes", { id, type: "text", x: 0, y: 0, width: 10, height: 10, text: id });
  }
  writeTombstone(doc, "n-ancient", { t: 1, by: "peer-a", on: true });
  writeTombstone(doc, "n-undone", { t: 2, by: "peer-a", on: false });
  writeTombstone(doc, "n-recent", { t: 100, by: "peer-b", on: true });
  return { doc, horizonTicks };
}

function tombstoneIds(doc: Y.Doc): string[] {
  return [...doc.getMap<unknown>(DELETED_MAP_NAME).keys()].sort();
}

function nodeIds(doc: Y.Doc): string[] {
  return [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort();
}

describe("WP25 AC3 — tombstones beyond the horizon are physically removed", () => {
  it("the horizon tunable is Lamport ticks, and the fixture straddles it", () => {
    expect(Number.isInteger(SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS)).toBe(true);
    const { doc } = board();
    // `nextTombstoneTime` is "highest + 1", so the highest stamp is one below.
    expect(nextTombstoneTime(doc.getMap<unknown>(DELETED_MAP_NAME)) - 1).toBe(100);
    doc.destroy();
  });

  it("an `on:true` tombstone beyond the horizon goes, and takes its record with it", async () => {
    const io = createSidecarIO(createTrace());
    const { doc, horizonTicks } = board();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    const result = await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(result.removedTombstoneIds).toEqual(["n-ancient"]);
    expect(readTombstoneEntry(doc.getMap<unknown>(DELETED_MAP_NAME), "n-ancient")).toBeUndefined();
    // BOTH halves. Removing the tombstone alone puts the card straight back on
    // the user's screen, because the tombstone was the only thing hiding it.
    expect(
      result.removedRecordIds,
      "the tombstone was removed but its record was left behind — the record resurrects",
    ).toEqual(["n-ancient"]);
    expect(nodeIds(doc)).toEqual(["n-live", "n-recent", "n-undone"]);

    await lifecycle.destroy();
  });

  it("an `on:true` tombstone INSIDE the horizon is kept, record included", async () => {
    // The discriminating half. Without it, "remove every tombstone" passes.
    const io = createSidecarIO(createTrace());
    const { doc, horizonTicks } = board();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    const kept = readTombstoneEntry(doc.getMap<unknown>(DELETED_MAP_NAME), "n-recent");
    expect(kept, "a recent tombstone was collected").toBeDefined();
    expect(kept?.on).toBe(true);
    expect(nodeIds(doc)).toContain("n-recent");

    await lifecycle.destroy();
  });

  it("an `on:false` tombstone is never collected, however old", async () => {
    // `on:false` is an UNDO. Collecting it would delete a record the user
    // restored — the tombstone says "visible" and the record is real.
    const io = createSidecarIO(createTrace());
    const { doc, horizonTicks } = board();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    const result = await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(result.removedTombstoneIds).not.toContain("n-undone");
    expect(readTombstoneEntry(doc.getMap<unknown>(DELETED_MAP_NAME), "n-undone")?.on).toBe(false);
    expect(
      nodeIds(doc),
      "a restored record was deleted by the tombstone GC",
    ).toContain("n-undone");

    await lifecycle.destroy();
  });

  it("a record with no tombstone at all is untouched", async () => {
    const io = createSidecarIO(createTrace());
    const { doc, horizonTicks } = board();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(nodeIds(doc)).toContain("n-live");
    expect(tombstoneIds(doc)).not.toContain("n-live");

    await lifecycle.destroy();
  });

  it("a suppressed EDGE beyond the horizon is collected the same way", async () => {
    // Tombstones are id-keyed across both id spaces (WP12). A collector that
    // only ever looked in `nodes` would leave the edge's tombstone dangling and
    // the edge would come back.
    const io = createSidecarIO(createTrace());
    const doc = new Y.Doc();
    seedRecord(doc, "nodes", { id: "n-1", type: "text", text: "one" });
    seedRecord(doc, "nodes", { id: "n-2", type: "text", text: "two" });
    seedRecord(doc, "edges", { id: "e-old", fromNode: "n-1", toNode: "n-2" });
    writeTombstone(doc, "e-old", { t: 1, by: "peer-a", on: true });
    writeTombstone(doc, "n-1", { t: 100, by: "peer-b", on: false });

    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    const result = await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(result.removedTombstoneIds).toEqual(["e-old"]);
    expect([...doc.getMap<Y.Map<unknown>>("edges").keys()]).toEqual([]);
    expect(nodeIds(doc)).toEqual(["n-1", "n-2"]);

    await lifecycle.destroy();
  });

  it("nothing is collected when every tombstone is inside the horizon", async () => {
    // The whole-compaction no-op case, and the reason `removedTombstoneIds` is
    // reported rather than inferred: a compaction that collected nothing is a
    // legitimate outcome, and it must be distinguishable from one that failed.
    const io = createSidecarIO(createTrace());
    const doc = new Y.Doc();
    seedRecord(doc, "nodes", { id: "n-1", type: "text", text: "one" });
    writeTombstone(doc, "n-1", { t: 7, by: "peer-a", on: true });

    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    lifecycle.attach(FIXED_GUID, doc);
    await settle();

    const result = await lifecycle.compact(FIXED_GUID, doc);
    await settle();

    expect(result.removedTombstoneIds).toEqual([]);
    expect(result.removedRecordIds).toEqual([]);
    expect(result.horizonTicks).toBe(HORIZON);
    // A no-op collection is still a compaction: the checkpoint was written.
    expect(result.checkpointWritten).toBe(true);
    expect(tombstoneIds(doc)).toEqual(["n-1"]);

    await lifecycle.destroy();
  });
});
