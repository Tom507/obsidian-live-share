// WP25 / AC4 blind1 — the coldOpen ordering, attacked through TRANSACTION
// ACCOUNTING instead of through a call-order log.
//
// Different angle from the visible test, which traces four seams and reads their
// indices. This one never looks at an order: it counts what the doc and the disk
// actually experienced during the attach.
//
// The contract is `waitForSync → coldOpen → start()`, and the reason it exists
// (US5 AC17) is that the one-time file→CRDT seed must not be persisted straight
// back out. That has an arithmetic consequence:
//
//   correct order  → during the attach the doc sees exactly ONE transaction (the
//                    seed) and the disk sees exactly ZERO writes.
//   start() first  → the seed fires the observer, the debounce is armed, and the
//                    file is rewritten with what was just read out of it.
//
// Both numbers are read at seams that exist anyway — a `Y.Doc` transaction
// listener and the injected `PersistenceIO` — so nothing about the production
// code has to be instrumented for the count to be available.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  type PersistenceIO,
  attachCanvasPersistence,
} from "../../../../../plugin/src/files/canvas-persistence";

const DISK_PATH = "atlas/regions.canvas";
const GUID = "d0491ba75c8e4f13a627be90cd35f814";

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

const FILE_CONTENT = JSON.stringify({
  nodes: [
    { id: "r-1", type: "text", x: 0, y: 0, width: 100, height: 60, text: "north" },
    { id: "r-2", type: "text", x: 300, y: 0, width: 100, height: 60, text: "south" },
  ],
  edges: [{ id: "r-e", fromNode: "r-1", toNode: "r-2" }],
});

interface Recorder {
  io: PersistenceIO;
  writes: string[];
  reads: string[];
}

function recordingIO(files: Map<string, string>): Recorder {
  const writes: string[] = [];
  const reads: string[] = [];
  return {
    writes,
    reads,
    io: {
      async read(path: string) {
        reads.push(path);
        return files.get(path) ?? "";
      },
      async write(path: string, content: string) {
        writes.push(path);
        files.set(path, content);
      },
      async exists(path: string) {
        return files.has(path);
      },
      mutePathEvents() {},
      unmutePathEvents() {},
    },
  };
}

/** A scheduler that never fires, so an ARMED debounce is countable. */
function inertScheduler(): {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  armed(): number;
} {
  let id = 1;
  const live = new Set<number>();
  return {
    now: () => 0,
    setTimeout() {
      const handle = id++;
      live.add(handle);
      return handle;
    },
    clearTimeout(handle: unknown) {
      live.delete(handle as number);
    },
    armed: () => live.size,
  };
}

describe("WP25 AC4 blind1 — the seed happens before anything is observing", () => {
  it("the attach opens exactly one transaction and writes nothing", async () => {
    const files = new Map([[DISK_PATH, FILE_CONTENT]]);
    const recorder = recordingIO(files);
    const scheduler = inertScheduler();
    const doc = new Y.Doc();

    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });

    const { coldOpen } = await attachCanvasPersistence(doc, recorder.io, DISK_PATH, {
      scheduler,
    });

    expect(coldOpen).toBe("seeded-from-file");
    // TWO, and both are named: `seedRecordsIntoYMaps` under `CANVAS_SEED_ORIGIN`,
    // then WP18's `migrateV1ToV2` — which runs AFTER the seed, never before it,
    // because its guard is one-shot on `meta`. A third transaction is a write
    // nobody has accounted for; a first-and-only one means the migration was
    // skipped and the seeded records are stranded in the V1 vocabulary.
    expect(transactions, "the cold-open seed and migration were not exactly two").toBe(2);
    expect(
      recorder.writes,
      "the attach wrote the file it had just read — start() ran before coldOpen",
    ).toEqual([]);
    expect(
      scheduler.armed(),
      "the seed armed a debounced write, so an observer was already installed",
    ).toBe(0);
  });

  it("the observer IS live afterwards — the absence above is ordering, not inertia", async () => {
    // Without this control, every assertion in the test above is satisfied by an
    // implementation that simply never calls `start()`.
    const files = new Map([[DISK_PATH, FILE_CONTENT]]);
    const recorder = recordingIO(files);
    const scheduler = inertScheduler();
    const doc = new Y.Doc();

    await attachCanvasPersistence(doc, recorder.io, DISK_PATH, { scheduler });
    expect(scheduler.armed()).toBe(0);

    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>("nodes").get("r-1")?.set("text", "north, edited");
    });

    expect(
      scheduler.armed(),
      "a post-attach edit armed no write — start() was never reached",
    ).toBe(1);
  });

  it("the doc-wins branch never reads the file and writes exactly once", async () => {
    // The other coldOpen branch, unchanged by WP25 and pinned so a sidecar load
    // that populates the doc cannot silently change which branch runs without a
    // test noticing.
    const files = new Map([[DISK_PATH, FILE_CONTENT]]);
    const recorder = recordingIO(files);
    const doc = new Y.Doc();
    doc.transact(() => {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set("from-doc", record);
      record.set("id", "from-doc");
      record.set("type", "text");
      record.set("x", 0);
      record.set("y", 0);
      record.set("width", 10);
      record.set("height", 10);
    });

    const { coldOpen } = await attachCanvasPersistence(doc, recorder.io, DISK_PATH, {
      scheduler: inertScheduler(),
    });

    expect(coldOpen).toBe("doc-wins");
    expect(recorder.reads, "the doc-wins branch read the file (I3/I9 violation)").toEqual([]);
    expect(recorder.writes).toEqual([DISK_PATH]);
    expect(files.get(DISK_PATH)).toContain("from-doc");
  });

  it("an ABSENT file yields `empty`, opens no transaction and writes nothing", async () => {
    const recorder = recordingIO(new Map());
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });

    const { coldOpen } = await attachCanvasPersistence(doc, recorder.io, DISK_PATH, {
      scheduler: inertScheduler(),
    });

    expect(coldOpen).toBe("empty");
    expect(transactions, "the empty branch emitted a CRDT delta").toBe(0);
    expect(recorder.writes).toEqual([]);
  });

  it("a sidecar load BEFORE the attach turns cold open into doc-wins", async () => {
    // WP25's whole point, expressed through AC4's contract instead of around it:
    // because the sidecar is loaded inside `subscribe` — before `waitForSync`
    // and therefore long before `coldOpen` — the returning client arrives at
    // cold open with a NON-EMPTY doc and its stale local file is overwritten
    // from the replica. A load placed after `coldOpen` gets `seeded-from-file`
    // instead, and the board silently restarts from whatever is on disk.
    const sidecar = memoryIO();
    const store = createSidecarStore(sidecar);
    const author = new Y.Doc();
    author.transact(() => {
      const record = new Y.Map<unknown>();
      author.getMap<Y.Map<unknown>>("nodes").set("resumed", record);
      for (const [k, v] of Object.entries({
        id: "resumed",
        type: "text",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        text: "from the previous session",
      })) {
        record.set(k, v);
      }
    });
    await store.checkpoint(GUID, author);
    author.destroy();

    const files = new Map([[DISK_PATH, FILE_CONTENT]]);
    const recorder = recordingIO(files);
    const lifecycle = createSidecarLifecycle(store);
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    const load = await lifecycle.load(GUID, doc);
    expect(load.degradation).toBe("none");

    const { coldOpen } = await attachCanvasPersistence(doc, recorder.io, DISK_PATH, {
      scheduler: inertScheduler(),
    });

    expect(
      coldOpen,
      "the returning client reseeded from the file instead of resuming its replica",
    ).toBe("doc-wins");
    expect(recorder.reads).toEqual([]);
    expect(files.get(DISK_PATH)).toContain("resumed");
    expect(files.get(DISK_PATH)).not.toContain("north");

    await lifecycle.destroy();
  });
});
