// WP25 / AC3 blind1 (horizon half) — the BOUNDARY, one Lamport tick at a time.
//
// Different angle from the visible test, which uses a scattered fixture and
// checks membership. This one drives the boundary itself: a table of stamps that
// sits exactly on, one tick inside, and one tick outside the horizon. Off-by-one
// is the defect class this rule is most likely to ship with, and a scattered
// fixture cannot see it — every id in it is far from the edge.
//
// THE RULE UNDER TEST, restated:
//
//     newest := max(entry.t)
//     collect iff  entry.on === true  AND  entry.t + horizonTicks <= newest
//
// so with `newest = 100` and `horizonTicks = 10` the last collected stamp is 90
// and the first surviving one is 91.
//
// The horizon is LAMPORT TICKS. `TombstoneEntry.t` comes from
// `nextTombstoneTime` — "one above the highest stamp in the container" — and
// WP12 never reads a clock. A millisecond horizon would compare a counter to a
// duration and would collect a different set on every peer.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  isTombstoneQuarantined,
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
  nextTombstoneTime,
} from "../../../../../plugin/src/files/canvas-sync";

const GUID = "2b6dc4813f0e47a59c8d1e07ba53f92c";
const HORIZON = 10;
const NEWEST = 100;

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

/**
 * One record per stamp. `n-anchor` carries the newest stamp so the boundary is
 * fixed at `NEWEST - HORIZON = 90`, and it is `on:false` so the anchor itself is
 * never a candidate for collection and cannot confuse the table.
 */
function boundaryBoard(): Y.Doc {
  const doc = new Y.Doc();
  const stamps = [88, 89, 90, 91, 92];
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
    for (const t of stamps) {
      const id = `n-t${t}`;
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("type", "text");
      record.set("text", `stamp ${t}`);
      deleted.set(id, { t, by: "peer-a", on: true });
    }
    const anchor = new Y.Map<unknown>();
    nodes.set("n-anchor", anchor);
    anchor.set("id", "n-anchor");
    anchor.set("type", "text");
    deleted.set("n-anchor", { t: NEWEST, by: "peer-z", on: false });
  });
  return doc;
}

describe("WP25 AC3 blind1 — the horizon boundary, tick by tick", () => {
  it("the fixture really does sit on the boundary (premise)", () => {
    const doc = boundaryBoard();
    expect(nextTombstoneTime(doc.getMap<unknown>(DELETED_MAP_NAME)) - 1).toBe(NEWEST);
    expect(NEWEST - HORIZON).toBe(90);
    doc.destroy();
  });

  it("t=88, 89 and 90 are collected; t=91 and 92 are not", async () => {
    const doc = boundaryBoard();
    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      horizonTicks: HORIZON,
    });
    lifecycle.attach(GUID, doc);
    await settle();

    const result = await lifecycle.compact(GUID, doc);
    await settle();

    expect(
      [...result.removedTombstoneIds].sort(),
      "the horizon boundary is off by at least one tick",
    ).toEqual(["n-t88", "n-t89", "n-t90"]);
    expect([...result.removedRecordIds].sort()).toEqual(["n-t88", "n-t89", "n-t90"]);

    const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
    expect([...deleted.keys()].sort()).toEqual(["n-anchor", "n-t91", "n-t92"]);
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual([
      "n-anchor",
      "n-t91",
      "n-t92",
    ]);

    await lifecycle.destroy();
  });

  it("the survivors keep their exact entries, byte for byte", async () => {
    // A collector that rewrote the survivors — normalising them, restamping
    // them, "tidying" them — would emit deltas that lose to a peer's older op
    // and would move the boundary on the next run.
    const doc = boundaryBoard();
    const before = new Map<string, unknown>();
    for (const id of ["n-t91", "n-t92", "n-anchor"]) {
      before.set(id, readTombstoneEntry(doc.getMap<unknown>(DELETED_MAP_NAME), id));
    }

    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      horizonTicks: HORIZON,
    });
    lifecycle.attach(GUID, doc);
    await settle();
    await lifecycle.compact(GUID, doc);
    await settle();

    for (const id of ["n-t91", "n-t92", "n-anchor"]) {
      expect(readTombstoneEntry(doc.getMap<unknown>(DELETED_MAP_NAME), id)).toEqual(
        before.get(id),
      );
    }

    await lifecycle.destroy();
  });

  it("a QUARANTINE beyond the horizon is collected like any other suppression", async () => {
    // `q:true` is a classification of an already-suppressed record (WP12), not a
    // second suppression rule. A collector that keyed on "user delete" would
    // leave every auditor-raised quarantine behind forever.
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
      for (const id of ["n-quarantined", "n-fresh"]) {
        const record = new Y.Map<unknown>();
        nodes.set(id, record);
        record.set("id", id);
        record.set("type", "text");
      }
      deleted.set("n-quarantined", { t: 1, by: "auditor", on: true, q: true });
      deleted.set("n-fresh", { t: NEWEST, by: "peer-a", on: true });
    });

    expect(
      isTombstoneQuarantined(readTombstoneEntry(doc.getMap<unknown>(DELETED_MAP_NAME), "n-quarantined")),
    ).toBe(true);

    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      horizonTicks: HORIZON,
    });
    lifecycle.attach(GUID, doc);
    await settle();
    const result = await lifecycle.compact(GUID, doc);
    await settle();

    expect(result.removedTombstoneIds).toEqual(["n-quarantined"]);
    expect(
      isTombstoneSuppressed(readTombstoneEntry(doc.getMap<unknown>(DELETED_MAP_NAME), "n-fresh")),
    ).toBe(true);

    await lifecycle.destroy();
  });

  it("an empty tombstone container collects nothing and still checkpoints", async () => {
    // `newest` is 0 here. An implementation that computed `newest - horizon`
    // without guarding the empty case gets a negative boundary and, depending on
    // how it compares, either collects everything or throws.
    const doc = new Y.Doc();
    doc.transact(() => {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set("n-1", record);
      record.set("id", "n-1");
      record.set("type", "text");
    });

    const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
      horizonTicks: HORIZON,
    });
    lifecycle.attach(GUID, doc);
    await settle();
    const result = await lifecycle.compact(GUID, doc);
    await settle();

    expect(result.removedTombstoneIds).toEqual([]);
    expect(result.removedRecordIds).toEqual([]);
    expect(result.checkpointWritten).toBe(true);
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()]).toEqual(["n-1"]);

    await lifecycle.destroy();
  });
});
