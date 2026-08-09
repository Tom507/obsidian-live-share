// WP122 B2 — THE HEADLINE. A guest's edit reaches the HOST'S FILE, on a
// host-created board nobody opened.
//
// THE MEASUREMENT THIS ROW ENCODES. A host-created canvas had no CRDT→disk
// writer for the life of the session: a guest's edit reached the host's shared
// DOCUMENT in seconds and its FILE never — measured unchanged after 240 s and
// after four unrelated manifest changes, then converged in 0.00 s the instant a
// human opened the board. A guest-created board took 0.25 s, because its create
// handshake attaches the writer. The deciding variable was who created it.
//
// 🔴 THE DISCRIMINATOR IS BUILT IN (charter B2). `tp02c` runs the SAME scenario
// against the pre-WP122 composition — the deps object with no bind seam, which
// is byte-for-byte what every caller handed the pass before this package — and
// asserts the file is UNCHANGED. If the rows below could pass with R1 unchanged
// they would be measuring the document, not the file, and the document was never
// the problem.
//
// 🔴 SCORED ON PARSED RECORDS, NEVER BYTES (`S174`). `tp02d` demonstrates why in
// one row and retires the byte oracle permanently.

import { afterEach, describe, expect, it } from "vitest";
import type * as Y from "yjs";

import { mirrorSharedCanvases } from "../../../files/canvas-mirror";
import {
  BOARD,
  authorSpelling,
  createHostWorld,
  docIds,
  fieldOf,
  node,
  obsidianSpelling,
  recordIdsIn,
  seedDoc,
} from "./harness";

let world: ReturnType<typeof createHostWorld> | null = null;
afterEach(() => {
  world?.destroy();
  world = null;
});

/** The host authored one card; the guest moved it and added one of its own. */
const HOST_FILE = authorSpelling([node("h1", { x: 10 })]);
const GUEST_STATE = {
  nodes: [node("h1", { x: 999 }), node("g1", { x: 500 })],
};

describe("WP122 B2 — the guest's edit reaches the host's disk", () => {
  it("tp02a: the host's FILE holds the guest's card after one pass, with nobody opening anything", async () => {
    world = createHostWorld({ file: HOST_FILE, peer: GUEST_STATE });

    // BEFORE: the file is the host's own authoring and knows nothing of `g1`.
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["h1"]);

    await mirrorSharedCanvases(world.deps);

    // The document holds the union — that much was never broken.
    expect(docIds(world.localDoc() as never).nodes).toStrictEqual(["g1", "h1"]);
    // THE CRITERION: so does the FILE.
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["g1", "h1"]);
  });

  it("tp02b: THE MEASURED SEQUENCE — the session is up, THEN the guest moves the host's card", async () => {
    // The live stall in the exact order it happened, which tp02a does not
    // reproduce: the host subscribed while file and document agreed, and only
    // afterwards did the guest edit. Nothing then wrote the host's file for
    // 240 s. This row is the one that is about the WRITER'S LIFETIME rather
    // than about the cold-open flush.
    world = createHostWorld({ file: HOST_FILE });
    await mirrorSharedCanvases(world.deps);
    expect(world.hasWriter(BOARD)).toBe(true);
    expect(fieldOf(world.disk(BOARD), "h1", "x")).toBe(10);

    // The guest's move arrives as a remote delta on the host's replica.
    seedDoc(world.localDoc() as Y.Doc, [node("h1", { x: 999 })]);
    await world.settleWriter();

    expect(fieldOf(world.disk(BOARD), "h1", "x")).toBe(999);
  });

  it("tp02b2: 🔴 THE SAME SEQUENCE without the bind seam — 'unchanged after 240 s', reproduced", async () => {
    // The discriminator for tp02b, and the reproduction of the live defect.
    // Identical inputs, identical deltas, identical settle — one difference:
    // the pass has no writer seam, which is what it had before this package.
    world = createHostWorld({ file: HOST_FILE, withoutBindSeam: true });
    await mirrorSharedCanvases(world.deps);
    expect(world.hasWriter(BOARD)).toBe(false);
    const before = world.disk(BOARD);

    seedDoc(world.localDoc() as Y.Doc, [node("h1", { x: 999 })]);
    await world.settleWriter();

    // The DOCUMENT has the move…
    expect(
      (world.localDoc() as Y.Doc).getMap<Y.Map<unknown>>("nodes").get("h1")?.get("x"),
    ).toBe(999);
    // …and the FILE is byte-unchanged. No writer ever existed for it.
    expect(world.disk(BOARD)).toBe(before);
    expect(fieldOf(world.disk(BOARD), "h1", "x")).toBe(10);
    expect(world.writes).toStrictEqual([]);
  });

  it("tp02c: 🔴 THE DISCRIMINATOR — the same scenario on the pre-WP122 composition leaves the file untouched", async () => {
    // This is the row that makes tp02a/tp02b evidence rather than a claim. The
    // deps object here differs from tp02a's in ONE way: no `bindHostWriter`.
    // That is precisely the shape of the pass before this package.
    world = createHostWorld({ file: HOST_FILE, peer: GUEST_STATE, withoutBindSeam: true });
    const before = world.disk(BOARD);

    await mirrorSharedCanvases(world.deps);

    // The document converged…
    expect(docIds(world.localDoc() as never).nodes).toStrictEqual(["g1", "h1"]);
    // …and the file did not. Byte-identical, not merely record-identical: on
    // THIS arm nothing was written at all, so a byte comparison is the correct
    // and strongest statement available.
    expect(world.disk(BOARD)).toBe(before);
    expect(world.writes).toStrictEqual([]);
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["h1"]);
  });

  it("tp02d: 🔴 `S174` — a byte oracle would score this backwards, so the oracle is records", async () => {
    // Three stable spellings of ONE record set. Measured live at 235 / 296 /
    // 218 B with zero field differences.
    const records = [node("h1", { x: 10 })];
    const author = authorSpelling(records);
    const obsidian = obsidianSpelling(records);

    // A byte oracle calls two IN-SYNC boards divergent…
    expect(author).not.toBe(obsidian);
    // …and `contains` — a raw substring test — flips on the SAME geometry
    // depending only on which peer last had the board open.
    expect(author.includes('"x":10')).toBe(true);
    expect(obsidian.includes('"x": 10')).toBe(false);
    // The record oracle answers the question that was actually asked.
    expect(recordIdsIn(author)).toStrictEqual(recordIdsIn(obsidian));
    expect(fieldOf(author, "h1", "x")).toBe(fieldOf(obsidian, "h1", "x"));

    // And the pass converges a board written in Obsidian's spelling just the
    // same — the fix is not sensitive to the byte form it starts from.
    world = createHostWorld({ file: obsidian, peer: GUEST_STATE });
    await mirrorSharedCanvases(world.deps);
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["g1", "h1"]);
  });

  it("tp02e: the writer stays live, so an edit arriving AFTER the pass converges too", async () => {
    // The 240-second stall was not slowness, it was absence. A writer that only
    // flushed once at attach would leave the very next remote edit stranded —
    // and a test that stopped at the attach could not tell the two apart.
    world = createHostWorld({ file: HOST_FILE, peer: GUEST_STATE });
    await mirrorSharedCanvases(world.deps);
    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["g1", "h1"]);

    // A later remote delta, then the writer's OWN observer → debounce → flush
    // chain. Not a re-attach and not a direct `flush()`: the writer the pass
    // installed is doing the work, through the path production runs.
    seedDoc(world.localDoc() as Y.Doc, [node("g2", { x: 42 })]);
    await world.settleWriter();

    expect(recordIdsIn(world.disk(BOARD)).nodes).toStrictEqual(["g1", "g2", "h1"]);
  });
});
