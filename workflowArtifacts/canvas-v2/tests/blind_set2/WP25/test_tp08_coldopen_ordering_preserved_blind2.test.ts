// WP25 / AC4 blind2 — the coldOpen contract as a THREE-WAY BRANCH TABLE, with
// the sidecar load moved around it.
//
// The visible test pins the four-stage sequence; blind1 counts transactions and
// armed timers. This one asks the question the other two do not: does WP25's new
// sidecar load change WHICH cold-open branch runs, and does the answer depend on
// where the load sits?
//
// The contract is `waitForSync → coldOpen → start()`, and `coldOpen`'s three
// verdicts are `doc-wins`, `seeded-from-file` and `empty`. Loading the sidecar
// BEFORE cold open is what turns a returning client's board from
// `seeded-from-file` (reseed from the stale local file) into `doc-wins` (resume
// the replica). Loading it AFTER produces the same final document in the happy
// case — the file and the replica usually agree — and silently discards
// everything the replica knew that the file did not, which is precisely the
// state a returning client is in.
//
// So the branch verdict IS the ordering oracle here, and it is a value rather
// than an index into a trace.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type PersistenceIO,
  attachCanvasPersistence,
} from "../../../../../plugin/src/files/canvas-persistence";
import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";

const DISK_PATH = "studio/plan.canvas";
const GUID = "cf19d20e8a744b53916ecab7052fd634";

const STALE_FILE = JSON.stringify({
  nodes: [{ id: "stale", type: "text", x: 0, y: 0, width: 60, height: 30, text: "old" }],
  edges: [],
});

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

function persistenceIO(files: Map<string, string>): {
  io: PersistenceIO;
  reads: string[];
  writes: string[];
} {
  const reads: string[] = [];
  const writes: string[] = [];
  return {
    reads,
    writes,
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

function inertScheduler(): {
  now(): number;
  setTimeout(): unknown;
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

async function primeSidecar(io: SidecarIO, text: string): Promise<void> {
  const store = createSidecarStore(io);
  const author = new Y.Doc();
  author.transact(() => {
    const record = new Y.Map<unknown>();
    author.getMap<Y.Map<unknown>>("nodes").set("resumed", record);
    for (const [k, v] of Object.entries({
      id: "resumed",
      type: "text",
      x: 0,
      y: 0,
      width: 60,
      height: 30,
      text,
    })) {
      record.set(k, v);
    }
  });
  await store.checkpoint(GUID, author);
  author.destroy();
}

describe("WP25 AC4 blind2 — the cold-open branch is decided AFTER the sidecar load", () => {
  it("sidecar present → the branch is doc-wins and the stale file is overwritten", async () => {
    const sidecar = memoryIO();
    await primeSidecar(sidecar, "from the replica");
    const files = new Map([[DISK_PATH, STALE_FILE]]);
    const persistence = persistenceIO(files);

    const lifecycle = createSidecarLifecycle(createSidecarStore(sidecar));
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    await lifecycle.load(GUID, doc);

    const { coldOpen } = await attachCanvasPersistence(doc, persistence.io, DISK_PATH, {
      scheduler: inertScheduler(),
    });

    expect(coldOpen, "the returning client reseeded from its stale file").toBe("doc-wins");
    expect(persistence.reads, "the doc-wins branch read the file").toEqual([]);
    expect(files.get(DISK_PATH)).toContain("resumed");
    expect(files.get(DISK_PATH)).not.toContain("stale");

    await lifecycle.destroy();
  });

  it("sidecar ABSENT → the branch is seeded-from-file, exactly as before WP25", async () => {
    // The preservation half of AC4. A first-ever session must behave exactly as
    // it did, or WP25 has changed the contract instead of preserving it.
    const sidecar = memoryIO();
    const files = new Map([[DISK_PATH, STALE_FILE]]);
    const persistence = persistenceIO(files);

    const lifecycle = createSidecarLifecycle(createSidecarStore(sidecar));
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    const load = await lifecycle.load(GUID, doc);
    expect(load.degradation).toBe("missing");
    expect(load.checkpointApplied).toBe(false);
    expect(load.historyEntriesApplied).toBe(0);

    const scheduler = inertScheduler();
    const { coldOpen } = await attachCanvasPersistence(doc, persistence.io, DISK_PATH, {
      scheduler,
    });

    expect(coldOpen).toBe("seeded-from-file");
    expect(persistence.writes, "the seed escaped straight back to disk").toEqual([]);
    expect(scheduler.armed(), "the seed armed a write — start() ran before coldOpen").toBe(0);
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()]).toEqual(["stale"]);

    await lifecycle.destroy();
  });

  it("sidecar absent AND file absent → empty, and no CRDT delta at all", async () => {
    const sidecar = memoryIO();
    const persistence = persistenceIO(new Map());
    const lifecycle = createSidecarLifecycle(createSidecarStore(sidecar));
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });
    lifecycle.attach(GUID, doc);
    await lifecycle.load(GUID, doc);

    const { coldOpen } = await attachCanvasPersistence(doc, persistence.io, DISK_PATH, {
      scheduler: inertScheduler(),
    });

    expect(coldOpen).toBe("empty");
    expect(transactions, "the empty path emitted a CRDT delta").toBe(0);
    expect(persistence.writes).toEqual([]);

    await lifecycle.destroy();
  });

  it("a DEGRADED sidecar falls back to seeded-from-file rather than to nothing", async () => {
    // WP24 AC3: a corrupt sidecar applies NOTHING and reports. The board must
    // then behave like a first session — reseed from the file — instead of
    // opening empty and letting the persistence writer flush that emptiness
    // over the user's canvas.
    const sidecar = memoryIO();
    await primeSidecar(sidecar, "from the replica");
    // Corrupt the checkpoint in place.
    const store = createSidecarStore(sidecar);
    await store.append(GUID, Uint8Array.from([0xff, 0x7f, 0x2a, 0xde, 0xad, 0xbe, 0xef]));

    const files = new Map([[DISK_PATH, STALE_FILE]]);
    const persistence = persistenceIO(files);
    const lifecycle = createSidecarLifecycle(store);
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    const load = await lifecycle.load(GUID, doc);

    expect(load.degradation).toBe("corrupt");
    expect(
      [...doc.getMap<Y.Map<unknown>>("nodes").keys()],
      "a partially applied sidecar reached the doc",
    ).toEqual([]);

    const { coldOpen } = await attachCanvasPersistence(doc, persistence.io, DISK_PATH, {
      scheduler: inertScheduler(),
    });

    expect(coldOpen).toBe("seeded-from-file");
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()]).toEqual(["stale"]);
    expect(files.get(DISK_PATH)).toBe(STALE_FILE);

    await lifecycle.destroy();
  });
});
