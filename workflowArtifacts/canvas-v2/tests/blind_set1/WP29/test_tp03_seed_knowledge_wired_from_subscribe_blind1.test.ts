// WP29 / AC1 blind1, the wiring half — the two conditions are produced by
// DIFFERENT EVIDENCE than the visible test uses.
//
//   sidecar: HISTORY FRAMES ONLY, with no checkpoint. That is the shape a
//            sidecar has between compactions, which is most of its life. An
//            implementation that reads `checkpointApplied` alone reports "no
//            sidecar" for a client that has a full, healthy frame log.
//   peer:    a TOMBSTONE-ONLY update. The peers deleted the last card; the
//            update that arrives carries a `deleted` entry and nothing else, so
//            the doc's `nodes`/`edges` stay empty and every emptiness-shaped
//            oracle still says "nobody has ever seen this board". This is the
//            most literal form of the R4 resurrection: the stale file puts back
//            exactly the card the peers just deleted.
//
// The board, the path and the guid are all different from the visible fixture,
// and nothing here is derivable from it by renaming.

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { attachCanvasPersistence } from "../../../../../plugin/src/files/canvas-persistence";
import { type SidecarIO, createSidecarStore } from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  CanvasSync,
  buildCanvasData,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const PATH = "research/lit-review.canvas";
const GUID = "ae4471c0d29b48f1b6035ea87c1d92f4";

const CARD = {
  id: "cite-7",
  type: "text",
  x: 120,
  y: 40,
  width: 240,
  height: 120,
  text: "Sanderson et al.",
};
const STALE_FILE = JSON.stringify({ nodes: [CARD], edges: [] });

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

function vaultDouble(files: Map<string, string>) {
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
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
}

function syncDouble() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const arriving = new Map<string, Uint8Array>();
  return {
    docs,
    arriving,
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
}

async function join(options: {
  historyFrames?: number;
  peerTombstone?: boolean;
}): Promise<{
  canvasSync: CanvasSync;
  doc: Y.Doc;
  files: Map<string, string>;
}> {
  const files = new Map<string, string>([[PATH, STALE_FILE]]);
  const vault = vaultDouble(files);
  const sync = syncDouble();
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect({ ...sync, waitForSync: async () => {} } as never);
  manifest.setCanvasGuid(PATH, GUID);

  const store = createSidecarStore(memoryIO());

  // A frame log with no checkpoint behind it: this client wrote its board out
  // update by update and has not compacted since.
  for (let i = 0; i < (options.historyFrames ?? 0); i++) {
    const author = new Y.Doc();
    author.transact(() => {
      author.getMap<unknown>("meta").set(`frame-${i}`, i);
    });
    await store.append(GUID, Y.encodeStateAsUpdate(author));
    author.destroy();
  }

  if (options.peerTombstone) {
    const peer = new Y.Doc();
    peer.transact(() => {
      // The peers deleted the last card. WP19's removal shape is an entry in
      // `deleted`, so `nodes` and `edges` stay empty on the wire.
      peer.getMap<unknown>("deleted").set(CARD.id, { t: 4, by: "peer-a", on: true });
    });
    sync.arriving.set(canvasDocId(GUID), Y.encodeStateAsUpdate(peer));
    peer.destroy();
  }

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

  return { canvasSync, doc: (sync.docs.get(canvasDocId(GUID)) as { doc: Y.Doc }).doc, files };
}

function persistenceIO(files: Map<string, string>) {
  const reads: string[] = [];
  const writes: string[] = [];
  return {
    reads,
    writes,
    io: {
      async read(p: string) {
        reads.push(p);
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
    },
  };
}

const inertScheduler = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

describe("WP29 AC1 blind1 — knowledge from a frame log and from a tombstone", () => {
  it("a sidecar with history frames and NO checkpoint is still a known doc", async () => {
    const { canvasSync } = await join({ historyFrames: 3 });
    expect(
      canvasSync.seedKnowledgeFor(PATH).sidecarKnowsDoc,
      "an uncompacted frame log was read as 'no sidecar'",
    ).toBe(true);
    canvasSync.destroy();
  });

  it("no sidecar files at all is not a known doc", async () => {
    const { canvasSync } = await join({});
    expect(canvasSync.seedKnowledgeFor(PATH)).toEqual({
      sidecarKnowsDoc: false,
      peerKnowsDoc: false,
    });
    canvasSync.destroy();
  });

  it("a tombstone-only peer update is peer knowledge, even though the board stays empty", async () => {
    const { canvasSync, doc } = await join({ peerTombstone: true });
    expect(doc.getMap<Y.Map<unknown>>("nodes").size, "the fixture leaked a record").toBe(0);
    expect(
      canvasSync.seedKnowledgeFor(PATH),
      "a deletion-only sync was not counted as a peer",
    ).toEqual({ sidecarKnowsDoc: false, peerKnowsDoc: true });
    canvasSync.destroy();
  });

  it("the deleted card is NOT resurrected from the stale file", async () => {
    // The most literal R4: the file still holds exactly the card the peers just
    // deleted. Seeding here un-deletes it for everyone.
    const { canvasSync, doc, files } = await join({ peerTombstone: true });
    const { io, reads, writes } = persistenceIO(files);
    const { coldOpen } = await attachCanvasPersistence(doc, io as never, PATH, {
      scheduler: inertScheduler,
      seedKnowledge: canvasSync.seedKnowledgeFor(PATH),
    });

    expect(coldOpen).toBe("empty");
    expect(reads, "the stale file was read back into a board the peers had cleared").toEqual([]);
    expect(writes).toEqual([]);
    const projected = buildCanvasData(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    );
    expect(
      projected.nodes.map((n) => n.id),
      "the deleted card came back",
    ).not.toContain(CARD.id);
    expect(files.get(PATH), "the user's file was rewritten").toBe(STALE_FILE);
    canvasSync.destroy();
  });

  it("both witnesses at once still refuses, and an unknown board still seeds", async () => {
    const both = await join({ historyFrames: 1, peerTombstone: true });
    expect(both.canvasSync.seedKnowledgeFor(PATH)).toEqual({
      sidecarKnowsDoc: true,
      peerKnowsDoc: true,
    });
    both.canvasSync.destroy();

    const unknown = await join({});
    const { io } = persistenceIO(unknown.files);
    const { coldOpen } = await attachCanvasPersistence(unknown.doc, io as never, PATH, {
      scheduler: inertScheduler,
      seedKnowledge: unknown.canvasSync.seedKnowledgeFor(PATH),
    });
    expect(coldOpen, "the guard switched seeding off entirely").toBe("seeded-from-file");
    expect(unknown.doc.getMap<Y.Map<unknown>>("nodes").has(CARD.id)).toBe(true);
    unknown.canvasSync.destroy();
  });
});
