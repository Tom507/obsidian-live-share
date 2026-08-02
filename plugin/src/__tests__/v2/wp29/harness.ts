// WP29 — shared fixtures for the SEED-ONCE / no-destructive-re-seed suite.
//
// Four design choices carry this file, and each exists because one of WP29's
// acceptance criteria is written in a way an ordinary end-state oracle cannot
// discriminate.
//
//   1. THE SURVIVAL ORACLE IS THE PROJECTION, NEVER RAW KEY PRESENCE.
//      Post-WP19 a removal instruction is a TOMBSTONE, not a missing key, so
//      "the peer's record survived" spelled as `nodes.get(id) !== undefined`
//      would stay green against a seed that tombstoned every record the host's
//      file omitted — the exact class WP64 swept out of this tree.
//      {@link surviving} therefore reads `buildCanvasData(nodes, edges,
//      deleted)`, which is what a peer, the file and the view actually see, and
//      {@link suppressed} names the tombstone directly.
//
//   2. PEER STATE ARRIVES DURING `waitForSync`, AS A REAL UPDATE.
//      AC1's second condition is "any peer knows the doc". A test that
//      pre-populates the doc before `subscribe` is testing doc emptiness, which
//      is the condition that already existed. The sync-manager double therefore
//      carries an optional per-doc peer update and applies it INSIDE
//      `waitForSync`, authored by a different `Y.Doc` — so the receiving replica
//      genuinely gains foreign state at the peer-sync step, and the two AC1
//      conditions can be varied independently.
//
//   3. ONE SHARED TRACE FOR THE ORDERING CLAIM (AC4). `coldOpen`-after-
//      `waitForSync`-before-`start()` is a pure ordering claim: the end state is
//      identical whichever order the steps ran in. Every seam appends to ONE
//      array and the assertions are about the sequence in it.
//
//   4. NO CONCURRENT SAME-KEY WRITES ANYWHERE. Yjs tie-breaks concurrent writes
//      to one key on `clientID`, which is `random.uint32()`. Every value this
//      suite asserts on has a single author or a causal predecessor chain; where
//      two sides both hold a record, they hold DIFFERENT ids.

import { TFile } from "obsidian";
import { vi } from "vitest";
import * as Y from "yjs";

import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import type { PersistenceIO, PersistenceScheduler } from "../../../files/canvas-persistence";
import type { SidecarIO } from "../../../files/canvas-sidecar";
import { DELETED_MAP_NAME, buildCanvasData } from "../../../files/canvas-sync";
import { ManifestManager } from "../../../files/manifest";

export const CANVAS_PATH = "boards/plan.canvas";
export const FIXED_GUID = "3c81a75e9f2b47d6a0e14c5b8d7629fa";

// --- record fixtures ---------------------------------------------------------
// Complete, legal JSON Canvas records. A shorthand node (`{id, x, y}`) is
// refused by C18 AC1 at both seed boundaries, and a test built on one fails on
// its scenery instead of on its subject (BUILD_SPEC §7, fixture-completion).

export function textNode(id: string, x: number, text: string): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text };
}

export function edge(id: string, from: string, to: string): Record<string, unknown> {
  return { id, fromNode: from, fromSide: "right", toNode: to, toSide: "left" };
}

export function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

// --- the survival oracle -----------------------------------------------------

export interface Projection {
  nodes: string[];
  edges: string[];
}

/** What a peer, the `.canvas` file and the open view can actually see. */
export function surviving(doc: Y.Doc): Projection {
  const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    deleted,
  );
  return {
    nodes: data.nodes.map((n) => String(n.id)),
    edges: data.edges.map((e) => String(e.id)),
  };
}

/** True iff `id` is currently suppressed by a tombstone (WP19's removal shape). */
export function suppressed(doc: Y.Doc, id: string): boolean {
  return isTombstoneSuppressed(readTombstoneEntry(doc.getMap<unknown>(DELETED_MAP_NAME), id));
}

/** One record's fields, read out of `nodes`/`edges`. */
export function fieldsOf(
  doc: Y.Doc,
  kind: "nodes" | "edges",
  id: string,
): Record<string, unknown> | undefined {
  const record = doc.getMap<Y.Map<unknown>>(kind).get(id);
  return record ? (record.toJSON() as Record<string, unknown>) : undefined;
}

// --- the ordering trace ------------------------------------------------------

export type Trace = string[];

export function createTrace(): Trace {
  return [];
}

export function firstContaining(trace: Trace, fragment: string): number {
  return trace.findIndex((entry) => entry.includes(fragment));
}

// --- the sync manager double -------------------------------------------------

export interface FakeDocHandle {
  doc: Y.Doc;
  text: Y.Text;
  awareness: unknown;
}

export interface FakeSyncManager {
  docs: Map<string, FakeDocHandle>;
  synced: string[];
  /**
   * Per-doc-id update a PEER will hand over during `waitForSync`. Registered
   * with {@link peerHolds}; applied inside `waitForSync` so the replica gains
   * foreign state exactly at the peer-sync step and not before it.
   */
  peerUpdates: Map<string, Uint8Array>;
  peerHolds(docId: string, build: (peer: Y.Doc) => void): void;
  getDoc(docId: string): FakeDocHandle;
  releaseDoc(docId: string): void;
  waitForSync(docId: string): Promise<void>;
}

export function createSyncManager(trace: Trace = []): FakeSyncManager {
  const docs = new Map<string, FakeDocHandle>();
  const synced: string[] = [];
  const peerUpdates = new Map<string, Uint8Array>();

  const manager: FakeSyncManager = {
    docs,
    synced,
    peerUpdates,
    peerHolds(docId: string, build: (peer: Y.Doc) => void) {
      const peer = new Y.Doc();
      build(peer);
      peerUpdates.set(docId, Y.encodeStateAsUpdate(peer));
      peer.destroy();
    },
    getDoc(docId: string) {
      trace.push(`sync:getDoc:${docId}`);
      let handle = docs.get(docId);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(docId, handle);
      }
      return handle;
    },
    releaseDoc(docId: string) {
      trace.push(`sync:releaseDoc:${docId}`);
    },
    async waitForSync(docId: string) {
      synced.push(docId);
      trace.push(`sync:waitForSync:start:${docId}`);
      await Promise.resolve();
      const update = peerUpdates.get(docId);
      const handle = docs.get(docId);
      if (update && handle) Y.applyUpdate(handle.doc, update);
      trace.push(`sync:waitForSync:end:${docId}`);
    },
  };
  return manager;
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
  adapter: {
    read: (p: string) => Promise<string>;
    write: (p: string, c: string) => Promise<void>;
    exists: (p: string) => Promise<boolean>;
  };
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
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
  };
}

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

/** A live `ManifestManager` whose own `waitForSync` is kept out of the trace. */
export async function createManifest(
  vault: FakeVault,
  sync: FakeSyncManager,
): Promise<ManifestManager> {
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  await manifest.connect({ ...sync, waitForSync: async () => {} } as never);
  return manifest;
}

// --- the sidecar IO double (WP24's own interface) ----------------------------

export interface RecordingSidecarIO extends SidecarIO {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
  ops: string[];
}

export function createSidecarIO(trace: Trace = []): RecordingSidecarIO {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const ops: string[] = [];

  async function run<T>(op: string, path: string, body: () => T): Promise<T> {
    ops.push(`${op}:${path}`);
    trace.push(`sidecar:${op}:start:${path}`);
    await Promise.resolve();
    const out = body();
    trace.push(`sidecar:${op}:end:${path}`);
    return out;
  }

  return {
    files,
    dirs,
    ops,
    ensureDir: (dirPath: string) =>
      run("ensureDir", dirPath, () => {
        dirs.add(dirPath);
      }),
    exists: (filePath: string) => run("exists", filePath, () => files.has(filePath)),
    read: (filePath: string) =>
      run("read", filePath, () => {
        const found = files.get(filePath);
        if (found === undefined) throw new Error(`ENOENT: ${filePath}`);
        return Uint8Array.from(found);
      }),
    write: (filePath: string, data: Uint8Array) =>
      run("write", filePath, () => {
        files.set(filePath, Uint8Array.from(data));
      }),
    append: (filePath: string, data: Uint8Array) =>
      run("append", filePath, () => {
        const prev = files.get(filePath) ?? new Uint8Array(0);
        const next = new Uint8Array(prev.length + data.length);
        next.set(prev, 0);
        next.set(data, prev.length);
        files.set(filePath, next);
      }),
    truncate: (filePath: string) =>
      run("truncate", filePath, () => {
        files.set(filePath, new Uint8Array(0));
      }),
    remove: (filePath: string) =>
      run("remove", filePath, () => {
        files.delete(filePath);
      }),
  };
}

// --- the persistence IO double ----------------------------------------------

export interface RecordingPersistenceIO extends PersistenceIO {
  reads: string[];
  writes: string[];
}

export function createPersistenceIO(
  files: Map<string, string>,
  trace: Trace = [],
): RecordingPersistenceIO {
  const reads: string[] = [];
  const writes: string[] = [];
  return {
    reads,
    writes,
    async read(path: string) {
      reads.push(path);
      trace.push(`persistence:read:${path}`);
      return files.get(path) ?? "";
    },
    async write(path: string, content: string) {
      writes.push(content);
      trace.push(`persistence:write:${path}`);
      files.set(path, content);
    },
    async exists(path: string) {
      trace.push(`persistence:exists:${path}`);
      return files.has(path);
    },
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  };
}

// --- a manual scheduler so "a timer was armed" is directly countable ---------

export interface ManualScheduler extends PersistenceScheduler {
  pending(): number;
  runAll(): void;
}

export function createManualScheduler(): ManualScheduler {
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    now: () => clock++,
    setTimeout(cb: () => void) {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    runAll() {
      for (const [id, cb] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
  };
}

/** Drain the microtask queue without touching the clock. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Count the transactions a doc experiences while `body` runs. */
export async function countTransactions(doc: Y.Doc, body: () => Promise<void>): Promise<number> {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on("afterTransaction", listener);
  try {
    await body();
  } finally {
    doc.off("afterTransaction", listener);
  }
  return count;
}
