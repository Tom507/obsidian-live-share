// WP29 / AC3 — "A host rejoining with an older local file does not remove any
// peer's records." This is the DATA-LOSS test and the R4 regression pin.
//
// THE FIXTURE IS BUILT SO THE PEER RECORDS ARE GENUINELY ABSENT from the host's
// file. That is the whole difficulty of this AC: it is easy to write a version
// in which the host's file happens to mention every record, and such a test
// passes against the fully destructive implementation, because there is then
// nothing in `absentFromFile` to delete.
//
// THREE REPLICAS, NOT TWO. The charter forbids reasoning from two peers: with
// two, "the host's file wins" and "the newer state wins" are indistinguishable,
// because there is only ever one other side. With three, the host's stale file
// is a minority of one against two independently-authored sets of records, and
// an implementation that removes "everything my file does not mention" loses
// BOTH — which is visible as a set difference rather than as a single missing id.
//
// THE FILE IS STRICTLY OLDER: it is the board exactly as it stood at T0, before
// either peer drew anything. The host has been offline since. Nothing was added
// to the file, so the only way its content can change the board is by REMOVING.
//
// WHAT IS *NOT* CLAIMED HERE. The host's file still upserts the KEYS it does
// mention, so `orig-1`'s text goes back to the host's older value. That is
// WP18's upsert boundary, it is pinned by WP18 tp06, and it is deliberately
// unchanged by WP29 — a stale key value is a visible, self-correcting
// staleness, whereas a removed record is silent, shared and permanent. AC3 is
// about RECORDS. It is asserted below so the difference is on the record rather
// than left to be inferred from silence.
//
// CRDT DISCIPLINE: no value asserted here is the result of a concurrent same-key
// write. The two peers author DISJOINT ids, and the host's seed runs strictly
// after their state has arrived, so every asserted value has a causal
// predecessor chain rather than a `clientID` coin flip.
//
// PRODUCTION LINE <-> ASSERTION: the record-level delete-by-omission reached
// from `subscribe(path, "host")`. Restoring it removes `b-1`, `c-1` and
// `c-edge` from the host replica, and the removal then propagates to both peers
// — which the convergence block at the end measures directly.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasSync, canvasDocId } from "../../../files/canvas-sync";
import {
  CANVAS_PATH,
  canvasJson,
  createFileOps,
  createSyncManager,
  createVault,
  edge,
  fieldsOf,
  suppressed,
  surviving,
  textNode,
} from "./harness";

// ── T0: the board as the host last saw it, and as its `.canvas` file still is ──
const ORIG_1 = textNode("orig-1", 0, "kickoff");
const ORIG_2 = textNode("orig-2", 300, "scope");
const ORIG_EDGE = edge("orig-edge", "orig-1", "orig-2");
const HOST_FILE_AT_T0 = canvasJson([ORIG_1, ORIG_2], [ORIG_EDGE]);

// ── after T0: two peers each draw their own, disjoint, additions ──────────────
const B_NODE = textNode("b-1", 600, "peer B's card");
const C_NODE = textNode("c-1", 900, "peer C's card");
const C_EDGE = edge("c-edge", "orig-2", "c-1");

function write(doc: Y.Doc, kind: "nodes" | "edges", source: Record<string, unknown>): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>(kind).set(String(source.id), record);
    for (const [k, v] of Object.entries(source)) record.set(k, v);
  });
}

function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from));
}

/**
 * Three replicas of one board. `a` is the host's, and it is the one the
 * `CanvasSync` under test is wired to; `b` and `c` are the peers'.
 */
function threeReplicas() {
  const vault = createVault({ [CANVAS_PATH]: HOST_FILE_AT_T0 });
  const manager = createSyncManager();
  const a = manager.getDoc(canvasDocId(CANVAS_PATH)).doc;

  // T0 state, authored once and shared, so all three have the same history.
  write(a, "nodes", ORIG_1);
  write(a, "nodes", ORIG_2);
  write(a, "edges", ORIG_EDGE);
  const b = new Y.Doc();
  const c = new Y.Doc();
  sync(a, b);
  sync(a, c);

  // The two peers draw, independently, on disjoint ids.
  write(b, "nodes", B_NODE);
  write(c, "nodes", C_NODE);
  write(c, "edges", C_EDGE);
  // A peer also moves `orig-1`'s text on. The host's file still says "kickoff".
  b.transact(() => {
    b.getMap<Y.Map<unknown>>("nodes").get("orig-1")?.set("text", "kickoff (revised by B)");
  });

  // Both peers' state reaches the host's replica before it rejoins.
  sync(b, a);
  sync(c, a);
  sync(b, c);
  sync(c, b);

  return { vault, manager, a, b, c };
}

async function rejoinAsHost(vault: unknown, manager: unknown): Promise<CanvasSync> {
  const canvasSync = new CanvasSync(vault as never, manager as never, createFileOps() as never);
  canvasSync.setLogger({ debug: () => {}, warn: () => {} });
  await canvasSync.subscribe(CANVAS_PATH, "host");
  return canvasSync;
}

describe("WP29 AC3 — a host rejoining with an older file removes no peer record", () => {
  it("both peers' records survive the rejoin", async () => {
    const { vault, manager, a } = threeReplicas();
    const before = surviving(a);
    expect(before.nodes.sort(), "the fixture did not assemble the shared board").toEqual([
      "b-1",
      "c-1",
      "orig-1",
      "orig-2",
    ]);

    const canvasSync = await rejoinAsHost(vault, manager);

    const after = surviving(a);
    expect(after.nodes.sort(), "the rejoining host deleted a peer's card (R4)").toEqual([
      "b-1",
      "c-1",
      "orig-1",
      "orig-2",
    ]);
    expect(after.edges.sort(), "the rejoining host deleted a peer's edge (R4)").toEqual([
      "c-edge",
      "orig-edge",
    ]);

    canvasSync.destroy();
  });

  it("survival is real, not a tombstone — and the records keep their contents", async () => {
    const { vault, manager, a } = threeReplicas();
    const canvasSync = await rejoinAsHost(vault, manager);

    for (const id of ["b-1", "c-1", "c-edge"]) {
      expect(suppressed(a, id), `the rejoin TOMBSTONED ${id} instead of deleting it`).toBe(false);
    }
    expect(fieldsOf(a, "nodes", "b-1")).toMatchObject({ id: "b-1", text: "peer B's card" });
    expect(fieldsOf(a, "nodes", "c-1")).toMatchObject({ id: "c-1", text: "peer C's card" });
    expect(fieldsOf(a, "edges", "c-edge")).toMatchObject({
      id: "c-edge",
      fromNode: "orig-2",
      toNode: "c-1",
    });

    canvasSync.destroy();
  });

  it("the seed genuinely ran — the older file's KEY values did land", async () => {
    // Non-vacuity, and the honest statement of what WP29 does NOT change: the
    // host's file is still an upsert of the keys it mentions (WP18 tp06), so
    // `orig-1` goes back to the host's older text. A stale key is visible and
    // self-correcting; a removed record is not. Without this assertion, an
    // implementation that simply deleted the host seed passes every survival
    // check in this file.
    const { vault, manager, a } = threeReplicas();
    expect(fieldsOf(a, "nodes", "orig-1")?.text).toBe("kickoff (revised by B)");

    const canvasSync = await rejoinAsHost(vault, manager);

    expect(
      fieldsOf(a, "nodes", "orig-1")?.text,
      "the host seed did not run at all — nothing from the file reached the doc",
    ).toBe("kickoff");

    canvasSync.destroy();
  });

  it("the rejoin does not propagate a removal to either peer", async () => {
    // The blast radius. A record removed on the host is removed EVERYWHERE the
    // moment the host's update ships — which is the difference between "my file
    // looks wrong" and "two other people lost work".
    const { vault, manager, a, b, c } = threeReplicas();
    const canvasSync = await rejoinAsHost(vault, manager);

    sync(a, b);
    sync(a, c);

    for (const [name, doc] of [
      ["peer B", b],
      ["peer C", c],
    ] as const) {
      const seen = surviving(doc);
      expect(seen.nodes.sort(), `${name} lost a record when the host rejoined`).toEqual([
        "b-1",
        "c-1",
        "orig-1",
        "orig-2",
      ]);
      expect(seen.edges.sort(), `${name} lost an edge when the host rejoined`).toEqual([
        "c-edge",
        "orig-edge",
      ]);
    }

    canvasSync.destroy();
  });

  it("all three replicas converge on the same board", async () => {
    // Convergence is not correctness — three replicas agreeing on a board that
    // lost two cards converge perfectly. So this is asserted TOGETHER with
    // membership, never instead of it.
    const { vault, manager, a, b, c } = threeReplicas();
    const canvasSync = await rejoinAsHost(vault, manager);

    for (let round = 0; round < 2; round++) {
      sync(a, b);
      sync(b, c);
      sync(c, a);
      sync(a, c);
      sync(c, b);
      sync(b, a);
    }

    const boards = [a, b, c].map((doc) => surviving(doc));
    expect(boards[1]).toEqual(boards[0]);
    expect(boards[2]).toEqual(boards[0]);
    expect(boards[0].nodes.sort()).toEqual(["b-1", "c-1", "orig-1", "orig-2"]);
    expect(boards[0].edges.sort()).toEqual(["c-edge", "orig-edge"]);

    canvasSync.destroy();
  });

  it("a host whose file is EMPTY still removes nothing from the two peers", async () => {
    // The extreme of "older": the host's `.canvas` was truncated, or the board
    // was created after the file was last written. Every peer record is then
    // absent from the file, so this is the maximal blast radius of the removed
    // behaviour.
    const { vault, manager, a, b, c } = threeReplicas();
    vault.files.set(CANVAS_PATH, canvasJson([], []));

    const canvasSync = await rejoinAsHost(vault, manager);
    sync(a, b);
    sync(a, c);

    for (const doc of [a, b, c]) {
      expect(surviving(doc).nodes.sort(), "an empty host file wiped the shared board").toEqual([
        "b-1",
        "c-1",
        "orig-1",
        "orig-2",
      ]);
    }

    canvasSync.destroy();
  });
});
