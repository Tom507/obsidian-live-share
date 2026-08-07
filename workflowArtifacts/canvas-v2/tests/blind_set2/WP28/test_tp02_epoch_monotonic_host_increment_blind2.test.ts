// WP28 / AC1 blind2 — monotonicity across the LIFECYCLE the mechanism actually
// lives in: bump, conflict, adopt, bump again.
//
// Different angle: neither the visible probe nor blind1 exercises a bump that
// follows an ADOPTION. That is the sequence WP30 will produce in the field — the
// host imports from file (epoch++), a peer adopts, the peer's user later imports
// their own version (epoch++ again from the adopted value) — and it is where a
// plausible implementation loses monotonicity: if the adoption writes the
// winner's epoch anywhere other than the doc's own cell, the next bump computes
// from the pre-adoption value and produces an epoch that has already been used.
// Two different boards then circulate under one epoch, and the rule that is
// supposed to order them cannot.
//
// The second attack is on EXCLUSIVITY of the write: the bump must be observable
// as one `meta` change and must not disturb the record containers, checked here
// through container-level observers rather than by comparing snapshots.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  bumpEpoch,
  readEpoch,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "design/system.canvas";

function makeBoard(epoch: unknown, ids: readonly string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    if (epoch !== undefined) doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const id of ids) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
    }
  });
  return doc;
}

const quietEnv = {
  serializeDoc: () => "{}",
  writeConflictCopy: async () => {},
  notify: () => {},
  today: () => "2026-06-06",
  logger: { debug: () => {}, warn: () => {} },
};

describe("WP28 AC1 blind2 — the epoch stays monotonic across adoptions", () => {
  it("bump -> adopt -> bump never reuses a value", async () => {
    const peer = makeBoard(1, ["mine"]);
    const seen: number[] = [readEpoch(peer)];

    expect(bumpEpoch(peer)).toBe(2);
    seen.push(readEpoch(peer));

    const host = makeBoard(9, ["theirs"]);
    await resolveEpochConflict({ doc: peer, winner: host, canvasPath: BOARD, env: quietEnv });
    seen.push(readEpoch(peer));

    const afterAdoption = bumpEpoch(peer);
    seen.push(afterAdoption);

    expect(
      afterAdoption,
      "the bump after an adoption computed from the PRE-adoption epoch — two different " +
        "boards now circulate under one epoch and the rule cannot order them",
    ).toBe(10);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `step ${i} of ${JSON.stringify(seen)}`).toBeGreaterThan(seen[i - 1]);
    }
    peer.destroy();
    host.destroy();
  });

  it("a five-round import/adopt cycle is strictly increasing throughout", async () => {
    const peer = makeBoard(0, ["a"]);
    const observed: number[] = [readEpoch(peer)];
    for (let round = 1; round <= 5; round++) {
      bumpEpoch(peer);
      observed.push(readEpoch(peer));
      const host = makeBoard(readEpoch(peer) + round, [`h${round}`]);
      await resolveEpochConflict({ doc: peer, winner: host, canvasPath: BOARD, env: quietEnv });
      observed.push(readEpoch(peer));
      host.destroy();
    }
    for (let i = 1; i < observed.length; i++) {
      expect(observed[i], `${JSON.stringify(observed)}`).toBeGreaterThan(observed[i - 1]);
    }
    peer.destroy();
  });

  it("a losing adoption never LOWERS the epoch, even from a much older winner", async () => {
    const peer = makeBoard(50, ["mine"]);
    const older = makeBoard(3, ["theirs"]);

    await resolveEpochConflict({ doc: peer, winner: older, canvasPath: BOARD, env: quietEnv });

    expect(
      readEpoch(peer),
      "meeting an older replica moved the epoch backwards — every peer would then " +
        "re-adopt the state this replica had already superseded",
    ).toBe(50);
    peer.destroy();
    older.destroy();
  });

  it("the bump touches `meta` and does not fire the record observers", () => {
    const doc = makeBoard(4, ["a", "b", "c"]);
    let metaChanges = 0;
    let nodeChanges = 0;
    let edgeChanges = 0;
    doc.getMap<unknown>(META_MAP_NAME).observe(() => {
      metaChanges += 1;
    });
    doc.getMap<Y.Map<unknown>>("nodes").observeDeep(() => {
      nodeChanges += 1;
    });
    doc.getMap<Y.Map<unknown>>("edges").observeDeep(() => {
      edgeChanges += 1;
    });

    bumpEpoch(doc);

    expect(metaChanges).toBe(1);
    expect(nodeChanges, "the bump disturbed the records").toBe(0);
    expect(edgeChanges).toBe(0);
    doc.destroy();
  });

  it("the bump's return value and the doc's cell never disagree", () => {
    const doc = makeBoard(undefined, ["a"]);
    for (let i = 0; i < 8; i++) {
      const returned = bumpEpoch(doc);
      expect(doc.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY), `round ${i}`).toBe(returned);
      expect(readEpoch(doc)).toBe(returned);
    }
    expect(readEpoch(doc)).toBe(8);
    doc.destroy();
  });

  it("the epoch written by a bump is a plain number, storable and readable by a peer", () => {
    const doc = makeBoard(2, ["a"]);
    bumpEpoch(doc);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

    expect(peer.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY)).toBe(3);
    expect(typeof peer.getMap<unknown>(META_MAP_NAME).get(EPOCH_KEY)).toBe("number");
    expect(readEpoch(peer)).toBe(3);
    doc.destroy();
    peer.destroy();
  });
});
