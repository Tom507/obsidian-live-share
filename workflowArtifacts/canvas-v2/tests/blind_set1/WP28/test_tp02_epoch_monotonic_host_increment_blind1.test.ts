// WP28 / AC1 blind1 — monotonicity attacked as a SEQUENCE PROPERTY over an
// interleaved history, rather than as a single bump.
//
// Different angle: drive a long alternating run of bumps and Yjs round trips
// (encode → decode into a fresh doc → bump again), and assert the epoch is
// strictly increasing across the WHOLE run. A doc in this system is regularly
// reconstructed from an update stream — that is what the sidecar replay and the
// relay handshake both do — so an implementation whose monotonicity depends on
// in-memory state rather than on the doc's own cell decreases the moment the doc
// is rebuilt, and no single-bump test can see that.
//
// The second attack is on HOST-INCREMENT as an exclusive claim: the bump must
// write the epoch and NOTHING else, including on a doc carrying a large record
// population, because the cheapest wrong implementation of "host-incremented" is
// a re-seed that happens to also raise the epoch.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { bumpEpoch, nextEpoch, readEpoch } from "../../../../../plugin/src/canvas/canvas-epoch";
import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";

const GUID = "aa11bb22cc33dd44ee55ff6677889900";
const PATH = "vault/rooms/kickoff.canvas";

function docWith(recordCount: number, epoch?: unknown): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, GUID);
    meta.set(PATH_KEY, PATH);
    if (epoch !== undefined) meta.set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (let i = 0; i < recordCount; i++) {
      const record = new Y.Map<unknown>();
      nodes.set(`card-${i}`, record);
      record.set("id", `card-${i}`);
      record.set("type", "text");
      record.set("text", `card body ${i}`);
    }
  });
  return doc;
}

function roundTrip(doc: Y.Doc): Y.Doc {
  const rebuilt = new Y.Doc();
  Y.applyUpdate(rebuilt, Y.encodeStateAsUpdate(doc));
  return rebuilt;
}

function nodeSnapshot(doc: Y.Doc): string {
  const out: Record<string, unknown> = {};
  for (const [id, record] of doc.getMap<Y.Map<unknown>>("nodes")) out[id] = record.toJSON();
  return JSON.stringify(out);
}

describe("WP28 AC1 blind1 — the epoch never decreases across a rebuilt history", () => {
  it("bump → round trip → bump, twelve times, is strictly increasing", () => {
    let doc = docWith(3, 0);
    const observed: number[] = [readEpoch(doc)];
    for (let round = 0; round < 12; round++) {
      bumpEpoch(doc);
      const rebuilt = roundTrip(doc);
      doc.destroy();
      doc = rebuilt;
      const now = readEpoch(doc);
      expect(
        now,
        `round ${round}: the epoch fell from ${observed[observed.length - 1]} to ${now} ` +
          "after the doc was rebuilt from its own update stream",
      ).toBeGreaterThan(observed[observed.length - 1]);
      observed.push(now);
    }
    expect(observed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    doc.destroy();
  });

  it("`nextEpoch` agrees with what a bump actually writes, at every step", () => {
    const doc = docWith(2, 5);
    for (let i = 0; i < 6; i++) {
      const predicted = nextEpoch(readEpoch(doc));
      const written = bumpEpoch(doc);
      expect(written, `step ${i}`).toBe(predicted);
      expect(readEpoch(doc)).toBe(predicted);
    }
    doc.destroy();
  });

  it("a bump on a 200-record board changes no record", () => {
    const doc = docWith(200, 3);
    const before = nodeSnapshot(doc);

    bumpEpoch(doc);

    expect(
      nodeSnapshot(doc),
      "the bump rewrote the records — a re-seed that happens to raise the epoch is not " +
        "a host increment",
    ).toBe(before);
    expect(doc.getMap<Y.Map<unknown>>("nodes").size).toBe(200);
    expect(readEpoch(doc)).toBe(4);
    doc.destroy();
  });

  it("the bump leaves `guid` and `path` untouched on a large board", () => {
    const doc = docWith(50, 1);
    bumpEpoch(doc);
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    expect(meta.get(GUID_KEY)).toBe(GUID);
    expect(meta.get(PATH_KEY)).toBe(PATH);
    expect([...meta.keys()].sort()).toEqual([EPOCH_KEY, GUID_KEY, PATH_KEY].sort());
    doc.destroy();
  });

  it("two bumps in a row on the SAME doc land two apart, never one", () => {
    const doc = docWith(1, 10);
    const first = bumpEpoch(doc);
    const second = bumpEpoch(doc);
    expect(first).toBe(11);
    expect(second).toBe(12);
    expect(second - first).toBe(1);
    doc.destroy();
  });

  it("a doc whose epoch cell was corrupted mid-life recovers to a live sequence", () => {
    const doc = docWith(2, 6);
    doc.transact(() => {
      doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, "corrupted");
    });
    expect(readEpoch(doc)).toBe(0);
    expect(bumpEpoch(doc)).toBe(1);
    expect(bumpEpoch(doc)).toBe(2);
    expect(readEpoch(doc)).toBe(2);
    doc.destroy();
  });
});
