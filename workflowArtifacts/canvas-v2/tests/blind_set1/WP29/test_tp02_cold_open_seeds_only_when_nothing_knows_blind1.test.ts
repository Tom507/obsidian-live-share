// WP29 / AC1 blind1 at the cold-open boundary — attacked by COUNTING the
// file->CRDT reads over the whole knowledge lattice instead of asserting one
// outcome per scenario.
//
// The visible test asks each row "what did you return?". This one never looks at
// a return value until the very end: it drives all four knowledge shapes through
// `coldOpen` against the same disk, and counts how many of them opened the file
// at all. The contract makes that number exactly ONE. A guard that checks a
// single condition counts two; a guard that was removed counts four; a guard
// that refuses everything counts zero.
//
// The board here is EDGE-heavy rather than node-heavy — the file's only nodes
// exist to carry the edges — because `coldOpen`'s emptiness test reads
// `nodesMap.size > 0 || edgesMap.size > 0` and a fixture with nodes alone cannot
// tell whether the second disjunct is still there.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasPersistence,
  type PersistenceIO,
} from "../../../../../plugin/src/files/canvas-persistence";
import type { SeedKnowledge } from "../../../../../plugin/src/files/canvas-seed-decision";

const DISK = "diagrams/flow.canvas";

const FILE = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 160, height: 80, text: "start" },
    { id: "b", type: "text", x: 400, y: 0, width: 160, height: 80, text: "finish" },
  ],
  edges: [
    { id: "a->b", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" },
    { id: "b->a", fromNode: "b", fromSide: "bottom", toNode: "a", toSide: "bottom" },
  ],
});

interface Disk {
  io: PersistenceIO;
  reads: number;
  writes: number;
  bytes: string;
}

function disk(initial: string | null): Disk {
  const state = { reads: 0, writes: 0, bytes: initial };
  const io: PersistenceIO = {
    async read() {
      state.reads += 1;
      return state.bytes ?? "";
    },
    async write(_p: string, content: string) {
      state.writes += 1;
      state.bytes = content;
    },
    async exists() {
      return state.bytes !== null;
    },
    mutePathEvents() {},
    unmutePathEvents() {},
  };
  return {
    io,
    get reads() {
      return state.reads;
    },
    get writes() {
      return state.writes;
    },
    get bytes() {
      return state.bytes ?? "";
    },
  } as Disk;
}

const inertScheduler = {
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
};

const LATTICE: SeedKnowledge[] = [
  { sidecarKnowsDoc: false, peerKnowsDoc: false },
  { sidecarKnowsDoc: false, peerKnowsDoc: true },
  { sidecarKnowsDoc: true, peerKnowsDoc: false },
  { sidecarKnowsDoc: true, peerKnowsDoc: true },
];

async function coldOpenWith(seedKnowledge: SeedKnowledge, initial: string | null = FILE) {
  const doc = new Y.Doc();
  const d = disk(initial);
  const persistence = new CanvasPersistence(doc, d.io, DISK, {
    scheduler: inertScheduler,
    seedKnowledge,
  });
  const outcome = await persistence.coldOpen();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes").size;
  const edges = doc.getMap<Y.Map<unknown>>("edges").size;
  persistence.destroy();
  doc.destroy();
  return { outcome, reads: d.reads, writes: d.writes, bytes: d.bytes, nodes, edges };
}

describe("WP29 AC1 blind1 — exactly one knowledge shape may read the file", () => {
  it("across the whole lattice the file is opened exactly once", async () => {
    let opened = 0;
    for (const shape of LATTICE) {
      const run = await coldOpenWith(shape);
      opened += run.reads;
    }
    expect(opened, "the number of knowledge shapes allowed to seed is not one").toBe(1);
  });

  it("the shape that opened it is the ignorant one, and it really seeded", async () => {
    const run = await coldOpenWith({ sidecarKnowsDoc: false, peerKnowsDoc: false });
    expect(run.reads).toBe(1);
    expect(run.nodes).toBe(2);
    expect(run.edges, "the edge half of the file never reached the doc").toBe(2);
    expect(run.outcome).toBe("seeded-from-file");
  });

  it("no informed shape touches the disk in either direction", async () => {
    for (const shape of LATTICE.slice(1)) {
      const run = await coldOpenWith(shape);
      expect(run.reads, `read the file for ${JSON.stringify(shape)}`).toBe(0);
      expect(run.writes, `wrote the file for ${JSON.stringify(shape)}`).toBe(0);
      expect(run.bytes, "the user's file was modified").toBe(FILE);
      expect(run.nodes + run.edges, "records reached a doc that must not have been seeded").toBe(0);
    }
  });

  it("an EDGE-only doc still counts as non-empty, so the doc-wins branch survives", async () => {
    // Regression on the second disjunct of the emptiness test. If WP29's guard
    // replaced that test rather than following it, an edge-only board would be
    // treated as empty and re-seeded from the file.
    const doc = new Y.Doc();
    const d = disk(FILE);
    doc.transact(() => {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("edges").set("live", record);
      for (const [k, v] of Object.entries({
        id: "live",
        fromNode: "x",
        fromSide: "right",
        toNode: "y",
        toSide: "left",
      })) {
        record.set(k, v);
      }
    });
    const persistence = new CanvasPersistence(doc, d.io, DISK, {
      scheduler: inertScheduler,
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });

    expect(await persistence.coldOpen()).toBe("doc-wins");
    expect(d.reads, "an edge-only doc was re-seeded from the file").toBe(0);
    persistence.destroy();
  });

  it("with no `seedKnowledge` at all the pre-WP29 behaviour is intact", async () => {
    const doc = new Y.Doc();
    const d = disk(FILE);
    const persistence = new CanvasPersistence(doc, d.io, DISK, { scheduler: inertScheduler });
    expect(await persistence.coldOpen()).toBe("seeded-from-file");
    expect(d.reads).toBe(1);
    persistence.destroy();
  });

  it("an informed shape over a MISSING file is still inert", async () => {
    const run = await coldOpenWith({ sidecarKnowsDoc: true, peerKnowsDoc: true }, null);
    expect(run.outcome).toBe("empty");
    expect(run.reads + run.writes).toBe(0);
  });
});
