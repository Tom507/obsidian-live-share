// WP29 / AC4 blind1, ordering — TRANSACTION AND WRITE ACCOUNTING instead of a
// call-order log.
//
// The visible test reads indices out of a trace. This one never looks at an
// order: it counts what the doc and the disk actually experienced during the
// attach, and the contract turns those counts into arithmetic.
//
//   correct order (coldOpen -> start)   seeding branch: doc sees exactly ONE
//                                       transaction (the seed) and the disk sees
//                                       ZERO writes.
//   start() first                       the seed fires the observer, the debounce
//                                       is armed, and the file is rewritten with
//                                       what was just read out of it.
//
//   WP29's no-seed branch               doc sees ZERO transactions and the disk
//                                       sees ZERO writes — and `start()` must
//                                       still have run, which is proved by
//                                       making a change AFTERWARDS and watching
//                                       a timer appear.
//
// Both numbers come from seams that exist anyway — a `Y.Doc` transaction
// listener and the injected `PersistenceIO` — so nothing in production has to be
// instrumented for them to be available.
//
// The second half attacks the ordering from the KNOWLEDGE side, which the
// visible test cannot: the peer state that makes `peerKnowsDoc` true is
// delivered INSIDE `waitForSync`, so a client that decided whether to seed
// before peer sync resolves necessarily decides on the wrong evidence and seeds.

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type PersistenceIO,
  attachCanvasPersistence,
} from "../../../../../plugin/src/files/canvas-persistence";
import { type SidecarIO, createSidecarStore } from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const PATH = "notes/wiring.canvas";
const GUID = "5b90f7d2e14c4a8fbb6d03c9a25e7418";
const FILE = JSON.stringify({
  nodes: [{ id: "w-1", type: "text", x: 0, y: 0, width: 140, height: 70, text: "wire" }],
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

function countingScheduler() {
  let armed = 0;
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    get armed() {
      return armed;
    },
    pending: () => timers.size,
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

function persistenceIO(files: Map<string, string>): PersistenceIO & { writes: number } {
  const counters = { writes: 0 };
  return {
    get writes() {
      return counters.writes;
    },
    async read(p: string) {
      return files.get(p) ?? "";
    },
    async write(p: string, c: string) {
      counters.writes += 1;
      files.set(p, c);
    },
    async exists(p: string) {
      return files.has(p);
    },
    mutePathEvents() {},
    unmutePathEvents() {},
  } as PersistenceIO & { writes: number };
}

async function joined(peerBuild?: (peer: Y.Doc) => void) {
  const files = new Map<string, string>([[PATH, FILE]]);
  const vault = {
    files,
    read: vi.fn(async (f: { path: string }) => files.get(f.path) ?? ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
    adapter: {
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
  };

  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const arriving = new Map<string, Uint8Array>();
  const sync = {
    docs,
    getDoc(docId: string) {
      let handle = docs.get(docId);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(docId, handle);
      }
      return handle;
    },
    releaseDoc: vi.fn(),
    async waitForSync(docId: string) {
      await Promise.resolve();
      const update = arriving.get(docId);
      const handle = docs.get(docId);
      if (update && handle) Y.applyUpdate(handle.doc, update);
    },
  };

  if (peerBuild) {
    const peer = new Y.Doc();
    peerBuild(peer);
    arriving.set(canvasDocId(GUID), Y.encodeStateAsUpdate(peer));
    peer.destroy();
  }

  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect({ ...sync, waitForSync: async () => {} } as never);
  manifest.setCanvasGuid(PATH, GUID);
  const store = createSidecarStore(memoryIO());

  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never,
  );
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
  canvasSync.setSidecarLifecycle(createSidecarLifecycle(store));
  await canvasSync.subscribe(PATH, "guest");
  for (let i = 0; i < 40; i++) await Promise.resolve();

  return { canvasSync, doc: (docs.get(canvasDocId(GUID)) as { doc: Y.Doc }).doc, files };
}

async function attachAndCount(doc: Y.Doc, files: Map<string, string>, knowledge: unknown) {
  let transactions = 0;
  const listener = (): void => {
    transactions += 1;
  };
  doc.on("afterTransaction", listener);
  const scheduler = countingScheduler();
  const io = persistenceIO(files);
  const attached = await attachCanvasPersistence(doc, io, PATH, {
    scheduler,
    seedKnowledge: knowledge as never,
  });
  doc.off("afterTransaction", listener);
  return { attached, transactions, scheduler, io };
}

describe("WP29 AC4 blind1 — the ordering, as arithmetic", () => {
  it("the seeding branch: seed + migration, zero disk writes, zero timers armed", async () => {
    // TWO transactions, not one: `coldOpen` seeds and then runs `migrateV1ToV2`
    // on the records it just wrote (WP18's placement rule — migrate AFTER the
    // seed, never before). Both are the cold open's own; neither is a write-back.
    const { canvasSync, doc, files } = await joined();
    const { attached, transactions, scheduler, io } = await attachAndCount(
      doc,
      files,
      canvasSync.seedKnowledgeFor(PATH),
    );

    expect(attached.coldOpen).toBe("seeded-from-file");
    expect(transactions, "the cold-open seed and migration were not exactly two").toBe(2);
    expect(scheduler.armed, "the seed armed a write — start() ran before coldOpen").toBe(0);
    expect(io.writes, "the seed was persisted straight back out").toBe(0);

    attached.persistence.destroy();
    canvasSync.destroy();
  });

  it("WP29's no-seed branch: zero doc transactions, zero disk writes", async () => {
    const { canvasSync, doc, files } = await joined((peer) => {
      peer.transact(() => {
        peer.getMap<unknown>("meta").set("schemaVersion", 2);
      });
    });
    const knowledge = canvasSync.seedKnowledgeFor(PATH);
    expect(knowledge.peerKnowsDoc, "the peer's state did not arrive").toBe(true);

    const { attached, transactions, io } = await attachAndCount(doc, files, knowledge);
    expect(attached.coldOpen).toBe("empty");
    expect(transactions, "the no-seed cold open wrote to the doc").toBe(0);
    expect(io.writes).toBe(0);
    expect(files.get(PATH)).toBe(FILE);

    attached.persistence.destroy();
    canvasSync.destroy();
  });

  it("`start()` still ran on the no-seed branch — a later change arms exactly one timer", async () => {
    const { canvasSync, doc, files } = await joined((peer) => {
      peer.transact(() => {
        peer.getMap<unknown>("meta").set("schemaVersion", 2);
      });
    });
    const { attached, scheduler } = await attachAndCount(
      doc,
      files,
      canvasSync.seedKnowledgeFor(PATH),
    );
    expect(scheduler.armed, "the attach itself armed a timer").toBe(0);

    doc.transact(() => {
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set("after", record);
      record.set("id", "after");
    });
    expect(scheduler.armed, "no writer is watching the doc — start() never ran").toBe(1);

    attached.persistence.destroy();
    canvasSync.destroy();
  });

  it("the seed decision is taken on POST-sync evidence", async () => {
    // The peer's state is delivered inside `waitForSync`. A client that decided
    // before peer sync resolved would see an empty, unknown board and seed it.
    // This is the ordering claim restated in terms of the WP29 branch's input.
    const { canvasSync, doc, files } = await joined((peer) => {
      peer.transact(() => {
        peer.getMap<unknown>("meta").set("epoch", 4);
      });
    });

    expect(
      canvasSync.seedKnowledgeFor(PATH).peerKnowsDoc,
      "the knowledge was gathered before waitForSync resolved",
    ).toBe(true);

    const { attached } = await attachAndCount(doc, files, canvasSync.seedKnowledgeFor(PATH));
    expect(attached.coldOpen).toBe("empty");
    expect(files.get(PATH)).toBe(FILE);

    attached.persistence.destroy();
    canvasSync.destroy();
  });
});
