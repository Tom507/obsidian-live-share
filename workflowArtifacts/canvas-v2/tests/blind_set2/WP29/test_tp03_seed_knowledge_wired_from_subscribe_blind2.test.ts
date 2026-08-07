// WP29 / AC1 blind2, the wiring half — PER-PATH ISOLATION.
//
// Every single-canvas test of the two conditions is satisfied by an
// implementation that keeps ONE flag pair for the whole `CanvasSync`: subscribe
// one board, ask about that board, get the right answer. The vault has more than
// one canvas in it, they are subscribed in sequence, and a shared flag then
// answers the second board's question with the first board's evidence — which
// either refuses to seed a genuinely new canvas (a silently empty board) or
// re-seeds a live one (R4).
//
// So this file subscribes THREE canvases through ONE `CanvasSync`, gives each a
// different kind of evidence, and asks about all three afterwards — and it asks
// in an order different from the one they were subscribed in, so an
// implementation that returns "the most recent answer" is red too.
//
//   archive.canvas   a sidecar checkpoint, no peer      -> (true,  false)
//   sprint.canvas    a peer hands state over, no sidecar-> (false, true)
//   ideas.canvas     nothing at all                     -> (false, false)
//
// The end-to-end half then cold-opens all three with their own knowledge and
// asserts that exactly ONE of them takes the file.

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { attachCanvasPersistence } from "../../../../../plugin/src/files/canvas-persistence";
import { type SidecarIO, createSidecarStore } from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const BOARDS = {
  archive: { path: "vault/archive.canvas", guid: "11d4f60ab8c8452e9a37e5b0c41d7e92" },
  sprint: { path: "vault/sprint.canvas", guid: "22a7c3e5904b41d8bf16e2d9a7530c4b" },
  ideas: { path: "vault/ideas.canvas", guid: "33fe2b8149d7406cae05913c6bd82a7f" },
};

function fileFor(tag: string): string {
  return JSON.stringify({
    nodes: [
      { id: `${tag}-1`, type: "text", x: 0, y: 0, width: 160, height: 80, text: `${tag} one` },
    ],
    edges: [],
  });
}

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

async function openVault() {
  const files = new Map<string, string>(
    Object.entries(BOARDS).map(([tag, board]) => [board.path, fileFor(tag)]),
  );
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

  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect({ ...sync, waitForSync: async () => {} } as never);
  for (const board of Object.values(BOARDS)) manifest.setCanvasGuid(board.path, board.guid);

  const store = createSidecarStore(memoryIO());

  // `archive` has a sidecar replica; it happens to be an EMPTY board.
  const archived = new Y.Doc();
  archived.transact(() => {
    archived.getMap<unknown>("meta").set("schemaVersion", 2);
  });
  await store.checkpoint(BOARDS.archive.guid, archived);
  archived.destroy();

  // `sprint` has a peer, holding a board with one card on it.
  const peer = new Y.Doc();
  peer.transact(() => {
    peer.getMap<unknown>("meta").set("epoch", 2);
  });
  arriving.set(canvasDocId(BOARDS.sprint.guid), Y.encodeStateAsUpdate(peer));
  peer.destroy();

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

  // Subscribed in this order on purpose; asked about in a different one below.
  for (const board of [BOARDS.archive, BOARDS.sprint, BOARDS.ideas]) {
    await canvasSync.subscribe(board.path, "guest");
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  return { canvasSync, sync, files };
}

function persistenceIO(files: Map<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    io: {
      async read(p: string) {
        reads.push(p);
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
    },
  };
}

const inert = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

describe("WP29 AC1 blind2 — the two conditions are per-path", () => {
  it("three boards in one session keep three different answers", async () => {
    const { canvasSync } = await openVault();

    // Deliberately not the subscribe order.
    expect(canvasSync.seedKnowledgeFor(BOARDS.ideas.path), "ideas.canvas").toEqual({
      sidecarKnowsDoc: false,
      peerKnowsDoc: false,
    });
    expect(canvasSync.seedKnowledgeFor(BOARDS.archive.path), "archive.canvas").toEqual({
      sidecarKnowsDoc: true,
      peerKnowsDoc: false,
    });
    expect(canvasSync.seedKnowledgeFor(BOARDS.sprint.path), "sprint.canvas").toEqual({
      sidecarKnowsDoc: false,
      peerKnowsDoc: true,
    });

    canvasSync.destroy();
  });

  it("asking twice does not change the answer", async () => {
    const { canvasSync } = await openVault();
    const first = canvasSync.seedKnowledgeFor(BOARDS.archive.path);
    const second = canvasSync.seedKnowledgeFor(BOARDS.archive.path);
    expect(second).toEqual(first);
    // ...and asking about one board does not disturb another.
    canvasSync.seedKnowledgeFor(BOARDS.sprint.path);
    expect(canvasSync.seedKnowledgeFor(BOARDS.archive.path)).toEqual(first);
    canvasSync.destroy();
  });

  it("exactly one of the three boards takes its file at cold open", async () => {
    const { canvasSync, sync, files } = await openVault();
    const opened: string[] = [];

    for (const [tag, board] of Object.entries(BOARDS)) {
      const doc = (sync.docs.get(canvasDocId(board.guid)) as { doc: Y.Doc }).doc;
      const { io, reads } = persistenceIO(files);
      const { coldOpen } = await attachCanvasPersistence(doc, io as never, board.path, {
        scheduler: inert,
        seedKnowledge: canvasSync.seedKnowledgeFor(board.path),
      });
      if (reads.length > 0) opened.push(tag);
      expect(coldOpen, `${tag} produced an unexpected outcome`).toBe(
        tag === "ideas" ? "seeded-from-file" : "empty",
      );
    }

    expect(opened, "the wrong set of boards was allowed to seed from disk").toEqual(["ideas"]);
    canvasSync.destroy();
  });

  it("the two known boards keep their files and their empty documents", async () => {
    const { canvasSync, sync, files } = await openVault();
    for (const tag of ["archive", "sprint"] as const) {
      const board = BOARDS[tag];
      const doc = (sync.docs.get(canvasDocId(board.guid)) as { doc: Y.Doc }).doc;
      const { io } = persistenceIO(files);
      await attachCanvasPersistence(doc, io as never, board.path, {
        scheduler: inert,
        seedKnowledge: canvasSync.seedKnowledgeFor(board.path),
      });
      expect(doc.getMap<Y.Map<unknown>>("nodes").size, `${tag} was re-seeded`).toBe(0);
      expect(files.get(board.path), `${tag}'s file was rewritten`).toBe(
        fileFor(tag === "archive" ? "archive" : "sprint"),
      );
    }
    canvasSync.destroy();
  });
});
