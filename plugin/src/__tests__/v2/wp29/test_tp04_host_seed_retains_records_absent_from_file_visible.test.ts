// WP29 / AC2 — "The destructive re-seed that deleted doc entries absent from the
// host's local file no longer exists; a host rejoin is an ordinary
// related-replica merge."
//
// AC2 IS A REMOVAL CLAIM, and removal claims cannot be pinned positively: "the
// destructive re-seed no longer exists" is not a thing a test can observe. What
// is observable is the BEHAVIOUR it produced, so that is what is pinned — a seed
// over a doc that already holds records is upsert-only at the RECORD level, and
// a record absent from the seed source is RETAINED.
//
// TWO FACTS ABOUT THE CURRENT TREE SHAPE THIS TEST, and neither is in the
// charter:
//
//   1. The destructive semantics are NOT in `applyCanvasToYMaps`. That method's
//      body is four statements; the record-level delete-by-omission lives in
//      `seedFlatSpace`, which it calls twice. Deleting the wrapper and leaving
//      `seedFlatSpace` destructive satisfies the charter's words and none of its
//      purpose.
//   2. `applyCanvasToYMaps` is named in no executable assertion anywhere in this
//      tree — only in header comments. Removing the method by itself retires
//      nothing.
//
// So the oracle is a DIFFERENTIAL against the seam that already has the right
// semantics. `seedRecordsIntoYMaps` is the exported COLD-OPEN seed writer, and
// its record loop has never deleted an absent id. The same fixture is pushed
// through both boundaries and the two resulting boards must be identical.
//
//   ├── `seedFlatSpace` still destructive  -> the two boards diverge, and the
//   │                                          peer-only record is missing from
//   │                                          the host arm. RED.
//   ├── wrapper deleted, nothing replaces  -> the host arm never lands the
//   │                                          file's own values and never
//   │                                          creates the file-only record. RED.
//   └── correct                            -> identical boards, peer record kept,
//                                              file values landed.
//
// The survival oracle is the PROJECTION plus an explicit tombstone check, never
// raw key presence: post-WP19 a removal instruction IS a tombstone, so a seed
// that tombstoned every omitted record would satisfy a `get(id) !== undefined`
// test completely.
//
// PRODUCTION LINE <-> ASSERTION: `CanvasSync.seedFlatSpace`'s
// `for (const id of absentFromFile) container.delete(id)` loop, reached from
// `subscribe(path, "host")`. Restoring that loop — under any name, in any method
// — reddens every assertion in this file.

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CanvasSync,
  canvasDocId,
  decodeCanvasDataToFlat,
  parseCanvas,
  seedRecordsIntoYMaps,
} from "../../../files/canvas-sync";
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

const SEED_ORIGIN: unique symbol = Symbol("wp29-differential-seed");

// The doc the host rejoins into: a card only the peers have, a card both sides
// know, and an edge only the peers have. Distinct ids on the two sides, so
// nothing in this fixture is a concurrent same-key write.
const PEER_NODE = textNode("peer-only", 600, "drawn while the host was away");
const SHARED_NODE = textNode("shared", 300, "the doc's older text");
const PEER_EDGE = edge("peer-edge", "shared", "peer-only");

// The host's file: it knows the shared card (with a newer text) and one card of
// its own. It has never heard of `peer-only` or `peer-edge`.
const HOST_FILE = canvasJson([
  { ...SHARED_NODE, text: "the host's newer text" },
  textNode("host-only", 0, "drawn on the host"),
]);

function populate(doc: Y.Doc): void {
  doc.transact(() => {
    for (const [kind, source] of [
      ["nodes", PEER_NODE],
      ["nodes", SHARED_NODE],
      ["edges", PEER_EDGE],
    ] as const) {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>(kind).set(String(source.id), record);
      for (const [k, v] of Object.entries(source)) record.set(k, v);
    }
  });
}

/** Arm A — the HOST SEED, through the only call site it has. */
async function hostSeedArm(): Promise<{ doc: Y.Doc; close: () => void }> {
  const vault = createVault({ [CANVAS_PATH]: HOST_FILE });
  const sync = createSyncManager();
  const handle = sync.getDoc(canvasDocId(CANVAS_PATH));
  populate(handle.doc);

  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  canvasSync.setLogger({ debug: () => {}, warn: () => {} });
  await canvasSync.subscribe(CANVAS_PATH, "host");
  return { doc: handle.doc, close: () => canvasSync.destroy() };
}

/** Arm B — the COLD-OPEN seed writer, which has always been record-retaining. */
function coldOpenSeedArm(): Y.Doc {
  const doc = new Y.Doc();
  populate(doc);
  seedRecordsIntoYMaps(doc, decodeCanvasDataToFlat(parseCanvas(HOST_FILE)), SEED_ORIGIN);
  return doc;
}

describe("WP29 AC2 — the seed retains records the source omits", () => {
  it("a record only the doc holds survives the host seed", async () => {
    const { doc, close } = await hostSeedArm();

    const seen = surviving(doc);
    expect(seen.nodes, "the host's file deleted a card it had never heard of (R4)").toContain(
      "peer-only",
    );
    expect(seen.edges, "the host's file deleted an edge it had never heard of (R4)").toContain(
      "peer-edge",
    );
    // ...and it was not "kept" by being tombstoned instead of dropped.
    expect(suppressed(doc, "peer-only"), "the seed TOMBSTONED the peer's card").toBe(false);
    expect(suppressed(doc, "peer-edge"), "the seed TOMBSTONED the peer's edge").toBe(false);
    // The whole record survives, not just its id.
    expect(fieldsOf(doc, "nodes", "peer-only")).toMatchObject({
      id: "peer-only",
      type: "text",
      text: "drawn while the host was away",
    });

    close();
  });

  it("the seed still RAN — the file's own values landed and its own record was created", async () => {
    // Without this, an implementation that deleted the host seed outright
    // passes every survival assertion in this file.
    const { doc, close } = await hostSeedArm();

    expect(fieldsOf(doc, "nodes", "shared")?.text, "the file's value never reached the doc").toBe(
      "the host's newer text",
    );
    expect(surviving(doc).nodes, "the file's own record was never created").toContain("host-only");

    close();
  });

  it("the host seed and the cold-open seed writer produce the SAME board", async () => {
    // The differential. `seedRecordsIntoYMaps` is the boundary whose record loop
    // has never deleted an absent id; after WP29 the two boundaries make the
    // same record-level decisions, so their projections are equal.
    const { doc: hostDoc, close } = await hostSeedArm();
    const coldDoc = coldOpenSeedArm();

    const host = surviving(hostDoc);
    const cold = surviving(coldDoc);
    expect(host.nodes.sort(), "the two seed boundaries disagree about NODES").toEqual(
      cold.nodes.sort(),
    );
    expect(host.edges.sort(), "the two seed boundaries disagree about EDGES").toEqual(
      cold.edges.sort(),
    );
    // Not vacuously equal: both really do hold all four records.
    expect(host.nodes.sort()).toEqual(["host-only", "peer-only", "shared"]);
    expect(host.edges).toEqual(["peer-edge"]);

    close();
    coldDoc.destroy();
  });

  it("a SECOND host seed over the same doc removes nothing either", async () => {
    // Re-subscribing is the rejoin the DoD is about. `subscribe` refuses a path
    // it already holds, so the second seed is reached through a fresh
    // `CanvasSync` over the same doc — which is exactly what a reload is.
    const vault = createVault({ [CANVAS_PATH]: HOST_FILE });
    const sync = createSyncManager();
    const handle = sync.getDoc(canvasDocId(CANVAS_PATH));
    populate(handle.doc);

    const first = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    first.setLogger({ debug: () => {}, warn: () => {} });
    await first.subscribe(CANVAS_PATH, "host");
    first.destroy();

    const second = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    second.setLogger({ debug: () => {}, warn: () => {} });
    await second.subscribe(CANVAS_PATH, "host");

    const seen = surviving(handle.doc);
    expect(seen.nodes.sort()).toEqual(["host-only", "peer-only", "shared"]);
    expect(seen.edges).toEqual(["peer-edge"]);
    expect(suppressed(handle.doc, "peer-only")).toBe(false);

    second.destroy();
  });

  it("an EMPTY host file removes nothing at all", async () => {
    // The limiting case, and the one an off-by-one guard gets wrong: with no
    // records in the file, `absentFromFile` was the WHOLE board.
    const vault = createVault({ [CANVAS_PATH]: canvasJson([], []) });
    const sync = createSyncManager();
    const handle = sync.getDoc(canvasDocId(CANVAS_PATH));
    populate(handle.doc);

    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    canvasSync.setLogger({ debug: () => {}, warn: () => {} });
    await canvasSync.subscribe(CANVAS_PATH, "host");

    const seen = surviving(handle.doc);
    expect(seen.nodes.sort(), "an empty file wiped the shared board").toEqual([
      "peer-only",
      "shared",
    ]);
    expect(seen.edges).toEqual(["peer-edge"]);
    expect(suppressed(handle.doc, "shared")).toBe(false);

    canvasSync.destroy();
  });

  it("the seed emits no `deleted` entries of its own", async () => {
    // The tombstone container is the only other place a removal can hide. A
    // seed that "kept" the peer's records by writing `on:false` entries, or that
    // wrote any tombstone at all, is still a seed with an opinion about
    // deletion — and it has none.
    const vault = createVault({ [CANVAS_PATH]: HOST_FILE });
    const sync = createSyncManager();
    const handle = sync.getDoc(canvasDocId(CANVAS_PATH));
    populate(handle.doc);

    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    canvasSync.setLogger({ debug: () => {}, warn: vi.fn() });
    await canvasSync.subscribe(CANVAS_PATH, "host");

    expect(
      handle.doc.getMap<unknown>("deleted").size,
      "the host seed wrote to the tombstone container",
    ).toBe(0);

    canvasSync.destroy();
  });
});
