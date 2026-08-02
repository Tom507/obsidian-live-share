// WP27 — shared fixtures for the GUID doc-identity probes.
//
// The one design choice that matters here: the fake `SyncManager` RECORDS every
// doc id it is asked for and never destroys a doc on `releaseDoc`. Both are
// deliberate.
//
//   ├── `requested` is the only channel through which AC4 can be tested at all.
//   │   Once a canvas doc is `__canvas__:<guid>`, a bare path collides with
//   │   nothing, so "no canvas doc came back" is true against an UNGUARDED call
//   │   site as well. What discriminates is whether the call happened, and that
//   │   is an observation about the CALLER, not about the doc.
//   └── `released` + a non-destroying `releaseDoc` is what makes "no orphaned
//       doc" observable across a rename: the doc must still be there afterwards,
//       under the same id, as the same object.
//
// The IO double is the real WP24 `SidecarIO` contract, so `index.json` is
// exercised through WP24's own store rather than through a second, agreeing
// re-implementation of its JSON encoding.

import { TFile } from "obsidian";
import { vi } from "vitest";
import * as Y from "yjs";

import type { SidecarIO } from "../../../files/canvas-sidecar";
import { ManifestManager } from "../../../files/manifest";

export const CANVAS_PATH = "boards/board.canvas";
export const RENAMED_PATH = "boards/archive/plan.canvas";
export const MARKDOWN_PATH = "notes/journal.md";

/** A fixed guid. Fixture-supplied, never generated — see the charter §7 note. */
export const FIXED_GUID = "0f2a9c6e1b4d47aa9d316c0e2f8b5a70";

export const NODE_A = {
  id: "n-a",
  type: "text",
  x: 0,
  y: 0,
  width: 120,
  height: 60,
  text: "alpha",
};

export const NODE_B = {
  id: "n-b",
  type: "text",
  x: 400,
  y: 0,
  width: 120,
  height: 60,
  text: "beta",
};

export function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

// --- the sync manager double -------------------------------------------------

export interface FakeDocHandle {
  doc: Y.Doc;
  text: Y.Text;
  awareness: unknown;
}

export interface FakeSyncManager {
  docs: Map<string, FakeDocHandle>;
  /** Every id ever passed to `getDoc`, in order, duplicates included. */
  requested: string[];
  /** Every id ever passed to `releaseDoc`. */
  released: string[];
  /** Every id ever passed to `waitForSync`. */
  synced: string[];
  getDoc(docId: string): FakeDocHandle;
  releaseDoc(docId: string): void;
  waitForSync(docId: string): Promise<void>;
}

export function createSyncManager(): FakeSyncManager {
  const docs = new Map<string, FakeDocHandle>();
  const requested: string[] = [];
  const released: string[] = [];
  const synced: string[] = [];
  return {
    docs,
    requested,
    released,
    synced,
    getDoc(docId: string) {
      requested.push(docId);
      let handle = docs.get(docId);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(docId, handle);
      }
      return handle;
    },
    releaseDoc(docId: string) {
      released.push(docId);
    },
    async waitForSync(docId: string) {
      synced.push(docId);
    },
  };
}

/** Distinct ids in the canvas namespace that were ever asked for, sorted. */
export function canvasIdsRequested(sync: FakeSyncManager, prefix: string): string[] {
  return [...new Set(sync.requested.filter((id) => id.startsWith(prefix)))].sort();
}

/** Distinct ids in the canvas namespace that actually EXIST, sorted. */
export function canvasDocsAlive(sync: FakeSyncManager, prefix: string): string[] {
  return [...sync.docs.keys()].filter((id) => id.startsWith(prefix)).sort();
}

// --- the vault double --------------------------------------------------------

export interface FakeVault {
  files: Map<string, string>;
  read: (file: { path: string }) => Promise<string>;
  modify: (file: { path: string }, content: string) => Promise<void>;
  create: (path: string, content: string) => Promise<unknown>;
  getFiles: () => unknown[];
  createFolder: (path: string) => Promise<unknown>;
  getAllLoadedFiles: () => unknown[];
  getAbstractFileByPath: (path: string) => unknown;
  adapter: { write: (p: string, c: string) => Promise<void> };
}

export function createVault(initial: Record<string, string> = {}): FakeVault {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    modify: vi.fn(async (file: { path: string }, content: string) => {
      files.set(file.path, content);
    }),
    create: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return {};
    }),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((path: string) => {
      if (!files.has(path)) return null;
      const f = new TFile();
      f.path = path;
      return f;
    }),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
    },
  };
}

// --- the sidecar IO double (WP24's own interface) ----------------------------

export interface MemoryIO extends SidecarIO {
  files: Map<string, Uint8Array>;
}

export function createMemoryIO(): MemoryIO {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    ensureDir: vi.fn(async () => {}),
    exists: vi.fn(async (p: string) => files.has(p)),
    read: vi.fn(async (p: string) => {
      const bytes = files.get(p);
      if (!bytes) throw new Error(`no such sidecar file: ${p}`);
      return bytes;
    }),
    write: vi.fn(async (p: string, data: Uint8Array) => {
      files.set(p, new Uint8Array(data));
    }),
    append: vi.fn(async (p: string, data: Uint8Array) => {
      const prev = files.get(p) ?? new Uint8Array();
      const out = new Uint8Array(prev.length + data.length);
      out.set(prev, 0);
      out.set(data, prev.length);
      files.set(p, out);
    }),
    truncate: vi.fn(async (p: string) => {
      files.set(p, new Uint8Array());
    }),
    remove: vi.fn(async (p: string) => {
      files.delete(p);
    }),
  };
}

// --- the REAL manifest, over the doubles above -------------------------------

/**
 * A live `ManifestManager` on a real `Y.Map`. `sharedFolder: ""` makes every
 * path shared, so `isSharedPath` never silently swallows a fixture.
 */
export async function createManifest(
  vault: FakeVault,
  sync: FakeSyncManager,
): Promise<ManifestManager> {
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect(sync as never);
  return manifest;
}

// --- misc --------------------------------------------------------------------

export function createFileOps() {
  const muted = new Set<string>();
  return {
    muted,
    mutePathEvents: vi.fn((p: string) => {
      muted.add(p);
    }),
    unmutePathEvents: vi.fn((p: string) => {
      muted.delete(p);
    }),
    isPathMuted: vi.fn((p: string) => muted.has(p)),
  };
}

/**
 * Apply a delta the way a PEER would — through a second doc and a real update —
 * so the receiving doc sees a NON-local transaction and its observers fire.
 */
export function applyRemoteDelta(doc: Y.Doc, build: (peer: Y.Doc) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

/** Write a V1-shaped (flat geometry, no `meta`) record into a doc. */
export function seedV1Node(doc: Y.Doc, node: Record<string, unknown>): void {
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set(String(node.id), record);
    for (const [key, value] of Object.entries(node)) record.set(key, value);
  });
}
