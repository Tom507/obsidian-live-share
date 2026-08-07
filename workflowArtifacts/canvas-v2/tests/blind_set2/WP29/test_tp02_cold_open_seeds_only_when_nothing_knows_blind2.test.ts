// WP29 / AC1 blind2 at the cold-open boundary — the oracle is the DOC'S OWN
// CLOCK, not the return value and not the IO counters.
//
// A seed is a CRDT write, so it advances the doc's state vector; a refusal to
// seed is not a write, so the state vector is byte-identical afterwards. That
// makes "did this cold open put the file into the document?" answerable without
// consulting `coldOpen`'s return value, without instrumenting the IO, and
// without knowing what records the file contained. An implementation that
// returned `"empty"` while still applying the file — the worst possible
// combination, because every string-based oracle would call it correct — is red
// here and green everywhere else.
//
// (The inverse mistake — asserting the state vector is UNCHANGED across an
// operation the AC requires to write — is the trap this project has already been
// bitten by. It is safe here precisely because WP29's branch is defined by
// writing NOTHING.)
//
// The file is a REGISTER-SHAPED V2 board rather than the flat V1 shape used
// elsewhere, so the fixture also exercises the decode bridge the seed sits
// behind.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasPersistence,
  type PersistenceIO,
} from "../../../../../plugin/src/files/canvas-persistence";
import type { SeedKnowledge } from "../../../../../plugin/src/files/canvas-seed-decision";

const DISK = "wiki/topics.canvas";

const FILE = JSON.stringify({
  nodes: [
    { id: "t-alpha", type: "text", x: 10, y: 20, width: 300, height: 150, text: "alpha" },
    { id: "t-beta", type: "text", x: 400, y: 20, width: 300, height: 150, text: "beta" },
    { id: "t-gamma", type: "text", x: 800, y: 20, width: 300, height: 150, text: "gamma" },
  ],
  edges: [
    { id: "ab", fromNode: "t-alpha", fromSide: "right", toNode: "t-beta", toSide: "left" },
    { id: "bg", fromNode: "t-beta", fromSide: "right", toNode: "t-gamma", toSide: "left" },
  ],
});

const inert = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

function fileIO(files: Map<string, string>): PersistenceIO {
  return {
    async read(p: string) {
      return files.get(p) ?? "";
    },
    async write(p: string, c: string) {
      files.set(p, c);
    },
    async exists(p: string) {
      return files.has(p);
    },
    mutePathEvents() {},
    unmutePathEvents() {},
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function coldOpenAndWatchTheClock(knowledge: SeedKnowledge | undefined) {
  const files = new Map<string, string>([[DISK, FILE]]);
  const doc = new Y.Doc();
  const before = Y.encodeStateVector(doc);
  const persistence = new CanvasPersistence(doc, fileIO(files), DISK, {
    scheduler: inert,
    ...(knowledge ? { seedKnowledge: knowledge } : {}),
  });
  const outcome = await persistence.coldOpen();
  const after = Y.encodeStateVector(doc);
  persistence.destroy();
  return { outcome, advanced: !sameBytes(before, after), files, doc };
}

describe("WP29 AC1 blind2 — the doc's clock says whether the file was applied", () => {
  it("an unknown board: the clock advances and the outcome says so", async () => {
    const run = await coldOpenAndWatchTheClock({ sidecarKnowsDoc: false, peerKnowsDoc: false });
    expect(run.advanced, "nothing was written for a board nobody knows").toBe(true);
    expect(run.outcome).toBe("seeded-from-file");
    expect(run.doc.getMap<Y.Map<unknown>>("nodes").size).toBe(3);
    expect(run.doc.getMap<Y.Map<unknown>>("edges").size).toBe(2);
  });

  it.each([
    { sidecarKnowsDoc: true, peerKnowsDoc: false },
    { sidecarKnowsDoc: false, peerKnowsDoc: true },
    { sidecarKnowsDoc: true, peerKnowsDoc: true },
  ])("a known board (%j): the clock does not move at all", async (knowledge) => {
    const run = await coldOpenAndWatchTheClock(knowledge);
    expect(
      run.advanced,
      "the file was applied to a doc somebody else already knows, whatever the outcome said",
    ).toBe(false);
    expect(run.doc.getMap<Y.Map<unknown>>("nodes").size).toBe(0);
    expect(run.doc.getMap<Y.Map<unknown>>("edges").size).toBe(0);
    expect(run.files.get(DISK), "the file was rewritten").toBe(FILE);
  });

  it("the outcome and the clock never disagree", async () => {
    // The cross-check that makes both oracles worth having: a `"empty"` that
    // wrote, or a `"seeded-from-file"` that did not, is a contradiction.
    for (const sidecarKnowsDoc of [false, true]) {
      for (const peerKnowsDoc of [false, true]) {
        const run = await coldOpenAndWatchTheClock({ sidecarKnowsDoc, peerKnowsDoc });
        expect(run.advanced, `outcome ${run.outcome} does not match what happened to the doc`).toBe(
          run.outcome === "seeded-from-file",
        );
      }
    }
  });

  it("no knowledge supplied behaves as an unknown board", async () => {
    const run = await coldOpenAndWatchTheClock(undefined);
    expect(run.outcome).toBe("seeded-from-file");
    expect(run.advanced).toBe(true);
  });

  it("a known board that already holds records still takes doc-wins, and the clock moves for the migration", async () => {
    // Precedence again, from the clock's side: `doc-wins` runs the V1->V2
    // migration on the records it found, which IS a write, and then flushes.
    // So the clock advancing here is correct and expected — what must not
    // happen is the FILE reaching the doc.
    const files = new Map<string, string>([[DISK, FILE]]);
    const doc = new Y.Doc();
    doc.transact(() => {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set("resident", record);
      for (const [k, v] of Object.entries({
        id: "resident",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        text: "already here",
      })) {
        record.set(k, v);
      }
    });
    const persistence = new CanvasPersistence(doc, fileIO(files), DISK, {
      scheduler: inert,
      seedKnowledge: { sidecarKnowsDoc: true, peerKnowsDoc: true },
    });

    expect(await persistence.coldOpen()).toBe("doc-wins");
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(["resident"]);
    expect(files.get(DISK), "the doc's projection did not reach the file").toContain("resident");
    persistence.destroy();
  });
});
