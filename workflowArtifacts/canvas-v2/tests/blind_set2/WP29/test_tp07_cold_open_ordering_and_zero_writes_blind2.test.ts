// WP29 / AC4 blind2, ordering — an A/B DISCRIMINATION SEAM built out of the same
// public API.
//
// A preservation criterion is the easiest kind of assertion to write so that it
// cannot fail. So this file does not merely assert that the shipped order is
// correct: it assembles the WRONG order by hand — `new CanvasPersistence(...)`,
// `start()`, then `coldOpen()` — and shows that the oracle goes RED on it. Both
// arms use only exported API, both run against identical fixtures, and the only
// difference between them is the order of two statements. An assertion that
// stays green on the inverted arm is proof that the correct arm proved nothing.
//
// The oracle is the injected scheduler: on the seeding branch the wrong order
// lets the seed reach the persistence observer, which arms the debounce and
// rewrites the file with what was just read out of it. The right order arms
// nothing, because no observer exists yet.
//
// The second half covers the branch WP29 adds. There, the wrong order is
// INDISTINGUISHABLE by this oracle — nothing is written, so nothing can be
// observed, so no timer is armed either way. That is stated explicitly rather
// than left as a silent gap: it is why the ordering has to be pinned on the
// seeding branch, and why a WP29 implementation that only ever exercised its own
// branch would have no ordering evidence at all.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CanvasPersistence,
  type PersistenceIO,
  attachCanvasPersistence,
} from "../../../../../plugin/src/files/canvas-persistence";
import type { SeedKnowledge } from "../../../../../plugin/src/files/canvas-seed-decision";

const DISK = "plans/launch.canvas";
const FILE = JSON.stringify({
  nodes: [
    { id: "l-1", type: "text", x: 0, y: 0, width: 180, height: 90, text: "announce" },
    { id: "l-2", type: "text", x: 220, y: 0, width: 180, height: 90, text: "ship" },
  ],
  edges: [{ id: "l-e", fromNode: "l-1", fromSide: "right", toNode: "l-2", toSide: "left" }],
});

function scheduler() {
  let armed = 0;
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    get armed() {
      return armed;
    },
    runAll() {
      for (const [id, cb] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
    now: () => 0,
    setTimeout(cb: () => void) {
      armed += 1;
      const id = next++;
      timers.set(id, cb);
      return id;
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number);
    },
  };
}

function disk() {
  const files = new Map<string, string>([[DISK, FILE]]);
  const writes: string[] = [];
  const io: PersistenceIO = {
    async read(p: string) {
      return files.get(p) ?? "";
    },
    async write(p: string, c: string) {
      writes.push(c);
      files.set(p, c);
    },
    async exists(p: string) {
      return files.has(p);
    },
    mutePathEvents() {},
    unmutePathEvents() {},
  };
  return { io, files, writes };
}

/** ARM A — the shipped order, as `attachCanvasPersistence` expresses it. */
async function correctOrder(knowledge?: SeedKnowledge) {
  const doc = new Y.Doc();
  const clock = scheduler();
  const d = disk();
  const attached = await attachCanvasPersistence(doc, d.io, DISK, {
    scheduler: clock,
    ...(knowledge ? { seedKnowledge: knowledge } : {}),
  });
  return { doc, clock, ...d, outcome: attached.coldOpen, persistence: attached.persistence };
}

/** ARM B — the same two statements, inverted. Public API only. */
async function invertedOrder(knowledge?: SeedKnowledge) {
  const doc = new Y.Doc();
  const clock = scheduler();
  const d = disk();
  const persistence = new CanvasPersistence(doc, d.io, DISK, {
    scheduler: clock,
    ...(knowledge ? { seedKnowledge: knowledge } : {}),
  });
  persistence.start();
  const outcome = await persistence.coldOpen();
  return { doc, clock, ...d, outcome, persistence };
}

describe("WP29 AC4 blind2 — the ordering oracle is shown to be able to fail", () => {
  it("the shipped order arms no write on the seeding branch", async () => {
    const run = await correctOrder({ sidecarKnowsDoc: false, peerKnowsDoc: false });
    expect(run.outcome).toBe("seeded-from-file");
    expect(run.doc.getMap<Y.Map<unknown>>("nodes").size).toBe(2);
    expect(run.clock.armed, "the seed escaped to the writer").toBe(0);
    expect(run.writes, "the cold-open seed was written straight back out").toEqual([]);
    run.persistence.destroy();
  });

  it("the inverted order arms one — so the assertion above is falsifiable", async () => {
    const run = await invertedOrder({ sidecarKnowsDoc: false, peerKnowsDoc: false });
    expect(run.outcome).toBe("seeded-from-file");
    expect(
      run.clock.armed,
      "start()-before-coldOpen was indistinguishable from the correct order — " +
        "the oracle in the previous test cannot fail",
    ).toBeGreaterThan(0);
    run.persistence.destroy();
  });

  it("and the inverted order really does put the file back on disk", async () => {
    const run = await invertedOrder({ sidecarKnowsDoc: false, peerKnowsDoc: false });
    run.clock.runAll();
    await Promise.resolve();
    expect(run.writes.length, "the consequence the ordering prevents did not materialise").toBe(1);
    run.persistence.destroy();
  });

  it("on WP29's no-seed branch the two orders are indistinguishable, and both are inert", async () => {
    // Stated explicitly so the gap is on the record: nothing is written, so no
    // observer can fire, so this oracle has nothing to say about the ordering
    // here. What it CAN say is that the branch is inert in both arms — no
    // timer, no write, no record.
    const knowledge: SeedKnowledge = { sidecarKnowsDoc: true, peerKnowsDoc: false };
    for (const [label, run] of [
      ["shipped order", await correctOrder(knowledge)],
      ["inverted order", await invertedOrder(knowledge)],
    ] as const) {
      expect(run.outcome, `${label}: outcome`).toBe("empty");
      expect(run.clock.armed, `${label}: a timer was armed`).toBe(0);
      expect(run.writes, `${label}: the disk was written`).toEqual([]);
      expect(run.doc.getMap<Y.Map<unknown>>("nodes").size, `${label}: the doc was seeded`).toBe(0);
      run.persistence.destroy();
    }
  });

  it("the shipped order still installs the observer afterwards, on BOTH branches", async () => {
    for (const knowledge of [
      { sidecarKnowsDoc: false, peerKnowsDoc: false },
      { sidecarKnowsDoc: false, peerKnowsDoc: true },
    ]) {
      const run = await correctOrder(knowledge);
      const armedBefore = run.clock.armed;
      run.doc.transact(() => {
        const record = new Y.Map<unknown>();
        run.doc.getMap<Y.Map<unknown>>("nodes").set("post-attach", record);
        record.set("id", "post-attach");
      });
      expect(
        run.clock.armed - armedBefore,
        `no writer is watching after ${JSON.stringify(knowledge)}`,
      ).toBe(1);
      run.persistence.destroy();
    }
  });
});
